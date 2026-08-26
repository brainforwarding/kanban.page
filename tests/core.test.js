/* Tests for board's pure logic: Chile week math, report aggregation, markdown.
   Run: node --test tests/          (no dependencies)

   These were written before core.js existed. If one fails, the behaviour is
   wrong — not the test. */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

/* ── calendar dates in America/Santiago ────────────────── */

test('ymd returns the Chile calendar date, not the UTC one', () => {
  // 2026-03-09T02:00Z — Chile is UTC-3 in March (summer time), so it is still Mar 8 there.
  assert.equal(C.ymd(Date.parse('2026-03-09T02:00:00Z')), '2026-03-08');
  // 2026-05-11T02:00Z — Chile is UTC-4 in May (standard time), so it is still May 10 there.
  assert.equal(C.ymd(Date.parse('2026-05-11T02:00:00Z')), '2026-05-10');
  // Midday UTC is unambiguously the same day in Chile.
  assert.equal(C.ymd(Date.parse('2026-05-11T15:00:00Z')), '2026-05-11');
});

test('ymd survives the April DST fallback weekend', () => {
  // Chile ends DST on the first Saturday of April 2026 (clocks go back at 24:00 Apr 4).
  assert.equal(C.ymd(Date.parse('2026-04-04T23:30:00Z')), '2026-04-04'); // UTC-3 → 20:30
  assert.equal(C.ymd(Date.parse('2026-04-05T03:30:00Z')), '2026-04-04'); // UTC-4 → 23:30
});

test('addDays walks calendar dates across month and year ends', () => {
  assert.equal(C.addDays('2026-03-30', 6), '2026-04-05');
  assert.equal(C.addDays('2025-12-29', 6), '2026-01-04');
  assert.equal(C.addDays('2026-03-05', -4), '2026-03-01');
  assert.equal(C.addDays('2024-02-28', 1), '2024-02-29'); // leap year
});

test('addDays is immune to DST (pure calendar arithmetic)', () => {
  // Crossing the Chile DST boundary must still advance exactly one day.
  assert.equal(C.addDays('2026-04-04', 1), '2026-04-05');
  assert.equal(C.addDays('2026-09-05', 1), '2026-09-06');
});

/* ── weeks run Monday → Sunday ─────────────────────────── */

test('mondayOf snaps any date back to its Monday', () => {
  assert.equal(C.mondayOf('2026-03-09'), '2026-03-09'); // Monday itself
  assert.equal(C.mondayOf('2026-03-11'), '2026-03-09'); // Wednesday
  assert.equal(C.mondayOf('2026-03-15'), '2026-03-09'); // Sunday belongs to the week that opened Mar 9
  assert.equal(C.mondayOf('2026-03-16'), '2026-03-16'); // next Monday
});

test('mondayOf crosses month and year boundaries', () => {
  assert.equal(C.mondayOf('2026-01-03'), '2025-12-29'); // Sat Jan 3 2026 → Mon Dec 29 2025
  assert.equal(C.mondayOf('2026-04-01'), '2026-03-30');
});

test('weekRange spans exactly seven days ending Sunday', () => {
  const w = C.weekRange('2026-03-09');
  assert.equal(w.monday, '2026-03-09');
  assert.equal(w.sunday, '2026-03-15');
  assert.equal(w.days.length, 7);
  assert.equal(w.days[0], '2026-03-09');
  assert.equal(w.days[6], '2026-03-15');
});

test('weekLabel reads like a human wrote it', () => {
  assert.equal(C.weekLabel('2026-03-09'), '9–15 Mar 2026');       // same month
  assert.equal(C.weekLabel('2026-03-30'), '30 Mar – 5 Apr 2026'); // spans months
  assert.equal(C.weekLabel('2025-12-29'), '29 Dec 2025 – 4 Jan 2026'); // spans years
});

test('contains() knows whether a day belongs to a week', () => {
  assert.equal(C.contains('2026-03-09', '2026-03-09'), true);
  assert.equal(C.contains('2026-03-09', '2026-03-15'), true);
  assert.equal(C.contains('2026-03-09', '2026-03-16'), false);
  assert.equal(C.contains('2026-03-09', '2026-03-08'), false);
});

