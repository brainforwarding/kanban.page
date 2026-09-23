/* The relay's image routes (docs/attachments.md), against an in-memory
   stand-in for the Durable Object runtime. Run: node --test tests/relay.test.js */

const { test } = require('node:test');
const assert = require('node:assert/strict');

/** Enough of ctx.storage for the worker: get/put/delete/list over a Map. */
function memoryStorage() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.get(k); },
    async put(k, v) {
      if (typeof k === 'object') { for (const [kk, vv] of Object.entries(k)) m.set(kk, vv); } else m.set(k, v);
    },
    async delete(k) { for (const kk of [].concat(k)) m.delete(kk); },
    async list({ prefix = '', limit = Infinity } = {}) {
      const out = new Map();
      for (const k of [...m.keys()].sort()) {
        if (k.startsWith(prefix)) out.set(k, m.get(k));
        if (out.size >= limit) break;
      }
      return out;
    },
  };
}

async function relay({ gate = async () => new Response('ok') } = {}) {
  const { default: worker, Board } = await import('../relay/worker.js');
  const objects = new Map();
  const gateCalls = [];
  const env = {
    GATE: { idFromName: n => n, get: () => ({ fetch: async url => { gateCalls.push(url); return gate(url); } }) },
    WATCH: { limit: async () => ({ success: true }) },
    BOARD: {
      idFromName: n => n,
      get: id => {
        if (!objects.has(id)) {
          const storage = memoryStorage();
          objects.set(id, new Board({ storage, getWebSockets: () => [], acceptWebSocket() {} }, env));
        }
        return objects.get(id);
      },
    },
  };
  const token = 'x'.repeat(43);
  const call = (method, path, body, headers = {}) => worker.fetch(new Request(`https://relay${path}`, {
    method, body, headers: { Authorization: `Bearer ${token}`, ...headers },
  }), env);
  const storage = () => [...objects.values()][0].ctx.storage;
  return { call, storage, gateCalls };
}

const ID = 'A'.repeat(22);
const bytes = n => new Uint8Array(n).fill(7);
const board = call => call('PUT', '/v1/board', JSON.stringify({ baseVer: 0, env: { v: 1, gz: 0, n: 'a', d: 'b' } }),
  { 'Content-Type': 'application/json' });

test('an image cannot be written before its board exists', async () => {
  const { call } = await relay();
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(100))).status, 404);
});

test('an image round-trips and re-sending it counts nothing twice', async () => {
  const { call, storage } = await relay();
  await board(call);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(100))).status, 204);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(100))).status, 204);
  assert.equal(await storage().get('blobBytes'), 100);
  const res = await call('GET', `/v1/blob/${ID}`);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes(100));
  assert.equal((await call('GET', `/v1/blob/${'B'.repeat(22)}`)).status, 404);
});

test('a malformed image id is not a route, and a body shorter than an IV and tag is refused', async () => {
  const { call } = await relay();
  assert.equal((await call('GET', '/v1/blob/short')).status, 404);
  await board(call);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(27))).status, 400);
});

test('new image bytes are charged to the budget once, and a refused budget refuses the upload', async () => {
  let allow = true;
  const { call, gateCalls } = await relay({ gate: async url => new Response(allow || !String(url).includes('/bytes') ? 'ok' : 'no', { status: allow || !String(url).includes('/bytes') ? 200 : 429 }) });
  await board(call);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(100))).status, 204);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(100))).status, 204);
  assert.equal(gateCalls.filter(u => String(u).includes('/bytes')).length, 1, 'a re-send is not charged');
  allow = false;
  assert.equal((await call('PUT', `/v1/blob/${'C'.repeat(22)}`, bytes(100))).status, 429);
});

test('the byte budget fails closed when the Gate is unreachable', async () => {
  const { call } = await relay({ gate: async url => { if (String(url).includes('/bytes')) throw new Error('down'); return new Response('ok'); } });
  await board(call);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(100))).status, 429);
});

test('a board holds at most 500 images however small', async () => {
  const { call, storage } = await relay();
  await board(call);
  await storage().put('blobCount', 500);
  const res = await call('PUT', `/v1/blob/${ID}`, bytes(100));
  assert.equal(res.status, 507);
  assert.equal((await res.json()).maxCount, 500);
});

test('an oversized image is refused', async () => {
  const { call } = await relay();
  await board(call);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(1_100_001))).status, 413);
});

test('a full board refuses a new image and says how full', async () => {
  const { call, storage } = await relay();
  await board(call);
  await storage().put('blobBytes', 25 * 1024 * 1024 - 50);
  const res = await call('PUT', `/v1/blob/${ID}`, bytes(100));
  assert.equal(res.status, 507);
  const body = await res.json();
  assert.equal(body.quota, 25 * 1024 * 1024);
  assert.equal(body.used, 25 * 1024 * 1024 - 50);
});

test('ending sync deletes the board’s images with it', async () => {
  const { call, storage } = await relay();
  await board(call);
  for (let i = 0; i < 130; i++) {
    const id = String(i).padStart(22, '0');
    assert.equal((await call('PUT', `/v1/blob/${id}`, bytes(40))).status, 204);
  }
  assert.equal((await call('DELETE', '/v1/board')).status, 204);
  assert.equal([...storage().m.keys()].filter(k => k.startsWith('b:')).length, 0);
  assert.equal(await storage().get('blobBytes'), undefined);
  assert.equal(await storage().get('blobCount'), undefined);
  assert.equal([...storage().m.keys()].filter(k => k.startsWith('s:')).length, 0);
  assert.equal((await call('GET', `/v1/blob/${'0'.repeat(22)}`)).status, 410);
  assert.equal((await call('PUT', `/v1/blob/${ID}`, bytes(40))).status, 410);
});

test('two uploads racing past the budget cannot both overfill the board', async () => {
  const waiting = [];
  const { call, storage } = await relay({ gate: url => String(url).includes('/bytes')
    ? new Promise(r => waiting.push(() => r(new Response('ok')))) : Promise.resolve(new Response('ok')) });
  await board(call);
  await storage().put('blobBytes', 25 * 1024 * 1024 - 150); // room for one of the two
  const a = call('PUT', `/v1/blob/${'A'.repeat(22)}`, bytes(100));
  const b = call('PUT', `/v1/blob/${'C'.repeat(22)}`, bytes(100));
  while (waiting.length < 2) await new Promise(r => setTimeout(r, 5));
  waiting[0](); const ra = await a;
  waiting[1](); const rb = await b;
  assert.deepEqual([ra.status, rb.status].sort(), [204, 507]);
  assert.equal(await storage().get('blobBytes'), 25 * 1024 * 1024 - 50);
  assert.equal(await storage().get('blobCount'), 1);
});

test('an upload waiting on the budget stores nothing if the board is deleted meanwhile', async () => {
  let release;
  const { call, storage } = await relay({ gate: url => String(url).includes('/bytes')
    ? new Promise(r => { release = () => r(new Response('ok')); }) : Promise.resolve(new Response('ok')) });
  await board(call);
  const put = call('PUT', `/v1/blob/${ID}`, bytes(100));
  while (!release) await new Promise(r => setTimeout(r, 5));
  assert.equal((await call('DELETE', '/v1/board')).status, 204);
  release();
  assert.equal((await put).status, 410);
  assert.equal([...storage().m.keys()].filter(k => /^[bs]:/.test(k)).length, 0);
});
