/* kanban.page sync relay — a capability-addressed ciphertext store.
   ~100 lines, same ethos as the app: no dependencies, forkable, dull.

   The client derives a bearer token from its secret (HKDF); this worker
   addresses storage by SHA-256(token) and never persists the token itself.
   Payloads are AES-GCM envelopes sealed on the device — a dump of this
   store holds hashes and ciphertext, no board content. There is no user
   table and no auth beyond the unguessable token: knowing it IS the board.

   GET    /v1/board        → {ver, env} | 404
   PUT    /v1/board        {baseVer, env} → {ver} | 409 {ver, env} | 413
   DELETE /v1/board        → 204
   GET    /v1/board/watch  → WebSocket; every accepted PUT broadcasts {ver}
   PUT    /v1/blob/<id>    sealed image bytes → 204 | 400 | 404 | 410 | 413 | 429 | 507 {used, quota, count, maxCount}
   GET    /v1/blob/<id>    → sealed image bytes | 404 | 410 | 429

   Images live beside their board, in the same object, under the same token
   (docs/attachments.md). The relay cannot read the board, so it cannot tell
   a live image from an orphan: nothing deletes one but deleting the board.

   CORS is `*` on purpose: the token is the whole capability and cookies are
   never used, so an origin allowlist adds nothing and would break file://
   boards and forks. */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
});

const MAX_BODY = 600_000; // sealed boards are ~10–100 KB; this is generous
// A 1 MB image plus IV and tag; SQLite-backed objects cap a value at 2 MB.
const MAX_BLOB = 1_100_000;
// Per board. A full board stays full: nothing here can tell a live image
// from an orphan, so nothing frees space short of deleting the board.
const BLOB_QUOTA = 25 * 1024 * 1024;
const MAX_BLOBS = 500;
// New image bytes per hour, per IP and across the relay — the Gate's ledger.
const BYTES_PER_IP = 200 * 1024 * 1024;
const BYTES_GLOBAL = 2 * 1024 * 1024 * 1024;
const BLOB_PATH = /^\/v1\/blob\/([A-Za-z0-9_-]{22})$/;

const clientIp = request => request.headers.get('CF-Connecting-IP') || 'unknown';

/* Bump to rotate the ledger — it is derived data on a one-hour window, so a
   fresh name simply starts counting again (used once to clear the probe
   traffic from building and verifying the budget). */
const LEDGER = 'creations.1';

/** One object counts every board ever created here, so the budget is a real
    number rather than a per-location guess. The platform's rate-limit binding
    is best-effort and measured permissive on this account, so it is kept as
    defence in depth and this is what actually holds the line. */
/** Image bytes are budgeted like board creation, but fail CLOSED: refusing
    an upload costs a retry, while an unbudgeted one costs storage. */
async function allowBytes(env, ip, n) {
  try {
    const gate = env.GATE.get(env.GATE.idFromName(LEDGER));
    const res = await gate.fetch(`https://gate/bytes?ip=${encodeURIComponent(ip)}&n=${n}`);
    return res.status === 200;
  } catch (err) {
    return false;
  }
}

async function allowCreate(env, ip) {
  try {
    const gate = env.GATE.get(env.GATE.idFromName(LEDGER));
    const res = await gate.fetch(`https://gate/allow?ip=${encodeURIComponent(ip)}`);
    return res.status === 200;
  } catch (err) {
    return true; // never let the doorman lock out the building
  }
}

export class Gate {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(request) {
    const url = new URL(request.url);
    const ip = url.searchParams.get('ip') || 'unknown';
    const now = Date.now();
    const HOUR = 3600_000;
    if (url.pathname === '/bytes') return this.bytes(ip, Math.max(0, +url.searchParams.get('n') || 0), now);
    const PER_IP = 20;      // a person pairs a handful of devices, once
    const GLOBAL = 400;     // a distributed burst still cannot drain the tier

    const key = `ip:${ip}`;
    const mine = ((await this.ctx.storage.get(key)) || []).filter(t => now - t < HOUR);
    if (mine.length >= PER_IP) return new Response('no', { status: 429 });

    const all = ((await this.ctx.storage.get('all')) || []).filter(t => now - t < HOUR);
    if (all.length >= GLOBAL) return new Response('no', { status: 429 });

