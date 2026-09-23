/* Team boards and computers: the pure rules from docs/team.md and
   docs/computers.md. Run: node --test tests/team.test.js */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

const clone = x => JSON.parse(JSON.stringify(x));
const board = (extra = {}) => ({
  v: 2,
  columns: [{ id: 'c1', name: 'Inbox' }, { id: 'c2', name: 'Doing' }, { id: 'c3', name: 'Done' }],
  projects: [], tasks: [], events: [], tombstones: {}, ...extra,
});
/** Save the way the app does: diff against the last save, stamp what changed. */
const save = (prev, next, now) => C.stampChanges(clone(prev), next, now);

/* ── schema ─────────────────────────────────────────────── */

test('a board without team or computer data still syncs as v2, byte for byte', () => {
  const b = board();
  const out = C.syncable(b);
  assert.equal(out.v, 2);
  for (const k of ['members', 'teams', 'teamsLeft', 'machines', 'privateSessions']) assert.ok(!(k in out));
});

test('members, teams, a lone leave tombstone, machines or private sessions make it v3', () => {
  assert.equal(C.syncable(board({ members: [{ id: 'm1', name: 'Ana' }] })).v, 3);
  assert.equal(C.syncable(board({ teams: [{ id: 'x', ns: 't-x' }] })).v, 3);
  // leaving the last team must keep the tombstone on the wire, or a stale
  // copy of the secret could come back through an old client
  assert.equal(C.syncable(board({ teamsLeft: { x: 5 } })).v, 3);
  assert.equal(C.syncable(board({ machines: [{ id: 'k', name: 'MacBook' }] })).v, 3);
  assert.equal(C.syncable(board({ privateSessions: { '["x","t"]': { session: 'a' } } })).v, 3);
  assert.equal(C.syncable(board({ tasks: [{ id: 't', assigneeId: 'm1' }] })).v, 3);
});

test('a head from a newer release is refused, and the forward guard spots it before migrate', () => {
  assert.match(C.validateSyncable({ ...board(), v: C.SYNC_V + 1 }), /newer than this client/);
  assert.equal(C.isFutureBoard({ v: C.SYNC_V + 1 }), true);
  assert.equal(C.isFutureBoard({ v: C.SYNC_V }), false);
  assert.equal(C.isFutureBoard(null), false);
});

test('validation rejects malformed team and computer data', () => {
  assert.ok(C.validateSyncable(board({ members: [{ id: 'm1', name: '  ' }] })));
  assert.ok(C.validateSyncable(board({ members: {} })));
  assert.ok(C.validateSyncable(board({ teams: [{ id: 'x', ns: 'personal' }] })));
  assert.ok(C.validateSyncable(board({ teams: [{ id: 'x', ns: 't-x', secret: 'short' }] })));
  assert.ok(C.validateSyncable(board({ teamsLeft: { x: 'soon' } })));
  assert.ok(C.validateSyncable(board({ machines: [{ id: 'k', name: 'x', icon: 'toaster' }] })));
  assert.ok(C.validateSyncable(board({ privateSessions: { k: 'nope' } })));
});

test('board kind: a roster never lands on the personal board, team-only data never on a team board', () => {
  const roster = board({ members: [{ id: 'm1', name: 'Ana' }] });
  assert.equal(C.validateSyncable(roster), null, 'kind-free structural check passes, so routing can happen');
  assert.match(C.validateSyncable(roster, 'personal'), /roster/);
  assert.equal(C.validateSyncable(roster, 'team'), null);
  assert.match(C.validateSyncable(board({ members: [] }), 'team'), /roster/);
  assert.match(C.validateSyncable(board(), 'team'), /roster/);
  for (const k of ['teams', 'teamsLeft', 'machines', 'privateSessions']) {
    const val = k === 'teams' || k === 'machines' ? [] : {};
    assert.match(C.validateSyncable({ ...roster, [k]: val }, 'team'), new RegExp(k));
  }
});

/* ── roster ─────────────────────────────────────────────── */

test('members union by id; a rename wins by clock; a remote-only roster survives merge', () => {
  const a = board({ members: [{ id: 'm1', name: 'Ana', mt: 5 }] });
  const b = board({ members: [{ id: 'm1', name: 'Ana R', mt: 9 }, { id: 'm2', name: 'Tomás', mt: 3 }] });
  const m = C.merge(a, b);
  assert.deepEqual(m.members.map(x => [x.id, x.name]), [['m1', 'Ana R'], ['m2', 'Tomás']]);
  assert.deepEqual(C.merge(board(), b).members.map(x => x.id), ['m1', 'm2']);
});

