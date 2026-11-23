import { useState } from 'react';
import type { useLiveRoom } from '../hooks/useLiveRoom';

type Live = ReturnType<typeof useLiveRoom>;
const button = { border: '1px solid #c2b8d5', background: '#f4efff', borderRadius: 8, color: '#4b3480', padding: '7px 11px', cursor: 'pointer', fontSize: 13, fontWeight: 600 } as const;
export default function LiveControls({ live }: { live: Live }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return <div style={{ position: 'relative', display: 'flex', alignItems: 'center', zIndex: 300 }}>
    <button type="button" style={button} onClick={() => live.room ? setOpen(v => !v) : (live.start(), setOpen(true))}>
      {live.room ? live.status === 'connected' ? '● Live · ' + live.members.length : '○ ' + live.status : '↗ Share live'}
    </button>
    {open && live.room && <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 10px)', width: 280, padding: 16, background: '#fff', color: '#272030', border: '1px solid #d7cde5', borderRadius: 12, boxShadow: '0 16px 35px #0002' }}>
      <strong>Shared board</strong>
      <p style={{ fontSize: 12, opacity: .7 }}>Anyone with the room link can collaborate.</p>
      <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Your name</label>
      <input aria-label="Your name" defaultValue={live.name} onBlur={e => live.setDisplayName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        style={{ boxSizing: 'border-box', width: '100%', padding: 8, borderRadius: 6, border: '1px solid #c8bfd4', marginBottom: 10 }} />
      <button type="button" style={{ ...button, width: '100%' }} onClick={async () => { await navigator.clipboard.writeText(live.shareUrl); setCopied(true); }}>
        {copied ? 'Link copied!' : 'Copy invite link'}
      </button>
      {live.error && <p style={{ fontSize: 12, color: '#b44' }}>{live.error}</p>}
      <div style={{ fontSize: 12, marginTop: 12 }}>{live.members.map(m => <div key={m.id}>● {m.name}</div>)}</div>
      <button type="button" style={{ ...button, marginTop: 12 }} onClick={() => { live.leave(); setOpen(false); }}>Leave room</button>
    </div>}
  </div>;
}
