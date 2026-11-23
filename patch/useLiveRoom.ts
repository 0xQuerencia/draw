import type { OrderedExcalidrawElement as El } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { useExcalidrawFilesStore } from '../store/excalidrawFiles';

export type Member = { id: string; name: string; pointer?: { x: number; y: number } | null };
export type RoomStatus = 'private' | 'connecting' | 'connected' | 'offline';
const CLIENT = crypto.randomUUID();
const parseRoom = () => {
  const id = new URLSearchParams(location.hash.slice(1)).get('room');
  return id && /^[a-f0-9]{32}$/.test(id) ? id : null;
};
const newer = (a: El | undefined, b: El) => !a || b.version > a.version || (b.version === a.version && b.versionNonce > a.versionNonce);
const merge = (old: readonly El[], next: readonly El[]): El[] => {
  const items = new Map(old.map(e => [e.id, e]));
  for (const el of next) if (el?.id && newer(items.get(el.id), el)) items.set(el.id, el);
  return [...items.values()];
};

export function useLiveRoom(api: ExcalidrawImperativeAPI | null, tabId: number) {
  const [room, setRoom] = useState<string | null>(parseRoom);
  const [roomTab, setRoomTab] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<RoomStatus>(room ? 'connecting' : 'private');
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState(() => localStorage.getItem('draw-name') || 'Guest');
  const ws = useRef<WebSocket | null>(null);
  const applying = useRef(false);
  const sent = useRef(new Map<string, string>());
  const pending = useRef(new Map<string, El>());
  const pendingFiles = useRef<BinaryFiles>({});
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ api, tabId, roomTab });
  latest.current = { api, tabId, roomTab };
  const { setFiles, getFiles } = useExcalidrawFilesStore();

  useEffect(() => {
    const hash = () => setRoom(parseRoom());
    window.addEventListener('hashchange', hash);
    return () => window.removeEventListener('hashchange', hash);
  }, []);

  useEffect(() => {
    if (!room) { setRoomTab(null); setHydrated(false); setStatus('private'); return; }
    const key = 'draw-room-tab:' + room;
    const saved = localStorage.getItem(key);
    const existing = saved === null ? NaN : Number(saved);
    const store = useAppStore.getState();
    const id = Number.isFinite(existing) && store.tabs.some(t => t.id === existing) ? existing : store.createTab();
    localStorage.setItem(key, String(id));
    useAppStore.getState().setCurrentTabId(id);
    setRoomTab(id);
    setHydrated(false);
    setStatus('connecting');
  }, [room]);

  const apply = useCallback((incoming: El[], files: BinaryFiles) => {
    const current = latest.current;
    if (!current.api || current.roomTab === null) return [];
    const stored = useAppStore.getState().tabs.find(t => t.id === current.roomTab)?.elements || [];
    const combined = merge(stored, incoming);
    applying.current = true;
    useAppStore.getState().updateTab(current.roomTab, { elements: combined });
    if (current.tabId === current.roomTab) current.api.updateScene({ elements: combined });
    if (Object.keys(files).length) void getFiles().then(all => {
      const joined = { ...all, ...files };
      void setFiles(joined);
      current.api?.addFiles(Object.values(files));
    });
    setTimeout(() => { applying.current = false; }, 160);
    return combined;
  }, [getFiles, setFiles]);

  const flush = useCallback(() => {
    if (ws.current?.readyState !== WebSocket.OPEN || !hydrated) return;
    const elements = [...pending.current.values()].filter(e => {
      const stamp = e.version + ':' + e.versionNonce;
      if (sent.current.get(e.id) === stamp) return false;
      sent.current.set(e.id, stamp);
      return true;
    });
    const files = pendingFiles.current;
    if (!elements.length && !Object.keys(files).length) return;
    pending.current.clear();
    pendingFiles.current = {};
    ws.current.send(JSON.stringify({ type: 'patch', elements, files }));
  }, [hydrated]);

  useEffect(() => {
    if (!room || roomTab === null) return;
    let closed = false;
    pending.current.clear();
    pendingFiles.current = {};
    sent.current.clear();
    setHydrated(false);
    const connect = () => {
      if (closed) return;
      setStatus('connecting');
      const url = 'wss://sync.querencia.art/room/' + room + '?client=' + encodeURIComponent(CLIENT) + '&name=' + encodeURIComponent(name);
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => { setError(''); };
      socket.onmessage = event => {
        let message: any;
        try { message = JSON.parse(event.data as string); } catch { return; }
        if (message.type === 'snapshot') {
          const elements = Array.isArray(message.elements) ? message.elements as El[] : [];
          const files = message.files && typeof message.files === 'object' ? message.files as BinaryFiles : {};
          const joined = apply(elements, files);
          setMembers(Array.isArray(message.members) ? message.members : []);
          setStatus('connected');
          setHydrated(true);
          // Restore offline edits that are newer than the server snapshot.
          const server = new Map(elements.map(e => [e.id, e]));
          for (const el of joined) if (newer(server.get(el.id), el)) pending.current.set(el.id, el);
          void getFiles().then(all => {
            for (const [id, file] of Object.entries(all)) if (!files[id]) pendingFiles.current[id] = file;
            if (socket.readyState === WebSocket.OPEN && (pending.current.size || Object.keys(pendingFiles.current).length)) {
              const diff = [...pending.current.values()];
              pending.current.clear();
              const uploads = pendingFiles.current;
              pendingFiles.current = {};
              socket.send(JSON.stringify({ type: 'patch', elements: diff, files: uploads }));
              for (const el of diff) sent.current.set(el.id, el.version + ':' + el.versionNonce);
            }
          });
        } else if (message.type === 'patch') {
          const incoming = Array.isArray(message.elements) ? message.elements as El[] : [];
          apply(incoming, message.files || {});
          for (const el of incoming) sent.current.set(el.id, el.version + ':' + el.versionNonce);
        } else if (message.type === 'members') {
          setMembers(Array.isArray(message.members) ? message.members : []);
        } else if (message.type === 'pointer') {
          setMembers(prev => prev.map(m => m.id === message.id ? { ...m, pointer: message.pointer } : m));
        }
      };
      socket.onclose = () => {
        if (ws.current !== socket || closed) return;
        setStatus('offline');
        setHydrated(false);
        retry.current = setTimeout(connect, 1200 + Math.random() * 1500);
      };
      socket.onerror = () => setError('Could not reach the collaboration server');
    };
    connect();
    return () => {
      closed = true;
      if (retry.current) clearTimeout(retry.current);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      ws.current?.close();
      ws.current = null;
    };
  }, [room, roomTab, name, apply, getFiles]);

  const sceneChanged = useCallback((elements: readonly El[], files: BinaryFiles) => {
    if (!room || tabId !== roomTab || applying.current || !hydrated) return;
    for (const el of elements) if (sent.current.get(el.id) !== el.version + ':' + el.versionNonce) pending.current.set(el.id, el);
    for (const [key, file] of Object.entries(files)) if (!pendingFiles.current[key]) pendingFiles.current[key] = file;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flush, 180);
  }, [room, tabId, roomTab, hydrated, flush]);

  const sendPointer = useCallback((pointer: { x: number; y: number }) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'pointer', pointer }));
  }, []);
  const start = useCallback(() => { location.hash = 'room=' + crypto.randomUUID().replace(/-/g, ''); }, []);
  const leave = useCallback(() => { location.hash = 'local'; }, []);
  const setDisplayName = useCallback((value: string) => { const clean = value.trim().slice(0, 32) || 'Guest'; localStorage.setItem('draw-name', clean); setName(clean); }, []);
  const shareUrl = room ? location.origin + '/#room=' + room : '';
  return { room, roomTab, hydrated, status, members, name, error, start, leave, setDisplayName,
    shareUrl, sendPointer, sceneChanged, isApplyingRemote: () => applying.current };
}
