'use strict';
/* Transport. Every status has a defined behaviour, and the one that matters is
   the ambiguous one: a PUT that was accepted but whose response was lost looks
   exactly like a PUT that never arrived. Rebuilding the mutation there is how a
   card lands twice, so this module never rebuilds — it re-fetches and looks for
   the id the caller already generated. */

const C = require('../core.js');

const OFFICIAL = 'https://kanban-relay.quiet-bush-25b1.workers.dev';

/** An origin is an authentication destination: every request carries the
    bearer token, so a config that can silently change it can exfiltrate the
    capability. Anything but the pinned relay needs an explicit decision. */
function checkOrigin(origin, { trusted = false } = {}) {
  if (origin === OFFICIAL) return null;
  if (!trusted) return `relay ${origin} is not the official relay; pass --relay to use it deliberately`;
  let u;
  try { u = new URL(origin); } catch (err) { return `relay ${origin} is not a URL`; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !local) return 'a custom relay must be https (except localhost)';
  return null;
}

class RelayError extends Error {
  constructor(kind, message, extra = {}) { super(message); this.kind = kind; Object.assign(this, extra); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class Relay {
  constructor({ origin = OFFICIAL, token, fetchImpl = globalThis.fetch } = {}) {
    this.origin = origin;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async request(method, body) {
    let res;
    try {
      res = await this.fetchImpl(`${this.origin}/v1/board`, {
        method,
        redirect: 'error', // a redirect would hand the token to another host
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new RelayError('transport', `network error: ${err.message}`);
    }
    return res;
  }

  /** GET → {ver, payload} | null when the relay holds no board. */
  async head(key) {
    const res = await this.request('GET');
    if (res.status === 404) return null;
    if (res.status === 410) throw new RelayError('gone', 'this board was ended on every device');
    if (res.status === 401) throw new RelayError('credential', 'the relay rejected this secret');
    if (res.status === 429) throw new RelayError('transport', 'the relay is rate limiting; try again shortly');
    if (res.status !== 200) throw new RelayError(res.status >= 500 ? 'transport' : 'protocol', `relay ${res.status}`);

    let body;
    try { body = await res.json(); } catch (err) { throw new RelayError('protocol', 'relay sent a malformed body'); }
    if (!Number.isInteger(body.ver) || body.ver < 0 || !body.env) {
      throw new RelayError('protocol', 'relay sent no version or no envelope');
    }
    let payload;
    try { payload = await C.unseal(key, body.env); } catch (err) {
      throw new RelayError('credential', 'could not decrypt the board — wrong secret for this relay');
    }
    const bad = C.validateSyncable(payload);
    if (bad) throw new RelayError('protocol', `refusing to touch this board: ${bad}`);
    return { ver: body.ver, payload };
  }

  /**
   * Land an already-built state. `probe(payload)` returns true when the caller's
   * own change is already present in a fetched head — that is the idempotency
   * key, and it is why an ambiguous failure never re-runs the mutation.
   */
  async land({ key, state, baseVer, probe, attempts = 4, backoff = sleep }) {
    let next = state, ver = baseVer, ambiguous = 0;

    for (let i = 0; i < attempts; i++) {
      const env = await C.seal(key, C.syncable(next));
      let res;
      try {
        res = await this.request('PUT', { baseVer: ver, env });
      } catch (err) {
        // Ambiguous: it may have landed. Ask, never assume.
        if (++ambiguous > 2) throw new RelayError('outcome-unknown', 'the write may or may not have landed; re-run a read to check');
        await backoff(ambiguous === 1 ? 1000 : 3000);
        const settled = await this.resolveAmbiguous(key, probe);
        if (settled.landed) return { ver: settled.ver, state: next, contended: i > 0 };
        next = C.merge(next, settled.payload);
        ver = settled.ver;
        continue;
      }

      if (res.status === 200) {
        const body = await res.json();
        return { ver: body.ver, state: next, contended: i > 0 };
      }
      if (res.status === 409) {
        const body = await res.json();
        // The version is the relay's field. The decrypted payload has `v`, a
        // schema number, and no `ver` at all.
        const theirs = body.env ? await C.unseal(key, body.env) : null;
        if (theirs) {
          const bad = C.validateSyncable(theirs);
          if (bad) throw new RelayError('protocol', `refusing to merge this head: ${bad}`);
          next = C.merge(next, theirs);
        }
        ver = body.ver;
        continue; // never re-run the mutation or stampChanges
      }
      if (res.status === 410) throw new RelayError('gone', 'the board was ended while this write was in flight');
      if (res.status === 413) {
        const size = Buffer.byteLength(JSON.stringify({ baseVer: ver, env }), 'utf8');
        throw new RelayError('protocol', `board too large for the relay (${size} bytes)`);
      }
      if (res.status >= 500 || res.status === 408) {
        if (++ambiguous > 2) throw new RelayError('outcome-unknown', 'the write may or may not have landed; re-run a read to check');
        await backoff(ambiguous === 1 ? 1000 : 3000);
        const settled = await this.resolveAmbiguous(key, probe);
        if (settled.landed) return { ver: settled.ver, state: next, contended: i > 0 };
        next = C.merge(next, settled.payload);
        ver = settled.ver;
        continue;
      }
      throw new RelayError(res.status === 401 ? 'credential' : 'protocol', `relay ${res.status}`);
    }
    throw new RelayError('contention', 'the board kept changing under this write; try again');
  }

  async resolveAmbiguous(key, probe) {
    let head;
    try { head = await this.head(key); } catch (err) {
      if (err.kind === 'transport') {
        throw new RelayError('outcome-unknown', 'the write may or may not have landed; re-run a read to check');
      }
      throw err;
    }
    if (!head) throw new RelayError('outcome-unknown', 'the board vanished mid-write; re-run a read to check');
    return { landed: !!probe && probe(head.payload), ver: head.ver, payload: head.payload };
  }
}

module.exports = { Relay, RelayError, OFFICIAL, checkOrigin };