/* ── the week list ─────────────────────────────────────── */

const ev = (day, patch = {}) => ({
  id: day + Math.random(), taskId: 't1', title: 'x',
  type: 'moved', from: 'Inbox', to: 'Doing', at: Date.parse(day + 'T12:00:00Z'), day, ...patch,
});

test('weeksWithActivity lists every week from first activity to last, newest first', () => {
  const events = [ev('2026-03-11'), ev('2026-03-15'), ev('2026-03-16'), ev('2026-02-02')];
  const weeks = C.weeksWithActivity(events);
  // quiet weeks in between are listed too, so any week can still be picked
  assert.deepEqual(weeks.map(w => w.monday), [
    '2026-03-16', '2026-03-09', '2026-03-02', '2026-02-23', '2026-02-16', '2026-02-09', '2026-02-02',
  ]);
  assert.equal(weeks[1].count, 2); // Mar 11 and Mar 15 are the same week
  assert.equal(weeks[2].count, 0); // a genuinely quiet week
});

test('weeksWithActivity runs the range up to today, so this week is always reachable', () => {
  const weeks = C.weeksWithActivity([ev('2026-02-02')], '2026-03-11');
  assert.equal(weeks[0].monday, '2026-03-09');
  assert.equal(weeks.at(-1).monday, '2026-02-02');
  assert.equal(weeks.length, 6);
});

test('weeksWithActivity always includes the current week, even when empty', () => {
  const weeks = C.weeksWithActivity([], '2026-03-11');
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].monday, '2026-03-09');
  assert.equal(weeks[0].count, 0);
});

/* ── aggregation: initial state → end state ────────────── */

const look = titles => id => ({ title: titles[id] || null, project: null });

test('a card created this week reports New → its stage', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'Fix webhook', type: 'created', from: null, to: 'Inbox', at: 1, day: '2026-03-09' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'Fix webhook' }));
  assert.equal(e.from, 'New');
  assert.equal(e.to, 'Inbox');
  assert.equal(e.created, true);
});

test('a card moved several times reports the first origin and the last destination', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 2, day: '2026-03-09' },
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Doing', to: 'Waiting', at: 3, day: '2026-03-11' },
    { id: 'e3', taskId: 't1', title: 'A', type: 'moved', from: 'Waiting', to: 'Done', at: 4, day: '2026-03-13' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }));
  assert.equal(e.from, 'Inbox');
  assert.equal(e.to, 'Done');
  assert.equal(e.day, '2026-03-13'); // dated by its latest movement
});

test('events are folded in (day, at) order regardless of array order', () => {
  const events = [
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Doing', to: 'Done', at: 9, day: '2026-03-13' },
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 99, day: '2026-03-09' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }));
  assert.equal(e.from, 'Inbox');
  assert.equal(e.to, 'Done');
});

test('created and then moved in the same week still reports New → final stage', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'created', from: null, to: 'Inbox', at: 1, day: '2026-03-09' },
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 2, day: '2026-03-10' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }));
  assert.equal(e.from, 'New');
  assert.equal(e.to, 'Doing');
  assert.equal(e.created, true);
});

test('a round trip within the week is marked netZero and excluded by default', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Doing', to: 'Waiting', at: 1, day: '2026-03-09' },
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Waiting', to: 'Doing', at: 2, day: '2026-03-10' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }));
  assert.equal(e.netZero, true);
  assert.equal(e.include, false); // still listed in the UI, just unticked
});

test('a card created this week is never netZero, even if it ends where it started', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'created', from: null, to: 'Inbox', at: 1, day: '2026-03-09' },
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 2, day: '2026-03-10' },
    { id: 'e3', taskId: 't1', title: 'A', type: 'moved', from: 'Doing', to: 'Inbox', at: 3, day: '2026-03-11' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }));
  assert.equal(e.created, true);
  assert.equal(e.netZero, false);
  assert.equal(e.include, false); // real work, but unfinished and unassigned — listed, not pre-ticked
});

