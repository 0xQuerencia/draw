import { useEffect, useState } from 'react';
import type { Comment, useLiveRoom } from '../hooks/useLiveRoom';

type Live = ReturnType<typeof useLiveRoom>;
type Draft = { x: number; y: number; kind: 'comment' | 'note' };
const button = { border: '1px solid #e4dce8', borderRadius: 8, background: '#fff', padding: '7px 10px',
  boxShadow: '0 3px 10px #0001', cursor: 'pointer', color: '#36303d', fontSize: 12 } as const;
const rect = () => document.querySelector<HTMLElement>('.excalidraw')?.getBoundingClientRect();
const mentions = (text: string) => text.split(/(@[A-Za-z0-9_-]+)/g).map((part, i) =>
  part.startsWith('@') ? <strong key={i} style={{ color: '#6650a2' }}>{part}</strong> : part);
const prettyTime = (at: number) => new Date(at).toLocaleString();

export default function CanvasComments({ live }: { live: Live }) {
  const [placing, setPlacing] = useState<'comment' | 'note' | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftText, setDraftText] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPlacing(null); setDraft(null); setActive(null); }
    };
    addEventListener('keydown', escape);
    return () => removeEventListener('keydown', escape);
  }, []);
  if (!live.room) return null;
  const r = rect();
  const toScreen = (x: number, y: number) => r
    ? { left: r.left + (x + live.viewport.scrollX) * live.viewport.zoom,
      top: r.top + (y + live.viewport.scrollY) * live.viewport.zoom } : { left: 0, top: 0 };
  const place = (e: React.PointerEvent) => {
    if (!placing || !r) return;
    setDraft({ x: (e.clientX - r.left) / live.viewport.zoom - live.viewport.scrollX,
      y: (e.clientY - r.top) / live.viewport.zoom - live.viewport.scrollY, kind: placing });
    setDraftText('');
    setPlacing(null);
    setActive(null);
  };
  const submit = () => {
    if (!draft || !draftText.trim()) return;
    live.createComment({ ...draft, body: draftText });
    setDraft(null);
    setDraftText('');
  };
  const opened: Comment | undefined = live.comments.find(c => c.id === active);
  const modalStyle = { position: 'fixed', right: 16, bottom: 184, width: 298, maxHeight: '50vh', overflowY: 'auto',
    zIndex: 1350, padding: 14, background: '#fff', border: '1px solid #ded6e8',
    borderRadius: 12, boxShadow: '0 14px 35px #0002', color: '#2e2934',
    fontFamily: 'Inter, sans-serif', fontSize: 13 } as const;
  return <>
    <div style={{ position: 'fixed', right: 16, bottom: 137, zIndex: 1200, display: 'flex', gap: 6 }}>
      <button type="button" style={button} onClick={() => { setPlacing('comment'); setDraft(null); setActive(null); }}>＋ Comment</button>
      <button type="button" style={button} onClick={() => { setPlacing('note'); setDraft(null); setActive(null); }}>▧ Note</button>
      <button type="button" style={{ ...button, opacity: showResolved ? 1 : .7 }}
        onClick={() => setShowResolved(v => !v)}>{showResolved ? 'Hide resolved' : 'Show resolved'}</button>
    </div>
    {placing && <div role="button" tabIndex={0} aria-label={'Place ' + placing} onPointerDown={place}
      style={{ position: 'fixed', inset: 0, zIndex: 1150, cursor: 'crosshair' }}>
      <span style={{ position: 'absolute', left: '50%', top: 55, transform: 'translateX(-50%)',
        background: '#fff', padding: '7px 12px', borderRadius: 20,
        boxShadow: '0 2px 12px #0002', pointerEvents: 'none' }}>Click a spot to place a {placing} · Esc to cancel</span>
    </div>}
    {r && live.comments.filter(c => showResolved || !c.resolved).map(c => {
      const point = toScreen(c.x, c.y);
      return <button type="button" key={c.id} title={c.body} onClick={() => { setActive(c.id === active ? null : c.id); setReply(''); setDraft(null); }}
        style={{ position: 'fixed', left: point.left, top: point.top, zIndex: 1130, transform: 'translate(-50%,-50%)',
          padding: c.kind === 'note' ? '12px' : '6px 10px', borderRadius: c.kind === 'note' ? 4 : 20,
          maxWidth: 175, minWidth: c.kind === 'note' ? 100 : 0, minHeight: c.kind === 'note' ? 70 : 0,
          background: c.kind === 'note' ? '#fff2b0' : '#fff',
          color: '#383136', border: active === c.id ? '2px solid #785db5' : '1px solid #d4cbdc',
          boxShadow: '0 4px 12px #0002', cursor: 'pointer', textAlign: 'left', fontSize: 12 }}>
        {c.kind === 'note' ? c.body.slice(0, 90) : '💬 ' + (c.replies.length + 1)}
      </button>;
    })}
    {draft && <div style={modalStyle}>
      <strong>New {draft.kind}</strong>
      <textarea autoFocus placeholder={'Write a ' + draft.kind + '… Use @name to mention someone'} value={draftText}
        onChange={e => setDraftText(e.target.value)} maxLength={500} rows={4}
        style={{ boxSizing: 'border-box', width: '100%', marginTop: 10, border: '1px solid #ddd', borderRadius: 7,
          padding: 9, resize: 'vertical', fontFamily: 'inherit' }} />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button type="button" style={button} onClick={() => setDraft(null)}>Cancel</button>
        <button type="button" style={button} disabled={!draftText.trim()} onClick={submit}>Post</button>
      </div>
    </div>}
    {opened && <div style={modalStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{opened.kind === 'note' ? 'Sticky note' : 'Comment thread'}</strong>
        <button style={button} type="button" onClick={() => setActive(null)}>✕</button>
      </div>
      {[{ id: opened.id, body: opened.body, author: opened.author, at: opened.at }, ...opened.replies].map(entry =>
        <div key={entry.id} style={{ marginTop: 10, borderBottom: '1px solid #f1edf5', paddingBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <strong>{entry.author}</strong><small style={{ color: '#898092' }}>{prettyTime(entry.at)}</small>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 5 }}>{mentions(entry.body)}</div>
        </div>)}
      <textarea value={reply} onChange={e => setReply(e.target.value)} maxLength={500} rows={2}
        placeholder="Reply… (@name is supported)" style={{ boxSizing: 'border-box', width: '100%', marginTop: 12,
          border: '1px solid #ddd', borderRadius: 7, padding: 8, fontFamily: 'inherit' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 5 }}>
        <button style={button} type="button" onClick={() => live.resolveComment(opened.id, !opened.resolved)}>
          {opened.resolved ? 'Reopen' : 'Resolve'}</button>
        <button style={button} type="button" disabled={!reply.trim()} onClick={() => {
          live.replyComment(opened.id, reply); setReply('');
        }}>Reply</button>
      </div>
    </div>}
  </>;
}
