'use strict';
/* CLI tests. No network: a fake relay implements the real version-and-409
   behaviour in process. The cases that matter are the ones that would lose
   work — a double add, a resurrected card, a restamped clock. */

const { test } = require('node:test');
const assert = require('node:assert');

const C = require('../core.js');
const ops = require('../cli/ops.js');
const { Relay, RelayError, checkOrigin, OFFICIAL } = require('../cli/relay.js');
const { safeErrorLine } = require('../cli/kanban.js');
const boardsMod = require('../cli/boards.js');
const fs = require('node:fs');

const clone = x => JSON.parse(JSON.stringify(x));

/* ── a relay that behaves like the real one ─────────── */

class FakeRelay {
  constructor(key) { this.key = key; this.ver = 0; this.env = null; this.deleted = false; this.script = []; }

  async seed(payload) { this.env = await C.seal(this.key, payload); this.ver = 1; }

  /** Queue one-shot behaviours: 'boom' (network), 500, 410, 413, or 'accept-then-lose'. */
  plan(...kinds) { this.script.push(...kinds); return this; }

  fetch = async (url, init) => {
    // Scripted failures target writes: a GET must stay reliable, or the test
    // exercises the wrong path.
    const next = init.method === 'PUT' ? this.script.shift() : null;
    if (next === 'boom') throw new Error('socket hang up');
    if (next === 'accept-then-lose') {           // the dangerous one: it LANDS, then the reply is lost
      const body = JSON.parse(init.body);
      if (body.baseVer === this.ver) { this.ver += 1; this.env = body.env; }
      throw new Error('socket hang up');
    }
    const status = typeof next === 'number' ? next : null;
    if (status) return this.res(status, { error: 'scripted' });

    if (this.deleted) return this.res(410, { error: 'deleted' });
    if (init.method === 'GET') {
      if (!this.ver) return this.res(404, { error: 'no board' });
      return this.res(200, { ver: this.ver, env: this.env });
    }
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body);
      if (body.baseVer !== this.ver) return this.res(409, { ver: this.ver, env: this.env });
      this.ver += 1; this.env = body.env;
      return this.res(200, { ver: this.ver });
    }
    return this.res(405, {});
  };

  res(status, body) {
    return { status, json: async () => body };
  }

  async read() { return C.unseal(this.key, this.env); }
}

async function fixture() {
  const secret = C.randomSecret();
  const { key } = await C.deriveSync(secret);
  let board = C.defaultBoard('en');
  board.projects = [{ id: 'p1', name: 'Kanban Board' }];
  board = C.stampChanges(clone(C.defaultBoard('en')), board, 5000);
  const payload = C.syncable(board);
  const fake = new FakeRelay(key);
  await fake.seed(payload);
  const relay = new Relay({ origin: OFFICIAL, token: 't', fetchImpl: fake.fetch });
  return { key, fake, relay, payload };
}

/** The production cycle, exactly as cli/kanban.js runs it. */
async function runMutation(ctx, build, { attempts = 4 } = {}) {
  const head = await ctx.relay.head(ctx.key);
  const built = build(head.payload);
  if (built.noop) return { noop: true };
  const prev = clone(head.payload);
  let next = built.state;
  C.stampChanges(prev, next);
  next = C.unionFloor(next, { events: head.payload.events, tombstones: head.payload.tombstones });
  const probe = built.probe || built.probeFromStamped(next);
  const landed = await ctx.relay.land({
    key: ctx.key, state: next, baseVer: head.ver, probe, attempts, backoff: async () => {},
  });
  return { ...landed, stamped: next };
}

/* ── the tests ──────────────────────────────────────── */

test('add lands and appends exactly one created event', async () => {
  const ctx = await fixture();
  await runMutation(ctx, st => ops.add(st, { title: 'explore right margin', project: 'Kanban Board' }));
  const head = await ctx.fake.read();
  assert.equal(head.tasks.length, 1);
  assert.equal(head.tasks[0].title, 'explore right margin');
  assert.equal(head.events.filter(e => e.type === 'created').length, 1);
});