test('only the selected week is aggregated', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 1, day: '2026-03-08' },
    { id: 'e2', taskId: 't2', title: 'B', type: 'moved', from: 'Inbox', to: 'Doing', at: 2, day: '2026-03-10' },
    { id: 'e3', taskId: 't3', title: 'C', type: 'moved', from: 'Inbox', to: 'Doing', at: 3, day: '2026-03-16' },
  ];
  const rows = C.aggregateWeek(events, '2026-03-09', look({ t2: 'B' }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'B');
});

test('the same card reports independently in each of its weeks', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 1, day: '2026-03-10' },
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Doing', to: 'Done', at: 2, day: '2026-03-17' },
  ];
  const w1 = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }));
  const w2 = C.aggregateWeek(events, '2026-03-16', look({ t1: 'A' }));
  assert.deepEqual([w1[0].from, w1[0].to], ['Inbox', 'Doing']);
  assert.deepEqual([w2[0].from, w2[0].to], ['Doing', 'Done']);
});

test('a deleted card still reports, using the title stored on its event', () => {
  const events = [
    { id: 'e1', taskId: 'gone', title: 'Ship the thing', type: 'moved', from: 'Doing', to: 'Done', at: 1, day: '2026-03-09' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', () => null); // task no longer exists
  assert.equal(e.title, 'Ship the thing');
  assert.equal(e.deleted, true);
});

test('a renamed card reports its current title, not the snapshot', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'old title', type: 'moved', from: 'Doing', to: 'Done', at: 1, day: '2026-03-09' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'new title' }));
  assert.equal(e.title, 'new title');
});

test('stage names come from the event, so later renames cannot rewrite history', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Backlog', to: 'Shipped', at: 1, day: '2026-03-09' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }));
  assert.equal(e.from, 'Backlog'); // even though no stage is called Backlog any more
  assert.equal(e.to, 'Shipped');
});

test('entries are ordered by project, then by the day they last moved', () => {
  const mk = (id, day, project) => ({
    id: 'e' + id, taskId: id, title: id, type: 'moved', from: 'Inbox', to: 'Done',
    at: 1, day,
  });
  const events = [mk('a', '2026-03-13'), mk('b', '2026-03-09'), mk('c', '2026-03-11')];
  const proj = { a: 'crm', b: 'crm', c: null };
  const rows = C.aggregateWeek(events, '2026-03-09', id => ({ title: id, project: proj[id] }));
  assert.deepEqual(rows.map(r => r.taskId), ['b', 'a', 'c']); // crm (b, a) before unassigned (c)
});

/* ── grouping + markdown ───────────────────────────────── */

const week = '2026-03-09';

function rows() {
  const events = [
    { id: '1', taskId: 't1', title: 'Fix webhook retries', type: 'moved', from: 'Inbox', to: 'Done', at: 1, day: '2026-03-09' },
    { id: '2', taskId: 't2', title: 'Refactor auth', type: 'created', from: null, to: 'Inbox', at: 2, day: '2026-03-10' },
    { id: '3', taskId: 't2', title: 'Refactor auth', type: 'moved', from: 'Inbox', to: 'Doing', at: 3, day: '2026-03-10' },
    { id: '4', taskId: 't3', title: 'Buy domain', type: 'created', from: null, to: 'Done', at: 4, day: '2026-03-12' },
  ];
  const meta = { t1: ['Fix webhook retries', 'crm'], t2: ['Refactor auth', 'crm'], t3: ['Buy domain', null] };
  return C.aggregateWeek(events, week, id => (meta[id] ? { title: meta[id][0], project: meta[id][1] } : null), 'Done');
}

test('groupByProject keeps project order and puts unassigned last', () => {
  const groups = C.groupByProject(rows(), ['crm', 'webapp']);
  assert.deepEqual(groups.map(g => g.project), ['crm', 'No project']);
  assert.equal(groups[0].entries.length, 2);
});

test('toMarkdown lists exactly the entries it is handed, nothing else', () => {
  const md = C.toMarkdown(rows().filter(r => r.include), week, { projectOrder: ['crm'] });
  assert.equal(md, [
    '# Progress — 9–15 Mar 2026',
    '',
    '## Shipped',
    '- Fix webhook retries · crm',
    '',
  ].join('\n')); // no summary line, no route, and 'Buy domain' (no project) stays out
});