    mine.push(now);
    all.push(now);
    await this.ctx.storage.put({ [key]: mine, all });
    // Sweep the IP buckets daily so a wide spread of addresses cannot turn
    // the doorman's own ledger into the thing that fills up.
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + 24 * HOUR);
    return new Response('ok');
  }

  /** Minute buckets of bytes, so the ledger stays small however many
      uploads there are. */
  async bytes(ip, n, now) {
    const HOUR = 3600_000;
    const minute = Math.floor(now / 60_000);
    const live = o => Object.fromEntries(Object.entries(o || {}).filter(([m]) => now - (+m) * 60_000 < HOUR));
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const key = `bytes:${ip}`;
    const mine = live(await this.ctx.storage.get(key));
    const all = live(await this.ctx.storage.get('bytes:all'));
    if (sum(mine) + n > BYTES_PER_IP || sum(all) + n > BYTES_GLOBAL) return new Response('no', { status: 429 });
    mine[minute] = (mine[minute] || 0) + n;
    all[minute] = (all[minute] || 0) + n;
    await this.ctx.storage.put({ [key]: mine, 'bytes:all': all });
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + 24 * HOUR);
    return new Response('ok');
  }

  async alarm() {
    const now = Date.now();
    const stale = [];
    for (const [key, times] of await this.ctx.storage.list({ prefix: 'ip:' })) {
      if (!times.some(t => now - t < 3600_000)) stale.push(key);
    }
    for (const [key, mins] of await this.ctx.storage.list({ prefix: 'bytes:' })) {
      if (key !== 'bytes:all' && !Object.keys(mins || {}).some(m => now - (+m) * 60_000 < 3600_000)) stale.push(key);
    }
    if (stale.length) await this.ctx.storage.delete(stale);
  }
}

async function slot(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const isBlob = BLOB_PATH.test(url.pathname);
    if (url.pathname !== '/v1/board' && url.pathname !== '/v1/board/watch' && !isBlob) {
      return json(404, { error: 'not found' });
    }
    if (+(request.headers.get('Content-Length') || 0) > (isBlob ? MAX_BLOB : MAX_BODY)) {
      return json(413, { error: 'too large' });
    }

    // Browsers cannot set headers on a WebSocket, so the watch route carries
    // the token as the second entry of Sec-WebSocket-Protocol instead — never
    // in the URL, where proxies and logs could see it.
    let token = null;
    const auth = request.headers.get('Authorization') || '';
    if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
    const proto = request.headers.get('Sec-WebSocket-Protocol');
    if (!token && proto) {
      const parts = proto.split(',').map(s => s.trim());
      if (parts[0] === 'kanban.v1' && parts[1]) token = parts[1];
    }
    if (!token || token.length < 20 || token.length > 128) return json(401, { error: 'missing token' });

    // Opening a socket is budgeted here, where the path alone says what this
    // is. Board CREATION is budgeted inside the object instead — only it can
    // see that a slot is genuinely empty, and a check out here would rest on
    // a header the caller could simply lie about.
    if (url.pathname.endsWith('/watch')) {
      const { success } = await env.WATCH.limit({ key: clientIp(request) });
      if (!success) return json(429, { error: 'slow down' });
    }
    if (isBlob && env.BLOB) {
      const { success } = await env.BLOB.limit({ key: clientIp(request) });
      if (!success) return json(429, { error: 'slow down' });
    }

    return env.BOARD.get(env.BOARD.idFromName(await slot(token))).fetch(request);
  },
};