test('add advances only pmt on siblings, never mt or existMt', async () => {
  const ctx = await fixture();
  await runMutation(ctx, st => ops.add(st, { title: 'first' }));
  const before = await ctx.fake.read();
  const sib = before.tasks[0];
  await runMutation(ctx, st => ops.add(st, { title: 'second' }));
  const after = await ctx.fake.read();
  const same = after.tasks.find(t => t.id === sib.id);
  assert.equal(C.mtOf(same), C.mtOf(sib), 'content clock moved');
  assert.equal(C.existMtOf(same), C.existMtOf(sib), 'existence clock moved');
  assert.ok(C.pmtOf(same) > C.pmtOf(sib), 'placement clock should move');
});

test('a lost 200 response does not double-add', async () => {
  const ctx = await fixture();
  ctx.fake.plan('accept-then-lose');           // it lands; the reply never arrives
  const out = await runMutation(ctx, st => ops.add(st, { title: 'only once' }));
  const head = await ctx.fake.read();
  assert.equal(head.tasks.filter(t => t.title === 'only once').length, 1, 'card landed twice');
  assert.equal(head.events.filter(e => e.type === 'created').length, 1, 'event logged twice');
  assert.ok(out.ver, 'should report the version it found');
});

test('409 merges both devices and never restamps', async () => {
  const ctx = await fixture();
  // Another device writes between our GET and our PUT.
  const head = await ctx.relay.head(ctx.key);
  const built = ops.add(head.payload, { title: 'ours' });
  const prev = clone(head.payload);
  let next = built.state;
  C.stampChanges(prev, next);
  const ourClock = C.mtOf(next.tasks.find(t => t.title === 'ours'));

  const theirs = ops.add(head.payload, { title: 'theirs' }).state;
  C.stampChanges(clone(head.payload), theirs);
  await ctx.fake.seed(theirs); ctx.fake.ver = head.ver + 1;

  const landed = await ctx.relay.land({
    key: ctx.key, state: next, baseVer: head.ver,
    probe: p => (p.events || []).some(e => e.id === built.probe && false), backoff: async () => {},
  });
  const final = await ctx.fake.read();
  assert.ok(final.tasks.find(t => t.title === 'ours'), 'our card lost');
  assert.ok(final.tasks.find(t => t.title === 'theirs'), 'their card lost');
  assert.equal(C.mtOf(final.tasks.find(t => t.title === 'ours')), ourClock, 'clocks were restamped on retry');
  assert.ok(landed.contended);
});

test('409 takes baseVer from the relay envelope, not the payload', async () => {
  const ctx = await fixture();
  const head = await ctx.relay.head(ctx.key);
  assert.equal(head.payload.ver, undefined, 'the decrypted payload has no ver field');
  assert.equal(head.payload.v, 2, 'it has a schema v instead');
});

test('a concurrent permanent delete wins over a CLI edit', async () => {
  const ctx = await fixture();
  await runMutation(ctx, st => ops.add(st, { title: 'doomed' }));
  const head = await ctx.relay.head(ctx.key);
  const id = head.payload.tasks[0].id;

  // Build our edit against the head that still has the card.
  const built = ops.edit(head.payload, { id, title: 'renamed' });
  let next = built.state;
  C.stampChanges(clone(head.payload), next);

  // Meanwhile another device permanently deletes it.
  const theirs = clone(head.payload);
  theirs.tasks = theirs.tasks.filter(t => t.id !== id);
  theirs.tombstones = { [id]: Date.now() + 60000 };
  await ctx.fake.seed(theirs); ctx.fake.ver = head.ver + 1;

  await ctx.relay.land({ key: ctx.key, state: next, baseVer: head.ver, probe: () => false, backoff: async () => {} });
  const final = await ctx.fake.read();
  assert.ok(!final.tasks.find(t => t.id === id), 'the delete must win');
});