test('toMarkdown reports only the entries handed to it (partial export)', () => {
  const partial = rows().filter(r => r.taskId === 't1');
  const md = C.toMarkdown(partial, week, { projectOrder: ['crm'], doneStage: 'Done' });
  assert.ok(md.includes('- Fix webhook retries'));
  assert.ok(!md.includes('Refactor auth'));
});

test('finished-but-unassigned work is listed, unticked, and exports if you tick it', () => {
  const [buy] = rows().filter(r => r.taskId === 't3'); // Buy domain, Done, no project
  assert.equal(buy.include, false);                    // never in the default export
  const md = C.toMarkdown([buy], week, { projectOrder: [] });
  assert.ok(md.includes('## Shipped'), md);            // but the tick is the last word
  assert.ok(md.includes('- Buy domain'), md);
  assert.ok(!md.includes('Buy domain ·'), md);         // no project, so no suffix
});

test('unfinished work is listed, unticked, and exports if you tick it', () => {
  const [refactor] = rows().filter(r => r.taskId === 't2'); // Inbox → Doing, never Done
  assert.equal(refactor.include, false);
  const md = C.toMarkdown([refactor], week, { projectOrder: ['crm'] });
  assert.ok(md.includes('## In flight'), md);
  assert.ok(md.includes('- Refactor auth · crm'), md);
  assert.ok(!md.includes('## Shipped'), md);           // an empty section prints no heading
});

test('an empty week still produces a valid, honest file', () => {
  const md = C.toMarkdown([], week, { projectOrder: [] });
  assert.ok(md.startsWith('# Progress — 9–15 Mar 2026'));
  assert.ok(md.includes('No activity recorded'));
});

test('markdown escapes nothing it should not, and keeps titles verbatim', () => {
  const entries = [{ taskId: 'x', title: 'Fix *glob* handling in `src/**`', from: 'Inbox', to: 'Done', project: 'infra', created: false, netZero: false, include: true, day: week }];
  const md = C.toMarkdown(entries, week, { projectOrder: [], doneStage: 'Done' });
  assert.ok(md.includes('- Fix *glob* handling in `src/**`'));
});

test('a week of movement with nothing finished pre-ticks nothing at all', () => {
  // The defect: three cards moved Inbox → Doing, the footer read "3 / 3",
  // Copy was enabled, and the clipboard said "Nothing finished."
  const ev = (id, title, day) => ({ id: 'e' + id, taskId: id, title, project: 'crm', type: 'moved', from: 'Inbox', to: 'Doing', at: 1, day });
  const events = [ev('a', 'Rework onboarding', '2026-03-10'), ev('b', 'Migrate billing', '2026-03-11'), ev('c', 'Debug prod', '2026-03-12')];
  const listed = C.aggregateWeek(events, week, id => ({ title: id, project: 'crm' }), 'Done');
  assert.equal(listed.length, 3);                             // all three still listed
  assert.equal(listed.filter(r => r.include).length, 0);      // none announced by default
});

test('the count the modal shows is the count the export contains', () => {
  const ticked = rows().filter(r => r.include);
  const md = C.toMarkdown(ticked, week, { projectOrder: ['crm'] });
  assert.equal(md.split('\n').filter(l => l.startsWith('- ')).length, ticked.length);
});

test('both tenses get their own heading, Shipped always first', () => {
  const md = C.toMarkdown(rows(), week, { projectOrder: ['crm'] });
  assert.ok(md.indexOf('## Shipped') < md.indexOf('## In flight'), md);
  assert.ok(md.includes('- Fix webhook retries · crm'), md);   // ended in Done
  assert.ok(md.includes('- Refactor auth · crm'), md);         // ended in Doing
});

