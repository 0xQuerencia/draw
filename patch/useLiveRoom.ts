import type { OrderedExcalidrawElement as El } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../store';
import { useExcalidrawFilesStore } from '../store/excalidrawFiles';
import { rememberRoom } from '../utils/recentRooms';

export type Viewport = { scrollX: number; scrollY: number; zoom: number };
export type Sticker = { id: string; emoji: string; x: number; y: number; size: number };
export type Reaction = { id: string; emoji: string; x: number; y: number; at: number };
export type Reply = { id: string; body: string; author: string; at: number };
export type Comment = { id: string; x: number; y: number; kind: 'comment' | 'note'; body: string;
  author: string; at: number; resolved: boolean; replies: Reply[] };
export const EMOJI = ['❤️', '✨', '🎉', '👍', '😂', '🥹', '🔥', '💜'] as const;
export type Member = { id: string; name: string; pointer?: { x: number; y: number } | null; viewport?: Viewport | null };
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
  const [roomName, setRoomNameState] = useState('Untitled board');
  const [roomTab, setRoomTab] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<RoomStatus>(room ? 'connecting' : 'private');
  const [members, setMembers] = useState<Member[]>([]);
  const [following, setFollowing] = useState<string | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ scrollX: 0, scrollY: 0, zoom: 1 });
  const followingRef = useRef<string | null>(null);
  const lastView = useRef(0);
  const lastPointer = useRef(0);
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
    if (!room) { setRoomTab(null); setHydrated(false); setStatus('private'); setStickers([]); setReactions([]); setComments([]); followingRef.current = null; setFollowing(null); return; }
    followingRef.current = null; setFollowing(null); setMembers([]); setRoomNameState('Untitled board');
    rememberRoom(room);
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
    if (current.roomTab === null) return [];
    const stored = useAppStore.getState().tabs.find(t => t.id === current.roomTab)?.elements || [];
    const combined = merge((stored as readonly El[]).filter(e => e.index !== null), incoming);
    applying.current = true;
    useAppStore.getState().updateTab(current.roomTab, { elements: combined });
    if (current.tabId === current.roomTab) current.api?.updateScene({ elements: combined });
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
          setStickers(Array.isArray(message.stickers) ? message.stickers : []);
          setComments(Array.isArray(message.comments) ? message.comments : []);
          if (message.meta && typeof message.meta.title === 'string') {
            setRoomNameState(message.meta.title);
            rememberRoom(room, { title: message.meta.title, updatedAt: Number(message.meta.updatedAt) || Date.now() });
          }
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
        } else if (message.type === 'view') {
          const v = message.viewport as Viewport | undefined;
          if (!v || !Number.isFinite(v.scrollX) || !Number.isFinite(v.scrollY) || !Number.isFinite(v.zoom)) return;
          setMembers(prev => prev.map(m => m.id === message.id ? { ...m, viewport: v } : m));
          if (followingRef.current === message.id && latest.current.api) {
            applying.current = true;
            latest.current.api.updateScene({ appState: {
              scrollX: v.scrollX, scrollY: v.scrollY, zoom: { value: v.zoom } as AppState['zoom']
            } });
            setViewport(v);
            setTimeout(() => { applying.current = false; }, 120);
          }
        } else if (message.type === 'reaction') {
          const r = message.reaction as Reaction | undefined;
          if (!r || !EMOJI.includes(r.emoji as typeof EMOJI[number])) return;
          setReactions(prev => [...prev.slice(-18), { ...r, at: Date.now() }]);
        } else if (message.type === 'room_meta') {
          const meta = message.meta;
          if (meta && typeof meta.title === 'string') {
            setRoomNameState(meta.title);
            rememberRoom(room, { title: meta.title, updatedAt: Number(meta.updatedAt) || Date.now() });
          }
        } else if (message.type === 'comments') {
          if (Array.isArray(message.comments)) setComments(message.comments as Comment[]);
        } else if (message.type === 'sticker') {
          const item = message.sticker as Sticker | undefined;
          if (!item || typeof item.id !== 'string') return;
          setStickers(prev => message.op === 'delete'
            ? prev.filter(s => s.id !== item.id)
            : [...prev.filter(s => s.id !== item.id), item]);
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
    const now = Date.now();
    if (now - lastPointer.current < 45) return;
    lastPointer.current = now;
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'pointer', pointer }));
  }, []);
  const sendView = useCallback((state: AppState) => {
    if (room && roomTab === tabId) {
      setViewport(prev => prev.scrollX === state.scrollX && prev.scrollY === state.scrollY && prev.zoom === state.zoom.value
        ? prev : { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value });
    }
    if (!room || !hydrated || roomTab !== tabId || followingRef.current) return;
    const now = Date.now();
    if (now - lastView.current < 125) return;
    lastView.current = now;
    if (ws.current?.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({ type: 'view', viewport: {
      scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value
    } }));
  }, [room, hydrated, tabId, roomTab]);
  const setRoomName = useCallback((raw: string) => {
    const title = raw.trim().slice(0, 80) || 'Untitled board';
    if (!room) return;
    setRoomNameState(title);
    rememberRoom(room, { title });
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: 'room_meta', title }));
  }, [room]);

  const createComment = useCallback((data: { x: number; y: number; kind: 'comment' | 'note'; body: string }) => {
    if (!room || ws.current?.readyState !== WebSocket.OPEN) return;
    const body = data.body.trim().slice(0, 500);
    if (!body) return;
    const comment: Comment = { id: crypto.randomUUID(), ...data, body, author: name,
      at: Date.now(), resolved: false, replies: [] };
    setComments(prev => [...prev, comment]);
    ws.current.send(JSON.stringify({ type: 'comment_event', op: 'add', comment }));
  }, [room, name]);

  const replyComment = useCallback((id: string, body: string) => {
    if (!room || ws.current?.readyState !== WebSocket.OPEN || !body.trim()) return;
    const reply: Reply = { id: crypto.randomUUID(), body: body.trim().slice(0, 500), author: name, at: Date.now() };
    setComments(prev => prev.map(c => c.id === id ? { ...c, replies: [...c.replies, reply] } : c));
    ws.current.send(JSON.stringify({ type: 'comment_event', op: 'reply', id, reply }));
  }, [room, name]);

  const resolveComment = useCallback((id: string, resolved: boolean) => {
    if (!room || ws.current?.readyState !== WebSocket.OPEN) return;
    setComments(prev => prev.map(c => c.id === id ? { ...c, resolved } : c));
    ws.current.send(JSON.stringify({ type: 'comment_event', op: 'resolve', id, resolved }));
  }, [room]);

  const sendReaction = useCallback((emoji: string) => {
    if (!room || !EMOJI.includes(emoji as typeof EMOJI[number]) || ws.current?.readyState !== WebSocket.OPEN) return;
    const reaction: Reaction = { id: crypto.randomUUID(), emoji, x: .5, y: .6, at: Date.now() };
    setReactions(prev => [...prev.slice(-18), reaction]);
    ws.current.send(JSON.stringify({ type: 'reaction', reaction }));
  }, [room]);

  const sendSticker = useCallback((sticker: Sticker) => {
    if (!room || ws.current?.readyState !== WebSocket.OPEN) return;
    setStickers(prev => [...prev.filter(s => s.id !== sticker.id), sticker]);
    ws.current.send(JSON.stringify({ type: 'sticker', op: 'upsert', sticker }));
  }, [room]);

  const deleteSticker = useCallback((sticker: Sticker) => {
    if (!room || ws.current?.readyState !== WebSocket.OPEN) return;
    setStickers(prev => prev.filter(s => s.id !== sticker.id));
    ws.current.send(JSON.stringify({ type: 'sticker', op: 'delete', sticker }));
  }, [room]);

  useEffect(() => {
    if (!reactions.length) return;
    const timer = setTimeout(() => setReactions(prev => prev.filter(r => Date.now() - r.at < 2800)), 500);
    return () => clearTimeout(timer);
  }, [reactions]);

  const follow = useCallback((id: string) => {
    if (!id || id === CLIENT) return;
    followingRef.current = id;
    setFollowing(id);
    const target = members.find(m => m.id === id)?.viewport;
    if (target && latest.current.api) {
      applying.current = true;
      latest.current.api.updateScene({ appState: {
        scrollX: target.scrollX, scrollY: target.scrollY,
        zoom: { value: target.zoom } as AppState['zoom']
      } });
      setViewport(target);
      setTimeout(() => { applying.current = false; }, 120);
    }
  }, [members]);
  const stopFollowing = useCallback(() => {
    followingRef.current = null;
    setFollowing(null);
  }, []);
  useEffect(() => {
    if (!following) return;
    const stopOnInput = (event: Event) => {
      if ((event.target as HTMLElement | null)?.closest?.('.excalidraw')) stopFollowing();
    };
    const stopOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') stopFollowing(); };
    window.addEventListener('wheel', stopOnInput, { passive: true });
    window.addEventListener('pointerdown', stopOnInput);
    window.addEventListener('keydown', stopOnEscape);
    return () => {
      window.removeEventListener('wheel', stopOnInput);
      window.removeEventListener('pointerdown', stopOnInput);
      window.removeEventListener('keydown', stopOnEscape);
    };
  }, [following, stopFollowing]);
  const start = useCallback(() => { location.hash = 'room=' + crypto.randomUUID().replace(/-/g, ''); }, []);
  const leave = useCallback(() => { location.hash = 'local'; }, []);
  const setDisplayName = useCallback((value: string) => { const clean = value.trim().slice(0, 32) || 'Guest'; localStorage.setItem('draw-name', clean); setName(clean); }, []);
  const shareUrl = room ? location.origin + '/#room=' + room : '';
  return { room, roomTab, hydrated, status, members, clientId: CLIENT, following, follow, stopFollowing,
    viewport, api, roomName, setRoomName, stickers, reactions, comments, createComment, replyComment, resolveComment, sendReaction, sendSticker, deleteSticker, sendView, name, error, start, leave, setDisplayName,
    shareUrl, sendPointer, sceneChanged, isApplyingRemote: () => applying.current };
}