test('two people who both join as "Ana" stay two people', () => {
  const a = board({ members: [{ id: 'm1', name: 'Ana', mt: 5 }] });
  const b = board({ members: [{ id: 'm2', name: 'Ana', mt: 5 }] });
  assert.equal(C.merge(a, b).members.length, 2);
  assert.equal(C.merge(b, a).members.length, 2);
});

test('a member rename on a behind-clock device still stamps above everything observed', () => {
  const prev = board({ members: [{ id: 'm1', name: 'Ana', mt: 5000 }] });
  const next = clone(prev); next.members[0].name = 'Ana R';
  save(prev, next, 10); // wall clock far behind
  assert.ok(next.members[0].mt > 5000);
});

/* ── teams you belong to ────────────────────────────────── */

test('team id and namespace derive from the secret: same secret, same place', async () => {
  const secret = C.randomSecret();
  const a = await C.teamIdOf(secret), b = await C.teamIdOf(secret);
  assert.equal(a, b);
  assert.equal(a.length, 22);
  assert.ok(C.isTeamNs(C.teamNs(a)));
  assert.notEqual(a, await C.teamIdOf(C.randomSecret()));
});

test('two devices joining the same team concurrently converge on one entry', () => {
  const entry = (memberId, joinMt, memberMt) => ({ id: 'T', ns: 't-T', label: 'Team', secret: 'S'.repeat(43), memberId, joinMt, mt: joinMt, memberMt });
  const a = board({ teams: [entry('m1', 10, 10)] });
  const b = board({ teams: [entry('m2', 10, 12)] });
  const ab = C.merge(a, b), ba = C.merge(b, a);
  assert.equal(ab.teams.length, 1);
  assert.equal(ab.teams[0].memberId, 'm2', 'identity resolves by its own clock');
  assert.deepEqual(C.syncable(ab), C.syncable(ba));
});

test('a leave is a tombstone: it strips the secret, beats a stale label edit, loses to a rejoin', () => {
  const secret = 'S'.repeat(43);
  const live = board({ teams: [{ id: 'T', ns: 't-T', label: 'Team', secret, memberId: 'm1' }] });
  const joined = save(board(), clone(live), 100);
  assert.ok(joined.teams[0].joinMt >= 100);

  // leave on device A
  const left = clone(joined); left.teams = []; left.teamsLeft = { T: 0 };
  save(joined, left, 200);
  assert.ok(left.teamsLeft.T > joined.teams[0].joinMt);

  // device B still holds the entry and renames it — a stale edit
  const stale = clone(joined); stale.teams[0].label = 'Renamed';
  save(joined, stale, 300);
  const merged = C.merge(stale, left);
  assert.equal((merged.teams || []).length, 0, 'the stale edit must not resurrect the team');
  assert.ok(!JSON.stringify(merged).includes(secret), 'no copy of the secret survives');

  // an explicit rejoin (absent in the last save, present now) starts a newer generation
  const rejoin = clone(merged); rejoin.teams = [{ id: 'T', ns: 't-T', label: 'Team', secret, memberId: 'm1' }];
  save(merged, rejoin, 400);
  assert.equal(C.merge(rejoin, left).teams.length, 1);
});

test('a fast-clock leave cannot sit above a later rejoin', () => {
  const left = board({ teamsLeft: { T: 9_000_000_000_000 } });
  const next = clone(left); next.teams = [{ id: 'T', ns: 't-T', label: 'Team', secret: 'S'.repeat(43) }];
  save(left, next, 1000);
  assert.ok(next.teams[0].joinMt > left.teamsLeft.T);
});

test('export omits team secrets and device bookkeeping', () => {
  const st = board({ teams: [{ id: 'T', ns: 't-T', secret: 'S'.repeat(43) }], teamsLeft: { X: 1 }, teamsReqApplied: { T: 3 }, _contentGen: 2 });
  const out = C.exportable(st);
  for (const k of ['teams', 'teamsLeft', 'teamsReqApplied', '_contentGen']) assert.ok(!(k in out));
  assert.ok(st.teams, 'the live state is untouched');
});

/* ── assignment ─────────────────────────────────────────── */