test('a card that reached done and was pulled back out is In flight', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', project: 'crm', type: 'moved', from: 'Doing', to: 'Done', at: 1, day: '2026-03-10' },
    { id: 'e2', taskId: 't1', title: 'A', project: 'crm', type: 'moved', from: 'Done', to: 'Doing', at: 2, day: '2026-03-12' },
  ];
  const [e] = C.aggregateWeek(events, week, () => ({ title: 'A', project: 'crm' }), 'Done');
  assert.equal(e.tense, 'inflight');   // it did not END the week done
  assert.equal(e.include, false);
});

test('a round trip takes its tense from where it ended, like everything else', () => {
  const back = [
    { id: 'e1', taskId: 't1', title: 'A', project: 'crm', type: 'moved', from: 'Doing', to: 'Done', at: 1, day: '2026-03-10' },
    { id: 'e2', taskId: 't1', title: 'A', project: 'crm', type: 'moved', from: 'Done', to: 'Doing', at: 2, day: '2026-03-11' },
    { id: 'e3', taskId: 't1', title: 'A', project: 'crm', type: 'moved', from: 'Doing', to: 'Done', at: 3, day: '2026-03-12' },
  ];
  const [e] = C.aggregateWeek(back, week, () => ({ title: 'A', project: 'crm' }), 'Done');
  assert.equal(e.netZero, false);      // Doing → … → Done is real movement
  assert.equal(e.tense, 'shipped');
});

test('project order drives the order inside a section', () => {
  const ev = (id, proj, day) => ({ id: 'e' + id, taskId: id, title: id, project: proj, type: 'moved', from: 'Doing', to: 'Done', at: 1, day });
  const events = [ev('a', 'zeta', '2026-03-10'), ev('b', 'alpha', '2026-03-11')];
  const meta = { a: 'zeta', b: 'alpha' };
  const list = C.aggregateWeek(events, week, id => ({ title: id, project: meta[id] }), 'Done');
  const md = C.toMarkdown(list, week, { projectOrder: ['zeta', 'alpha'] });
  assert.ok(md.indexOf('· zeta') < md.indexOf('· alpha'), md);  // user order, not alphabetical
});

test('the headings are localised, and avoid the Spanish stage names', () => {
  const md = C.toMarkdown(rows(), week, { projectOrder: ['crm'], locale: 'es' });
  assert.ok(md.includes('## Entregado'), md);
  assert.ok(md.includes('## En marcha'), md);
  assert.ok(!md.includes('En curso'), md);   // that is the Doing column's Spanish name
});

test('an entry with no tense gets no heading at all', () => {
  const md = C.toMarkdown([{ taskId: 'x', title: 'A', to: 'Done', project: 'crm', netZero: false, include: true, day: week }],
    week, { projectOrder: ['crm'] });
  assert.ok(!md.includes('##'), md);         // under-claim rather than mislabel
  assert.ok(md.includes('- A · crm'), md);
});

test('archiving annotates a row but never moves it between tenses', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', project: 'crm', type: 'moved', from: 'Inbox', to: 'Doing', at: 1, day: '2026-03-10' },
  ];
  const [e] = C.aggregateWeek(events, week, () => ({ title: 'A', project: 'crm', archived: true }), 'Done');
  assert.equal(e.archived, true);
  assert.equal(e.tense, 'inflight');   // classification still comes only from the log
});

test('work that was already done before the week is not shipped this week', () => {
  // Reopened on Tuesday, re-closed on Thursday. It ends the week in Done, but it
  // did not cross the done line this week — announcing it as Shipped would be a
  // false claim, and Select all is one click away from making it.
  const ev = (id, f, t, day) => ({ id: 'e' + id, taskId: 't1', title: 'Reopened bug', project: 'crm', type: 'moved', from: f, to: t, at: id, day });
  const [e] = C.aggregateWeek([ev(1, 'Done', 'Doing', '2026-03-10'), ev(2, 'Doing', 'Done', '2026-03-12')],
    week, () => ({ title: 'Reopened bug', project: 'crm' }), 'Done');
  assert.equal(e.netZero, true);
  assert.equal(e.tense, 'inflight');
  assert.equal(e.include, false);
  const md = C.toMarkdown([e], week, { projectOrder: ['crm'] });   // ticked anyway
  assert.ok(!md.includes('## Shipped'), md);
});

