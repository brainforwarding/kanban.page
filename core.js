/* board/core.js — pure logic, no DOM.
   Loaded by index.html as a plain script (global `BoardCore`)
   and by tests/core.test.js through require(). No dependencies. */

const BoardCore = (() => {
  const TZ = 'America/Santiago';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);

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
   * where it ended it. `lookup(taskId)` returns { title, project } for a card
   * that still exists, or null for one that was deleted.
   */
  function aggregateWeek(events, monday, lookup) {
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
      } else {
        // deleted: fall back to what the event remembers, so cleared work does
        // not silently migrate into "No project"
        r.title = r.snapshotTitle;
        r.project = r.snapshotProject || null;
        r.deleted = true;
      }
      // A card that left a stage and came back did no reportable work.
      r.netZero = !r.created && r.from === r.to;
      r.include = !r.netZero;
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

    // The export is the outward-facing report: only work that reached the done
    // stage is announced, title only — the route a card took is board detail.
    // Unassigned cards stay off it too; work worth reporting has a project.
    const finished = (opts.doneStage ? entries.filter(e => e.to === opts.doneStage) : entries)
      .filter(e => e.project);

    if (!finished.length) {
      lines.push(es ? 'No se terminó nada.' : 'Nothing finished.', '');
      return lines.join('\n');
    }

    for (const g of groupByProject(finished, opts.projectOrder)) {
      lines.push(`## ${g.project}`);
      for (const e of g.entries) lines.push(`- ${e.title}`);
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
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BoardCore;
if (typeof window !== 'undefined') window.BoardCore = BoardCore;
