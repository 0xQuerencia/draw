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
      <label style={{ display: 'block', fontSize: 12, marginTop: 10, marginBottom: 5 }}>Room name</label>
      <input aria-label="Room name" key={live.roomName} defaultValue={live.roomName}
        onBlur={e => live.setRoomName(e.target.value)} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        maxLength={80} style={{ boxSizing: 'border-box', width: '100%', padding: 8, borderRadius: 6, border: '1px solid #c8bfd4' }} />
      <p style={{ fontSize: 12, opacity: .7 }}>Anyone with the room link can collaborate.</p>
      <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>Your name</label>
      <input aria-label="Your name" defaultValue={live.name} onBlur={e => live.setDisplayName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        style={{ boxSizing: 'border-box', width: '100%', padding: 8, borderRadius: 6, border: '1px solid #c8bfd4', marginBottom: 10 }} />
      <button type="button" style={{ ...button, width: '100%' }} onClick={async () => { await navigator.clipboard.writeText(live.shareUrl); setCopied(true); }}>
        {copied ? 'Link copied!' : 'Copy invite link'}
      </button>
      {live.error && <p style={{ fontSize: 12, color: '#b44' }}>{live.error}</p>}
      <div style={{ fontSize: 12, marginTop: 12 }}>
        <strong style={{ display: 'block', marginBottom: 7 }}>People here</strong>
        {live.members.map(m => <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span>● {m.name}{m.id === live.clientId ? ' (you)' : ''}</span>
          {m.id !== live.clientId && <button type="button" style={{ ...button, padding: '4px 8px', fontSize: 11 }}
            onClick={() => live.following === m.id ? live.stopFollowing() : live.follow(m.id)}>
            {live.following === m.id ? 'Unfollow' : 'Follow'}
          </button>}
        </div>)}
      </div>
      {live.following && <div role="status" style={{ borderTop: '1px solid #eee', paddingTop: 10, fontSize: 12 }}>
        Following {live.members.find(m => m.id === live.following)?.name || 'collaborator'}
        <button type="button" style={{ ...button, marginLeft: 10 }} onClick={live.stopFollowing}>Stop</button>
        <div style={{ opacity: .7, marginTop: 5 }}>Move your canvas or press Esc to stop</div>
      </div>}
      <button type="button" style={{ ...button, marginTop: 12 }} onClick={() => { live.leave(); setOpen(false); }}>Leave room</button>
    </div>}
  </div>;
}