test('without a done stage no tense is claimed, so nothing is announced', () => {
  const events = [{ id: 'e1', taskId: 't1', title: 'A', project: 'crm', type: 'moved', from: 'Inbox', to: 'Doing', at: 1, day: '2026-03-10' }];
  const [e] = C.aggregateWeek(events, week, () => ({ title: 'A', project: 'crm' }));
  assert.equal(e.tense, null);       // the caller cannot say where the done line is
  assert.equal(e.include, false);
  const md = C.toMarkdown([e], week, { projectOrder: ['crm'] });
  assert.ok(!md.includes('##'), md); // under-claim, never guess "Shipped"
  assert.ok(md.includes('- A · crm'), md);
});

test('reportFilename is sortable and names the week it covers', () => {
  assert.equal(C.reportFilename(week), 'progress-2026-03-09.md');
});

/* ── event log helpers ─────────────────────────────────── */

test('makeEvent stamps the Chile day of the given clock', () => {
  const e = C.makeEvent({ taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing' },
    { now: Date.parse('2026-03-09T02:00:00Z') });
  assert.equal(e.day, '2026-03-08'); // Chile is still on Mar 8
  assert.equal(e.at, Date.parse('2026-03-09T02:00:00Z'));
});

test('makeEvent honours a date override without touching the real clock', () => {
  const now = Date.parse('2026-03-12T15:00:00Z');
  const e = C.makeEvent({ taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing' },
    { now, asOf: '2026-03-05' });
  assert.equal(e.day, '2026-03-05'); // backdated
  assert.equal(e.at, now);           // audit trail: when it was really recorded
  assert.equal(e.backdated, true);
});

test('moving a card to the stage it is already in records nothing', () => {
  assert.equal(C.shouldLogMove('a', 'a'), false);
  assert.equal(C.shouldLogMove('a', 'b'), true);
});

test('rewriting an entry’s day moves every event behind it', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 1, day: '2026-03-09' },
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Doing', to: 'Done', at: 2, day: '2026-03-10' },
    { id: 'e3', taskId: 't2', title: 'B', type: 'moved', from: 'Inbox', to: 'Doing', at: 3, day: '2026-03-10' },
  ];
  const entry = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A', t2: 'B' }))[0];
  C.rewriteDay(events, entry, '2026-03-04');
  assert.deepEqual(events.map(e => e.day), ['2026-03-04', '2026-03-04', '2026-03-10']);
});

test('a round trip is listed but never pre-ticked — it did no reportable work', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Doing', to: 'Waiting', at: 1, day: '2026-03-09' },
    { id: 'e2', taskId: 't1', title: 'A', type: 'moved', from: 'Waiting', to: 'Doing', at: 2, day: '2026-03-10' },
  ];
  const rows = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }), 'Done');
  assert.equal(rows[0].netZero, true);
  assert.equal(rows[0].include, false);
  const md = C.toMarkdown(rows.filter(r => r.include), '2026-03-09', { projectOrder: [] });
  assert.ok(!md.includes('- A'), md);
});

test('a deleted card keeps the project it was done under', () => {
  const events = [
    { id: 'e1', taskId: 'gone', title: 'Ship it', project: 'crm', type: 'moved', from: 'Doing', to: 'Done', at: 1, day: '2026-03-09' },
  ];
  const [e] = C.aggregateWeek(events, '2026-03-09', () => null);
  assert.equal(e.project, 'crm'); // not swept into "No project"
  const md = C.toMarkdown([e], '2026-03-09', { projectOrder: ['crm'] });
  assert.ok(md.includes('- Ship it · crm'), md);
});

test('makeEvent carries the project name for that reason', () => {
  const e = C.makeEvent({ taskId: 't1', title: 'A', project: 'crm', type: 'created', from: null, to: 'Inbox' },
    { now: Date.parse('2026-03-09T15:00:00Z') });
  assert.equal(e.project, 'crm');
});

/* ── re-dating guards ──────────────────────────────────── */