test('the assignee group merges independently of a concurrent title edit, as one unit', () => {
  const base = board({ tasks: [{ id: 't', title: 'x', columnId: 'c1', order: 0 }] });
  const s0 = save(board(), clone(base), 100);
  const a = clone(s0); a.tasks[0].title = 'renamed'; save(s0, a, 200);
  const b = clone(s0); Object.assign(b.tasks[0], { assigneeId: 'm2', assignedBy: 'm1', assignedAt: 1 }); save(s0, b, 300);
  const m = C.merge(a, b);
  assert.equal(m.tasks[0].title, 'renamed');
  assert.deepEqual([m.tasks[0].assigneeId, m.tasks[0].assignedBy], ['m2', 'm1']);
  assert.deepEqual(C.syncable(C.merge(b, a)), C.syncable(m));
});

/* ── events ─────────────────────────────────────────────── */

test('events carry stage ids always and attribution only when the caller knows who', () => {
  const e1 = C.makeEvent({ taskId: 't', title: 'x', type: 'moved', from: 'Inbox', to: 'Done', fromColumnId: 'c1', toColumnId: 'c3' });
  assert.equal(e1.toColumnId, 'c3');
  assert.ok(!('by' in e1), 'no identity, no attribution');
  const e2 = C.makeEvent({ taskId: 't', title: 'x', type: 'moved', from: 'Inbox', to: 'Done', toColumnId: 'c3', by: 'm1', byName: 'Ana' });
  assert.deepEqual([e2.by, e2.byName], ['m1', 'Ana']);
});

test('rewriteDay changes the day and nothing else', () => {
  const e = C.makeEvent({ taskId: 't', title: 'x', type: 'moved', from: 'Inbox', to: 'Done', fromColumnId: 'c1', toColumnId: 'c3', by: 'm1', byName: 'Ana' }, { now: Date.parse('2026-09-16T15:00:00Z') });
  const events = [e];
  C.rewriteDay(events, { eventIds: [e.id] }, '2026-09-15');
  const after = events.find(x => x.id === e.id);
  assert.equal(after.day, '2026-09-15');
  assert.deepEqual([after.by, after.byName, after.fromColumnId, after.toColumnId], ['m1', 'Ana', 'c1', 'c3']);
});

/* ── tense and done-by by column id ─────────────────────── */

const MON = '2026-09-14';
const at = d => Date.parse(`2026-09-${d}T15:00:00Z`);
const ev = (f, d) => C.makeEvent(f, { now: at(d) });

test('a move into a middle stage that happens to be named like the done stage is not shipped', () => {
  const done = { id: 'c3', name: 'Done' };
  const events = [
    ev({ taskId: 'a', title: 'A', type: 'moved', from: 'Inbox', to: 'Done', fromColumnId: 'c1', toColumnId: 'c9' }, 15),
    ev({ taskId: 'b', title: 'B', type: 'moved', from: 'Inbox', to: 'Done', fromColumnId: 'c1', toColumnId: 'c3' }, 15),
  ];
  const rows = C.aggregateWeek(events, MON, () => ({ title: 'x', project: 'P' }), done);
  const t = Object.fromEntries(rows.map(r => [r.taskId, r.tense]));
  assert.deepEqual(t, { a: 'inflight', b: 'shipped' });
});

test('a renamed done stage still classifies by id; legacy events fall back to names and give no doneBy', () => {
  const done = { id: 'c3', name: 'Shipped' }; // renamed since the events were logged
  const events = [
    ev({ taskId: 'a', title: 'A', type: 'moved', from: 'Doing', to: 'Done', fromColumnId: 'c2', toColumnId: 'c3', by: 'm1' }, 15),
    ev({ taskId: 'b', title: 'B', type: 'moved', from: 'Doing', to: 'Shipped' }, 15), // legacy: no ids
  ];
  const rows = C.aggregateWeek(events, MON, () => ({ title: 'x', project: 'P' }), done);
  const a = rows.find(r => r.taskId === 'a'), b = rows.find(r => r.taskId === 'b');
  assert.equal(a.tense, 'shipped');
  assert.equal(a.doneBy, 'm1');
  assert.equal(b.tense, 'shipped');
  assert.equal(b.doneBy, null);
});

test('a string done stage keeps the old behaviour for existing callers', () => {
  const events = [ev({ taskId: 'a', title: 'A', type: 'moved', from: 'Doing', to: 'Done', fromColumnId: 'c2', toColumnId: 'c3' }, 15)];
  assert.equal(C.aggregateWeek(events, MON, null, 'Done')[0].tense, 'shipped');
});