export class Board {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/v1/board/watch') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
        return json(426, { error: 'upgrade required' });
      }
      const pair = new WebSocketPair();
      // Hibernation API: the DO can be evicted while sockets stay open, so an
      // idle watcher costs nothing.
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, {
        status: 101, webSocket: pair[0],
        headers: { 'Sec-WebSocket-Protocol': 'kanban.v1' },
      });
    }

    const blob = url.pathname.match(BLOB_PATH);
    if (blob) return this.blob(request, blob[1]);

    if (request.method === 'GET') {
      if (await this.ctx.storage.get('deleted')) return json(410, { error: 'deleted' });
      const ver = (await this.ctx.storage.get('ver')) || 0;
      if (!ver) return json(404, { error: 'no board' });
      return json(200, { ver, env: JSON.parse(await this.ctx.storage.get('env')) });
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BODY) return json(413, { error: 'too large' });
      let body;
      try { body = JSON.parse(text); } catch (err) { return json(400, { error: 'bad json' }); }
      if (!Number.isInteger(body.baseVer) || body.baseVer < 0
        || !body.env || typeof body.env !== 'object'
        || typeof body.env.n !== 'string' || typeof body.env.d !== 'string') {
        return json(400, { error: 'bad body' });
      }
      if (await this.ctx.storage.get('deleted')) return json(410, { error: 'deleted' });
      const ver = (await this.ctx.storage.get('ver')) || 0;
      if (body.baseVer !== ver) {
        // Optimistic concurrency: hand back the current head; the client
        // merges and retries. The DO is single-threaded, so this is a real
        // serialization point.
        const cur = await this.ctx.storage.get('env');
        return json(409, { ver, env: cur ? JSON.parse(cur) : null });
      }
      if (ver === 0) {
        // A brand-new board. This is the one write nobody had to prove
        // anything to make, so it is the one that gets a budget.
        if (!await allowCreate(this.env, clientIp(request))) {
          return json(429, { error: 'slow down' });
        }
      }
      const next = ver + 1;
      await this.ctx.storage.put({ ver: next, env: JSON.stringify(body.env) });
      this.broadcast(next);
      return json(200, { ver: next });
    }

    if (request.method === 'DELETE') {
      // Durable: the ciphertext goes, a sentinel stays, and the slot answers
      // 410 from then on — a stale device cannot quietly resurrect a board
      // its owner chose to wipe. A re-enable mints a new secret = a new slot.
      const ver = ((await this.ctx.storage.get('ver')) || 0) + 1;
      // The sentinel first: an upload that was waiting on the budget re-checks
      // it and stops, so nothing lands in a board that is being deleted.
      await this.ctx.storage.put({ ver, deleted: true });
      // Its images go with it — ending sync is the one thing that deletes them.
      for (;;) {
        const keys = [...(await this.ctx.storage.list({ prefix: 'b:', limit: 64 })).keys()];
        if (!keys.length) break;
        await this.ctx.storage.delete([...keys, ...keys.map(k => `s:${k.slice(2)}`)]);
      }
      await this.ctx.storage.delete(['env', 'blobBytes', 'blobCount']);
      await this.ctx.storage.put({ ver, deleted: true });
      this.broadcast(ver, true);
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', ...CORS } });
    }

    return json(405, { error: 'method not allowed' });
  }

  /** An image beside the board. Writable only into a board that exists, so
      it opens no new unauthenticated way to allocate storage. Immutable:
      re-sending a stored id is a no-op that counts nothing twice. */
  async blob(request, id) {
    if (await this.ctx.storage.get('deleted')) return json(410, { error: 'deleted' });
    const key = `b:${id}`;
    if (request.method === 'GET') {
      const bytes = await this.ctx.storage.get(key);
      if (!bytes) return json(404, { error: 'no image' });
      return new Response(bytes, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store', ...CORS },
      });
    }
    if (request.method === 'PUT') {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > MAX_BLOB) return json(413, { error: 'too large' });
      if (bytes.length < 28) return json(400, { error: 'bad body' }); // iv + tag at least
      // Checked twice: once to refuse early, and again after the budget call.
      // Awaiting the Gate is an outside request, which lets other requests
      // into this object — two uploads or a DELETE may have landed meanwhile.
      // Everything from the re-check to the put is storage-only, so nothing
      // interleaves there.
      const check = async () => {
        if (await this.ctx.storage.get('deleted')) return json(410, { error: 'deleted' });
        if (!((await this.ctx.storage.get('ver')) || 0)) return json(404, { error: 'no board' });
        if (await this.ctx.storage.get(`s:${id}`) !== undefined) return new Response(null, { status: 204, headers: CORS });
        const used = (await this.ctx.storage.get('blobBytes')) || 0;
        const count = (await this.ctx.storage.get('blobCount')) || 0;
        if (used + bytes.length > BLOB_QUOTA || count + 1 > MAX_BLOBS) {
          return json(507, { error: 'board full', used, quota: BLOB_QUOTA, count, maxCount: MAX_BLOBS });
        }
        return { used, count };
      };
      const early = await check();
      if (early instanceof Response) return early;
      if (!await allowBytes(this.env, clientIp(request), bytes.length)) return json(429, { error: 'slow down' });
      const now = await check();
      if (now instanceof Response) return now;
      const { used, count } = now;
      const full = () => json(507, { error: 'board full', used, quota: BLOB_QUOTA, count, maxCount: MAX_BLOBS });
      try {
        // one put: the bytes and both totals land together or not at all
        await this.ctx.storage.put({ [key]: bytes, [`s:${id}`]: bytes.length, blobBytes: used + bytes.length, blobCount: count + 1 });
      } catch (err) {
        return full();
      }
      return new Response(null, { status: 204, headers: CORS });
    }
    return json(405, { error: 'method not allowed' });
  }

  /** Every accepted write tells every watcher; the writer recognises its own
      ver and ignores it. This is what makes a phone edit appear on an open
      laptop without polling. */
  broadcast(ver, deleted = false) {
    const msg = JSON.stringify(deleted ? { ver, deleted: true } : { ver });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch (err) { /* socket already closing */ }
    }
  }

  webSocketMessage() { /* watchers only listen */ }
  webSocketClose(ws) { try { ws.close(); } catch (err) { /* already closed */ } }
  webSocketError(ws) { try { ws.close(); } catch (err) { /* already closed */ } }
}