test('an unpadded or bogus date is refused rather than silently lost', () => {
  const events = [{ id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 1, day: '2026-03-09' }];
  const entry = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }))[0];
  assert.equal(C.rewriteConflict(events, entry, '2026-3-5'), 'invalid');
  assert.equal(C.rewriteDay(events, entry, '2026-3-5'), false);
  assert.equal(events[0].day, '2026-03-09'); // untouched
  assert.equal(C.isDay('2026-03-05'), true);
  assert.equal(C.isDay('2026-3-5'), false);
});

test('a row cannot be re-dated to before the card existed', () => {
  const events = [
    { id: 'e0', taskId: 't1', title: 'A', type: 'created', from: null, to: 'Inbox', at: 1, day: '2026-03-04' },
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 2, day: '2026-03-09' },
  ];
  const entry = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }))[0];
  assert.equal(C.rewriteConflict(events, entry, '2026-03-02'), 'before');
  assert.equal(C.rewriteDay(events, entry, '2026-03-02'), false);
  assert.equal(C.rewriteConflict(events, entry, '2026-03-05'), null); // after it existed: fine
  assert.equal(C.rewriteDay(events, entry, '2026-03-05'), true);
});

test('a whole row moving together may land anywhere, including before its own creation day', () => {
  // both events are in the row, so nothing is left behind to contradict
  const events = [
    { id: 'e0', taskId: 't1', title: 'A', type: 'created', from: null, to: 'Inbox', at: 1, day: '2026-03-09' },
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Doing', at: 2, day: '2026-03-11' },
  ];
  const entry = C.aggregateWeek(events, '2026-03-09', look({ t1: 'A' }))[0];
  assert.equal(C.rewriteDay(events, entry, '2026-03-02'), true);
  assert.deepEqual(events.map(e => e.day), ['2026-03-02', '2026-03-02']);
});

/* ── storage migration ─────────────────────────────────── */

test('a v1 board loads as v2 with an empty event log', () => {
  const v1 = { v: 1, columns: [{ id: 'c1', name: 'Inbox' }], tasks: [], projects: [] };
  const s = C.migrate(v1);
  assert.equal(s.v, 2);
  assert.deepEqual(s.events, []);
  assert.equal(s.asOf, null);
});

test('migrate backfills a created event for tasks that predate the log', () => {
  const v1 = {
    v: 1,
    columns: [{ id: 'c1', name: 'Inbox' }],
    tasks: [{ id: 't1', title: 'Old task', columnId: 'c1', order: 0, createdAt: Date.parse('2026-03-10T15:00:00Z') }],
    projects: [],
  };
  const s = C.migrate(v1);
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].type, 'created');
  assert.equal(s.events[0].to, 'Inbox');
  assert.equal(s.events[0].day, '2026-03-10');
});

test('migrate is idempotent', () => {
  const once = C.migrate({ v: 1, columns: [{ id: 'c1', name: 'Inbox' }], tasks: [], projects: [] });
  const twice = C.migrate(once);
  assert.deepEqual(twice, once);
});

test('a corrupt board falls back to a usable empty board', () => {
  assert.equal(C.migrate(null).columns.length > 0, true);
  assert.equal(C.migrate({ columns: 'nope' }).columns.length > 0, true);
});

test('a damaged board keeps its event log — history is the one thing with no second copy', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'A', type: 'moved', from: 'Inbox', to: 'Shipped', at: 1, day: '2026-03-09' },
  ];
  const s = C.migrate({ v: 2, columns: [], tasks: 'corrupt', events });
  assert.equal(s.events.length, 1);
  assert.deepEqual(s.columns.map(c => c.name), ['Shipped']); // stages recovered from the log
  assert.deepEqual(s.tasks, []);
});

test('a board that already has a log is never regenerated from createdAt', () => {
  const events = [
    { id: 'e1', taskId: 't1', title: 'real history', type: 'moved', from: 'Inbox', to: 'Done', at: 1, day: '2026-03-09' },
  ];
  const s = C.migrate({
    v: 1, // an older shape that nonetheless carries a log
    columns: [{ id: 'c1', name: 'Inbox' }],
    tasks: [{ id: 't1', title: 'A', columnId: 'c1', order: 0, createdAt: Date.parse('2026-03-10T15:00:00Z') }],
    events,
  });
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].title, 'real history');
});

