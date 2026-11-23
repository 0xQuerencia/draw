export type RecentRoom = { id: string; title: string; lastOpened: number; updatedAt: number; pinned: boolean; preview?: string };
const KEY = 'draw:recent-rooms';
const valid = (id: string) => /^[a-f0-9]{32}$/.test(id);
export const loadRooms = (): RecentRoom[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((x: RecentRoom) => x && valid(x.id)).slice(0, 50) : [];
  } catch { return []; }
};
export const saveRooms = (rooms: RecentRoom[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(rooms.slice(0, 50))); } catch { /* local storage may be full */ }
  window.dispatchEvent(new Event('draw:rooms-updated'));
};
export const rememberRoom = (id: string, changes: Partial<Omit<RecentRoom, 'id'>> = {}) => {
  if (!valid(id)) return;
  const rooms = loadRooms();
  const old = rooms.find(r => r.id === id);
  const latest: RecentRoom = { id, title: 'Untitled board', lastOpened: Date.now(), updatedAt: Date.now(), pinned: false,
    ...old, ...changes };
  saveRooms([latest, ...rooms.filter(r => r.id !== id)]);
};
export function captureRoom(id: string) {
  if (!valid(id)) return;
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.excalidraw canvas')];
  const source = canvases.filter(c => c.width > 100 && c.height > 100).sort((a,b) => b.width*b.height - a.width*a.height)[0];
  if (!source) return;
  try {
    const output = document.createElement('canvas');
    output.width = 288; output.height = 176;
    const context = output.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, output.width, output.height);
    context.drawImage(source, 0, 0, output.width, output.height);
    rememberRoom(id, { preview: output.toDataURL('image/webp', .62), updatedAt: Date.now() });
  } catch { /* a tainted canvas must not break drawing */ }
}
