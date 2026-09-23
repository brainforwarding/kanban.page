/* board/core.js — pure logic, no DOM.
   Loaded by index.html as a plain script (global `BoardCore`)
   and by tests/core.test.js through require(). No dependencies. */

const BoardCore = (() => {
  const TZ = 'America/Santiago';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Crypto-strength when available: with sync, ids are minted on independent
  // devices, and a collision would silently fold two cards into one.
  const uid = () => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const b = crypto.getRandomValues(new Uint8Array(6));
      return Array.from(b, x => x.toString(16).padStart(2, '0')).join('') + Date.now().toString(36).slice(-3);
    }
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  };

  /* ── calendar dates ──────────────────────────────────── */

  // en-CA formats as YYYY-MM-DD, which is also the sort order we rely on.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  });

  /** Calendar date in Chile for an epoch timestamp. */
  const ymd = (ts = Date.now()) => fmt.format(new Date(ts));

  /** Calendar arithmetic done in UTC so DST can never add or drop a day. */
  function addDays(day, n) {
    const [y, m, d] = day.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  /** 0 = Monday … 6 = Sunday. */
  function weekdayIndex(day) {
    const [y, m, d] = day.split('-').map(Number);
    return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  }

  const weekdayName = (day, locale = 'en') => locale === 'es'
    ? ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'][weekdayIndex(day)]
    : DAYS[weekdayIndex(day)];
  const mondayOf = day => addDays(day, -weekdayIndex(day));

  function weekRange(monday) {
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(monday, i));
    return { monday, sunday: days[6], days };
  }

  /** "9–15 Mar 2026" · "30 Mar – 5 Apr 2026" · "29 Dec 2025 – 4 Jan 2026" */
  function weekLabel(monday, locale = 'en') {
    const a = monday.split('-').map(Number);
    const b = addDays(monday, 6).split('-').map(Number);
    const [ay, am, ad] = a, [by, bm, bd] = b;
    const months = locale === 'es' ? ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'] : MONTHS;
    if (ay !== by) return `${ad} ${months[am - 1]} ${ay} – ${bd} ${months[bm - 1]} ${by}`;
    if (am !== bm) return `${ad} ${months[am - 1]} – ${bd} ${months[bm - 1]} ${by}`;
    return `${ad}–${bd} ${months[am - 1]} ${ay}`;
  }

  /** "MON 9" — the stamp on a report row. The week label carries the month. */
  const dayLabel = (day, locale = 'en') => `${weekdayName(day, locale)} ${Number(day.split('-')[2])}`;

  const contains = (monday, day) => day >= monday && day <= addDays(monday, 6);

  /* ── weeks with activity ─────────────────────────────── */

  /**
   * Every week from the first one with activity through today — quiet weeks
   * included, so "any week" really is selectable and a gap looks like a gap.
   */
  function weeksWithActivity(events, todayYmd, locale = 'en') {
    const counts = new Map();
    for (const e of events || []) {
      const m = mondayOf(e.day);
      counts.set(m, (counts.get(m) || 0) + 1);
    }
    if (todayYmd) {
      const m = mondayOf(todayYmd);
      counts.set(m, counts.get(m) || 0);
    }
    if (!counts.size) return [];

    const keys = [...counts.keys()].sort();
    const last = keys[keys.length - 1];
    const out = [];
    for (let m = keys[0]; m <= last; m = addDays(m, 7)) {
      out.push({ monday: m, count: counts.get(m) || 0, label: weekLabel(m, locale) });
    }
    return out.reverse();
  }

  /* ── report aggregation ──────────────────────────────── */

  const byDayThenAt = (a, b) =>
    a.day < b.day ? -1 : a.day > b.day ? 1 : (a.at || 0) - (b.at || 0);

  /**
   * Fold a week's events into one row per card: where it started the week,
   * where it ended it. `lookup(taskId)` returns { title, project, archived }
   * for a card that still exists, or null for one that was deleted.
   *
   * `doneStage` is the last column's name. It decides each row's tense and,
   * through it, which rows arrive pre-ticked. Omit it and no row gets a tense,
   * so nothing is pre-ticked and nothing is announced under a heading.
   */
  function aggregateWeek(events, monday, lookup, done) {
    // `done` is the done column as { id, name } — or, for older callers, its
    // name alone. Rows whose events carry stage ids are classified by id;
    // legacy rows fall back to the name, and never produce a doneBy.
    const doneStage = done && typeof done === 'object' ? done.name : done;
    const doneId = done && typeof done === 'object' ? done.id : null;
    const week = (events || []).filter(e => contains(monday, e.day)).sort(byDayThenAt);
    const rows = new Map();

    for (const e of week) {
      let r = rows.get(e.taskId);
      if (!r) {
        r = {
          taskId: e.taskId,
          title: e.title,
          from: e.type === 'created' ? 'New' : e.from,
          to: e.to,
          created: e.type === 'created',
          day: e.day,
          firstDay: e.day,
          at: e.at,
          eventIds: [],
          moves: 0,
          path: [e.type === 'created' ? 'New' : e.from],
          project: null,
          deleted: false,
          // endpoint ids: 'new' stands for a card created this week
          fromId: e.type === 'created' ? 'new' : (e.fromColumnId || null),
          toId: null,
          byIds: [],
          doneBy: null,
        };
        rows.set(e.taskId, r);
      }
      if (e.type === 'created') { r.created = true; r.from = 'New'; r.fromId = 'new'; }
      else r.moves++;
      r.to = e.to;
      r.toId = e.toColumnId || null;
      if (e.by && !r.byIds.includes(e.by)) r.byIds.push(e.by);
      if (doneId && e.by && e.toColumnId === doneId && e.fromColumnId !== doneId) r.doneBy = e.by;
      r.day = e.day;
      r.at = e.at;
      r.eventIds.push(e.id);
      r.snapshotTitle = e.title;
      if (e.project !== undefined && e.project !== null) r.snapshotProject = e.project;
      if (r.path[r.path.length - 1] !== e.to) r.path.push(e.to);
    }

    const out = [...rows.values()].map(r => {
      const meta = lookup ? lookup(r.taskId) : null;
      if (meta) {
        r.title = meta.title || r.snapshotTitle;
        r.project = meta.project || null;
        // Archiving logs no event, so it can never move a card between tenses —
        // it only annotates the row. Live state annotates; the log classifies.
        r.archived = !!meta.archived;
      } else {
        // deleted: fall back to what the event remembers, so cleared work does
        // not silently migrate into "No project"
        r.title = r.snapshotTitle;
        r.project = r.snapshotProject || null;
        r.deleted = true;
      }
      // A card that left a stage and came back did no reportable work.
      r.netZero = !r.created && r.from === r.to;
      // Shipped means the card CROSSED the done line this week: it ended in the
      // last column and did not start the week already there. Without the second
      // clause, a card that was already done, got reopened and re-closed reads as
      // shipped-this-week, which is a false claim in someone else's inbox.
      // Positional either way — the caller passes the last column's name, and no
      // middle stage means anything, so renaming or reordering cannot change how
      // a week reads.
      //
      // No doneStage means the caller cannot say where the done line is, so no
      // tense is claimed at all. Never guess "shipped" — toMarkdown renders an
      // untensed row under no heading, which under-claims instead of lying.
      const byId = doneId && r.toId && r.fromId;
      r.tense = !doneStage ? null
        : byId ? ((r.toId === doneId && r.fromId !== doneId) ? 'shipped' : 'inflight')
        : (r.to === doneStage && r.from !== doneStage) ? 'shipped'
        : 'inflight';
      if (!byId) r.doneBy = null;
      // The export's opinion, made visible. This is the only place that decides
      // what a report announces by default — toMarkdown has no second opinion.
      // Everything else is still listed, unticked, one click from being
      // included anyway: the tick is the user's, not ours.
      r.include = !r.netZero && r.tense === 'shipped' && !!r.project;
      return r;
    });

    // Grouped by project (unassigned last), then chronological within a group.
    return out.sort((a, b) => {
      const pa = a.project || '￿', pb = b.project || '￿';
      if (pa !== pb) return pa < pb ? -1 : 1;
      return byDayThenAt(a, b);
    });
  }

  const NO_PROJECT = 'No project';

  function groupByProject(entries, projectOrder = []) {
    const groups = new Map();
    for (const e of entries) {
      const key = e.project || NO_PROJECT;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    const rank = name => {
      if (name === NO_PROJECT) return [2, ''];
      const i = projectOrder.indexOf(name);
      return i === -1 ? [1, name] : [0, String(i).padStart(4, '0')];
    };
    return [...groups.entries()]
      .map(([project, list]) => ({ project, entries: list }))
      .sort((a, b) => {
        const [ra, sa] = rank(a.project), [rb, sb] = rank(b.project);
        return ra !== rb ? ra - rb : sa < sb ? -1 : sa > sb ? 1 : 0;
      });
  }

  /* ── markdown ────────────────────────────────────────── */

  function summaryLine(entries, doneStage, locale = 'en') {
    const n = entries.length;
    const es = locale === 'es';
    const parts = [es ? `${n} ${n === 1 ? 'tarjeta' : 'tarjetas'}` : `${n} card${n === 1 ? '' : 's'}`];
    const created = entries.filter(e => e.created).length;
    if (created) parts.push(es ? `${created} cread${created === 1 ? 'a' : 'as'}` : `${created} created`);
    if (doneStage) {
      const finished = entries.filter(e => e.to === doneStage).length;
      if (finished) parts.push(es ? `${finished} finalizada${finished === 1 ? '' : 's'}` : `${finished} finished`);
    }
    return parts.join(' · ');
  }

  function toMarkdown(entries, monday, opts = {}) {
    const es = opts.locale === 'es';
    const lines = [`# ${es ? 'Progreso' : 'Progress'} — ${weekLabel(monday, opts.locale)}`, ''];

    if (!entries.length) {
      lines.push(es ? 'No hay actividad registrada.' : 'No activity recorded.', '');
      return lines.join('\n');
    }

    // The export is the outward-facing report: title only — the route a card
    // took is board detail. What it announces is exactly what was ticked; the
    // default tick lives in aggregateWeek, where the user can see and overrule
    // it. Nothing is filtered out here, so the count the modal shows is always
    // the count this file contains.
    //
    // Grouped by tense, because that is what a reader scans by; the project
    // is a suffix. An entry with no tense gets no heading at all — a caller
    // that forgot `doneStage` should under-claim, never file unfinished work
    // under "Shipped" in a document that goes to someone else.
    const HEADS = { shipped: es ? 'Entregado' : 'Shipped', inflight: es ? 'En marcha' : 'In flight' };
    for (const tense of [null, 'shipped', 'inflight']) {
      const section = entries.filter(e => (e.tense || null) === tense);
      if (!section.length) continue;                       // no empty headings
      if (tense) lines.push(`## ${HEADS[tense]}`);
      // Project order still drives the export, now within a section.
      for (const g of groupByProject(section, opts.projectOrder)) {
        const suffix = g.project === NO_PROJECT ? '' : ` · ${g.project}`;
        for (const e of g.entries) lines.push(`- ${e.title}${suffix}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  const reportFilename = (monday, locale = 'en') => `${locale === 'es' ? 'progreso' : 'progress'}-${monday}.md`;

  /* ── event log ───────────────────────────────────────── */

  const shouldLogMove = (fromColId, toColId) => fromColId !== toColId;

  // `contains` compares day strings, so an unpadded date would sort out of every
  // week and become invisible while still sitting in the log.
  const isDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  /** asOf backdates the reported day but never rewrites `at`, the real clock. */
  function makeEvent(fields, { now = Date.now(), asOf = null } = {}) {
    const backdated = isDay(asOf);
    return {
      id: uid(),
      taskId: fields.taskId,
      title: fields.title,
      project: fields.project ?? null, // so deleted cards keep their grouping
      type: fields.type,
      from: fields.from ?? null,
      to: fields.to,
      at: now,
      day: backdated ? asOf : ymd(now),
      backdated,
      // Stage ids beside the names: names can repeat and rename, so "moved
      // into the done column" is only decidable by id. Attribution only when
      // the caller knows who it is — missing means unknown, never guessed.
      // All four are immutable; rewriteDay touches `day` alone.
      ...(fields.fromColumnId ? { fromColumnId: fields.fromColumnId } : {}),
      ...(fields.toColumnId ? { toColumnId: fields.toColumnId } : {}),
      ...(fields.by ? { by: fields.by, byName: fields.byName || null } : {}),
    };
  }

  /** Why a row cannot take this day, or null when it can. */
  function rewriteConflict(events, entry, day) {
    if (!isDay(day)) return 'invalid';
    const ids = new Set(entry.eventIds);
    const earlier = (events || [])
      .filter(e => e.taskId === entry.taskId && !ids.has(e.id) && e.day < entry.firstDay)
      .map(e => e.day)
      .sort();
    const floor = earlier[earlier.length - 1];
    if (floor && day < floor) return 'before';
    return null;
  }

  /** Re-date every event behind one report row (they move as a unit). */
  function rewriteDay(events, entry, day) {
    if (rewriteConflict(events, entry, day)) return false;
    const ids = new Set(entry.eventIds);
    for (const e of events) if (ids.has(e.id)) e.day = day;
    return true;
  }

  /* ── board mechanics ─────────────────────────────────── */

  function reindex(tasks, columnId) {
    tasks.filter(t => t.columnId === columnId)
      .sort((a, b) => a.order - b.order)
      .forEach((t, i) => { t.order = i; });
    return tasks;
  }

  /** Visible cards take DOM order; cards hidden by a filter keep theirs, after. */
  function applyOrder(tasks, columnId, visibleIds) {
    const seen = new Set(visibleIds);
    let i = 0;
    for (const id of visibleIds) {
      const t = tasks.find(x => x.id === id);
      if (t) { t.columnId = columnId; t.order = i++; }
    }
    tasks.filter(t => t.columnId === columnId && !seen.has(t.id))
      .sort((a, b) => a.order - b.order)
      .forEach(t => { t.order = i++; });
    return tasks;
  }

  /** One-shot tidy: stable-sort every column into project order — groups in
      the order given, unassigned cards last (the report's rule) — keeping the
      hand-made order within each group. Touches only `order`, never the log. */
  function sortByProject(tasks, projectIds) {
    const rank = t => {
      const i = t.projectId ? projectIds.indexOf(t.projectId) : -1;
      return i === -1 ? projectIds.length : i;
    };
    new Set(tasks.map(t => t.columnId)).forEach(colId => {
      tasks.filter(t => t.columnId === colId)
        .sort((a, b) => a.order - b.order)  // current hand order first,
        .sort((a, b) => rank(a) - rank(b))  // then grouped — stably — by project
        .forEach((t, i) => { t.order = i; });
    });
    return tasks;
  }

  /* ── sync: clocks, merge, sealed envelopes ───────────────
     Two boards that have drifted apart meet in merge(). Everything here is
     pure and deterministic over the synced subset: both devices, fed the
     same pair of boards in either order, converge on the same result. The
     clocks are maintained in ONE place — stampChanges, called by app.js
     before every save — never by scattered touch() calls, so no future
     feature can forget to wind them.

     The clock is a hybrid logical clock folded into one number: every stamp
     is max(wall clock, everything already observed + 1). A device with a
     fast clock cannot make its old edits win forever — the other side's
     next stamp jumps past it, so causally later edits always dominate.

     Tasks carry per-field content clocks (`fieldMt`), an aggregate content
     clock (`mt`) for compatibility, a placement clock (`pmt`), and an
     existence generation (`existMt`) for delete/restore decisions.
     Without the split, addTask bumping every sibling's order — or one "Sort
     by project" — would let a stale device's copy beat a real content edit
     made elsewhere. Placement never fights content, and placement never
     resurrects a deleted card. */

  /** Canonical serialization: object keys sorted, so two structurally equal
      values compare equal regardless of construction history. All tie-breaks
      go through this — an arbitrary winner, but the same arbitrary winner on
      both devices. */
  function canonValue(x) {
    if (Array.isArray(x)) return x.map(canonValue);
    if (x && typeof x === 'object') {
      const out = {};
      for (const k of Object.keys(x).sort()) out[k] = canonValue(x[k]);
      return out;
    }
    return x;
  }
  const canon = x => JSON.stringify(canonValue(x));

  /** Aggregate content clock of a task. `updatedAt` seeds boards from before sync. */
  const aggregateMtOf = t => t.mt ?? t.updatedAt ?? t.createdAt ?? 0;
  const mtOf = t => Math.max(
    aggregateMtOf(t),
    ...Object.values(t.fieldMt || {}),
  );
  /** Placement clock of a task. */
  const pmtOf = t => t.pmt ?? mtOf(t);
  /** Existence generation: only creation / explicit restore advances this. */
  const existMtOf = t => t.existMt ?? t.createdAt ?? mtOf(t);

  // Mutable task content merges by field group. Archive fields are one group:
  // half an archive operation (a timestamp without its source stage, or vice
  // versa) is not a meaningful state. `mt` remains the aggregate content clock
  // for old clients and unknown future fields.
  const TASK_FIELDS = [
    ['title', ['title']],
    ['notes', ['notes']],
    // A session command without its computer is the ambiguity docs/computers.md
    // removes, so the three merge as one atomic group.
    ['session', ['session', 'sessionMachine', 'sessionCwd']],
    ['project', ['projectId']],
    ['flag', ['flag']],
    ['archive', ['archivedAt', 'archivedFrom']],
    // docs/team.md: an assignee without who assigned it is not a state.
    ['assignee', ['assigneeId', 'assignedBy', 'assignedAt']],
  ];
  const taskFieldValue = (t, name, keys) => keys.length === 1
    ? t[keys[0]]
    : Object.fromEntries(keys.map(key => [key, t[key] ?? null]));
  const setTaskFieldValue = (t, keys, value) => {
    if (keys.length === 1) { t[keys[0]] = value; return; }
    for (const key of keys) {
      const next = value && value[key];
      if (next == null) delete t[key]; else t[key] = next;
    }
  };
  const fieldMtOf = (t, name) => {
    const aggregate = aggregateMtOf(t);
    if (!t.fieldMt) return aggregate;
    const explicitMax = Math.max(0, ...Object.values(t.fieldMt));
    // An older app preserves the unknown fieldMt object but only advances mt.
    // Treat that as its legacy whole-row edit; mixed versions may still lose a
    // concurrent field, but the old client's actual edit is never ignored.
    if (aggregate > explicitMax) return aggregate;
    return t.fieldMt[name] != null ? t.fieldMt[name] : aggregate;
  };
  const materializeFieldMt = t => ({
    ...Object.fromEntries(TASK_FIELDS.map(([name]) => [name, fieldMtOf(t, name)])),
    ...(t.fieldMt && t.fieldMt._extra != null ? { _extra: t.fieldMt._extra } : {}),
  });
  const taskExtraContent = t => {
    const {
      id, title, notes, session, sessionMachine, sessionCwd, projectId, flag,
      archivedAt, archivedFrom, assigneeId, assignedBy, assignedAt,
      createdAt, updatedAt, mt, pmt, existMt, fieldMt, columnId, order, ...extra
    } = t;
    return extra;
  };
  const taskPlacement = t => ({ columnId: t.columnId, order: t.order });
  const itemContent = c => {
    const { mt, ...content } = c;
    return content;
  };

  /** The highest clock visible anywhere in a board — what a new stamp must
      strictly exceed. */
  function clockMax(st) {
    let m = 0;
    for (const t of st.tasks || []) {
      m = Math.max(m, mtOf(t), pmtOf(t), existMtOf(t), ...Object.values(t.fieldMt || {}));
    }
    for (const e of st.events || []) m = Math.max(m, e.mt || 0);
    for (const c of st.columns || []) m = Math.max(m, c.mt || 0);
    for (const p of st.projects || []) m = Math.max(m, p.mt || 0);
    for (const ts of Object.values(st.tombstones || {})) m = Math.max(m, ts);
    // team and computer data: a fast-clock leave must never sit above a
    // later rejoin, so every one of their clocks counts
    for (const x of st.members || []) m = Math.max(m, x.mt || 0);
    for (const x of st.machines || []) m = Math.max(m, x.mt || 0);
    for (const x of st.teams || []) m = Math.max(m, x.joinMt || 0, x.mt || 0, x.memberMt || 0);
    for (const ts of Object.values(st.teamsLeft || {})) m = Math.max(m, ts || 0);
    for (const x of Object.values(st.privateSessions || {})) m = Math.max(m, (x && x.mt) || 0);
    for (const x of Object.values(st.attachments || {})) m = Math.max(m, (x && x.mt) || 0);
    if (st.profile) m = Math.max(m, st.profile.mt || 0);
    return Math.max(m, st.columnsMt || 0, st.projectsMt || 0, st.machinesMt || 0);
  }

  /**
   * Stamp everything `next` changed since `prev` (the last-saved state).
   * Mutates and returns `next`. New events get no stamp — an appended event
   * is immutable and merges by union; only a rewritten one (rewriteDay)
   * needs a clock to win a collision. Any stamp clears the first-run `seed`
   * marker: a board the user has touched is no longer safe to replace.
   */
  function stampChanges(prev, next, now = Date.now(), observedTombstones = null) {
    const observedMax = Math.max(0, ...Object.values(observedTombstones || {}));
    const clock = Math.max(now, clockMax(prev) + 1, clockMax(next) + 1, observedMax + 1);
    let stamped = false;

    const oldTasks = new Map((prev.tasks || []).map(t => [t.id, t]));
    for (const t of next.tasks || []) {
      const before = oldTasks.get(t.id);
      if (!before) {
        t.fieldMt = Object.fromEntries(TASK_FIELDS.map(([name]) => [name, clock]));
        t.mt = clock;
        t.pmt = clock;
        t.existMt = clock;
        stamped = true;
        continue;
      }

      const changedFields = TASK_FIELDS.filter(([name, keys]) =>
        canon(taskFieldValue(before, name, keys)) !== canon(taskFieldValue(t, name, keys)));
      const extraChanged = canon(taskExtraContent(before)) !== canon(taskExtraContent(t));
      const placementChanged = canon(taskPlacement(before)) !== canon(taskPlacement(t));
      const deleteAt = Math.max((next.tombstones && next.tombstones[t.id]) || 0,
        (observedTombstones && observedTombstones[t.id]) || 0);

      // Legacy rows used `mt` as the fallback placement clock. Freeze that
      // baseline before a content edit advances mt, or a title edit would look
      // like a move. The inverse protects content when an old row is first
      // moved and `updatedAt` advances for the age label.
      if ((changedFields.length || extraChanged || placementChanged) && t.pmt == null) {
        t.pmt = pmtOf(before);
      }
      if ((changedFields.length || extraChanged) && deleteAt >= existMtOf(before)) {
        // A draft settled after its remote delete was already fetched is an
        // explicit restore. This is still stamped here—not at the UI mutation
        // site—so every interaction path keeps the same clock discipline.
        t.existMt = clock;
      } else if ((changedFields.length || extraChanged || placementChanged) && t.existMt == null) {
        t.existMt = existMtOf(before);
      }
      if (placementChanged && t.mt == null) t.mt = mtOf(before);

      if (changedFields.length) {
        const fieldMt = materializeFieldMt(before);
        for (const [name] of changedFields) fieldMt[name] = clock;
        t.fieldMt = fieldMt;
        t.mt = clock;
        stamped = true;
      } else if (extraChanged) {
        t.fieldMt = { ...materializeFieldMt(before), _extra: clock };
        t.mt = clock;
        stamped = true;
      }
      if (placementChanged) { t.pmt = clock; stamped = true; }
    }

    const oldEvents = new Map((prev.events || []).map(e => [e.id, e]));
    for (const e of next.events || []) {
      const before = oldEvents.get(e.id);
      if (before && canon(itemContent(before)) !== canon(itemContent(e))) { e.mt = clock; stamped = true; }
      if (!before) stamped = true;
    }

    for (const [list, oldList, key] of [
      [next.columns, prev.columns, 'columnsMt'],
      [next.projects, prev.projects, 'projectsMt'],
      [next.machines, prev.machines, 'machinesMt'],
    ]) {
      const old = new Map((oldList || []).map(c => [c.id, c]));
      for (const c of list || []) {
        const before = old.get(c.id);
        if (!before || canon(itemContent(before)) !== canon(itemContent(c))) { c.mt = clock; stamped = true; }
      }
      // the order VECTOR has its own clock: reorders, adds and deletes move
      // it; a rename alone does not, so a rename can never drag the done
      // line of a concurrent reorder along with it
      const ids = l => (l || []).map(c => c.id).join('\\0');
      if (ids(oldList) !== ids(list)) { next[key] = clock; stamped = true; }
    }

    if ((prev.tombstones && Object.keys(prev.tombstones).length) !==
        (next.tombstones && Object.keys(next.tombstones).length)) stamped = true;
    // A tombstone written as 0 asks to be stamped here, past everything
    // observed — a wall-clock stamp could sit below a fast-clocked item's mt
    // and lose to it (computers use this; see docs/computers.md).
    for (const [id, ts] of Object.entries(next.tombstones || {})) {
      if (ts === 0 && !(prev.tombstones && prev.tombstones[id])) { next.tombstones[id] = clock; stamped = true; }
    }

    // Roster: per member, like a project but with no order vector.
    const oldMembers = new Map((prev.members || []).map(x => [x.id, x]));
    for (const x of next.members || []) {
      const before = oldMembers.get(x.id);
      if (!before || canon(itemContent(before)) !== canon(itemContent(x))) { x.mt = clock; stamped = true; }
    }

    // Teams you belong to (personal board). An entry absent from the last
    // save and present now is a (re)join and starts a new generation; one
    // present in both keeps its joinMt whatever else changed, so a stale tab
    // editing a label cannot outvote a leave. Label and identity have their
    // own clocks so renaming a team never fights choosing who you are.
    const oldTeams = new Map((prev.teams || []).map(x => [x.id, x]));
    for (const x of next.teams || []) {
      const before = oldTeams.get(x.id);
      if (!before) { x.joinMt = clock; x.mt = clock; x.memberMt = clock; stamped = true; continue; }
      if ((before.label || '') !== (x.label || '')) { x.mt = clock; stamped = true; }
      if ((before.memberId || null) !== (x.memberId || null)) { x.memberMt = clock; stamped = true; }
    }
    // A new leave tombstone is stamped now. An existing one never moves on
    // its own; leaving again after a rejoin writes any other value (the app
    // writes 0) and is re-stamped past the rejoin it undoes.
    for (const id of Object.keys(next.teamsLeft || {})) {
      const before = prev.teamsLeft ? prev.teamsLeft[id] : undefined;
      if (before == null || next.teamsLeft[id] !== before) { next.teamsLeft[id] = clock; stamped = true; }
    }
    // Your profile (personal board): one record, one clock.
    if (next.profile && canon(itemContent(next.profile)) !== canon(itemContent(prev.profile || {}))) {
      next.profile.mt = clock; stamped = true;
    }
    // Private sessions for team cards (personal board), per key.
    const oldPriv = prev.privateSessions || {};
    for (const [k, v] of Object.entries(next.privateSessions || {})) {
      const before = oldPriv[k];
      if (!before || canon(itemContent(before)) !== canon(itemContent(v))) { v.mt = clock; stamped = true; }
    }

    // Images, per attachment id (docs/attachments.md). Absence is never a
    // removal — only `gone` removes — so an entry missing since the last save
    // is put back exactly as it was. A snapshot that predates a teammate's
    // image must not be able to delete it.
    const oldAtt = prev.attachments || {};
    for (const [k, before] of Object.entries(oldAtt)) {
      if (!next.attachments || !next.attachments[k]) (next.attachments = next.attachments || {})[k] = before;
    }
    for (const [k, v] of Object.entries(next.attachments || {})) {
      const before = oldAtt[k];
      if (!before || canon(itemContent(before)) !== canon(itemContent(v))) { v.mt = clock; stamped = true; }
    }

    if (stamped) delete next.seed;
    return next;
  }

  /**
   * The subset of state that travels. Preferences stay on their device.
   *
   * Canonical: tasks by id, events by (at, id), tombstones by key — the same
   * order merge() emits. Two boards holding the same work therefore serialize
   * identically no matter which mutation built them, which is what lets the
   * client compare "what I have" against "what the relay has" with a string
   * and never push a board the relay already holds.
   */
  const byKey = o => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => a < b ? -1 : 1));
  const byIdSort = l => (l || []).slice().sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  /** Team and computer data an older client would silently drop (its
      whitelist) or corrupt (its fieldMt rebuild). Any of it makes a board v3,
      which every older client refuses instead. docs/team.md → Schema. */
  /** Images: a v3 client accepts v3 and its syncable drops unknown keys, so a
      board with images is v4, which every older client refuses. */
  const hasV4Data = st => !!(st.attachments && Object.keys(st.attachments).length);
  const hasV3Data = st => !!((st.members && st.members.length) || (st.teams && st.teams.length)
    || (st.teamsLeft && Object.keys(st.teamsLeft).length)
    || (st.machines && st.machines.length)
    || (st.privateSessions && Object.keys(st.privateSessions).length)
    || !!(st.profile && (st.profile.name || st.profile.avatar))
    || (st.tasks || []).some(t => t.assigneeId || t.assignedBy || t.sessionMachine || t.sessionCwd));
  const syncable = st => {
    const out = {
      v: hasV4Data(st) ? 4 : hasV3Data(st) ? 3 : 2,
      columns: st.columns,
      columnsMt: st.columnsMt || 0,
      projects: st.projects,
      projectsMt: st.projectsMt || 0,
      tasks: byIdSort(st.tasks),
      tombstones: byKey(st.tombstones),
      events: (st.events || []).slice()
        .sort((x, y) => (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
    };
    // Emitted only when present, so a v2 board serializes byte for byte as before.
    if (st.members && st.members.length) out.members = byIdSort(st.members);
    if (st.teams && st.teams.length) out.teams = byIdSort(st.teams);
    if (st.teamsLeft && Object.keys(st.teamsLeft).length) out.teamsLeft = byKey(st.teamsLeft);
    if (st.machines && st.machines.length) { out.machines = st.machines; out.machinesMt = st.machinesMt || 0; }
    if (st.privateSessions && Object.keys(st.privateSessions).length) out.privateSessions = byKey(st.privateSessions);
    if (st.profile && (st.profile.name || st.profile.avatar)) out.profile = st.profile;
    if (st.attachments && Object.keys(st.attachments).length) out.attachments = byKey(st.attachments);
    return out;
  };

  /**
   * Is this decrypted payload a board this client may write back?
   *
   * `unseal` only decrypts and JSON.parses — it promises nothing about shape,
   * and `syncable` hard-codes v:2 and copies only the fields it knows. So a
   * client that merged a NEWER board and pushed it would silently drop every
   * field a later version added. The browser has always refused a future `v`
   * (see applyRemote); this is that check, named and shared, so the app and any
   * headless client cannot drift on what "valid" means.
   *
   * Returns null when acceptable, else a short reason string.
   */
  const SYNC_V = 4;
  const isStr = v => typeof v === 'string' && v.length > 0;
  const isNum = v => typeof v === 'number' && isFinite(v);
  const ICONS = ['laptop', 'desktop', 'mini', 'server'];
  /**
   * `kind` is the namespace the payload is about to land in: 'personal' (the
   * null namespace), 'team' (t-…), or omitted for a kind-free structural
   * check — the step that runs before a candidate is routed. Personal and team
   * data never mix: a roster on the personal board, or a team list or private
   * sessions on a team board, is refused before adoption, merge or push.
   */
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const MAX_IMAGE = 1_000_000;
  const isCount = v => typeof v === 'number' && isFinite(v) && v >= 0;
  function attachmentProblem(a) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return 'an attachment is malformed';
    if (!isStr(a.task) || !BLOB_ID.test(a.blob || '')) return 'an attachment has no card or image';
    if (!IMAGE_TYPES.includes(a.type)) return 'an attachment type is not an image';
    if (!isCount(a.w) || !isCount(a.h) || !isCount(a.bytes) || a.bytes > MAX_IMAGE) return 'an attachment size is malformed';
    if (a.name !== undefined && typeof a.name !== 'string') return 'an attachment name is not a string';
    if (a.mt !== undefined && !isNum(a.mt)) return 'an attachment clock is not a number';
    return null;
  }

  function validateSyncable(x, kind) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return 'not an object';
    if ((x.v || SYNC_V) > SYNC_V) return `schema v${x.v} is newer than this client (v${SYNC_V})`;
    if (!Array.isArray(x.columns) || !x.columns.length) return 'no columns';
    for (const c of x.columns) {
      if (!c || typeof c.id !== 'string' || !c.id) return 'a column has no id';
    }
    for (const [key, val] of [['projects', x.projects], ['tasks', x.tasks], ['events', x.events]]) {
      if (val !== undefined && !Array.isArray(val)) return `${key} is not an array`;
    }
    for (const t of x.tasks || []) {
      if (!t || typeof t.id !== 'string' || !t.id) return 'a task has no id';
    }
    if (x.tombstones !== undefined
      && (!x.tombstones || typeof x.tombstones !== 'object' || Array.isArray(x.tombstones))) {
      return 'tombstones is not an object';
    }
    const isMap = o => o && typeof o === 'object' && !Array.isArray(o);
    if (x.members !== undefined) {
      if (!Array.isArray(x.members)) return 'members is not an array';
      for (const m of x.members) {
        if (!m || !isStr(m.id) || typeof m.name !== 'string' || !m.name.trim()) return 'a member has no id or name';
        if (m.color !== undefined && typeof m.color !== 'string') return 'a member color is not a string';
        if (m.avatar !== undefined && m.avatar !== null && typeof m.avatar !== 'string') return 'a member avatar is not a string';
        if (m.mt !== undefined && !isNum(m.mt)) return 'a member clock is not a number';
      }
    }
    if (x.teams !== undefined) {
      if (!Array.isArray(x.teams)) return 'teams is not an array';
      for (const t of x.teams) {
        if (!t || !isStr(t.id) || !isStr(t.ns) || !/^t-/.test(t.ns)) return 'a team has no id or namespace';
        if (t.secret !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(t.secret)) return 'a team secret is malformed';
        for (const k of ['joinMt', 'mt', 'memberMt']) if (t[k] !== undefined && !isNum(t[k])) return 'a team clock is not a number';
      }
    }
    if (x.teamsLeft !== undefined) {
      if (!isMap(x.teamsLeft)) return 'teamsLeft is not an object';
      for (const v of Object.values(x.teamsLeft)) if (!isNum(v)) return 'a leave stamp is not a number';
    }
    if (x.machines !== undefined) {
      if (!Array.isArray(x.machines)) return 'machines is not an array';
      for (const m of x.machines) {
        if (!m || !isStr(m.id) || typeof m.name !== 'string') return 'a computer has no id or name';
        if (m.icon !== undefined && !ICONS.includes(m.icon)) return 'a computer icon is unknown';
      }
    }
    if (x.privateSessions !== undefined) {
      if (!isMap(x.privateSessions)) return 'privateSessions is not an object';
      for (const v of Object.values(x.privateSessions)) if (!isMap(v) || typeof (v.session || '') !== 'string') return 'a private session is malformed';
    }
    if (x.profile !== undefined) {
      if (!isMap(x.profile) || typeof (x.profile.name || '') !== 'string'
        || (x.profile.avatar != null && typeof x.profile.avatar !== 'string')) return 'the profile is malformed';
    }
    if (x.attachments !== undefined) {
      if (!isMap(x.attachments)) return 'attachments is not an object';
      for (const a of Object.values(x.attachments)) {
        const bad = attachmentProblem(a);
        if (bad) return bad;
      }
    }
    if (kind === 'personal' && x.members !== undefined) return 'a roster cannot land on the personal board';
    if (kind === 'team') {
      if (!Array.isArray(x.members) || !x.members.length) return 'a team board needs its roster';
      for (const k of ['teams', 'teamsLeft', 'machines', 'privateSessions', 'profile']) {
        if (x[k] !== undefined) return `${k} cannot land on a team board`;
      }
      // The session firewall: a resume command is private and only works on
      // one computer. Team sessions live on each person's personal board; a
      // team payload carrying one is a leak and is refused, never stripped.
      // Presence, not truthiness: an empty `session: ""` is still a slot the
      // team board must not have.
      for (const t of x.tasks || []) {
        if (t && ('session' in t || 'sessionMachine' in t || 'sessionCwd' in t)) return 'a session cannot land on a team board';
      }
    }
    return null;
  }

  /**
   * merge(local, remote[, opts]) → a fresh board. Local preferences pass through
   * untouched; the synced subset merges by the rules in docs/sync-spec.md:
   *
   * - columns/projects: per-item union (id, then name-deduped for boards
   *   with independent histories), item content by higher `mt`; the ORDER
   *   is one atomic vector under columnsMt/projectsMt — order is semantics,
   *   the last column is the done line. Stages the winning vector does not
   *   know arrive BEFORE its last column, so they can never move the done
   *   line; unknown projects append.
   *
   *   Known and accepted: merge is commutative and idempotent, but the
   *   middle order of stages added CONCURRENTLY on two devices depends on
   *   the order the merges happened in, so two devices can briefly list the
   *   same stages in a different middle order. The set converges, the done
   *   line converges, and the next reorder on either device stamps a new
   *   vector clock that wins everywhere and settles it. The alternative —
   *   a per-stage order key, which would be fully associative — lets a
   *   stage added elsewhere sort last and silently redefine what the weekly
   *   report calls finished. A cosmetic divergence that self-heals beats a
   *   semantic one that does not.
   * - tasks: known content by `fieldMt`, aggregate/legacy content by `mt`,
   *   placement by `pmt`, and existence by `existMt`, independently. A
   *   tombstone deletes an older existence generation. Ordinary edits and
   *   moves do not change that generation; an explicit restore after an
   *   observed delete does. This prevents stale fields from leaking back
   *   through a third replica while still making Undo/save-draft restorative.
   * - events: union by id — the log only ever grows.
   */
  function merge(local, remote, opts = {}) {
    const deep = x => JSON.parse(JSON.stringify(x));
    const a = local || {}, b = remote || {};
    // Adoption forces the side whose order wins: scanning a pairing link
    // means joining an existing board, not bringing your stage layout to it.
    // Clocks are untouched, so ordinary sync keeps resolving them normally.
    //
    // This makes merge DELIBERATELY ASYMMETRIC while set: `preferOrder:
    // 'remote'` names the second argument, so swapping the arguments swaps
    // which order wins. Only the plain two-argument call is commutative, and
    // that is the only form ongoing sync uses — the option is passed at
    // exactly one call site, always as merge(local, remote, …).
    const forced = opts.preferOrder === 'remote' ? 'b'
      : opts.preferOrder === 'local' ? 'a' : null;

    const tombstones = {};
    for (const side of [a.tombstones, b.tombstones]) {
      for (const [id, ts] of Object.entries(side || {})) {
        tombstones[id] = Math.max(tombstones[id] || 0, ts);
      }
    }
    const sortedTombstones = {};
    for (const id of Object.keys(tombstones).sort()) sortedTombstones[id] = tombstones[id];

    /** Per-item union of columns or projects + one atomic order vector. */
    function mergeLists(aList, bList, aMt, bMt, insertBeforeLast) {
      const aIds = (aList || []).map(c => c.id);
      const bIds = (bList || []).map(c => c.id);
      // An empty list is not an opinion about order, so it can never win one:
      // without this, a caller handing merge a board with `columns: []` sorts
      // the real board's stages by id and moves its done line.
      // Emptiness is checked BEFORE `forced`: an empty list carries no
      // ordering information, so not even an explicit preference can make it
      // win one.
      const orderWinsA = !aIds.length !== !bIds.length ? !bIds.length
        : forced ? forced === 'a'
        : aMt !== bMt ? aMt > bMt
        : canon(aIds) >= canon(bIds);
      const winnerIds = orderWinsA ? aIds : bIds;
      // A forced (adoption) decision outranks both inputs, so a second tab on
      // the joining device — still holding the pre-adoption order at the same
      // clock — cannot tie and win it back. Only when the two orders actually
      // differ, so merging a board with itself stays idempotent.
      const decided = forced && canon(aIds) !== canon(bIds);
      const orderMt = Math.max(aMt, bMt) + (decided ? 1 : 0);

      // union by id: higher item clock wins content, tombstones delete
      const byId = new Map();
      for (const c of aList || []) byId.set(c.id, c);
      for (const c of bList || []) {
        const held = byId.get(c.id);
        if (!held) { byId.set(c.id, c); continue; }
        const cm = c.mt || 0, hm = held.mt || 0;
        if (cm > hm || (cm === hm && canon(c) > canon(held))) byId.set(c.id, c);
      }
      let items = [...byId.values()].filter(c => !(tombstones[c.id] != null && (c.mt || 0) <= tombstones[c.id]));
      // A board must retain a stage, but an empty project list is perfectly
      // valid. Sharing this guard used to resurrect the final deleted project.
      if (!items.length && insertBeforeLast) items = [...byId.values()];

      // Two boards with separate histories both have an "Inbox" under
      // different ids: keep one, remember the alias so tasks follow it.
      //
      // Only a genuine cross-board coincidence collapses — one id that ONLY
      // this side knows meeting one id that ONLY the other side does. Nothing
      // stops a single board from having two stages named the same, and an
      // earlier version of this collapsed those too: every merge, including a
      // routine pull, silently swallowed one of them. Deliberately
      // conservative, because the costs are not symmetric — a duplicate stage
      // is one click to delete, a swallowed stage is gone.
      const inWinner = new Set(winnerIds);
      const aHas = new Set(aIds), bHas = new Set(bIds);
      const byName = new Map();
      for (const c of items) {
        if (!byName.has(c.name)) byName.set(c.name, []);
        byName.get(c.name).push(c);
      }
      const alias = new Map();
      const dropped = new Set();
      for (const group of byName.values()) {
        if (group.length < 2) continue;
        const aOnly = group.filter(c => aHas.has(c.id) && !bHas.has(c.id));
        const bOnly = group.filter(c => bHas.has(c.id) && !aHas.has(c.id));
        const shared = group.filter(c => aHas.has(c.id) && bHas.has(c.id));
        // a name either side already shares, or more than one candidate on a
        // side, is ambiguous — keep every stage and let the user decide
        if (shared.length || aOnly.length !== 1 || bOnly.length !== 1) continue;
        const [x] = aOnly, [y] = bOnly;
        const keep =
          inWinner.has(x.id) !== inWinner.has(y.id) ? (inWinner.has(x.id) ? x : y)
            : (x.mt || 0) !== (y.mt || 0) ? ((x.mt || 0) > (y.mt || 0) ? x : y)
            : canon(x) >= canon(y) ? x : y;
        const drop = keep === x ? y : x;
        alias.set(drop.id, keep.id);
        dropped.add(drop.id);
      }
      items = items.filter(c => !dropped.has(c.id));

      // the winning vector first (survivors only), then what it never saw —
      // before its last entry for columns, so the done line cannot move
      const itemById = new Map(items.map(c => [c.id, c]));
      const ordered = winnerIds.filter(id => itemById.has(id)).map(id => itemById.get(id));
      // Stages the winner never saw keep the arrangement they had on the side
      // they came from; anything neither vector lists falls back to id order.
      // Both rules are argument-order independent, so this stays commutative.
      const loserIds = orderWinsA ? bIds : aIds;
      const rank = id => {
        const i = loserIds.indexOf(id);
        return i === -1 ? loserIds.length : i;
      };
      const leftovers = items.filter(c => !winnerIds.includes(c.id))
        .sort((x, y) => rank(x.id) - rank(y.id) || (x.id < y.id ? -1 : 1));
      if (insertBeforeLast && ordered.length) ordered.splice(ordered.length - 1, 0, ...leftovers);
      else ordered.push(...leftovers);

      return { items: ordered, orderMt, alias };
    }

    const cols = mergeLists(a.columns, b.columns, a.columnsMt || 0, b.columnsMt || 0, true);
    const projs = mergeLists(a.projects, b.projects, a.projectsMt || 0, b.projectsMt || 0, false);
    // Computers merge like projects. Here the name dedupe is exactly right:
    // two devices that each registered "MacBook" before syncing mean one
    // computer, and the alias re-points every session that named the other.
    const machs = (a.machines || b.machines)
      ? mergeLists(a.machines, b.machines, a.machinesMt || 0, b.machinesMt || 0, false) : null;
    const machAlias = id => (machs && id && machs.alias.has(id)) ? machs.alias.get(id) : id;

    const ofA = new Map((a.tasks || []).map(t => [t.id, t]));
    const ofB = new Map((b.tasks || []).map(t => [t.id, t]));
    const tasks = [];
    for (const id of new Set([...ofA.keys(), ...ofB.keys()])) {
      let x = ofA.get(id), y = ofB.get(id);
      // Creation/explicit restore starts a new generation. Older generations
      // never donate fields or placement to it, and a tombstone removes every
      // generation it has observed. This is what keeps delete/restore
      // associative across three or more replicas without retaining deleted
      // card content anywhere else.
      const generation = Math.max(x ? existMtOf(x) : 0, y ? existMtOf(y) : 0);
      if (x && existMtOf(x) < generation) x = null;
      if (y && existMtOf(y) < generation) y = null;
      if (tombstones[id] != null && generation <= tombstones[id]) continue;
      if (!x && !y) continue;
      const pick = (clockOf, valueOf = row => row) => !x ? y : !y ? x
        : clockOf(x) !== clockOf(y) ? (clockOf(x) > clockOf(y) ? x : y)
        : (canon(valueOf(x)) >= canon(valueOf(y)) ? x : y);
      const cw = pick(mtOf);   // content winner
      const pw = pick(pmtOf, taskPlacement);  // placement winner
      let row = deep(cw);

      // New clients merge known mutable fields independently. A legacy row
      // without fieldMt presents its aggregate mt as every field's clock, so
      // mixed-version boards remain deterministic and backwards compatible.
      if (x && y && (x.fieldMt || y.fieldMt)) {
        const fieldMt = {};
        for (const [name, keys] of TASK_FIELDS) {
          const xm = fieldMtOf(x, name), ym = fieldMtOf(y, name);
          const xv = taskFieldValue(x, name, keys);
          const yv = taskFieldValue(y, name, keys);
          const winner = xm !== ym ? (xm > ym ? xv : yv)
            : canon(xv) >= canon(yv) ? xv : yv;
          setTaskFieldValue(row, keys, winner);
          fieldMt[name] = Math.max(xm, ym);
        }
        row.fieldMt = fieldMt;
        const extraMt = Math.max((x.fieldMt && x.fieldMt._extra) || 0,
          (y.fieldMt && y.fieldMt._extra) || 0);
        if (extraMt) row.fieldMt._extra = extraMt;
        row.mt = Math.max(mtOf(x), mtOf(y), ...Object.values(fieldMt));
        row.updatedAt = Math.max(x.updatedAt || 0, y.updatedAt || 0) || row.updatedAt;
      }
      if (pmtOf(pw) > pmtOf(cw) || canon(taskPlacement(pw)) !== canon(taskPlacement(cw))) {
        row.columnId = pw.columnId;
        row.order = pw.order;
        row.pmt = pmtOf(pw);
      }
      if ((x && x.existMt != null) || (y && y.existMt != null)) row.existMt = generation;
      tasks.push(row);
    }

    // Re-point tasks at the surviving stage/project: alias from the name
    // dedupe first, then name-match against wherever the id came from, then
    // the first column — migrate's rule. Derived state: never bumps clocks.
    const nameOf = new Map([...(a.columns || []), ...(b.columns || [])].map(c => [c.id, c.name]));
    const colByName = new Map(cols.items.map(c => [c.name, c.id]));
    const colIds = new Set(cols.items.map(c => c.id));
    const projNameOf = new Map([...(a.projects || []), ...(b.projects || [])].map(p => [p.id, p.name]));
    const projByName = new Map(projs.items.map(p => [p.name, p.id]));
    const projIds = new Set(projs.items.map(p => p.id));
    for (const t of tasks) {
      if (cols.alias.has(t.columnId)) t.columnId = cols.alias.get(t.columnId);
      if (!colIds.has(t.columnId)) {
        t.columnId = colByName.get(nameOf.get(t.columnId)) ?? (cols.items[0] && cols.items[0].id);
      }
      if (t.projectId && projs.alias.has(t.projectId)) t.projectId = projs.alias.get(t.projectId);
      if (t.projectId && !projIds.has(t.projectId)) {
        const mapped = projByName.get(projNameOf.get(t.projectId));
        t.projectId = mapped || null;
      }
    }

    if (machs) {
      const live = new Set(machs.items.map(m => m.id));
      for (const t of tasks) {
        if (!t.sessionMachine) continue;
        t.sessionMachine = machAlias(t.sessionMachine);
        // a deleted computer never becomes a wrong one: show none
        if (!live.has(t.sessionMachine)) delete t.sessionMachine;
      }
    }

    // Roster: union by id, rename by mt. No order vector and deliberately no
    // name dedupe — two people who both join as "Ana" are two people.
    const members = unionById(a.members, b.members, x => x.mt || 0);

    // Teams you belong to. A leave is a tombstone; an entry survives only if
    // its generation (joinMt) is newer. Within one generation, label and
    // identity merge on their own clocks.
    const teamsLeft = {};
    for (const side of [a.teamsLeft, b.teamsLeft]) {
      for (const [id, ts] of Object.entries(side || {})) teamsLeft[id] = Math.max(teamsLeft[id] || 0, ts || 0);
    }
    const teamIds = new Set([...(a.teams || []), ...(b.teams || [])].map(x => x.id));
    const teamOf = (list, id) => (list || []).find(x => x.id === id);
    const teams = [];
    for (const id of [...teamIds].sort()) {
      let x = teamOf(a.teams, id), y = teamOf(b.teams, id);
      const gen = Math.max(x ? x.joinMt || 0 : 0, y ? y.joinMt || 0 : 0);
      if (x && (x.joinMt || 0) < gen) x = null;
      if (y && (y.joinMt || 0) < gen) y = null;
      if (teamsLeft[id] != null && gen <= teamsLeft[id]) continue;
      const pickBy = (clock, keys) => {
        if (!x) return y; if (!y) return x;
        const cx = x[clock] || 0, cy = y[clock] || 0;
        if (cx !== cy) return cx > cy ? x : y;
        const vx = canon(keys.map(k => x[k] ?? null)), vy = canon(keys.map(k => y[k] ?? null));
        return vx >= vy ? x : y;
      };
      const base = deep(pickBy('mt', ['label', 'ns', 'secret']));
      const who = pickBy('memberMt', ['memberId']);
      base.memberId = who.memberId ?? null;
      base.memberMt = who.memberMt || 0;
      base.mt = Math.max(x ? x.mt || 0 : 0, y ? y.mt || 0 : 0);
      base.joinMt = gen;
      teams.push(base);
    }

    // Private sessions for team cards: per key, higher mt wins.
    const privateSessions = {};
    for (const side of [a.privateSessions, b.privateSessions]) {
      for (const [k, v] of Object.entries(side || {})) {
        const held = privateSessions[k];
        if (!held || (v.mt || 0) > (held.mt || 0) || ((v.mt || 0) === (held.mt || 0) && canon(v) > canon(held))) {
          privateSessions[k] = deep(v);
        }
      }
    }
    const liveMachines = machs ? new Set(machs.items.map(m => m.id)) : null;
    for (const v of Object.values(privateSessions)) {
      if (!v.sessionMachine) continue;
      v.sessionMachine = machAlias(v.sessionMachine);
      if (liveMachines && !liveMachines.has(v.sessionMachine)) delete v.sessionMachine; // never a wrong computer
    }

    // Images: a set keyed by attachment id, higher mt wins, ties canonical.
    // Removal is a `gone` entry, never an absence, so nothing here deletes.
    const attachments = {};
    for (const side of [a.attachments, b.attachments]) {
      for (const [k, v] of Object.entries(side || {})) {
        const held = attachments[k];
        if (!held || (v.mt || 0) > (held.mt || 0) || ((v.mt || 0) === (held.mt || 0) && canon(v) > canon(held))) {
          attachments[k] = deep(v);
        }
      }
    }

    // The log only ever grows. A same-id collision is a rewriteDay conflict:
    // the stamped rewrite wins, a tie goes to the greater serialization.
    const events = new Map();
    for (const e of a.events || []) events.set(e.id, e);
    for (const e of b.events || []) {
      const held = events.get(e.id);
      if (!held) { events.set(e.id, e); continue; }
      const em = e.mt || 0, hm = held.mt || 0;
      if (em > hm || (em === hm && canon(e) > canon(held))) events.set(e.id, e);
    }

    const out = {
      ...deep(a),
      v: 2,
      columns: deep(cols.items),
      columnsMt: cols.orderMt,
      projects: deep(projs.items),
      projectsMt: projs.orderMt,
      tombstones: sortedTombstones,
      tasks: tasks.sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
      events: [...events.values()].map(deep)
        .sort((x, y) => (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
    };
    // Team and computer data: set when present, removed when empty, so a v2
    // board stays byte-identical and a local-only copy never lingers.
    const setOrDrop = (key, value, empty) => { if (empty) delete out[key]; else out[key] = value; };
    setOrDrop('members', members, !members.length);
    setOrDrop('teams', teams, !teams.length);
    setOrDrop('teamsLeft', Object.fromEntries(Object.entries(teamsLeft).sort(([p], [q]) => p < q ? -1 : 1)), !Object.keys(teamsLeft).length);
    // Profile: one record, higher clock wins, ties canonical.
    const pa = a.profile, pb = b.profile;
    const profile = !pa ? pb : !pb ? pa : (pa.mt || 0) !== (pb.mt || 0) ? ((pa.mt || 0) > (pb.mt || 0) ? pa : pb)
      : canon(pa) >= canon(pb) ? pa : pb;
    setOrDrop('profile', profile ? deep(profile) : null, !profile);
    setOrDrop('privateSessions', Object.fromEntries(Object.entries(privateSessions).sort(([p], [q]) => p < q ? -1 : 1)), !Object.keys(privateSessions).length);
    setOrDrop('attachments', Object.fromEntries(Object.entries(attachments).sort(([p], [q]) => p < q ? -1 : 1)), !Object.keys(attachments).length);
    if (machs) { out.machines = deep(machs.items); out.machinesMt = machs.orderMt; }
    delete out.seed; // a merged board is never a replaceable first-run seed
    return out;
  }

  /** Union by id, higher clock wins, ties canonical; sorted by id. */
  function unionById(aList, bList, clockOf) {
    const byId = new Map();
    for (const x of aList || []) byId.set(x.id, x);
    for (const y of bList || []) {
      const held = byId.get(y.id);
      if (!held || clockOf(y) > clockOf(held) || (clockOf(y) === clockOf(held) && canon(y) > canon(held))) byId.set(y.id, y);
    }
    return [...byId.values()].sort((x, y) => x.id < y.id ? -1 : 1).map(x => JSON.parse(JSON.stringify(x)));
  }

  /**
   * Union the relay's known events and tombstones back into a board, and
   * nothing else. The floor is what stops a snapshot write — an imported
   * backup, an undo — from shrinking the server's history, and it is
   * emphatically NOT a board: it carries no stages, projects or cards.
   * Putting it through merge() meant handing whole-board semantics a mostly
   * empty board, which sorted the real stages by id and moved the done line.
   */
  function unionFloor(st, floor) {
    const events = new Map();
    for (const e of st.events || []) events.set(e.id, e);
    for (const e of (floor && floor.events) || []) {
      const held = events.get(e.id);
      // same rule as merge: a rewritten day wins, ties break canonically
      if (!held) { events.set(e.id, e); continue; }
      const em = e.mt || 0, hm = held.mt || 0;
      if (em > hm || (em === hm && canon(e) > canon(held))) events.set(e.id, e);
    }

    const tombstones = { ...(st.tombstones || {}) };
    for (const [id, ts] of Object.entries((floor && floor.tombstones) || {})) {
      tombstones[id] = Math.max(tombstones[id] || 0, ts);
    }

    // Image references known to be on the relay: per key, merge's rule.
    const attachments = { ...(st.attachments || {}) };
    for (const [k, v] of Object.entries((floor && floor.attachments) || {})) {
      const held = attachments[k];
      if (!held || (v.mt || 0) > (held.mt || 0) || ((v.mt || 0) === (held.mt || 0) && canon(v) > canon(held))) attachments[k] = v;
    }

    return {
      ...st,
      ...(Object.keys(attachments).length
        ? { attachments: Object.fromEntries(Object.entries(attachments).sort(([x], [y]) => x < y ? -1 : 1)) } : {}),
      // A tombstone removes an observed existence generation. Only an explicit
      // restore/new generation can outvote it; an unseen stale edit cannot.
      tasks: (st.tasks || []).filter(t => !(tombstones[t.id] != null && existMtOf(t) <= tombstones[t.id])),
      tombstones: Object.fromEntries(Object.entries(tombstones).sort(([x], [y]) => x < y ? -1 : 1)),
      events: [...events.values()]
        .sort((x, y) => (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
    };
  }

  /* ── sync: capability crypto ──────────────────────────────
     One secret pairs the devices. HKDF splits it into a bearer token (what
     the relay sees) and an AES key (what it never sees); the relay addresses
     storage by SHA-256(token), so a server dump holds hashes and ciphertext.
     The relay is trusted only to be honest-but-curious and available —
     AES-GCM plus AAD authenticates each envelope, not the version history.
     WebCrypto exists in every target browser and in node ≥20, so all of
     this is unit-tested. */

  function bytesToB64u(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64uToBytes(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  /** 256 random bits, base64url — the whole capability. */
  const randomSecret = () => bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));

  const HKDF_SALT = new Uint8Array(32); // fixed: the secret carries the entropy

  async function deriveSync(secret) {
    const raw = b64uToBytes(secret);
    const km = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits', 'deriveKey']);
    const info = label => ({ name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode(label) });
    const tokenBits = await crypto.subtle.deriveBits(info('kanban.page auth'), km, 256);
    const key = await crypto.subtle.deriveKey(info('kanban.page enc'), km,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { token: bytesToB64u(new Uint8Array(tokenBits)), key };
  }

  /**
   * A team's identity, derived from its secret so every device that joins the
   * same team computes the same id and namespace with no coordination. One
   * way: it reveals nothing about the key. The full 128 bits go into the
   * namespace; truncating would let two teams meet. docs/team.md.
   */
  async function teamIdOf(secret) {
    const km = await crypto.subtle.importKey('raw', b64uToBytes(secret), 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode('kanban.page team') }, km, 128);
    return bytesToB64u(new Uint8Array(bits));
  }
  const teamNs = teamId => 't-' + teamId;
  const isTeamNs = ns => typeof ns === 'string' && /^t-[A-Za-z0-9_-]{22}$/.test(ns);

  async function pipeBytes(bytes, stream) {
    const out = await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
    return new Uint8Array(out);
  }

  // The envelope's metadata is authenticated as AAD, so the relay cannot
  // flip `gz` or `v` to cause a deterministic client failure.
  const envAad = env => new TextEncoder().encode(`kanban.page:env${env.v}:gz${env.gz}`);

  /** Board → opaque envelope. gzip when the platform has it, then AES-GCM. */
  async function seal(key, obj) {
    let data = new TextEncoder().encode(JSON.stringify(obj));
    let gz = 0;
    if (typeof CompressionStream !== 'undefined') {
      data = await pipeBytes(data, new CompressionStream('gzip'));
      gz = 1;
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: envAad({ v: 1, gz }) }, key, data));
    return { v: 1, gz, n: bytesToB64u(iv), d: bytesToB64u(ct) };
  }

  /** Envelope → board. Throws on tampering (GCM) or a wrong key. */
  async function unseal(key, env) {
    const pt = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64uToBytes(env.n), additionalData: envAad(env) },
      key, b64uToBytes(env.d)));
    const data = env.gz ? await pipeBytes(pt, new DecompressionStream('gzip')) : pt;
    return JSON.parse(new TextDecoder().decode(data));
  }

  /* Images (docs/attachments.md). A separate HKDF label, so the image key
     never shares an IV space with the board's `enc` key. */
  async function deriveBlobKey(secret) {
    const km = await crypto.subtle.importKey('raw', b64uToBytes(secret), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new TextEncoder().encode('kanban.page blob') },
      km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  const BLOB_ID = /^[A-Za-z0-9_-]{22}$/;
  const newBlobId = () => bytesToB64u(crypto.getRandomValues(new Uint8Array(16)));
  // The id is authenticated, so the relay cannot answer one image's request
  // with another image's bytes.
  const blobAad = id => new TextEncoder().encode(`kanban.page:blob:v1:${id}`);

  /** Image bytes → iv ‖ ciphertext. */
  async function sealBlob(key, id, bytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: blobAad(id) }, key, bytes));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv, 0);
    out.set(ct, 12);
    return out;
  }

  /** iv ‖ ciphertext → image bytes. Throws on tampering, a wrong key or a wrong id. */
  async function unsealBlob(key, id, sealed) {
    const buf = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed);
    if (buf.length < 12 + 16) throw new Error('blob too short');
    return new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf.subarray(0, 12), additionalData: blobAad(id) }, key, buf.subarray(12)));
  }

  /** A card's images that are live here: not removed, and the card itself
      exists on this board. Liveness is derived, so deleting a card forever
      writes nothing to its images and Undo brings them back with it. */
  function liveAttachments(st, taskId) {
    const cards = new Set((st.tasks || []).map(t => t.id));
    return Object.entries(st.attachments || {})
      .filter(([, a]) => a && !a.gone && cards.has(a.task) && (taskId == null || a.task === taskId))
      .map(([id, a]) => ({ id, ...a }))
      .sort((x, y) => (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  }

  /** Type and dimensions from an image's header, before anything decodes it
      — so a tiny file declaring a gigantic canvas is refused, not allocated.
      Returns { type, w, h } or null for anything that is not one of the four. */
  function imageInfo(b) {
    if (!b || b.length < 12) return null;
    const u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const u16 = i => (b[i] << 8) | b[i + 1];
    const le16 = i => b[i] | (b[i + 1] << 8);
    const le24 = i => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) {
      return b.length >= 24 ? { type: 'image/png', w: u32(16), h: u32(20) } : null;
    }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) {
      return { type: 'image/gif', w: le16(6), h: le16(8) };
    }
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
      if (b.length < 30) return null;
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === 'VP8X') return { type: 'image/webp', w: le24(24) + 1, h: le24(27) + 1 };
      if (chunk === 'VP8 ') return { type: 'image/webp', w: le16(26) & 0x3FFF, h: le16(28) & 0x3FFF };
      if (chunk === 'VP8L') {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { type: 'image/webp', w: (bits & 0x3FFF) + 1, h: ((bits >>> 14) & 0x3FFF) + 1 };
      }
      return null;
    }
    if (b[0] === 0xFF && b[1] === 0xD8) {
      // walk the markers to the first start-of-frame
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7) || m === 0xFF) { i += m === 0xFF ? 1 : 2; continue; }
        if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
          return { type: 'image/jpeg', w: u16(i + 7), h: u16(i + 5) };
        }
        i += 2 + u16(i + 2);
      }
      return null;
    }
    return null;
  }

  /* ── storage ─────────────────────────────────────────── */

  /** The forward guard: a board written by a newer release is never folded
      into this one's model — `migrate` would rewrite its `v` and a save would
      strip what it does not know. Checked before `migrate` on every read. */
  const isFutureBoard = raw => !!raw && typeof raw === 'object' && typeof raw.v === 'number' && raw.v > SYNC_V;

  /** What a backup file may carry. A backup travels (email, drives), so the
      keys to other people's boards — and device-local bookkeeping — stay out. */
  function exportable(st) {
    const out = JSON.parse(JSON.stringify(st));
    for (const k of ['teams', 'teamsLeft', 'teamsReqApplied', '_contentGen', '_bindingGen']) delete out[k];
    return out;
  }

  /** Who moved a card into the done column, from the log: the last event
      into that column by id that carries a `by`. Legacy events carry no
      column ids and so never answer. Returns { by, byName, at } or null. */
  function doneByOf(events, taskId, doneColumnId) {
    let hit = null;
    for (const e of events || []) {
      if (e.taskId !== taskId || !e.by || !e.toColumnId) continue;
      if (e.toColumnId === doneColumnId && e.fromColumnId !== doneColumnId) {
        if (!hit || (e.at || 0) >= (hit.at || 0)) hit = e;
      }
    }
    return hit ? { by: hit.by, byName: hit.byName || null, at: hit.at } : null;
  }

  function defaultBoard(locale = 'en') {
    return {
      v: 2,
      theme: 'light',
      density: 'comfortable',
      asOf: null,
      columns: (locale === 'es' ? ['Bandeja', 'En curso', 'En espera', 'Hecho'] : ['Inbox', 'Doing', 'Waiting', 'Done']).map(name => ({ id: uid(), name })),
      projects: [],
      tasks: [],
      events: [],
      tombstones: {},
      filter: null,
      flagFilter: false,
    };
  }

  /** Last resort: recover stage names from the log itself. */
  function columnsFromLog(events) {
    const names = [];
    for (const e of events) if (e.to && !names.includes(e.to)) names.push(e.to);
    return names.length ? names.map(name => ({ id: uid(), name })) : defaultBoard().columns;
  }

  function migrate(raw) {
    const base = defaultBoard();
    if (!raw || typeof raw !== 'object') return base;

    // A board carrying a log is never thrown away, however damaged the rest is —
    // the log is the only copy of the history. Gate on the log, not on `v`.
    if (Array.isArray(raw.events)) {
      const columns = Array.isArray(raw.columns) && raw.columns.length
        ? raw.columns : columnsFromLog(raw.events);
      const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
      const known = new Set(columns.map(c => c.id));
      tasks.forEach(t => { if (!known.has(t.columnId)) t.columnId = columns[0].id; });
      return {
        ...base,
        ...raw,
        v: 2,
        columns,
        tasks,
        events: raw.events,
        projects: raw.projects || [],
        theme: raw.theme || 'light',
        density: raw.density === 'compact' ? 'compact' : 'comfortable',
        asOf: null,
        filter: raw.filter || null,
        flagFilter: !!raw.flagFilter,
      };
    }

    if (!Array.isArray(raw.columns) || !raw.columns.length) return base;
    if (!Array.isArray(raw.tasks)) return base;

    const colName = id => (raw.columns.find(c => c.id === id) || {}).name || 'Inbox';
    const events = raw.tasks
      .filter(t => t.createdAt)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(t => ({
        id: uid(),
        taskId: t.id,
        title: t.title,
        type: 'created',
        from: null,
        to: colName(t.columnId),
        at: t.createdAt,
        day: ymd(t.createdAt),
        backdated: false,
      }));

    return {
      ...base,
      ...raw,
      v: 2,
      theme: raw.theme || 'light',
      density: raw.density === 'compact' ? 'compact' : 'comfortable',
      asOf: null,
      projects: raw.projects || [],
      events,
      filter: raw.filter || null,
      flagFilter: !!raw.flagFilter,
    };
  }

  return {
    TZ, MONTHS, DAYS, uid,
    ymd, addDays, weekdayIndex, weekdayName, mondayOf, weekRange, weekLabel, dayLabel, contains,
    weeksWithActivity, aggregateWeek, groupByProject, summaryLine, toMarkdown, reportFilename,
    shouldLogMove, isDay, makeEvent, rewriteConflict, rewriteDay,
    reindex, applyOrder, sortByProject, defaultBoard, migrate,
    mtOf, pmtOf, existMtOf, clockMax, canon, stampChanges, syncable, validateSyncable, SYNC_V, merge, unionFloor,
    randomSecret, deriveSync, seal, unseal, bytesToB64u, b64uToBytes,
    deriveBlobKey, sealBlob, unsealBlob, newBlobId, BLOB_ID, IMAGE_TYPES, MAX_IMAGE,
    hasV4Data, liveAttachments, imageInfo,
    hasV3Data, teamIdOf, teamNs, isTeamNs, isFutureBoard, exportable, doneByOf, ICONS,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BoardCore;
if (typeof window !== 'undefined') window.BoardCore = BoardCore;
