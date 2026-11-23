// This Worker uses the same Durable Object class, name and persisted 'board' key as Draw's live server.
const MAX = 900000;
const allowed = new Set(['https://draw.querencia.art', 'https://draw-querencia-art.vercel.app', 'http://localhost:5173']);
const newer = (a, b) => !a || b.version > a.version || (b.version === a.version && (b.versionNonce || 0) > (a.versionNonce || 0));

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.doc = { elements: [], files: {}, revision: 0 };
    this.stickers = [];
    this.comments = [];
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.doc = await ctx.storage.get('board') || this.doc;
      this.stickers = await ctx.storage.get('stickers') || [];
      this.comments = await ctx.storage.get('comments') || [];
    });
  }
  members() {
    return this.ctx.getWebSockets().map(s => {
      const a = s.deserializeAttachment() || {};
      return { id: a.id, name: a.name || 'Guest', pointer: a.pointer || null, viewport: a.viewport || null };
    }).filter(x => x.id);
  }
  emit(data, exclude) {
    const raw = JSON.stringify(data);
    for (const s of this.ctx.getWebSockets()) if (s !== exclude) try { s.send(raw); } catch {}
  }
  async fetch(request) {
    await this.ready;
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket required', { status: 426 });
    if (this.ctx.getWebSockets().length >= 24) return new Response('Room full', { status: 429 });
    const url = new URL(request.url);
    const name = (url.searchParams.get('name') || 'Guest').slice(0, 32).replace(/[<>]/g, '');
    const id = (url.searchParams.get('client') || crypto.randomUUID()).slice(0, 80);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name, pointer: null });
    server.send(JSON.stringify({ type: 'snapshot', elements: this.doc.elements, files: this.doc.files, revision: this.doc.revision, members: this.members(), stickers: this.stickers, comments: this.comments }));
    this.emit({ type: 'members', members: this.members() });
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX) return;
    let data; try { data = JSON.parse(raw); } catch { return; }
    const author = (ws.deserializeAttachment() || {}).id;
    if (data.type === 'pointer') {
      if (!data.pointer || !Number.isFinite(data.pointer.x) || !Number.isFinite(data.pointer.y)) return;
      const a = ws.deserializeAttachment() || {};
      ws.serializeAttachment({ ...a, pointer: { x: data.pointer.x, y: data.pointer.y } });
      this.emit({ type: 'pointer', id: author, pointer: data.pointer }, ws);
      return;
    }
    if (data.type === 'comment_event') {
      const attachment = ws.deserializeAttachment() || {};
      const authorName = (attachment.name || 'Guest').slice(0, 32).replace(/[<>]/g, '');
      const text = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';
      if (data.op === 'add') {
        const c = data.comment;
        if (!c || typeof c.id !== 'string' || c.id.length > 64 || this.comments.some(old => old.id === c.id)) return;
        if (!['comment', 'note'].includes(c.kind) || ![c.x,c.y].every(Number.isFinite) || Math.abs(c.x) > 100000 || Math.abs(c.y) > 100000) return;
        const body = text(c.body);
        if (!body || this.comments.length >= 250) return;
        this.comments = [...this.comments, { id: c.id, x: c.x, y: c.y, kind: c.kind, body,
          author: authorName, at: Date.now(), resolved: false, replies: [] }];
      } else if (data.op === 'reply') {
        const c = this.comments.find(x => x.id === data.id);
        const r = data.reply;
        if (!c || !r || typeof r.id !== 'string' || r.id.length > 64 || c.replies.length >= 100) return;
        const body = text(r.body);
        if (!body || c.replies.some(x => x.id === r.id)) return;
        c.replies.push({ id: r.id, body, author: authorName, at: Date.now() });
      } else if (data.op === 'resolve') {
        const c = this.comments.find(x => x.id === data.id);
        if (!c || typeof data.resolved !== 'boolean') return;
        c.resolved = data.resolved;
      } else return;
      await this.ctx.storage.put('comments', this.comments);
      this.emit({ type: 'comments', comments: this.comments });
      return;
    }
    if (data.type === 'reaction') {
      const r = data.reaction;
      if (!r || !['❤️', '✨', '🎉', '👍', '😂', '🥹', '🔥', '💜'].includes(r.emoji)) return;
      if (typeof r.id !== 'string' || r.id.length > 64) return;
      const reaction = { id: r.id, emoji: r.emoji,
        x: Number.isFinite(r.x) ? Math.min(1, Math.max(0, r.x)) : .5,
        y: Number.isFinite(r.y) ? Math.min(1, Math.max(0, r.y)) : .6 };
      this.emit({ type: 'reaction', reaction }, ws);
      return;
    }
    if (data.type === 'sticker') {
      const s = data.sticker;
      if (!s || typeof s.id !== 'string' || s.id.length > 64) return;
      if (data.op !== 'delete' && data.op !== 'upsert') return;
      if (data.op === 'delete') {
        this.stickers = this.stickers.filter(item => item.id !== s.id);
      } else {
        if (!['❤️', '✨', '🎉', '👍', '😂', '🥹', '🔥', '💜'].includes(s.emoji)) return;
        if (![s.x,s.y,s.size].every(Number.isFinite) || Math.abs(s.x) > 100000 || Math.abs(s.y) > 100000 || s.size < 16 || s.size > 160) return;
        if (this.stickers.length >= 400 && !this.stickers.some(item => item.id === s.id)) return;
        this.stickers = [...this.stickers.filter(item => item.id !== s.id), { id: s.id, emoji: s.emoji, x: s.x, y: s.y, size: s.size }];
      }
      await this.ctx.storage.put('stickers', this.stickers);
      this.emit({ type: 'sticker', op: data.op, sticker: s }, ws);
      return;
    }
    if (data.type === 'view') {
      const v = data.viewport;
      if (!v || !Number.isFinite(v.scrollX) || !Number.isFinite(v.scrollY) || !Number.isFinite(v.zoom) || v.zoom < 0.05 || v.zoom > 30) return;
      const viewport = { scrollX: v.scrollX, scrollY: v.scrollY, zoom: v.zoom };
      ws.serializeAttachment({ ...(ws.deserializeAttachment() || {}), viewport });
      this.emit({ type: 'view', id: author, viewport }, ws);
      return;
    }
    if (data.type !== 'patch' || !Array.isArray(data.elements) || data.elements.length > 2000 || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) return;
    const current = [...this.doc.elements];
    const index = new Map(current.map((e, i) => [e.id, i]));
    const accepted = [];
    for (const e of data.elements) {
      if (!e || typeof e.id !== 'string' || e.id.length > 128 || !Number.isInteger(e.version) || e.version < 1) continue;
      const at = index.get(e.id), old = at === undefined ? null : current[at];
      if (newer(old, e)) { if (at === undefined) { index.set(e.id, current.length); current.push(e); } else current[at] = e; accepted.push(e); }
    }
    const fresh = {};
    for (const [k, f] of Object.entries(data.files)) {
      if (k.length > 128 || !f || typeof f !== 'object' || typeof f.dataURL !== 'string' || f.dataURL.length > 550000) continue;
      if (!this.doc.files[k]) fresh[k] = f;
    }
    if (!accepted.length && !Object.keys(fresh).length) return;
    if (current.length > 5000) return;
    this.doc.elements = current;
    Object.assign(this.doc.files, fresh);
    this.doc.revision += 1;
    await this.ctx.storage.put('board', this.doc);
    this.emit({ type: 'patch', elements: accepted, files: fresh, revision: this.doc.revision, author });
  }
  webSocketClose(ws, code, reason) {
    this.emit({ type: 'members', members: this.members().filter(x => x.id !== (ws.deserializeAttachment() || {}).id) });
    try { ws.close(code >= 1000 && code < 5000 && ![1004,1005,1006,1015].includes(code) ? code : 1000, reason); } catch {}
  }
  webSocketError(ws) { this.webSocketClose(ws, 1000, ''); }
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === '/health') return Response.json({ ok: true, service: 'draw-collab' });
    const origin = request.headers.get('Origin');
    if (origin && !allowed.has(origin)) return new Response('Origin not allowed', { status: 403 });
    const match = u.pathname.match(/^\/room\/([a-f0-9]{32})$/);
    if (!match) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Upgrade required', { status: 426 });
    return env.ROOMS.getByName(match[1]).fetch(request);
  }
};
