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
  function aggregateWeek(events, monday, lookup, doneStage) {
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
        };
        rows.set(e.taskId, r);
      }
      if (e.type === 'created') { r.created = true; r.from = 'New'; }
      else r.moves++;
      r.to = e.to;
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
      r.tense = !doneStage ? null
        : (r.to === doneStage && r.from !== doneStage) ? 'shipped'
        : 'inflight';
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

     Tasks carry TWO clocks: `mt` for content (title, notes, session, flag,
     project, archive fields) and `pmt` for placement (columnId, order).
     Without the split, addTask bumping every sibling's order — or one
     "Sort by project" — would stamp whole rows and let a stale device's
     copy beat a real content edit made elsewhere. Placement never fights
     content, and placement never resurrects a deleted card. */

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

  /** Content clock of a task. `updatedAt` seeds boards from before sync. */
  const mtOf = t => t.mt ?? t.updatedAt ?? t.createdAt ?? 0;
  /** Placement clock of a task. */
  const pmtOf = t => t.pmt ?? mtOf(t);

  const taskContent = t => {
    const { mt, pmt, columnId, order, ...content } = t;
    return content;
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
    for (const t of st.tasks || []) m = Math.max(m, mtOf(t), pmtOf(t));
    for (const e of st.events || []) m = Math.max(m, e.mt || 0);
    for (const c of st.columns || []) m = Math.max(m, c.mt || 0);
    for (const p of st.projects || []) m = Math.max(m, p.mt || 0);
    for (const ts of Object.values(st.tombstones || {})) m = Math.max(m, ts);
    return Math.max(m, st.columnsMt || 0, st.projectsMt || 0);
  }

  /**
   * Stamp everything `next` changed since `prev` (the last-saved state).
   * Mutates and returns `next`. New events get no stamp — an appended event
   * is immutable and merges by union; only a rewritten one (rewriteDay)
   * needs a clock to win a collision. Any stamp clears the first-run `seed`
   * marker: a board the user has touched is no longer safe to replace.
   */
  function stampChanges(prev, next, now = Date.now()) {
    const clock = Math.max(now, clockMax(prev) + 1, clockMax(next) + 1);
    let stamped = false;

    const oldTasks = new Map((prev.tasks || []).map(t => [t.id, t]));
    for (const t of next.tasks || []) {
      const before = oldTasks.get(t.id);
      if (!before || canon(taskContent(before)) !== canon(taskContent(t))) { t.mt = clock; stamped = true; }
      if (!before || canon(taskPlacement(before)) !== canon(taskPlacement(t))) { t.pmt = clock; stamped = true; }
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
    ]) {
      const old = new Map((oldList || []).map(c => [c.id, c]));
      for (const c of list || []) {
        const before = old.get(c.id);
        if (!before || canon(itemContent(before)) !== canon(itemContent(c))) { c.mt = clock; stamped = true; }
      }
      // the order VECTOR has its own clock: reorders, adds and deletes move
      // it; a rename alone does not, so a rename can never drag the done
      // line of a concurrent reorder along with it
      const ids = l => (l || []).map(c => c.id).join(' ');
      if (ids(oldList) !== ids(list)) { next[key] = clock; stamped = true; }
    }

    if ((prev.tombstones && Object.keys(prev.tombstones).length) !==
        (next.tombstones && Object.keys(next.tombstones).length)) stamped = true;

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
  const syncable = st => ({
    v: 2,
    columns: st.columns,
    columnsMt: st.columnsMt || 0,
    projects: st.projects,
    projectsMt: st.projectsMt || 0,
    tasks: (st.tasks || []).slice().sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
    tombstones: Object.fromEntries(Object.entries(st.tombstones || {}).sort(([a], [b]) => a < b ? -1 : 1)),
    events: (st.events || []).slice()
      .sort((x, y) => (x.at || 0) - (y.at || 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)),
  });

  /**
   * merge(local, remote) → a fresh board. Local preferences pass through
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
   * - tasks: content by `mt`, placement by `pmt`, independently. A
   *   tombstone deletes unless the CONTENT clock is newer — an edit made
   *   after (or stamped after) the delete wins and the data survives;
   *   a mere reorder never resurrects anything.
   * - events: union by id — the log only ever grows.
   */
  function merge(local, remote) {
    const deep = x => JSON.parse(JSON.stringify(x));
    const a = local || {}, b = remote || {};

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
      const orderWinsA = aMt !== bMt ? aMt > bMt : canon(aIds) >= canon(bIds);
      const winnerIds = orderWinsA ? aIds : bIds;
      const orderMt = Math.max(aMt, bMt);

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
      if (!items.length) items = [...byId.values()]; // never merge a board into zero stages

      // Two boards with separate histories both have an "Inbox" under
      // different ids: keep one, remember the alias so tasks follow it.
      const inWinner = new Set(winnerIds);
      const byName = new Map();
      const alias = new Map();
      for (const c of items) {
        const held = byName.get(c.name);
        if (!held) { byName.set(c.name, c); continue; }
        const keep =
          inWinner.has(held.id) !== inWinner.has(c.id) ? (inWinner.has(held.id) ? held : c)
            : (held.mt || 0) !== (c.mt || 0) ? ((held.mt || 0) > (c.mt || 0) ? held : c)
            : canon(held) >= canon(c) ? held : c;
        const drop = keep === held ? c : held;
        byName.set(c.name, keep);
        alias.set(drop.id, keep.id);
      }
      items = [...byName.values()];

      // the winning vector first (survivors only), then what it never saw —
      // before its last entry for columns, so the done line cannot move
      const itemById = new Map(items.map(c => [c.id, c]));
      const ordered = winnerIds.filter(id => itemById.has(id)).map(id => itemById.get(id));
      const leftovers = items.filter(c => !winnerIds.includes(c.id))
        .sort((x, y) => x.id < y.id ? -1 : 1); // argument-order independent
      if (insertBeforeLast && ordered.length) ordered.splice(ordered.length - 1, 0, ...leftovers);
      else ordered.push(...leftovers);

      return { items: ordered, orderMt, alias };
    }

    const cols = mergeLists(a.columns, b.columns, a.columnsMt || 0, b.columnsMt || 0, true);
    const projs = mergeLists(a.projects, b.projects, a.projectsMt || 0, b.projectsMt || 0, false);

    const ofA = new Map((a.tasks || []).map(t => [t.id, t]));
    const ofB = new Map((b.tasks || []).map(t => [t.id, t]));
    const tasks = [];
    for (const id of new Set([...ofA.keys(), ...ofB.keys()])) {
      const x = ofA.get(id), y = ofB.get(id);
      const pick = (clockOf) => !x ? y : !y ? x
        : clockOf(x) !== clockOf(y) ? (clockOf(x) > clockOf(y) ? x : y)
        : (canon(x) >= canon(y) ? x : y);
      const cw = pick(mtOf);   // content winner
      const pw = pick(pmtOf);  // placement winner
      // Only the CONTENT clock argues with a tombstone: a reorder elsewhere
      // must never resurrect a deliberately deleted card, while an edit (or
      // an undo, which restamps what it brings back) does.
      if (tombstones[id] != null && mtOf(cw) <= tombstones[id]) continue;
      const row = deep(cw);
      if (pw !== cw) {
        row.columnId = pw.columnId;
        row.order = pw.order;
        row.pmt = pmtOf(pw);
      }
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
        if (mapped) t.projectId = mapped;
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
    delete out.seed; // a merged board is never a replaceable first-run seed
    return out;
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

  /* ── storage ─────────────────────────────────────────── */

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
    mtOf, pmtOf, clockMax, canon, stampChanges, syncable, merge,
    randomSecret, deriveSync, seal, unseal, bytesToB64u, b64uToBytes,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BoardCore;
if (typeof window !== 'undefined') window.BoardCore = BoardCore;
