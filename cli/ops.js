'use strict';
/* The mutations. Each mirrors a function in app.js; where they disagree, app.js
   is right. Every one of these builds ONCE: it generates its ids, applies its
   change and hands back a probe that recognises that exact change in a head
   fetched later. Nothing here winds a clock — stampChanges does that, in one
   place, and these functions must never set mt/pmt/existMt/fieldMt themselves. */

const C = require('../core.js');

const clone = x => JSON.parse(JSON.stringify(x));
const live = st => (st.tasks || []).filter(t => !t.archivedAt);
const doneStage = st => st.columns[st.columns.length - 1];

class OpError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/* ── resolution ─────────────────────────────────────────
   Duplicate stage and project names are legal, so every resolver refuses an
   ambiguous match rather than picking one. */

function resolveOne(items, needle, what) {
  const hits = items.filter(x => x.name && x.name.toLowerCase() === needle.toLowerCase());
  if (hits.length === 1) return hits[0];
  if (!hits.length) {
    const names = items.map(x => x.name).join(', ') || '(none)';
    throw new OpError('not-found', `no ${what} named "${needle}". Available: ${names}`);
  }
  throw new OpError('usage',
    `"${needle}" matches ${hits.length} ${what}s: ${hits.map(x => `${x.name} [${x.id}]`).join(', ')}. Use --${what}-id.`);
}

const resolveStage = (st, name) => resolveOne(st.columns, name, 'stage');
const resolveProject = (st, name) => resolveOne(st.projects || [], name, 'project');

function byId(items, id, what) {
  const hit = (items || []).find(x => x.id === id);
  if (!hit) throw new OpError('not-found', `no ${what} with id ${id}`);
  return hit;
}

/** Card ids are 15 chars; an unambiguous prefix of 4+ is enough. */
function resolveTask(st, prefix, { archived = false } = {}) {
  if (!prefix || prefix.length < 4) throw new OpError('usage', 'give at least 4 characters of a card id');
  const pool = archived ? (st.tasks || []) : live(st);
  const hits = pool.filter(t => t.id.startsWith(prefix));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new OpError('not-found', `no card starting with ${prefix}`);
  throw new OpError('usage',
    `${prefix} matches ${hits.length} cards:\n` + hits.map(t => `  ${t.id}  ${t.title}`).join('\n'));
}

function projectName(st, t) {
  const p = (st.projects || []).find(x => x.id === t.projectId);
  return p ? p.name : null;
}

const colName = (st, id) => {
  const c = (st.columns || []).find(x => x.id === id);
  return c ? c.name : '';
};

/** Mirrors app.js logEvent: names are snapshotted as strings, never
    referenced; column ids beside them; `me` (a roster member) only when this
    CLI has an identity on a team board — otherwise the move is unattributed,
    never guessed. */
function pushEvent(st, task, type, fromColId, toColId, me = null) {
  const e = C.makeEvent({
    taskId: task.id,
    title: task.title,
    project: projectName(st, task),
    type,
    from: fromColId ? colName(st, fromColId) : null,
    to: colName(st, toColId),
    fromColumnId: fromColId || null,
    toColumnId: toColId,
    by: me ? me.id : null,
    byName: me ? me.name : null,
  });
  st.events.push(e);
  return e;
}

const isTeam = st => (st.members || []).length > 0;

/** Case-insensitive, ambiguity refused — like stages and projects. */
function resolveMember(st, needle, memberId) {
  if (memberId) return byId(st.members || [], memberId, 'member');
  return resolveOne(st.members || [], needle, 'member');
}

/** A resume command is private and belongs to one computer; a team board
    never carries one (docs/computers.md, the session firewall). */
function refuseTeamSession(st, session) {
  if (session && isTeam(st)) {
    throw new OpError('usage',
      'sessions on team cards are private and never go on the team board. Run `kanban session <card> "<cmd>"` to keep it on your personal board.');
  }
}

/* ── mutations ───────────────────────────────────────────
   Each returns { state, probe, summary } or { noop, summary }. */

/** Mirrors addTask (app.js:1408). */
function add(remote, opts) {
  const title = (opts.title || '').trim();
  if (!title) throw new OpError('usage', 'a card needs a title');

  const st = clone(remote);
  const col = opts.stageId ? byId(st.columns, opts.stageId, 'stage')
    : opts.stage ? resolveStage(st, opts.stage)
      : st.columns[0];
  const project = opts.projectId ? byId(st.projects || [], opts.projectId, 'project')
    : opts.project ? resolveProject(st, opts.project)
      : null;

  refuseTeamSession(st, opts.session);
  const now = Date.now();
  const t = {
    id: C.uid(), title, notes: opts.notes || '', projectId: project ? project.id : null,
    // a team card has no session slot at all (the firewall checks presence)
    ...(isTeam(st) ? {} : { session: opts.session || '' }), flag: !!opts.flag, columnId: col.id,
    order: 0, createdAt: now, updatedAt: now,
    ...(opts.session && opts.sessionMachine ? { sessionMachine: opts.sessionMachine } : {}),
    ...(opts.session && opts.sessionCwd ? { sessionCwd: opts.sessionCwd } : {}),
  };
  st.tasks.filter(x => x.columnId === t.columnId).forEach(x => { x.order += 1; });
  st.tasks.push(t);
  const e = pushEvent(st, t, 'created', null, t.columnId, opts.me);

  return {
    state: st,
    probe: p => (p.events || []).some(x => x.id === e.id),
    summary: { verb: '+', stage: col.name, title, project: project ? project.name : null },
  };
}

