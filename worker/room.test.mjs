import assert from 'node:assert/strict';
import test from 'node:test';
import { Room } from './worker.mjs';

function setup(initial = {}) {
  const data = new Map(Object.entries(initial));
  const sockets = [];
  const ctx = {
    storage: {
      get: async key => data.get(key),
      put: async (key, value) => data.set(key, structuredClone(value))
    },
    blockConcurrencyWhile: task => task(),
    getWebSockets: () => sockets,
    acceptWebSocket: ws => sockets.push(ws)
  };
  const room = new Room(ctx, {});
  const socket = (id, name = 'Guest') => {
    let attachment = { id, name };
    const received = [];
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: value => { attachment = value; },
      send: raw => received.push(JSON.parse(raw))
    };
    sockets.push(ws);
    return { ws, received };
  };
  return { data, room, socket };
}

test('drawings persist and older revisions do not overwrite', async () => {
  const x = setup(), a = x.socket('a'), b = x.socket('b');
  await x.room.ready;
  const make = version => ({ id: 'line', version, versionNonce: version, x: version });
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'patch', elements: [make(3)], files: {} }));
  await x.room.webSocketMessage(b.ws, JSON.stringify({ type: 'patch', elements: [make(2)], files: {} }));
  assert.equal(x.data.get('board').elements[0].version, 3);
  assert.equal(x.data.get('board').revision, 1);
  assert.equal(b.received[0].type, 'patch');
});

test('viewports broadcast without changing drawings', async () => {
  const x = setup(), a = x.socket('a'), b = x.socket('b');
  await x.room.ready;
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'view', viewport: { scrollX: 12, scrollY: -5, zoom: 1.5 } }));
  assert.equal(b.received.at(-1).type, 'view');
  assert.equal(x.room.members()[0].viewport.zoom, 1.5);
  assert.equal(x.data.has('board'), false);
});

test('reactions are ephemeral while stickers are durable', async () => {
  const x = setup(), a = x.socket('a'), b = x.socket('b');
  await x.room.ready;
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'reaction', reaction: { id: 'emoji-1', emoji: '🎉', x: .5, y: .5 } }));
  assert.equal(b.received.at(-1).type, 'reaction');
  assert.equal(x.data.has('reactions'), false);
  const sticker = { id: 'sticker-1', emoji: '💜', x: 24, y: 38, size: 46 };
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'sticker', op: 'upsert', sticker }));
  assert.equal(x.data.get('stickers')[0].emoji, '💜');
  const restored = setup({ stickers: x.data.get('stickers') });
  await restored.room.ready;
  assert.equal(restored.room.stickers[0].id, 'sticker-1');
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'sticker', op: 'delete', sticker }));
  assert.equal(x.data.get('stickers').length, 0);
});

test('comments, replies, resolution and notes survive rehydration', async () => {
  const x = setup(), a = x.socket('a', 'Artist'), b = x.socket('b', 'Friend');
  await x.room.ready;
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'comment_event', op: 'add',
    comment: { id: 'c1', x: 18, y: 14, kind: 'note', body: 'Hello @Friend' } }));
  await x.room.webSocketMessage(b.ws, JSON.stringify({ type: 'comment_event', op: 'reply',
    id: 'c1', reply: { id: 'r1', body: 'Saw this!' } }));
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'comment_event', op: 'resolve', id: 'c1', resolved: true }));
  assert.equal(x.data.get('comments')[0].replies[0].author, 'Friend');
  const restored = setup({ comments: x.data.get('comments') });
  await restored.room.ready;
  assert.equal(restored.room.comments[0].resolved, true);
  assert.equal(restored.room.comments[0].body, 'Hello @Friend');
});

test('room metadata is persisted and bad sticker coordinates are rejected', async () => {
  const x = setup(), a = x.socket('a');
  await x.room.ready;
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'room_meta', title: 'Research sketches' }));
  assert.equal(x.data.get('meta').title, 'Research sketches');
  await x.room.webSocketMessage(a.ws, JSON.stringify({ type: 'sticker', op: 'upsert',
    sticker: { id: 'bad', emoji: '❤️', x: Infinity, y: 0, size: 40 } }));
  assert.equal(x.data.has('stickers'), false);
});
