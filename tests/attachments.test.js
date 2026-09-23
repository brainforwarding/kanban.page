/* Images on cards: the pure rules from docs/attachments.md.
   Run: node --test tests/attachments.test.js */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const clone = x => JSON.parse(JSON.stringify(x));
const board = (extra = {}) => ({
  v: 2,
  columns: [{ id: 'c1', name: 'Inbox' }, { id: 'c2', name: 'Done' }],
  projects: [], tasks: [{ id: 't', title: 'bug', columnId: 'c1', order: 0 }], events: [], tombstones: {}, ...extra,
});
const save = (prev, next, now) => C.stampChanges(clone(prev), next, now);
const att = (extra = {}) => ({ task: 't', blob: 'B'.repeat(22), type: 'image/webp', w: 800, h: 600, bytes: 1000, at: 1, ...extra });

test('an image makes the board v4, which a v3 client refuses, and travels in syncable', () => {
  assert.equal(C.syncable(board()).v, 2);
  assert.equal(C.syncable(board({ machines: [{ id: 'm', name: 'Mac' }] })).v, 3);
  const b = board({ attachments: { a1: att({ mt: 5 }) } });
  const out = C.syncable(b);
  assert.equal(out.v, 4);
  assert.equal(C.SYNC_V, 4);
  assert.ok(C.isFutureBoard({ v: 5 }));
  assert.match(C.validateSyncable({ ...out, v: 5 }), /newer than this client/);
  assert.deepEqual(out.attachments, b.attachments);
  assert.ok(!('attachments' in C.syncable(board({ attachments: {} }))));
});

test('two people adding an image to the same card at once keep both', () => {
  const base = board();
  const a = clone(base); a.attachments = { a1: att() }; save(base, a, 10);
  const b = clone(base); b.attachments = { a2: att({ blob: 'C'.repeat(22) }) }; save(base, b, 10);
  for (const m of [C.merge(a, b), C.merge(b, a)]) assert.deepEqual(Object.keys(m.attachments).sort(), ['a1', 'a2']);
  assert.equal(C.canon(C.syncable(C.merge(a, b))), C.canon(C.syncable(C.merge(b, a))), 'commutative');
  const m = C.merge(a, b);
  assert.equal(C.canon(C.merge(m, m)), C.canon(m), 'idempotent');
});

test('removing is a tombstone that beats the older copy, and Undo beats the removal', () => {
  const base = board({ attachments: { a1: att({ mt: 5 }) } });
  const removed = clone(base); removed.attachments.a1.gone = true; save(base, removed, 10);
  assert.ok(removed.attachments.a1.mt > 5);
  assert.equal(C.merge(base, removed).attachments.a1.gone, true);
  assert.equal(C.merge(removed, base).attachments.a1.gone, true);
  const undone = clone(removed); delete undone.attachments.a1.gone; save(removed, undone, 20);
  assert.ok(!C.merge(removed, undone).attachments.a1.gone);
  assert.ok(!C.merge(undone, removed).attachments.a1.gone);
});

test('absence is never a removal: a snapshot without an image puts it back, unstamped', () => {
  const before = board();
  const added = clone(before); added.attachments = { a1: att() }; save(before, added, 10);
  const restored = clone(before); // an unrelated Undo to a snapshot without the map at all
  save(added, restored, 20);
  assert.deepEqual(restored.attachments.a1, added.attachments.a1);
  assert.ok(!restored.attachments.a1.gone);
});

test('a fast-clock image cannot outvote a later local removal', () => {
  const future = 9_000_000_000_000;
  const remote = board({ attachments: { a1: att({ mt: future }) } });
  const local = C.merge(board(), remote);
  const removed = clone(local); removed.attachments.a1.gone = true; save(local, removed, 1000);
  assert.ok(removed.attachments.a1.mt > future);
  assert.equal(C.merge(remote, removed).attachments.a1.gone, true);
  const restored = clone(removed); delete restored.attachments.a1.gone; save(removed, restored, 1001);
  assert.ok(!C.merge(removed, restored).attachments.a1.gone);
});

test('an image is live only while its card exists, so deleting the card forever hides it and Undo brings it back', () => {
  const b = board({ attachments: { a1: att({ mt: 1 }), a2: att({ mt: 1, gone: true }), a3: att({ mt: 1, task: 'other' }) } });
  assert.deepEqual(C.liveAttachments(b, 't').map(a => a.id), ['a1']);
  const deleted = clone(b); deleted.tasks = []; deleted.tombstones = { t: 5 };
  assert.deepEqual(C.liveAttachments(deleted, 't'), []);
  assert.deepEqual(C.liveAttachments(b).map(a => a.id), ['a1'], 'no card filter: every live image');
});