test('a card already deleted at GET time is simply not found', async () => {
  const ctx = await fixture();
  await runMutation(ctx, st => ops.add(st, { title: 'doomed' }));
  let head = await ctx.relay.head(ctx.key);
  const id = head.payload.tasks[0].id;
  const gone = clone(head.payload);
  gone.tasks = []; gone.tombstones = { [id]: Date.now() };
  await ctx.fake.seed(gone); ctx.fake.ver += 1;

  head = await ctx.relay.head(ctx.key);
  assert.throws(() => ops.edit(head.payload, { id, title: 'x' }), /no card starting with/);
});

test('a v:3 head is refused and nothing is written', async () => {
  const ctx = await fixture();
  const future = clone(await ctx.fake.read());
  future.v = 3;
  await ctx.fake.seed(future);
  const verBefore = ctx.fake.ver;
  await assert.rejects(() => ctx.relay.head(ctx.key), /newer than this client/);
  assert.equal(ctx.fake.ver, verBefore, 'nothing should have been written');
});

test('done on an already-done card writes nothing', async () => {
  const ctx = await fixture();
  await runMutation(ctx, st => ops.add(st, { title: 'ship it' }));
  let head = await ctx.relay.head(ctx.key);
  const id = head.payload.tasks[0].id;
  await runMutation(ctx, st => ops.move(st, { id, done: true }));

  const verAfterMove = ctx.fake.ver;
  head = await ctx.relay.head(ctx.key);
  const again = ops.move(head.payload, { id, done: true });
  assert.ok(again.noop, 'a self-move must be a no-op');
  assert.equal(ctx.fake.ver, verAfterMove, 'no write');
  const final = await ctx.fake.read();
  assert.equal(final.events.filter(e => e.type === 'moved').length, 1, 'a Done→Done event was logged');
});

test('done targets the last column even when it is not named Done', async () => {
  const ctx = await fixture();
  let head = await ctx.relay.head(ctx.key);
  const renamed = clone(head.payload);
  renamed.columns[renamed.columns.length - 1].name = 'Shipped';
  await ctx.fake.seed(renamed); ctx.fake.ver += 1;

  await runMutation(ctx, st => ops.add(st, { title: 'x' }));
  head = await ctx.relay.head(ctx.key);
  const id = head.payload.tasks[0].id;
  await runMutation(ctx, st => ops.move(st, { id, done: true }));
  const final = await ctx.fake.read();
  const t = final.tasks.find(x => x.id === id);
  assert.equal(t.columnId, final.columns[final.columns.length - 1].id);
  assert.equal(final.events.find(e => e.type === 'moved').to, 'Shipped');
});

test('ambiguous stage and project names are refused, with ids', async () => {
  const ctx = await fixture();
  const head = await ctx.relay.head(ctx.key);
  const st = clone(head.payload);
  st.columns.push({ id: 'dup1', name: 'Done' });   // two stages named Done are legal
  assert.throws(() => ops.add(st, { title: 'x', stage: 'Done' }), /matches 2 stages/);
  st.projects.push({ id: 'p2', name: 'Kanban Board' });
  assert.throws(() => ops.add(st, { title: 'x', project: 'Kanban Board' }), /matches 2 projects/);
});

test('an unknown project is refused rather than created', async () => {
  const ctx = await fixture();
  const head = await ctx.relay.head(ctx.key);
  assert.throws(() => ops.add(head.payload, { title: 'x', project: 'Kanban Bord' }), /no project named/);
});

test('an empty title is refused', async () => {
  const ctx = await fixture();
  const head = await ctx.relay.head(ctx.key);
  assert.throws(() => ops.add(head.payload, { title: '   ' }), /needs a title/);
});

test('410 is terminal and does not retry', async () => {
  const ctx = await fixture();
  ctx.fake.deleted = true;
  await assert.rejects(() => ctx.relay.head(ctx.key), err => err.kind === 'gone');
});

test('a hard network failure reports outcome-unknown, never silent success', async () => {
  const ctx = await fixture();
  const head = await ctx.relay.head(ctx.key);
  const built = ops.add(head.payload, { title: 'maybe' });
  let next = built.state;
  C.stampChanges(clone(head.payload), next);
  ctx.fake.plan('boom', 'boom', 'boom', 'boom', 'boom', 'boom');
  await assert.rejects(
    () => ctx.relay.land({ key: ctx.key, state: next, baseVer: head.ver, probe: built.probe, backoff: async () => {} }),
    err => err.kind === 'outcome-unknown');
});

