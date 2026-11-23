// This Worker uses the same Durable Object class, name and persisted 'board' key as Draw's live server.
const MAX = 900000;
const allowed = new Set(['https://draw.querencia.art', 'https://draw-querencia-art.vercel.app', 'http://localhost:5173']);
const newer = (a, b) => !a || b.version > a.version || (b.version === a.version && (b.versionNonce || 0) > (a.versionNonce || 0));

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.doc = { elements: [], files: {}, revision: 0 };
    this.ready = ctx.blockConcurrencyWhile(async () => { this.doc = await ctx.storage.get('board') || this.doc; });
  }
  members() {
    return this.ctx.getWebSockets().map(s => {
      const a = s.deserializeAttachment() || {};
      return { id: a.id, name: a.name || 'Guest', pointer: a.pointer || null };
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
    server.send(JSON.stringify({ type: 'snapshot', elements: this.doc.elements, files: this.doc.files, revision: this.doc.revision, members: this.members() }));
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