test('rows record who touched them and who crossed the done line', () => {
  const done = { id: 'c3', name: 'Done' };
  const events = [
    ev({ taskId: 'a', title: 'A', type: 'created', to: 'Inbox', toColumnId: 'c1', by: 'andrea' }, 14),
    ev({ taskId: 'a', title: 'A', type: 'moved', from: 'Inbox', to: 'Done', fromColumnId: 'c1', toColumnId: 'c3', by: 'seb' }, 16),
  ];
  const [r] = C.aggregateWeek(events, MON, () => ({ title: 'A', project: 'P' }), done);
  assert.deepEqual(r.byIds.sort(), ['andrea', 'seb']);
  assert.equal(r.doneBy, 'seb');
  assert.equal(r.from, 'New', 'the full route is kept');
});

test('doneByOf reads the log by column id and ignores legacy events', () => {
  const events = [
    ev({ taskId: 'a', title: 'A', type: 'moved', from: 'Doing', to: 'Done', by: 'x' }, 14), // legacy
    ev({ taskId: 'a', title: 'A', type: 'moved', from: 'Doing', to: 'Done', fromColumnId: 'c2', toColumnId: 'c3', by: 'seb', byName: 'Seb' }, 15),
    ev({ taskId: 'a', title: 'A', type: 'moved', from: 'Doing', to: 'Done', fromColumnId: 'c2', toColumnId: 'c9', by: 'ana' }, 16), // same name, other column
  ];
  assert.deepEqual(C.doneByOf(events, 'a', 'c3'), { by: 'seb', byName: 'Seb', at: at(15) });
  assert.equal(C.doneByOf(events.slice(0, 1), 'a', 'c3'), null);
});

/* ── computers ──────────────────────────────────────────── */

test('the session group merges as one unit', () => {
  const base = board({ tasks: [{ id: 't', title: 'x', columnId: 'c1', order: 0, session: 'claude --resume a' }] });
  const s0 = save(board(), clone(base), 100);
  const a = clone(s0); Object.assign(a.tasks[0], { session: 'claude --resume b', sessionMachine: 'k1' }); save(s0, a, 200);
  const b = clone(s0); Object.assign(a.tasks[0]); b.tasks[0].notes = 'n'; save(s0, b, 300);
  const m = C.merge(a, b);
  assert.deepEqual([m.tasks[0].session, m.tasks[0].sessionMachine, m.tasks[0].notes], ['claude --resume b', 'k1', 'n']);
});

test('two devices that each registered "MacBook" collapse to one computer, and sessions follow', () => {
  const a = board({ machines: [{ id: 'k1', name: 'MacBook', icon: 'laptop', mt: 5 }], machinesMt: 5,
    tasks: [{ id: 't', title: 'x', columnId: 'c1', session: 's', sessionMachine: 'k1', mt: 5 }] });
  const b = board({ machines: [{ id: 'k2', name: 'MacBook', icon: 'laptop', mt: 6 }], machinesMt: 6 });
  const m = C.merge(a, b);
  assert.equal(m.machines.length, 1);
  assert.equal(m.tasks[0].sessionMachine, m.machines[0].id);
});

test('a deleted computer never becomes a wrong computer', () => {
  const a = board({ machines: [{ id: 'k1', name: 'Mac mini', mt: 5 }], machinesMt: 5,
    tasks: [{ id: 't', title: 'x', columnId: 'c1', session: 's', sessionMachine: 'k1', mt: 5 }] });
  const b = board({ machines: [], machinesMt: 9, tombstones: { k1: 9 } });
  const m = C.merge(a, b);
  assert.equal(m.machines.length, 0);
  assert.ok(!m.tasks[0].sessionMachine);
  assert.equal(m.tasks[0].session, 's', 'the command stays');
});

test('private sessions merge per key and clearing wins by clock', () => {
  const k = JSON.stringify(['T', 't']);
  const a = board({ privateSessions: { [k]: { session: 'claude --resume a', mt: 5 } } });
  const b = board({ privateSessions: { [k]: { session: '', mt: 9 } } });
  assert.equal(C.merge(a, b).privateSessions[k].session, '');
  assert.equal(C.merge(b, a).privateSessions[k].session, '');
});