/** Mirrors the keyboard move (app.js:1449). A self-move is a no-op, never an event. */
function move(remote, opts) {
  const st = clone(remote);
  const t = resolveTask(st, opts.id);
  if (t.archivedAt) throw new OpError('usage', 'that card is archived; restore it first');

  const dest = opts.stageId ? byId(st.columns, opts.stageId, 'stage')
    : opts.done ? doneStage(st)
      : resolveStage(st, opts.stage);

  const from = t.columnId;
  if (!C.shouldLogMove(from, dest.id)) {
    return { noop: true, summary: { verb: '=', stage: dest.name, title: t.title, project: projectName(st, t) } };
  }

  t.columnId = dest.id;
  t.order = -1;
  C.reindex(st.tasks, dest.id);
  t.updatedAt = Date.now();
  const e = pushEvent(st, t, 'moved', from, dest.id, opts.me);

  return {
    state: st,
    probe: p => (p.events || []).some(x => x.id === e.id),
    summary: { verb: '→', stage: dest.name, from: colName(st, from), title: t.title, project: projectName(st, t) },
  };
}

/** Field writes only; the log records moves and creations, not edits. */
function edit(remote, opts) {
  const st = clone(remote);
  const t = resolveTask(st, opts.id, { archived: true });

  let touched = false;
  const set = (k, v) => { if (t[k] !== v) { t[k] = v; touched = true; } };
  if (opts.title !== undefined) {
    const title = String(opts.title).trim();
    if (!title) throw new OpError('usage', 'a card needs a title');
    set('title', title);
  }
  if (opts.notes !== undefined) set('notes', opts.notes);
  if (opts.session !== undefined) {
    refuseTeamSession(st, opts.session);
    set('session', opts.session);
    // the session group is atomic: a new command gets this computer and folder
    if (opts.session) {
      if (opts.sessionMachine) set('sessionMachine', opts.sessionMachine); else if (t.sessionMachine) { delete t.sessionMachine; touched = true; }
      if (opts.sessionCwd) set('sessionCwd', opts.sessionCwd);
    } else {
      if (t.sessionMachine) { delete t.sessionMachine; touched = true; }
      if (t.sessionCwd) { delete t.sessionCwd; touched = true; }
    }
  }
  if (opts.flag !== undefined) set('flag', !!opts.flag);
  if (opts.noProject) set('projectId', null);
  else if (opts.projectId) set('projectId', byId(st.projects || [], opts.projectId, 'project').id);
  else if (opts.project) set('projectId', resolveProject(st, opts.project).id);

  if (!touched) return { noop: true, summary: { verb: '=', title: t.title, stage: colName(st, t.columnId) } };
  t.updatedAt = Date.now();

  // No event to key on, so the probe is the clock stampChanges will assign.
  return {
    state: st,
    probeFromStamped: stamped => {
      const me = stamped.tasks.find(x => x.id === t.id);
      const clock = C.mtOf(me);
      return p => {
        const there = (p.tasks || []).find(x => x.id === t.id);
        return !!there && C.mtOf(there) >= clock;
      };
    },
    summary: { verb: '~', title: t.title, stage: colName(st, t.columnId), project: projectName(st, t) },
  };
}

function archive(remote, opts) {
  const st = clone(remote);
  const t = resolveTask(st, opts.id);
  if (t.archivedAt) return { noop: true, summary: { verb: '=', title: t.title, stage: 'archive' } };
  t.archivedAt = Date.now();
  t.archivedFrom = t.columnId;
  t.updatedAt = Date.now();
  return {
    state: st,
    probeFromStamped: stamped => {
      const me = stamped.tasks.find(x => x.id === t.id);
      const clock = C.mtOf(me);
      return p => {
        const there = (p.tasks || []).find(x => x.id === t.id);
        return !!there && !!there.archivedAt && C.mtOf(there) >= clock;
      };
    },
    summary: { verb: '⊘', title: t.title, stage: colName(st, t.archivedFrom) },
  };
}