test('the push floor unions image references per key', () => {
  const st = board({ attachments: { a1: att({ mt: 1 }) } });
  const out = C.unionFloor(st, { events: [], tombstones: {}, attachments: { a1: att({ mt: 3, gone: true }), a2: att({ mt: 2 }) } });
  assert.equal(out.attachments.a1.gone, true);
  assert.ok(out.attachments.a2);
  assert.ok(!('attachments' in C.unionFloor(board(), { events: [], tombstones: {} })));
});

test('an unchanged image keeps its clock', () => {
  const b = board({ attachments: { a1: att({ mt: 5 }) } });
  const next = clone(b); next.tasks[0].title = 'renamed';
  save(b, next, 100);
  assert.equal(next.attachments.a1.mt, 5);
});

test('ties go to the greater serialization on both sides', () => {
  const x = board({ attachments: { a1: att({ mt: 5, name: 'a.png' }) } });
  const y = board({ attachments: { a1: att({ mt: 5, name: 'b.png' }) } });
  assert.equal(C.merge(x, y).attachments.a1.name, C.merge(y, x).attachments.a1.name);
});

test('image clocks count toward clockMax', () => {
  assert.equal(C.clockMax(board({ attachments: { a1: att({ mt: 9e12 }) } })), 9e12);
});

test('validation accepts images on both kinds of board and refuses malformed ones', () => {
  const ok = board({ attachments: { a1: att({ mt: 1 }) } });
  assert.equal(C.validateSyncable(ok), null);
  assert.equal(C.validateSyncable(ok, 'personal'), null);
  assert.equal(C.validateSyncable({ ...ok, members: [{ id: 'm', name: 'Ana' }] }, 'team'), null);
  for (const bad of [
    { attachments: [] },
    { attachments: { a: att({ blob: 'short' }) } },
    { attachments: { a: att({ type: 'text/html' }) } },
    { attachments: { a: att({ bytes: 2_000_000 }) } },
    { attachments: { a: att({ w: -1 }) } },
    { attachments: { a: att({ task: '' }) } },
    { attachments: { a: att({ name: 5 }) } },
  ]) assert.ok(C.validateSyncable(board(bad)), JSON.stringify(bad));
});

test('a backup keeps the image references', () => {
  const b = board({ attachments: { a1: att({ mt: 1 }) } });
  assert.deepEqual(C.exportable(b).attachments, b.attachments);
});

test('an image seals to its id: round trip, wrong id and tampering fail', async () => {
  const key = await C.deriveBlobKey(C.randomSecret());
  const id = C.newBlobId();
  assert.match(id, C.BLOB_ID);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const sealed = await C.sealBlob(key, id, bytes);
  assert.equal(sealed.length, 12 + bytes.length + 16);
  assert.deepEqual(await C.unsealBlob(key, id, sealed), bytes);
  await assert.rejects(C.unsealBlob(key, C.newBlobId(), sealed));
  const tampered = sealed.slice(); tampered[20] ^= 1;
  await assert.rejects(C.unsealBlob(key, id, tampered));
  await assert.rejects(C.unsealBlob(await C.deriveBlobKey(C.randomSecret()), id, sealed));
});

test('the image key is not the board key', async () => {
  const secret = C.randomSecret();
  const { key } = await C.deriveSync(secret);
  const id = C.newBlobId();
  const sealed = await C.sealBlob(await C.deriveBlobKey(secret), id, new Uint8Array([9, 9]));
  await assert.rejects(C.unsealBlob(key, id, sealed));
});

test('imageInfo reads type and size from the header, and nothing else passes', () => {
  const png = new Uint8Array(24); png.set([0x89, 0x50, 0x4E, 0x47, 13, 10, 26, 10]);
  png.set([0, 0, 0x06, 0x40], 16); png.set([0, 0, 0x04, 0xB0], 20);
  assert.deepEqual(C.imageInfo(png), { type: 'image/png', w: 1600, h: 1200 });
  const gif = new Uint8Array(12); gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x06, 0xB0, 0x04]);
  assert.deepEqual(C.imageInfo(gif), { type: 'image/gif', w: 1600, h: 1200 });
  const webp = new Uint8Array(30); webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
  webp.set([0x3F, 0x06, 0x00, 0xAF, 0x04, 0x00], 24);
  assert.deepEqual(C.imageInfo(webp), { type: 'image/webp', w: 1600, h: 1200 });
  // JPEG: SOI, an APP0 segment to skip, then SOF0 with height 1200, width 1600
  const jpg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x11, 0x08, 0x04, 0xB0, 0x06, 0x40, 0x03, 0, 0, 0, 0]);
  assert.deepEqual(C.imageInfo(jpg), { type: 'image/jpeg', w: 1600, h: 1200 });
  assert.equal(C.imageInfo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(C.imageInfo(new Uint8Array(3)), null);
});