test('the session firewall: a team payload carrying a session is refused, not stripped', () => {
  const roster = [{ id: 'm1', name: 'Ana' }];
  const leak = board({ members: roster, tasks: [{ id: 't', title: 'x', columnId: 'c1', session: 'claude --resume a' }] });
  assert.match(C.validateSyncable(leak, 'team'), /session/);
  const cwd = board({ members: roster, tasks: [{ id: 't', title: 'x', columnId: 'c1', sessionCwd: '/Users/x' }] });
  assert.match(C.validateSyncable(cwd, 'team'), /session/);
  assert.equal(C.validateSyncable(board({ members: roster, tasks: [{ id: 't', title: 'x', columnId: 'c1' }] }), 'team'), null);
});

test('computer aliases also re-point private sessions', () => {
  const k = JSON.stringify(['T', 't']);
  const a = board({ machines: [{ id: 'k1', name: 'MacBook', mt: 5 }], machinesMt: 5,
    privateSessions: { [k]: { session: 's', sessionMachine: 'k1', mt: 5 } } });
  const b = board({ machines: [{ id: 'k2', name: 'MacBook', mt: 6 }], machinesMt: 6 });
  const m = C.merge(a, b);
  assert.equal(m.privateSessions[k].sessionMachine, m.machines[0].id);
});

test('leaving again after a rejoin re-stamps the tombstone past the rejoin', () => {
  const secret = 'S'.repeat(43);
  let st = save(board(), board({ teams: [{ id: 'T', ns: 't-T', label: 'Team', secret }] }), 100);
  let next = clone(st); next.teams = []; next.teamsLeft = { T: 0 }; st = save(st, next, 200);
  next = clone(st); next.teams = [{ id: 'T', ns: 't-T', label: 'Team', secret }]; st = save(st, next, 300);
  const rejoinMt = st.teams[0].joinMt;
  next = clone(st); next.teams = []; next.teamsLeft = { T: 0 }; st = save(st, next, 400);
  assert.ok(st.teamsLeft.T > rejoinMt);
  assert.equal((C.merge(st, board({ teams: [{ id: 'T', ns: 't-T', secret, joinMt: rejoinMt, mt: rejoinMt, memberMt: rejoinMt }] })).teams || []).length, 0);
});

test('the firewall checks presence: even an empty session slot is refused on a team board', () => {
  const t = board({ members: [{ id: 'm1', name: 'Ana' }], tasks: [{ id: 't', title: 'x', columnId: 'c1', session: '' }] });
  assert.match(C.validateSyncable(t, 'team'), /session/);
});

test('a tombstone written as 0 is stamped past a fast-clocked item, so the item stays deleted', () => {
  const future = 9_000_000_000_000;
  const prev = board({ machines: [{ id: 'k', name: 'Mac mini', mt: future }], machinesMt: future });
  const next = clone(prev); next.machines = []; next.tombstones = { k: 0 };
  save(prev, next, 1000);
  assert.ok(next.tombstones.k > future);
  assert.equal(C.merge(prev, next).machines.length, 0);
  assert.equal(C.merge(next, prev).machines.length, 0);
});

test('a private session never keeps a deleted computer', () => {
  const k = JSON.stringify(['T', 't']);
  const a = board({ machines: [{ id: 'm', name: 'Mac mini', mt: 5 }], machinesMt: 5, privateSessions: { [k]: { session: 's', sessionMachine: 'm', mt: 5 } } });
  const b = board({ machines: [], machinesMt: 9, tombstones: { m: 9 } });
  const merged = C.merge(a, b);
  assert.ok(!merged.privateSessions[k].sessionMachine);
  assert.equal(merged.privateSessions[k].session, 's');
});

test('the profile syncs as one record: newest clock wins, it makes the board v3, and it never lands on a team board', () => {
  const prev = board({ profile: { name: 'Seb', avatar: 'byte', mt: 5 } });
  const next = clone(prev); next.profile.avatar = 'miso';
  save(prev, next, 1);
  assert.ok(next.profile.mt > 5);
  assert.equal(C.merge(prev, next).profile.avatar, 'miso');
  assert.equal(C.merge(next, prev).profile.avatar, 'miso');
  assert.equal(C.syncable(next).v, 3);
  assert.equal(C.merge(board(), next).profile.name, 'Seb', 'a remote-only profile survives merge');
  assert.match(C.validateSyncable({ ...board({ members: [{ id: 'm', name: 'A' }] }), profile: { name: 'x' } }, 'team'), /profile/);
  assert.match(C.validateSyncable(board({ profile: { name: 5 } })), /profile/);
});
