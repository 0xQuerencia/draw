import { useEffect, useMemo, useState } from 'react';
import { loadRooms, rememberRoom, saveRooms } from '../utils/recentRooms';
import type { RecentRoom } from '../utils/recentRooms';

const card = { background: '#fff', border: '1px solid #ebe7ed', borderRadius: 15,
  padding: 0, overflow: 'hidden', boxShadow: '0 2px 9px #211b2610' } as const;
const button = { background: '#fff', border: '1px solid #d6ced9', borderRadius: 9,
  padding: '10px 14px', fontSize: 14, fontWeight: 600, color: '#3a3141', cursor: 'pointer' } as const;
const primary = { ...button, background: '#5c4981', color: '#fff', border: '1px solid #5c4981' } as const;
const go = (id: string) => { location.hash = 'room=' + id; };
const newRoom = () => go(crypto.randomUUID().replace(/-/g, ''));

export default function RoomDashboard() {
  const [rooms, setRooms] = useState<RecentRoom[]>(loadRooms);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'pinned'>('all');
  useEffect(() => {
    const update = () => setRooms(loadRooms());
    window.addEventListener('draw:rooms-updated', update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener('draw:rooms-updated', update); window.removeEventListener('storage', update); };
  }, []);
  const shown = useMemo(() => rooms.filter(r => (filter === 'all' || r.pinned)
    && r.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a,b) => Number(b.pinned) - Number(a.pinned) || b.lastOpened - a.lastOpened), [rooms, query, filter]);
  const pin = (id: string) => {
    const next = rooms.map(r => r.id === id ? { ...r, pinned: !r.pinned } : r);
    saveRooms(next);
  };
  const forget = (id: string) => {
    saveRooms(rooms.filter(r => r.id !== id));
  };
  const open = (id: string) => { rememberRoom(id); go(id); };
  return <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '32px clamp(18px,5vw,80px) 90px',
    background: '#faf9f7', color: '#302d36', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}>
    <header style={{ maxWidth: 1150, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <a href="/" style={{ color: '#3d3444', fontWeight: 800, fontSize: 22, textDecoration: 'none',
        letterSpacing: '-.05em' }}>✳ draw<span style={{ color: '#9c8cb7' }}>.</span></a>
      <span style={{ fontSize: 12, color: '#807789' }}>Your collaborative workspace</span>
    </header>
    <section style={{ maxWidth: 1150, margin: '64px auto 48px' }}>
      <div style={{ textTransform: 'uppercase', fontSize: 11, fontWeight: 750, letterSpacing: '.14em',
        color: '#85719e' }}>The place to make something together</div>
      <h1 style={{ margin: '16px 0 14px', fontSize: 'clamp(36px,5vw,61px)', fontWeight: 750,
        lineHeight: 1.07, letterSpacing: '-.065em', maxWidth: 680 }}>Your ideas, on one canvas.</h1>
      <p style={{ fontSize: 16, lineHeight: 1.7, color: '#766e7b', maxWidth: 520,
        marginBottom: 26 }}>Sketch, leave a note, or invite someone to draw with you. Every shared board has its own link.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" style={primary} onClick={newRoom}>＋ New shared board</button>
        <button type="button" style={button} onClick={() => { location.hash = 'local'; }}>Open personal canvas</button>
      </div>
    </section>
    <section style={{ maxWidth: 1150, margin: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
        borderBottom: '1px solid #e5e0e9', paddingBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21, letterSpacing: '-.04em' }}>Your boards</h2>
          <p style={{ margin: '7px 0 0', color: '#958a9a', fontSize: 12 }}>Recent rooms on this browser · {rooms.length} saved</p>
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          <input aria-label="Search your boards" placeholder="Search boards…" value={query} onChange={e => setQuery(e.target.value)}
            style={{ ...button, background: '#fff', fontWeight: 400, minWidth: 175, outlineColor: '#9177ba' }} />
          <button style={filter === 'pinned' ? primary : button} type="button"
            onClick={() => setFilter(v => v === 'all' ? 'pinned' : 'all')}>{filter === 'all' ? '☆ Pinned' : '★ All boards'}</button>
        </div>
      </div>
      {shown.length === 0 ? <div style={{ padding: '90px 20px', textAlign: 'center', color: '#857b8b' }}>
        <div style={{ fontSize: 38, marginBottom: 12 }}>✎</div>
        <strong style={{ color: '#41364d' }}>{rooms.length ? 'No matching boards' : 'A blank canvas awaits.'}</strong>
        <p style={{ fontSize: 13, margin: '9px 0 0' }}>{rooms.length ? 'Try a different search or filter.' : 'Create your first shared board above.'}</p>
      </div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(252px,1fr))', gap: 20, marginTop: 25 }}>
        {shown.map(room => <article key={room.id} style={card}>
          <button type="button" aria-label={'Open ' + room.title} onClick={() => open(room.id)}
            style={{ display: 'block', width: '100%', border: 0, background: '#f1eff2', padding: 0, cursor: 'pointer', height: 168,
              overflow: 'hidden', position: 'relative' }}>
            {room.preview
              ? <img alt="" src={room.preview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%',
                color: '#b4a7bd', fontSize: 42, backgroundImage: 'radial-gradient(#d8d0dd 1px,transparent 1px)',
                backgroundSize: '20px 20px' }}>✳</span>}
          </button>
          <div style={{ padding: '15px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button type="button" onClick={() => open(room.id)}
                style={{ padding: 0, border: 0, background: 'transparent', fontSize: 15, fontWeight: 700,
                  cursor: 'pointer', color: '#392f40', textAlign: 'left', overflow: 'hidden',
                  whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{room.title}</button>
              <button type="button" aria-label={room.pinned ? 'Unpin board' : 'Pin board'} onClick={() => pin(room.id)}
                style={{ border: 0, padding: 4, background: 'none', cursor: 'pointer', color: room.pinned ? '#7254ad' : '#a49aa8',
                  fontSize: 19 }}>{room.pinned ? '★' : '☆'}</button>
            </div>
            <div style={{ marginTop: 6, color: '#918797', fontSize: 12 }}>Opened {new Date(room.lastOpened).toLocaleDateString()}</div>
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button type="button" style={{ ...button, padding: '6px 10px', fontSize: 12 }} onClick={() => open(room.id)}>Continue drawing</button>
              <button type="button" title="Forget locally, don't delete the shared room" onClick={() => forget(room.id)}
                style={{ border: 0, background: 'transparent', cursor: 'pointer', color: '#998e9d', fontSize: 12 }}>Forget</button>
            </div>
          </div>
        </article>)}
      </div>}
      <p style={{ color: '#998f9f', fontSize: 12, marginTop: 30 }}>Room links still work on other devices. This dashboard only remembers rooms visited in this browser.</p>
    </section>
  </main>;
}