test('flags ride through migration, and the flag filter defaults to off', () => {
  const s = C.migrate({
    v: 2,
    columns: [{ id: 'c1', name: 'Inbox' }],
    tasks: [{ id: 't1', title: 'A', columnId: 'c1', order: 0, flag: true }],
    events: [],
    flagFilter: true,
  });
  assert.equal(s.tasks[0].flag, true);
  assert.equal(s.flagFilter, true);
  assert.equal(C.defaultBoard().flagFilter, false);
  assert.equal(C.migrate({ v: 2, columns: [{ id: 'c1', name: 'Inbox' }], tasks: [], events: [] }).flagFilter, false);
});

test('density rides through migration and defaults to comfortable', () => {
  assert.equal(C.defaultBoard().density, 'comfortable');
  const cols = [{ id: 'c1', name: 'Inbox' }];
  assert.equal(C.migrate({ v: 2, columns: cols, tasks: [], events: [], density: 'compact' }).density, 'compact');
  assert.equal(C.migrate({ v: 2, columns: cols, tasks: [], events: [] }).density, 'comfortable');
  assert.equal(C.migrate({ v: 2, columns: cols, tasks: [], events: [], density: 'huge' }).density, 'comfortable');
});

test('tasks pointing at a stage that no longer exists are rehomed, not lost', () => {
  const s = C.migrate({
    v: 2,
    columns: [{ id: 'c1', name: 'Inbox' }],
    tasks: [{ id: 't1', title: 'orphan', columnId: 'deleted-stage', order: 0 }],
    events: [],
  });
  assert.equal(s.tasks[0].columnId, 'c1');
});

/* ── board mechanics that are easy to get wrong ────────── */

test('reindex renumbers a column from 0 with no gaps or ties', () => {
  const tasks = [
    { id: 'a', columnId: 'c1', order: 5 },
    { id: 'b', columnId: 'c1', order: 5 },
    { id: 'c', columnId: 'c2', order: 0 },
  ];
  C.reindex(tasks, 'c1');
  const c1 = tasks.filter(t => t.columnId === 'c1').map(t => t.order).sort();
  assert.deepEqual(c1, [0, 1]);
  assert.equal(tasks.find(t => t.id === 'c').order, 0); // other columns untouched
});

test('applyOrder places visible cards in DOM order and parks hidden ones after them', () => {
  // Simulates dropping while a filter hides one card in the target column.
  const tasks = [
    { id: 'visible1', columnId: 'c1', order: 0 },
    { id: 'hidden', columnId: 'c1', order: 1 },
    { id: 'visible2', columnId: 'c1', order: 2 },
  ];
  C.applyOrder(tasks, 'c1', ['visible2', 'visible1']); // dropped visible2 above visible1
  assert.equal(tasks.find(t => t.id === 'visible2').order, 0);
  assert.equal(tasks.find(t => t.id === 'visible1').order, 1);
  assert.equal(tasks.find(t => t.id === 'hidden').order, 2); // kept, not lost
});

test('sortByProject groups each column into project order, stably, unassigned last', () => {
  const tasks = [
    { id: 'a', columnId: 'c1', projectId: 'p2', order: 0 },
    { id: 'b', columnId: 'c1', projectId: null, order: 1 },
    { id: 'c', columnId: 'c1', projectId: 'p1', order: 2 },
    { id: 'd', columnId: 'c1', projectId: 'p2', order: 3 },
    { id: 'e', columnId: 'c2', projectId: null, order: 0 },
    { id: 'f', columnId: 'c2', projectId: 'p1', order: 1 },
  ];
  C.sortByProject(tasks, ['p1', 'p2']);
  const seq = col => tasks.filter(t => t.columnId === col)
    .sort((x, y) => x.order - y.order).map(t => t.id).join('');
  assert.equal(seq('c1'), 'cadb'); // p1 first, then p2 keeping a before d, unassigned last
  assert.equal(seq('c2'), 'fe');   // every column gets the treatment
});