test('a non-official relay origin is refused unless deliberate', () => {
  assert.equal(checkOrigin(OFFICIAL), null);
  assert.match(checkOrigin('https://evil.example'), /not the official relay/);
  assert.match(checkOrigin('http://evil.example', { trusted: true }), /must be https/);
  assert.equal(checkOrigin('http://localhost:8787', { trusted: true }), null);
});

test('archive then restore round-trips to the original stage', async () => {
  const ctx = await fixture();
  await runMutation(ctx, st => ops.add(st, { title: 'round trip', stage: 'Doing' }));
  let head = await ctx.relay.head(ctx.key);
  const id = head.payload.tasks[0].id;
  const doing = head.payload.columns.find(c => c.name === 'Doing').id;

  await runMutation(ctx, st => ops.archive(st, { id }));
  head = await ctx.relay.head(ctx.key);
  assert.ok(head.payload.tasks[0].archivedAt);

  await runMutation(ctx, st => ops.restore(st, { id }));
  head = await ctx.relay.head(ctx.key);
  assert.ok(!head.payload.tasks[0].archivedAt);
  assert.equal(head.payload.tasks[0].columnId, doing);
});

test('the event log only grows across every mutation', async () => {
  const ctx = await fixture();
  let seen = 0;
  for (const title of ['a', 'b', 'c']) {
    await runMutation(ctx, st => ops.add(st, { title }));
    const head = await ctx.fake.read();
    assert.ok(head.events.length >= seen, 'the log shrank');
    seen = head.events.length;
  }
  assert.equal(seen, 3);
});

/* ── secret handling ────────────────────────────────── */

test('a foreign error never reaches the terminal verbatim', () => {
  // Node puts the whole argv in the message of a failed spawn. If the CLI ever
  // shells out with a secret again, this is what keeps it off the screen.
  const spawnFail = new Error('Command failed: /usr/bin/security add-generic-password -w S3CRET_VALUE');
  const line = safeErrorLine(spawnFail);
  assert.ok(!line.includes('S3CRET_VALUE'), 'a subprocess error leaked its argv');
  assert.ok(!line.includes('add-generic-password'), 'raw subprocess text reached the output');
  assert.match(line, /unexpected failure/);
});

test('our own errors still say something useful', () => {
  const line = safeErrorLine(new boardsMod.BoardError('usage', 'no board named "work"'));
  assert.equal(line, 'usage: no board named "work"');
});

test('the keychain write never puts the secret in argv', () => {
  // A source-level guard, because the leak was a mismatch between what the
  // comment promised and what the argv array actually contained.
  const src = fs.readFileSync(require.resolve('../cli/boards.js'), 'utf8');
  const fn = src.slice(src.indexOf('function keychainSet'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(!/'-w',\s*secret/.test(body), 'the secret is being passed as an argv element');
  assert.ok(/input:/.test(body), 'the secret should go in over stdin');
  assert.ok(/'-U'/.test(body), "-U is required or replace fails on a duplicate item");
});

test('a sync link is never echoed back by the parser', () => {
  const secret = 'A'.repeat(43);
  const parsed = boardsMod.parseEntry(`https://kanban.page/app/?ns=work#sync=${secret}`);
  assert.equal(parsed, secret, 'the secret should be extracted');
  // and a bad one yields null rather than an error carrying the input
  assert.equal(boardsMod.parseEntry('https://kanban.page/app/#sync=short'), null);
});

test('a board cannot be named over another board\'s backup slot', () => {
  // `replace` parks the displaced secret at <name>.previous. Since keychainSet
  // passes -U, a board actually called "work.previous" would have its live
  // secret silently overwritten the next time "work" was replaced.
  assert.throws(() => boardsMod.addBoard('work.previous', 'A'.repeat(43)), /reserved/);
  assert.equal(boardsMod.previousOf('work'), 'work.previous');
});
