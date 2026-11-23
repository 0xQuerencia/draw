import { useEffect, useState } from 'react';
import type { useLiveRoom, Sticker } from '../hooks/useLiveRoom';
import { EMOJI } from '../hooks/useLiveRoom';

type Live = ReturnType<typeof useLiveRoom>;
const small = { background: '#fff', border: '1px solid #e2dce9', borderRadius: 8, padding: '7px 10px', cursor: 'pointer', boxShadow: '0 2px 10px #0001' } as const;
const canvasRect = () => document.querySelector<HTMLElement>('.excalidraw')?.getBoundingClientRect();

export default function CanvasExtras({ live }: { live: Live }) {
  const [picker, setPicker] = useState<'react' | 'stamp' | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [moving, setMoving] = useState<Sticker | null>(null);
  const size = 46;

  useEffect(() => {
    const stop = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPicker(null); setPlacing(null); setSelected(null); } };
    addEventListener('keydown', stop);
    return () => removeEventListener('keydown', stop);
  }, []);
  if (!live.room) return null;

  const rect = canvasRect();
  const toScene = (x: number, y: number) => {
    const r = canvasRect();
    if (!r) return null;
    return { x: (x - r.left) / live.viewport.zoom - live.viewport.scrollX,
      y: (y - r.top) / live.viewport.zoom - live.viewport.scrollY };
  };
  const place = (e: React.PointerEvent) => {
    if (!placing || !rect) return;
    const point = toScene(e.clientX, e.clientY);
    if (!point) return;
    live.sendSticker({ id: crypto.randomUUID(), emoji: placing, ...point, size });
    setPlacing(null);
  };
  const drag = (e: React.PointerEvent<HTMLButtonElement>, sticker: Sticker) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(sticker.id);
    const startX = e.clientX, startY = e.clientY;
    const move = (event: PointerEvent) => {
      setMoving({ ...sticker, x: sticker.x + (event.clientX - startX) / live.viewport.zoom,
        y: sticker.y + (event.clientY - startY) / live.viewport.zoom });
    };
    const up = (event: PointerEvent) => {
      const next = { ...sticker, x: sticker.x + (event.clientX - startX) / live.viewport.zoom,
        y: sticker.y + (event.clientY - startY) / live.viewport.zoom };
      if (Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > 3) live.sendSticker(next);
      setMoving(null);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  return <>
    <style>{'@keyframes draw-heart-rise { from { opacity:1; transform:translate(-50%,0) scale(.8) } to { opacity:0; transform:translate(-50%,-125px) scale(1.6) } }'}</style>
    <div style={{ position: 'fixed', bottom: 88, right: 16, zIndex: 1100, display: 'flex', gap: 6 }}>
      <button type="button" style={small} onClick={() => setPicker(picker === 'react' ? null : 'react')} title="Live reactions">♡ React</button>
      <button type="button" style={small} onClick={() => setPicker(picker === 'stamp' ? null : 'stamp')} title="Permanent emoji stickers">✦ Stickers</button>
      {picker && <div style={{ position: 'absolute', bottom: 43, right: 0, display: 'flex', gap: 4, background: '#fff', border: '1px solid #e2dce9', borderRadius: 12, padding: 7, boxShadow: '0 9px 24px #0002' }}>
        {EMOJI.map(emoji => <button key={emoji} type="button" style={{ ...small, fontSize: 20, padding: '6px' }} onClick={() => {
          if (picker === 'react') live.sendReaction(emoji);
          else setPlacing(emoji);
          setPicker(null);
        }}>{emoji}</button>)}
      </div>}
    </div>
    {live.reactions.map(r => <div key={r.id} aria-hidden="true" style={{
      position: 'fixed', left: (r.x * 100) + '%', top: (r.y * 100) + '%', zIndex: 1190,
      fontSize: 37, pointerEvents: 'none', animation: 'draw-heart-rise 2.8s ease-out forwards'
    }}>{r.emoji}</div>)}
    {placing && <div onPointerDown={place} role="button" aria-label="Place emoji sticker" tabIndex={0} style={{
      position: 'fixed', inset: 0, zIndex: 1090, cursor: 'crosshair'
    }}>
      <div style={{ position: 'absolute', left: '50%', top: 54, transform: 'translateX(-50%)',
        padding: '7px 14px', background: '#fff', borderRadius: 20, boxShadow: '0 3px 14px #0002',
        pointerEvents: 'none', color: '#302b38', fontSize: 12 }}>Click to place {placing} · Esc to cancel</div>
    </div>}
    {rect && live.stickers.map(item => {
      const s = moving?.id === item.id ? moving : item;
      const left = rect.left + (s.x + live.viewport.scrollX) * live.viewport.zoom;
      const top = rect.top + (s.y + live.viewport.scrollY) * live.viewport.zoom;
      return <button key={s.id} type="button" title="Drag to move sticker" aria-label={'Sticker ' + s.emoji}
        onPointerDown={e => drag(e, s)}
        style={{ position: 'fixed', zIndex: 1080, left, top, border: selected === s.id ? '1px dashed #6d54b1' : '1px solid transparent',
          borderRadius: 6, padding: 2, background: 'transparent', fontSize: s.size * live.viewport.zoom,
          cursor: 'grab', lineHeight: 1, touchAction: 'none', userSelect: 'none' }}>{s.emoji}</button>;
    })}
    {selected && live.stickers.some(s => s.id === selected) && <div style={{ position: 'fixed', right: 18, bottom: 142, display: 'flex', gap: 5, zIndex: 1200,
      background: '#fff', border: '1px solid #ded6e8', borderRadius: 10, padding: 6, boxShadow: '0 6px 20px #0002' }}>
      <button type="button" style={small} onClick={() => { const s = live.stickers.find(x => x.id === selected); if (s) live.sendSticker({ ...s, size: Math.max(16, s.size - 8) }); }}>−</button>
      <button type="button" style={small} onClick={() => { const s = live.stickers.find(x => x.id === selected); if (s) live.sendSticker({ ...s, size: Math.min(160, s.size + 8) }); }}>+</button>
      <button type="button" style={small} onClick={() => { const s = live.stickers.find(x => x.id === selected); if (s) live.deleteSticker(s); setSelected(null); }}>Delete</button>
    </div>}
  </>;
}