function restore(remote, opts) {
  const st = clone(remote);
  const t = resolveTask(st, opts.id, { archived: true });
  if (!t.archivedAt) return { noop: true, summary: { verb: '=', title: t.title, stage: colName(st, t.columnId) } };
  const back = (st.columns.find(c => c.id === t.archivedFrom) || st.columns[0]).id;
  t.columnId = back;
  delete t.archivedAt;
  delete t.archivedFrom;
  t.order = -1;
  C.reindex(st.tasks, back);
  t.updatedAt = Date.now();
  return {
    state: st,
    probeFromStamped: stamped => {
      const me = stamped.tasks.find(x => x.id === t.id);
      const clock = C.mtOf(me);
      return p => {
        const there = (p.tasks || []).find(x => x.id === t.id);
        return !!there && !there.archivedAt && C.mtOf(there) >= clock;
      };
    },
    summary: { verb: '↑', title: t.title, stage: colName(st, back) },
  };
}

/** Hand a card to someone (or to nobody). Needs an identity: the field
    group records who assigned it. */
function assign(remote, opts) {
  const st = clone(remote);
  if (!isTeam(st)) throw new OpError('usage', 'assigning needs a team board (one with a roster)');
  if (!opts.me) throw new OpError('usage', 'assigning needs to know who you are: run `kanban whoami <your name>` on this board first');
  const t = resolveTask(st, opts.id);
  const to = /^(nobody|none|-)$/i.test(opts.to || '') ? null : resolveMember(st, opts.to, opts.memberId);
  if ((t.assigneeId || null) === (to ? to.id : null)) {
    return { noop: true, summary: { verb: '=', title: t.title, stage: colName(st, t.columnId) } };
  }
  t.assigneeId = to ? to.id : null;
  t.assignedBy = opts.me.id;
  t.assignedAt = Date.now();
  return {
    state: st,
    probeFromStamped: stamped => {
      const me = stamped.tasks.find(x => x.id === t.id);
      const clock = C.mtOf(me);
      return p => {
        const there = (p.tasks || []).find(x => x.id === t.id);
        return !!there && (there.assigneeId || null) === t.assigneeId && C.mtOf(there) >= clock;
      };
    },
    summary: { verb: '@', title: t.title, stage: colName(st, t.columnId), project: to ? to.name : 'nobody' },
  };
}

/** Match or create a computer on the personal board (docs/computers.md). */
function here(remote, opts) {
  const st = clone(remote);
  if (isTeam(st)) throw new OpError('usage', 'computers live on your personal board, not on a team board. Pass --board <personal>.');
  const name = (opts.name || '').trim();
  if (!name) throw new OpError('usage', 'kanban here "<computer name>"');
  st.machines = st.machines || [];
  const hits = st.machines.filter(m => m.name.toLowerCase() === name.toLowerCase());
  if (hits.length > 1 && !opts.machineId) {
    throw new OpError('usage', `"${name}" matches ${hits.length} computers: ${hits.map(m => `${m.name} [${m.id}]`).join(', ')}. Use --machine-id.`);
  }
  const found = opts.machineId ? byId(st.machines, opts.machineId, 'computer') : hits[0];
  if (found) return { noop: true, machine: found, summary: { verb: '=', title: found.name, stage: 'computers' } };
  const icon = C.ICONS.includes(opts.icon) ? opts.icon : 'laptop';
  const m = { id: C.uid(), name, icon };
  st.machines.push(m);
  return {
    state: st,
    machine: m,
    probe: p => (p.machines || []).some(x => x.id === m.id),
    summary: { verb: '+', title: name, stage: 'computers' },
  };
}

/** A private session for a team card, on the personal board — the one
    board this command writes. */
function privateSession(remote, opts) {
  const st = clone(remote);
  if (isTeam(st)) throw new OpError('usage', 'private sessions live on your personal board');
  st.privateSessions = st.privateSessions || {};
  const key = JSON.stringify([opts.teamId, opts.taskId]);
  const next = opts.session
    ? { session: opts.session, ...(opts.sessionMachine ? { sessionMachine: opts.sessionMachine } : {}), ...(opts.sessionCwd ? { sessionCwd: opts.sessionCwd } : {}) }
    : { session: '' };
  const held = st.privateSessions[key];
  const same = held && held.session === next.session && (held.sessionMachine || null) === (next.sessionMachine || null)
    && (held.sessionCwd || null) === (next.sessionCwd || null);
  if (same) return { noop: true, summary: { verb: '=', title: opts.title, stage: 'session' } };
  st.privateSessions[key] = next;
  return {
    state: st,
    probeFromStamped: stamped => {
      const clock = stamped.privateSessions[key].mt;
      return p => !!(p.privateSessions && p.privateSessions[key] && (p.privateSessions[key].mt || 0) >= clock);
    },
    summary: { verb: '▸', title: opts.title, stage: 'session' },
  };
}

module.exports = {
  OpError, add, move, edit, archive, restore, assign, here, privateSession,
  resolveTask, resolveStage, resolveProject, resolveMember, projectName, colName, doneStage, live, clone, isTeam,
};
