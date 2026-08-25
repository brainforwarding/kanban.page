/* board — local kanban for agent-driven work.
   Everything lives in localStorage. No network, no build step. */

/* ── helpers ───────────────────────────────────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const clone = o => JSON.parse(JSON.stringify(o));
const EASE = 'cubic-bezier(.2,.8,.25,1)';

const ICON = {
  plus:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3.4v9.2M3.4 8h9.2"/></svg>',
  more:  '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.4" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.6" cy="8" r="1.2"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/></svg>',
  copy:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35"><rect x="5.6" y="5.6" width="7" height="7" rx="1.6"/><path d="M10.4 3.4H5.1c-.94 0-1.7.76-1.7 1.7v5.3" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.6 8.5l2.9 2.9 5.9-6.4"/></svg>',
  search:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7.2" cy="7.2" r="4"/><path d="M10.2 10.2l3 3"/></svg>',
  week:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.6" y="3.4" width="10.8" height="10" rx="2"/><path d="M2.6 6.6h10.8" stroke-linecap="round"/><path d="M5.6 9.4v1.6M8 9.4v1.6M10.4 9.4v1.6" stroke-linecap="round"/></svg>',
  left:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9.6 4L5.6 8l4 4"/></svg>',
  right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.4 4l4 4-4 4"/></svg>',
  grip:  '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="6" cy="4.2" r="1.1"/><circle cx="10" cy="4.2" r="1.1"/><circle cx="6" cy="8" r="1.1"/><circle cx="10" cy="8" r="1.1"/><circle cx="6" cy="11.8" r="1.1"/><circle cx="10" cy="11.8" r="1.1"/></svg>',
  star:  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2.5L9.47 6.28 13.52 6.51 10.38 9.07 11.41 12.99 8 10.8 4.59 12.99 5.62 9.07 2.48 6.51 6.53 6.28Z"/></svg>',
  starFill: '<svg viewBox="0 0 16 16" fill="currentColor" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2.5L9.47 6.28 13.52 6.51 10.38 9.07 11.41 12.99 8 10.8 4.59 12.99 5.62 9.07 2.48 6.51 6.53 6.28Z"/></svg>',
};

const COLORS = ['#FFB454', '#7FD1AE', '#8FB8FF', '#F58FA8', '#C79BFF', '#6FD3E8', '#D6C36B', '#9AA5B8'];
const COLOR_NAMES = ['Amber', 'Mint', 'Sky', 'Rose', 'Violet', 'Cyan', 'Gold', 'Slate'];

/* ── state ─────────────────────────────────────────────── */

const C = BoardCore;
const I = BoardI18n;

const LOCALE_KEY = 'board.locale';
let locale = 'en';
try { locale = I.valid(localStorage.getItem(LOCALE_KEY)); } catch (err) { /* English fallback */ }
const tr = (key, vars) => I.t(locale, key, vars);

// ?ns=… gives a board its own storage. Tests use it; so can a scratch board.
const NS = new URLSearchParams(location.search).get('ns');
const KEY = NS ? `board.v2.${NS}` : 'board.v2';
const LEGACY_KEY = NS ? null : 'board.v1';

/** First ever run: one card, so the session line is discoverable. */
function firstRun() {
  const s = C.defaultBoard(locale);
  const now = Date.now();
  const t = {
    id: C.uid(),
    title: locale === 'es' ? 'Arrástrame a otra etapa' : 'Drag me to another stage',
    notes: '',
    projectId: null,
    session: 'claude --resume 2d2bb76b-e6df-46c5-b742-8eab8c3c7303',
    flag: false,
    columnId: s.columns[1].id,
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
  s.tasks.push(t);
  s.events.push(C.makeEvent(
    { taskId: t.id, title: t.title, type: 'created', from: null, to: s.columns[1].name },
    { now }
  ));
  return s;
}

function load() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || (LEGACY_KEY && localStorage.getItem(LEGACY_KEY)) || 'null');
  } catch (err) {
    console.warn('board: could not read storage —', err);
  }
  return raw ? C.migrate(raw) : firstRun();
}

function applyLocale() {
  document.documentElement.lang = locale;
  document.title = 'board';
  $('#q').placeholder = tr('search');
  $('#reportBtn').title = `${tr('report')}  R`;
  $('#newTask').title = `${tr('newTask')}  N`;
  $('#menuBtn').title = tr('more');
  $('#menuBtn').setAttribute('aria-label', tr('more'));
  $('#updateText').textContent = tr('updateAvailable');
  $('#updateBtn').textContent = tr('update');
  $('#toast-undo').textContent = tr('undo');
  $('#editor').setAttribute('aria-label', tr('task'));
  $('#f-title').placeholder = tr('what');
  $('#f-notes').placeholder = tr('notes');
  $('#projectLabel').textContent = tr('project');
  $('#sessionLabel').textContent = tr('session');
  $('#f-session-copy').title = tr('copy');
  $('#f-archive').textContent = tr('archive');
  $('#f-flag').title = tr('flag');
  $('#f-save').textContent = tr('save');
  $('#report').setAttribute('aria-label', tr('weeklyReport'));
  $('#rep-prev').title = tr('previousWeek'); $('#rep-next').title = tr('nextWeek'); $('#rep-close').title = tr('close');
  $('#rep-all').textContent = tr('selectAll'); $('#rep-copy').textContent = tr('copyMarkdown'); $('#rep-save').textContent = tr('download');
  $('#projects').setAttribute('aria-label', tr('projects')); $('#projects h2').textContent = tr('projects');
  $('#proj-name').placeholder = tr('newProject'); $('#proj-add button').textContent = tr('add');
  $('#archive').setAttribute('aria-label', tr('archive')); $('#archive h2').textContent = tr('archive');
  $('#arch-empty').textContent = tr('deleteAll');
  const menuText = { projects: tr('projects'), archive: tr('archive'), theme: tr('theme'), addcol: tr('addStage'), sortproj: tr('sortProject'), export: tr('export'), import: tr('import') };
  Object.entries(menuText).forEach(([act, label]) => {
    const b = $(`[data-act="${act}"]`); if (b) b.childNodes[0].textContent = label;
  });
  const density = $('#act-density');
  if (density) density.childNodes[0].textContent = tr('compact');
  $('#languageLabel').textContent = tr('language');
  $('#languageChoices').setAttribute('aria-label', tr('language'));
  $$('#languageChoices button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.locale === locale)));
}

function setLocale(next) {
  next = I.valid(next);
  if (next === locale) return;
  locale = next;
  try { localStorage.setItem(LOCALE_KEY, locale); } catch (err) { /* session-only */ }
  applyLocale();
  render();
  if (!editor.hidden) openEditor(editing === 'new' ? null : editing);
  if (!panel.hidden) renderProjects();
  if (!archiveEl.hidden) renderArchive();
  if (!reportEl.hidden) renderReport(false);
  $('#menuBtn').focus();
}

let state = load();
applyLocale();
let saveTimer = null;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('board: could not write storage —', err);
      toast('Storage is unavailable — export a backup', null, 8000);
    }
  }, 120);
}

const byId = id => state.tasks.find(t => t.id === id);
const projectOf = t => state.projects.find(p => p.id === t.projectId) || null;
const colName = id => (state.columns.find(c => c.id === id) || {}).name || '';

/** The report's source of truth. Stage names are snapshotted, never referenced. */
function logEvent(task, type, fromColId, toColId) {
  const p = projectOf(task);
  state.events.push(C.makeEvent({
    taskId: task.id,
    title: task.title,
    project: p ? p.name : null, // so a deleted card still reports under its project
    type,
    from: fromColId ? colName(fromColId) : null,
    to: colName(toColId),
  }, { asOf: state.asOf }));
}

/* ── elements ──────────────────────────────────────────── */

const board = $('#board');
const filtersEl = $('#filters');
const scrim = $('#scrim');
const editor = $('#editor');
const panel = $('#projects');
const menu = $('#menu');
const qInput = $('#q');

/* ── PWA updates ───────────────────────────────────────── */

const updateNotice = $('#updateNotice');
const updateBtn = $('#updateBtn');
let pendingWorker = null;
let reloadingForUpdate = false;

function offerUpdate(worker) {
  pendingWorker = worker;
  updateNotice.hidden = false;
}

function installPwa() {
  // `file:` keeps working as the downloadable, no-server version. PWA features
  // activate only from a secure hosted URL (or localhost while developing).
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) location.reload();
  });

  navigator.serviceWorker.register('./sw.js').then(registration => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting);
    }

    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          offerUpdate(worker);
        }
      });
    });

    // Browsers throttle automatic checks; opening the board online should still
    // discover a newly deployed version promptly.
    registration.update().catch(() => {});
  }).catch(err => console.warn('board: service worker registration failed —', err));
}

updateBtn.onclick = () => {
  if (!pendingWorker) return;
  reloadingForUpdate = true;
  pendingWorker.postMessage('skip-waiting');
};

installPwa();

$('#newTask').innerHTML = ICON.plus;
$('#menuBtn').innerHTML = ICON.more;
$('#f-session-copy').innerHTML = ICON.copy;
$('[data-close]', panel).innerHTML = ICON.close;
$('#searchWrap').insertAdjacentHTML('afterbegin', ICON.search);

let query = '';
let composerCol = null;   // column id with an open quick composer
let editing = null;       // task id being edited, or 'new'
let hadFlagpill = false;  // ★ chip presence last render — entrance guard

/* ── FLIP ──────────────────────────────────────────────── */

const stillMotion = matchMedia('(prefers-reduced-motion: reduce)');

let flipStagger = null; // one-shot: taskId → delay ms, consumed by the next flip()

function flip(mutate) {
  // Consume the stagger before any early-out so it can never leak into a
  // later render — search keystrokes and drag retargets must stay instant.
  const stagger = flipStagger;
  flipStagger = null;
  if (stillMotion.matches) { mutate(); return; }

  // Rects are read mid-flight on purpose: an interrupted card animates from
  // where it visually is, not from where it would have landed.
  const before = new Map();
  $$('.card', board).forEach(el => { if (el.dataset.id) before.set(el.dataset.id, el.getBoundingClientRect()); });

  // renderBoard rebuilds the DOM, which would otherwise scroll every column
  // back to the top on any render — including every keystroke in search.
  const scrolled = new Map();
  $$('.col-body', board).forEach(b => scrolled.set(b.parentElement.dataset.id, b.scrollTop));

  mutate();

  $$('.col-body', board).forEach(b => {
    const top = scrolled.get(b.parentElement.dataset.id);
    if (top) b.scrollTop = top;
  });

  const cards = $$('.card', board);

  // Clear residual transforms BEFORE measuring: if a previous run is still
  // playing, its offset sits in both rects and cancels itself out of the delta,
  // and the card then snaps back by whatever distance was left to run.
  cards.forEach(el => el.getAnimations().forEach(anim => anim.cancel()));

  cards.forEach(el => {
    const b = before.get(el.dataset.id);
    if (!b) { el.classList.add('enter'); return; }
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    // fill:'backwards' holds a delayed card at its old rect until its wave
    // breaks (a no-op at zero delay, which is every flip but the sort).
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
      { duration: Math.min(340, 180 + dist * 0.28), easing: EASE,
        delay: stagger ? stagger(el.dataset.id) : 0,
        fill: 'backwards' }
    );
  });
}

/* ── render ────────────────────────────────────────────── */

/** An archived task keeps its row in state.tasks — it only leaves the board. */
const onBoard = t => !t.archivedAt;
const archivedTasks = () => state.tasks.filter(t => t.archivedAt);

function visible(t) {
  if (state.filter && t.projectId !== state.filter) return false;
  if (state.flagFilter && !t.flag) return false;
  if (!query) return true;
  const p = projectOf(t);
  return [t.title, t.notes, t.session, p && p.name]
    .filter(Boolean).join(' ').toLowerCase()
    .includes(query);
}

const tasksIn = colId => state.tasks
  .filter(t => t.columnId === colId && onBoard(t) && visible(t))
  .sort((a, b) => a.order - b.order);

function render() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.density = state.density;
  renderFilters();
  flip(renderBoard);
}

const boardIsEmpty = () => !state.tasks.some(onBoard);

function renderFilters() {
  filtersEl.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'pill';
  all.setAttribute('aria-pressed', String(!state.filter && !state.flagFilter));
  all.textContent = tr('all'); // no dot: the dot means "a project", and All is not one
  all.onclick = () => { state.filter = null; state.flagFilter = false; save(); render(); };
  filtersEl.append(all);

  // The ★ chip is pinned beside All so a long project list can never scroll
  // it out of reach — but no standing chrome: it only exists while something
  // is flagged (or the filter is on, so it can be turned off). It is a
  // category of its own, not a modifier: the row holds one selection, so
  // pressing ★ releases All or the active project, and they release ★.
  const flagged = state.tasks.filter(t => t.flag && onBoard(t)).length;
  const showFlagpill = flagged > 0 || !!state.flagFilter;
  if (showFlagpill) {
    const fp = document.createElement('button');
    // .enter only on the absent→present transition; the hundreds of rebuilds
    // where the chip merely persists recreate it bare (see flip's .enter)
    fp.className = 'pill flagpill' + (hadFlagpill ? '' : ' enter');
    fp.title = tr('flagged');
    fp.setAttribute('aria-pressed', String(!!state.flagFilter));
    fp.innerHTML = `${ICON.starFill}<span style="color:var(--faint);font:400 10.5px var(--mono)">${flagged}</span>`;
    fp.onclick = () => { state.flagFilter = !state.flagFilter; if (state.flagFilter) state.filter = null; save(); render(); };
    filtersEl.append(fp);
  }
  hadFlagpill = showFlagpill;

  state.projects.forEach(p => {
    const n = state.tasks.filter(t => t.projectId === p.id && onBoard(t)).length;
    const b = document.createElement('button');
    b.className = 'pill';
    b.style.setProperty('--c', p.color);
    b.setAttribute('aria-pressed', String(state.filter === p.id));
    b.innerHTML = `<span class="dot"></span>${esc(p.name)}${n ? ` <span style="color:var(--faint);font:400 10.5px var(--mono)">${n}</span>` : ''}`;
    b.onclick = () => { state.filter = state.filter === p.id ? null : p.id; state.flagFilter = false; save(); render(); };
    filtersEl.append(b);
  });

  const add = document.createElement('button');
  add.className = 'pill add';
  add.title = 'Projects  P';
  add.innerHTML = ICON.plus;
  add.onclick = openProjects;
  filtersEl.append(add);
}

function renderBoard() {
  board.innerHTML = '';

  state.columns.forEach(col => {
    const items = tasksIn(col.id);
    const total = state.tasks.filter(t => t.columnId === col.id && onBoard(t)).length;

    const el = document.createElement('section');
    el.className = 'col';
    el.dataset.id = col.id;
    el.innerHTML = `
      <div class="col-head">
        <span class="col-name" contenteditable="plaintext-only" spellcheck="false">${esc(col.name)}</span>
        <span class="col-count">${items.length}</span>
        <span class="grow"></span>
        <button class="icon sm" data-add title="${tr('newTask')}">${ICON.plus}</button>
        ${total === 0 && state.columns.length > 1 ? `<button class="icon sm" data-del title="${tr('delete')} ${tr('task')}">${ICON.close}</button>` : ''}
      </div>
      <div class="col-body"></div>`;

    const body = $('.col-body', el);
    if (composerCol === col.id) body.append(composerEl(col.id));
    items.forEach(t => body.append(cardEl(t)));

    // An empty board is one blinking cursor where the first card's title goes.
    // A cursor means type, and needs no caption.
    if (col === state.columns[0] && composerCol === null && boardIsEmpty()) {
      const ph = document.createElement('button');
      ph.className = 'phantom';
      ph.title = 'New task';
      ph.innerHTML = '<span class="tcursor"></span>';
      ph.onclick = () => openComposer(col.id);
      body.append(ph);
    }

    $('[data-add]', el).onclick = () => openComposer(col.id);
    const del = $('[data-del]', el);
    if (del) del.onclick = () => deleteColumn(col.id);

    const name = $('.col-name', el);
    name.addEventListener('blur', () => {
      const v = name.textContent.trim();
      col.name = v || col.name;
      name.textContent = col.name;
      save();
    });
    name.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      if (e.key === 'Escape') { name.textContent = col.name; name.blur(); }
    });

    board.append(el);
  });

  // Adding a stage is a once-a-year action, so it gets no standing chrome:
  // a hairline affordance that only appears when the pointer is on the board,
  // plus "Add stage" in the ⋯ menu, which is its real home.
  const ghost = document.createElement('div');
  ghost.className = 'col ghost-col';
  ghost.innerHTML = `<button class="add-col" title="Add stage">${ICON.plus}</button>`;
  $('.add-col', ghost).onclick = addColumn;
  board.append(ghost);
}

function cardEl(t) {
  const p = projectOf(t);
  const el = document.createElement('article');
  el.className = 'card';
  el.dataset.id = t.id;
  el.tabIndex = 0;
  if (p) el.style.setProperty('--c', p.color);

  const since = age(t.updatedAt);

  el.innerHTML = `
    <span class="edge"></span>
    <button class="flag" title="${t.flag ? 'Unflag' : 'Flag  F'}" aria-pressed="${t.flag ? 'true' : 'false'}">${t.flag ? ICON.starFill : ICON.star}</button>
    <h3>${esc(t.title)}</h3>
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ''}
    ${p || since ? `<div class="meta">
        ${p ? `<span class="proj">${esc(p.name)}</span>` : ''}
        <span class="grow"></span>
        ${since ? `<span class="age" title="Untouched for ${since}">${since}</span>` : ''}
      </div>` : ''}
    ${t.session ? `<button class="chip" title="Copy session command">
        <span class="caret">&#9656;</span>
        <span class="cmd">${esc(t.session)}</span>
        <span class="ci">${ICON.copy}</span>
      </button>` : ''}`;

  const chip = $('.chip', el);
  if (chip) chip.onclick = e => { e.stopPropagation(); copyChip(chip, t.session); };
  $('.flag', el).onclick = e => { e.stopPropagation(); toggleFlag(t.id); };

  el.addEventListener('keydown', e => {
    if (e.target !== el) return; // buttons inside the card keep their own keys
    if (e.key === 'Enter') { e.preventDefault(); openEditor(t.id); }
    if (e.key === 'f') { e.preventDefault(); toggleFlag(t.id); }
    if (e.altKey && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(t.id, e.key); }
    if (e.key === 'c' && chip) { e.preventDefault(); copyChip(chip, t.session); }
  });

  return el;
}

function composerEl(colId) {
  const el = document.createElement('div');
  el.className = 'composer';
  el.innerHTML = `<textarea rows="1" placeholder="${tr('what')}" spellcheck="false"></textarea>`;
  const ta = $('textarea', el);

  const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
  ta.addEventListener('input', grow);

  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const title = ta.value.trim();
      if (!title) { closeComposer(); return; }
      addTask({ title, columnId: colId });
      ta.value = '';
      grow();
    }
    if (e.key === 'Escape') { e.preventDefault(); closeComposer({ discard: true }); }
  });

  // Leaving the composer never loses words: closeComposer saves whatever was
  // typed, so the field simply becomes the card, in place. Deferred, because
  // a re-render blurs this textarea mid-teardown while it still reads as
  // connected — after the dust settles, detached means a render swap, and
  // connected means the user actually left.
  ta.addEventListener('blur', () => setTimeout(() => {
    if (ta.isConnected) closeComposer();
  }, 0));
  requestAnimationFrame(() => ta.focus());
  return el;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** How long a card has sat untouched. A nine-day-old session may not resume,
    which is the one thing the card could not otherwise tell you. */
function age(ts) {
  const days = Math.floor((Date.now() - (ts || Date.now())) / 86400000);
  if (days < 1) return '';
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

/* ── tasks ─────────────────────────────────────────────── */

function addTask(patch) {
  const now = Date.now();
  const t = {
    id: uid(), title: '', notes: '', projectId: state.filter || null,
    session: '', flag: state.flagFilter || false, columnId: state.columns[0].id,
    order: 0, createdAt: now, updatedAt: now, ...patch,
  };
  state.tasks.filter(x => x.columnId === t.columnId).forEach(x => x.order += 1);
  t.order = 0;
  state.tasks.push(t);
  logEvent(t, 'created', null, t.columnId);
  save();
  render();
  return t;
}

function openComposer(colId) {
  composerCol = colId;
  render();
}

/** Closing = saving. Every way out of the composer — clicking a card, the
    background, another panel — commits the draft; only Esc throws it away. */
function closeComposer({ discard = false } = {}) {
  if (composerCol === null) return;
  const ta = $('.composer textarea', board);
  const title = !discard && ta ? ta.value.trim() : '';
  const colId = composerCol;
  composerCol = null;
  if (title) addTask({ title, columnId: colId }); // addTask saves and renders
  else render();
}

function nudge(id, key) {
  const t = byId(id);
  if (!t) return;
  const ci = state.columns.findIndex(c => c.id === t.columnId);
  const peers = tasksIn(t.columnId);
  const i = peers.indexOf(t);

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const next = state.columns[ci + (key === 'ArrowRight' ? 1 : -1)];
    if (!next) return;
    const from = t.columnId;
    t.columnId = next.id;
    t.order = -1;
    resequence(next.id);
    logEvent(t, 'moved', from, next.id);
  } else {
    const j = i + (key === 'ArrowDown' ? 1 : -1);
    if (j < 0 || j >= peers.length) return;
    const other = peers[j];
    [t.order, other.order] = [other.order, t.order];
  }
  t.updatedAt = Date.now();
  save();
  render();
  const el = board.querySelector(`.card[data-id="${id}"]`);
  if (el) el.focus();
}

const resequence = colId => C.reindex(state.tasks, colId);

/** One shot, stable, undoable: group every column into project order,
    unassigned last, keeping the hand order within each group. Tidying the
    desk is planning, not work — no event, no updatedAt, the report never
    knows. */
function sortBoard() {
  snapshot();
  // Stagger the FLIP by project index so the rule is visible as it executes:
  // the first project's cards break first in every column, the next wave
  // ~45ms later, unassigned settle last — the whole choreography ≤ ~600ms.
  // One-shot: the next flip() consumes it, so no other render ever staggers.
  const wave = new Map(state.projects.map((p, i) => [p.id, i]));
  const last = state.projects.length;
  const step = Math.min(45, 260 / (last + 1));
  const delays = new Map(state.tasks.map(t =>
    [t.id, step * (wave.has(t.projectId) ? wave.get(t.projectId) : last)]));
  flipStagger = id => delays.get(id) || 0;
  C.sortByProject(state.tasks, state.projects.map(p => p.id));
  save();
  render();
  // The board motion is the feedback; the toast is the receipt and the Undo
  // affordance — let it arrive once the dust has settled, not mid-flight.
  setTimeout(() => toast(tr('sorted'), undo), stillMotion.matches ? 0 : 300);
}

/** The release half of the press the CSS starts (:active compresses the
    button): a one-shot pop on a freshly built star SVG, fired imperatively
    so no later render can replay it. Unstarring is an erasure — quicker,
    quieter, never celebrated. The fill swap itself stays instant. */
function popStar(svg, on) {
  if (!svg || stillMotion.matches) return;
  svg.animate(
    on ? [{ transform: 'scale(.55)' }, { transform: 'scale(1)' }]
       : [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
    { duration: on ? 220 : 140, easing: EASE }
  );
}

/** Flagging is planning, not work: no event is logged and the age stamp does
    not reset, so the report and "untouched for" never see it. */
function toggleFlag(id) {
  const t = byId(id);
  if (!t) return;
  t.flag = !t.flag;
  save();
  render();
  const el = board.querySelector(`.card[data-id="${id}"]`);
  if (el) {
    el.focus();
    popStar($('.flag svg', el), t.flag);
  }
  // unstarring under the ★ filter removes the card — the siblings' FLIP
  // explains that; there is nothing left to pop
}

/* ── copy ──────────────────────────────────────────────── */

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

const copyTimers = new WeakMap();

/** The command stays on screen — hiding it is hiding the thing being confirmed.
    The wash and the check carry the confirmation instead. */
async function copyChip(chip, text) {
  const ok = await copyText(text);
  if (!ok) { toast(tr('couldNotCopy')); return; }

  const ci = $('.ci', chip);
  clearTimeout(copyTimers.get(chip));
  chip.classList.remove('copied');
  void chip.offsetWidth; // restart the wash on a repeat click
  chip.classList.add('copied');
  if (ci) ci.innerHTML = ICON.check;

  copyTimers.set(chip, setTimeout(() => {
    chip.classList.remove('copied');
    if (ci) ci.innerHTML = ICON.copy;
  }, 1150));
}

/* ── drag ──────────────────────────────────────────────── */

let drag = null;
let dragRAF = null;
let lastPointer = { x: 0, y: 0 };

board.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  const card = e.target.closest('.card');
  if (!card || e.target.closest('.chip') || e.target.closest('.flag')) return;

  const sx = e.clientX, sy = e.clientY;
  let started = false;

  const move = ev => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      started = true;
      beginDrag(card, sx, sy);
    }
    lastPointer = { x: ev.clientX, y: ev.clientY };
    moveDrag(ev);
  };

  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    if (started) endDrag();
    else openEditor(card.dataset.id);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
});

function beginDrag(card, sx, sy) {
  const r = card.getBoundingClientRect();

  const wrap = document.createElement('div');
  wrap.className = 'card-ghost-wrap';
  const ghost = card.cloneNode(true);
  ghost.className = 'card card-ghost'; // drop any entrance animation the clone inherited
  ghost.style.width = r.width + 'px';
  wrap.append(ghost);
  wrap.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
  document.body.append(wrap);
  void ghost.offsetWidth; // flush layout so the lift has a value to transition from
  ghost.classList.add('lift');

  card.style.height = r.height + 'px';
  card.classList.add('dragging-src');
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';

  // pivot around the point being held, so the tilt reads as weight
  wrap.style.transformOrigin = `${sx - r.left}px ${sy - r.top}px`;
  board.classList.add('dragging');

  const task = byId(card.dataset.id);
  drag = {
    card, wrap, ghost,
    ox: sx - r.left, oy: sy - r.top,
    fromCol: task ? task.columnId : null,
    px: sx, vx: 0,
  };
  lastPointer = { x: sx, y: sy };
  dragRAF = requestAnimationFrame(dragFrame);
}

function place() {
  const tilt = Math.max(-4.5, Math.min(4.5, drag.vx * 0.25));
  drag.wrap.style.transform =
    `translate3d(${lastPointer.x - drag.ox}px, ${lastPointer.y - drag.oy}px, 0) rotate(${tilt.toFixed(2)}deg)`;
}

function moveDrag(ev) {
  if (!drag) return;
  drag.vx = drag.vx * 0.82 + (ev.clientX - drag.px) * 0.18;
  drag.px = ev.clientX;
  place();
  retarget(ev.clientX, ev.clientY);
}

function retarget(x, y) {
  const cols = $$('.col:not(.ghost-col)', board);
  let target = null;
  for (const c of cols) {
    const r = c.getBoundingClientRect();
    if (x >= r.left - 7 && x <= r.right + 7) { target = c; break; }
  }
  if (!target) target = drag.card.closest('.col');
  if (!target) return;

  const body = $('.col-body', target);
  $$('.col-body', board).forEach(b => b.classList.toggle('over', b === body));

  const cards = $$('.card', body).filter(c => c !== drag.card);
  let before = null;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) { before = c; break; }
  }

  const same = drag.card.parentElement === body &&
    (before ? drag.card.nextElementSibling === before : drag.card === body.lastElementChild);
  if (same) return;

  flip(() => body.insertBefore(drag.card, before));
}

/** One frame of the drag: settle the tilt, edge-scroll, re-aim. */
function dragFrame(now) {
  if (!drag) return;
  const dt = Math.min(2.5, (now - (drag.last || now)) / 16.67) || 1; // 60Hz units
  drag.last = now;

  // decay the tilt even while the pointer is still, so it never freezes askew
  if (Math.abs(drag.vx) > 0.05) {
    drag.vx *= Math.pow(0.86, dt);
    place();
  }

  const { x, y } = lastPointer;
  const zone = 70, speed = 14 * dt;
  let scrolled = false;

  const body = document.elementFromPoint(x, y)?.closest('.col-body');
  if (body) {
    const r = body.getBoundingClientRect();
    if (y - r.top < zone) { body.scrollTop -= speed * (1 - (y - r.top) / zone); scrolled = true; }
    else if (r.bottom - y < zone) { body.scrollTop += speed * (1 - (r.bottom - y) / zone); scrolled = true; }
  }
  const br = board.getBoundingClientRect();
  if (x - br.left < zone) { board.scrollLeft -= speed * (1 - (x - br.left) / zone); scrolled = true; }
  else if (br.right - x < zone) { board.scrollLeft += speed * (1 - (br.right - x) / zone); scrolled = true; }

  // the content moved under a still pointer, so the drop index is now stale
  if (scrolled) retarget(x, y);

  dragRAF = requestAnimationFrame(dragFrame);
}

function endDrag() {
  if (!drag) return;
  cancelAnimationFrame(dragRAF);

  const { wrap, ghost } = drag;
  const movedId = drag.card.dataset.id;
  const fromCol = drag.fromCol;
  const from = wrap.style.transform;
  const gr = ghost.getBoundingClientRect(); // where the ghost is right now

  drag.card.classList.remove('dragging-src');
  drag.card.style.height = '';
  $$('.col-body', board).forEach(b => b.classList.remove('over'));
  board.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';

  commitOrder(movedId);
  const t = byId(movedId);
  if (t && C.shouldLogMove(fromCol, t.columnId)) logEvent(t, 'moved', fromCol, t.columnId);

  drag = null;
  save();
  render(); // settle the real board first, so the ghost has a true rect to fly to

  const landed = board.querySelector(`.card[data-id="${movedId}"]`);
  if (!landed || stillMotion.matches) { wrap.remove(); return; }

  // Hold the real card back until the ghost has landed on it — otherwise both
  // are on screen for the length of the flight and the card appears twice.
  landed.classList.add('landing');
  const r = landed.getBoundingClientRect();
  ghost.classList.remove('lift');

  const dist = Math.hypot(r.left - gr.left, r.top - gr.top);
  const flight = wrap.animate(
    [{ transform: from }, { transform: `translate3d(${r.left}px, ${r.top}px, 0) rotate(0deg)` }],
    { duration: dist < 24 ? 120 : 220, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
  );
  const settle = () => {
    wrap.remove();
    landed.classList.remove('landing');
  };
  flight.finished.then(settle).catch(settle);
  // animations pause in a backgrounded tab, so `finished` may never arrive —
  // never leave a ghost stuck over the board waiting for it
  setTimeout(settle, 600);
}

function commitOrder(movedId) {
  $$('.col:not(.ghost-col)', board).forEach(col => {
    C.applyOrder(state.tasks, col.dataset.id, $$('.card', col).map(c => c.dataset.id));
  });
  const t = byId(movedId);
  if (t) t.updatedAt = Date.now();
}

/* ── columns ───────────────────────────────────────────── */

function addColumn() {
  state.columns.push({ id: uid(), name: 'New stage' });
  save();
  render();
  const last = board.querySelector('.col:nth-last-child(2) .col-name');
  if (last) {
    last.focus();
    const range = document.createRange();
    range.selectNodeContents(last);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function deleteColumn(id) {
  if (state.columns.length <= 1) return;
  snapshot();
  state.columns = state.columns.filter(c => c.id !== id);
  save();
  render();
  toast(tr('stageDeleted'), undo);
}

/* ── editor ────────────────────────────────────────────── */

const fTitle = $('#f-title');
const fNotes = $('#f-notes');
const fSession = $('#f-session');
const fStage = $('#f-stage');
const fProject = $('#f-project');
const fFlag = $('#f-flag');

let draft = null;

function openEditor(id, colId) {
  closeComposer();
  const t = id ? byId(id) : null;
  editing = t ? t.id : 'new';
  draft = t ? clone(t) : {
    title: '', notes: '', projectId: state.filter || null, session: '',
    flag: state.flagFilter || false, columnId: colId || state.columns[0].id,
  };

  fTitle.value = draft.title;
  fNotes.value = draft.notes || '';
  fSession.value = draft.session || '';
  $('#f-archive').style.visibility = t ? 'visible' : 'hidden';
  renderStage();
  renderProjectChooser();
  syncFlagBtn();

  scrim.hidden = false;
  editor.hidden = false;
  autogrow(fTitle);
  requestAnimationFrame(() => fTitle.focus());
}

function renderStage() {
  fStage.innerHTML = '';
  state.columns.forEach(c => {
    const b = document.createElement('button');
    b.textContent = c.name;
    b.setAttribute('aria-pressed', String(draft.columnId === c.id));
    b.onclick = () => { draft.columnId = c.id; renderStage(); };
    fStage.append(b);
  });
}

function renderProjectChooser() {
  fProject.innerHTML = '';
  const none = document.createElement('button');
  none.className = 'pill';
  none.textContent = tr('none');
  none.setAttribute('aria-pressed', String(!draft.projectId));
  none.onclick = () => { draft.projectId = null; renderProjectChooser(); };
  fProject.append(none);

  state.projects.forEach(p => {
    const b = document.createElement('button');
    b.className = 'pill';
    b.style.setProperty('--c', p.color);
    b.setAttribute('aria-pressed', String(draft.projectId === p.id));
    b.innerHTML = `<span class="dot"></span>${esc(p.name)}`;
    b.onclick = () => { draft.projectId = p.id; renderProjectChooser(); };
    fProject.append(b);
  });

  const add = document.createElement('button');
  add.className = 'pill add';
  add.title = 'Projects';
  add.innerHTML = ICON.plus;
  add.onclick = () => { closeEditor(); openProjects(); };
  fProject.append(add);
}

function syncFlagBtn() {
  fFlag.setAttribute('aria-pressed', String(!!draft.flag));
  fFlag.innerHTML = draft.flag ? ICON.starFill : ICON.star;
  fFlag.title = draft.flag ? tr('unflag') : tr('flag');
}

function saveEditor() {
  draft.title = fTitle.value.trim();
  draft.notes = fNotes.value.trim();
  draft.session = fSession.value.trim();

  if (!draft.title) { closeEditor(); return; }

  if (editing === 'new') {
    addTask(draft);
  } else {
    const t = byId(editing);
    if (t) {
      const from = t.columnId;
      const moved = C.shouldLogMove(from, draft.columnId);
      Object.assign(t, draft, { updatedAt: Date.now() });
      if (moved) {
        t.order = -1;
        resequence(t.columnId);
        logEvent(t, 'moved', from, t.columnId);
      }
    }
    save();
    render();
  }
  closeEditor();
}

function closeEditor() {
  editor.hidden = true;
  editing = null;
  draft = null;
  syncScrim();
}

$('#f-save').onclick = saveEditor;
fFlag.onclick = () => { draft.flag = !draft.flag; syncFlagBtn(); popStar($('svg', fFlag), draft.flag); };
$('#f-session-copy').onclick = async () => {
  if (!fSession.value.trim()) return;
  const ok = await copyText(fSession.value.trim());
  const wrap = $('#f-session-wrap');
  const btn = $('#f-session-copy');
  if (!ok) return;
  wrap.classList.add('copied');
  btn.innerHTML = ICON.check;
  setTimeout(() => { wrap.classList.remove('copied'); btn.innerHTML = ICON.copy; }, 1200);
};
$('#f-archive').onclick = () => {
  const t = byId(editing);
  closeEditor();
  if (!t) return;
  archiveTasks([t]);
  toast(tr('taskArchived'), undo);
};

fTitle.addEventListener('input', () => autogrow(fTitle));
[fTitle, fNotes, fSession].forEach(el => el.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEditor(); }
  if (e.key === 'Enter' && el !== fNotes && !e.shiftKey) { e.preventDefault(); saveEditor(); }
}));

function autogrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* ── projects ──────────────────────────────────────────── */

let openSwatch = null;

function openProjects() {
  panel.hidden = false;
  scrim.hidden = false;
  renderProjects();
  requestAnimationFrame(() => $('#proj-name').focus());
}

function closeProjects() {
  panel.hidden = true;
  openSwatch = null;
  syncScrim();
}

function renderProjects() {
  const list = $('#proj-list');
  list.innerHTML = '';

  if (!state.projects.length) {
    list.innerHTML = `<p style="margin:18px 8px;font:400 12.5px/1.6 var(--ui);color:var(--faint)">
      ${locale === 'es' ? 'Añade los repositorios y clientes en los que trabajas. Se convierten en filtros arriba y en un selector para cada tarea.' : 'Add the repos and clients you work on. They become filters up top and a picker on every task.'}</p>`;
  }

  state.projects.forEach(p => {
    const n = state.tasks.filter(t => t.projectId === p.id).length;
    const row = document.createElement('div');
    row.className = 'prow';
    row.dataset.id = p.id;
    row.style.setProperty('--c', p.color);

    // Picking a color morphs the row into the eight choices, blooming from
    // where the swatch sits — the list never shifts. Any pick closes it, so
    // the current color doubles as the way out.
    if (openSwatch === p.id) {
      row.classList.add('picking');
      row.innerHTML = `
        <button class="grab" title="Drag to reorder">${ICON.grip}</button>
        <div class="palette">${COLORS.map((c, i) =>
          `<button style="--c:${c}" aria-pressed="${c === p.color}" title="${COLOR_NAMES[i]}"></button>`).join('')}</div>`;

      $$('.palette button', row).forEach((b, i) => b.onclick = () => {
        p.color = COLORS[i];
        openSwatch = null;
        save(); render(); renderProjects();
      });
    } else {
      row.innerHTML = `
        <button class="grab" title="Drag to reorder">${ICON.grip}</button>
        <button class="swatch" title="Change color"></button>
        <input value="${esc(p.name)}" spellcheck="false">
        <span class="n">${n}</span>
        <button class="icon sm" title="Delete">${ICON.close}</button>`;

      $('input', row).addEventListener('change', e => { p.name = e.target.value.trim() || p.name; save(); render(); renderProjects(); });
      $('.swatch', row).onclick = () => { openSwatch = p.id; renderProjects(); };
      $('.icon', row).onclick = () => {
        snapshot();
        state.projects = state.projects.filter(x => x.id !== p.id);
        state.tasks.forEach(t => { if (t.projectId === p.id) t.projectId = null; });
        if (state.filter === p.id) state.filter = null;
        save(); render(); renderProjects();
        toast(tr('projectDeleted'), () => { undo(); renderProjects(); });
      };
    }

    $('.grab', row).onpointerdown = ev => dragProjectRow(ev, row);
    list.append(row);
  });
}

/** Reorder a project by dragging its handle. This order is the project order
    everywhere: the filter chips, the report modal, and the exported markdown.
    Same body language as a card drag: the row lifts into a ghost that follows
    the pointer, the other rows step aside, and the ghost flies into its slot. */
function dragProjectRow(ev, srcRow) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const list = $('#proj-list');
  const id = srcRow.dataset.id;

  // An open color picker changes row shapes mid-drag; fold it away first.
  if (openSwatch) { openSwatch = null; renderProjects(); }
  const row = list.querySelector(`.prow[data-id="${id}"]`);
  if (!row) return;

  const r = row.getBoundingClientRect();
  const wrap = document.createElement('div');
  wrap.className = 'prow-ghost-wrap';
  const ghost = row.cloneNode(true);
  ghost.classList.add('prow-ghost');
  ghost.style.width = r.width + 'px';
  wrap.append(ghost);
  wrap.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
  wrap.style.transformOrigin = `${ev.clientX - r.left}px ${ev.clientY - r.top}px`;
  document.body.append(wrap);
  void ghost.offsetWidth; // flush layout so the lift has a value to transition from
  ghost.classList.add('lift');

  row.style.height = r.height + 'px';
  row.classList.add('drag-src');
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';

  const oy = ev.clientY - r.top;
  let lastY = ev.clientY, py = ev.clientY, vy = 0, raf = null;

  const place = () => {
    const tilt = Math.max(-2.5, Math.min(2.5, vy * 0.2));
    wrap.style.transform =
      `translate3d(${r.left}px, ${lastY - oy}px, 0) rotate(${tilt.toFixed(2)}deg)`;
  };

  const retarget = y => {
    const others = [...list.querySelectorAll('.prow')].filter(x => x !== row);
    const next = others.find(o => {
      const b = o.getBoundingClientRect();
      return y < b.top + b.height / 2;
    });
    const same = next ? row.nextElementSibling === next : row === list.lastElementChild;
    if (same) return;
    const before = new Map(others.map(o => [o.dataset.id, o.getBoundingClientRect().top]));
    if (next) list.insertBefore(row, next); else list.append(row);
    if (stillMotion.matches) return;
    others.forEach(o => {
      const dy = before.get(o.dataset.id) - o.getBoundingClientRect().top;
      if (dy) o.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: 190, easing: EASE });
    });
  };

  const move = e => {
    vy = vy * 0.8 + (e.clientY - py) * 0.2;
    py = e.clientY;
    lastY = e.clientY;
    place();
    retarget(e.clientY);
  };

  // Settle the tilt and edge-scroll the list even while the pointer is still.
  const frame = () => {
    if (Math.abs(vy) > 0.05) { vy *= 0.86; place(); }
    const lr = list.getBoundingClientRect();
    const zone = 48;
    if (lastY - lr.top < zone) {
      list.scrollTop -= 10 * (1 - (lastY - lr.top) / zone);
      retarget(lastY);
    } else if (lr.bottom - lastY < zone) {
      list.scrollTop += 10 * (1 - (lr.bottom - lastY) / zone);
      retarget(lastY);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    cancelAnimationFrame(raf);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    const order = [...list.querySelectorAll('.prow')].map(x => x.dataset.id);
    const before = state.projects.map(x => x.id).join();
    state.projects.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (state.projects.map(x => x.id).join() !== before) { save(); render(); }

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      wrap.remove();
      renderProjects();
    };
    if (stillMotion.matches) { settle(); return; }

    const target = row.getBoundingClientRect();
    ghost.classList.remove('lift');
    const flight = wrap.animate(
      [{ transform: wrap.style.transform },
       { transform: `translate3d(${target.left}px, ${target.top}px, 0) rotate(0deg)` }],
      { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }
    );
    flight.finished.then(settle).catch(settle);
    // animations pause in a backgrounded tab — never leave a ghost stuck
    setTimeout(settle, 500);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
}

$('#proj-add').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#proj-name');
  const name = input.value.trim();
  if (!name) return;
  state.projects.push({ id: uid(), name, color: COLORS[state.projects.length % COLORS.length] });
  input.value = '';
  save();
  render();
  renderProjects();
});

$('[data-close]', panel).onclick = closeProjects;

/* ── archive panel ─────────────────────────────────────── */

const archiveEl = $('#archive');
const archList = $('#arch-list');
const archEmptyBtn = $('#arch-empty');

$('[data-close]', archiveEl).innerHTML = ICON.close;

/** Task ids whose Delete is armed — a second click within ARM_MS commits. */
const armed = new Set();
const ARM_MS = 3200;
let armTimer = null;

function arm(key, redraw) {
  armed.add(key);
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { armed.clear(); redraw(); }, ARM_MS);
  redraw();
}

function disarm() {
  clearTimeout(armTimer);
  armed.clear();
}

function openArchive() {
  closeComposer();
  archiveEl.hidden = false;
  scrim.hidden = false;
  disarm();
  renderArchive();
}

function closeArchive() {
  archiveEl.hidden = true;
  disarm();
  syncScrim();
}

/** Human-scale stamp: today and yesterday read as words, older as a date. */
function archStamp(ms) {
  const day = C.ymd(ms);
  const today = C.ymd();
  if (day === today) return tr('today');
  if (day === C.addDays(today, -1)) return tr('yesterday');
  return day;
}

function renderArchive() {
  const items = archivedTasks().sort((a, b) => b.archivedAt - a.archivedAt);
  archList.innerHTML = '';
  archEmptyBtn.hidden = items.length === 0;
  archEmptyBtn.textContent = armed.has('all') ? `${tr('deleteAll')} — ${tr('sure')}` : tr('deleteAll');
  archEmptyBtn.classList.toggle('armed', armed.has('all'));
  $('#arch-n').textContent = items.length
    ? `${items.length} ${locale === 'es' ? (items.length === 1 ? 'tarea' : 'tareas') : (items.length === 1 ? 'task' : 'tasks')}`
    : '';

  if (!items.length) {
    archList.innerHTML = `<p style="margin:18px 8px;font:400 12.5px/1.6 var(--ui);color:var(--faint)">
      ${tr('noArchived')} ${locale === 'es' ? '¿Terminaste una etapa? <b style="font-weight:600">Archivar ' : 'Finished with a stage? <b style="font-weight:600">Archive '}${
        esc((state.columns[state.columns.length - 1] || {}).name || 'done').toLowerCase()
      }</b>${locale === 'es' ? ' en el menú ⋯ la quita del tablero sin perder el registro; el informe semanal la conserva.</p>' : ' in the ⋯ menu clears it off the board without losing the record — your weekly report still counts it.</p>'}`;
    return;
  }

  items.forEach(t => {
    const p = projectOf(t);
    const isArmed = armed.has(t.id);
    const row = document.createElement('div');
    row.className = 'arow';
    if (p) row.style.setProperty('--c', p.color);
    row.innerHTML = `
      <span class="edge"${p ? '' : ' hidden'}></span>
      <div class="atext">
        <span class="atitle">${esc(t.title || tr('untitled'))}</span>
        <span class="ameta">${esc(t.archivedFrom || '—')} · ${archStamp(t.archivedAt)}</span>
      </div>
      <button class="ghost sm" data-restore>${tr('restore')}</button>
      <button class="ghost sm danger${isArmed ? ' armed' : ''}" data-del>${isArmed ? tr('sure') : tr('delete')}</button>`;

    $('[data-restore]', row).onclick = () => { disarm(); restoreTask(t.id); };
    $('[data-del]', row).onclick = () => {
      if (armed.has(t.id)) { disarm(); deleteForever([t.id]); return; }
      arm(t.id, renderArchive);
    };
    archList.append(row);
  });
}

archEmptyBtn.onclick = () => {
  if (armed.has('all')) {
    disarm();
    deleteForever(archivedTasks().map(t => t.id));
    return;
  }
  arm('all', renderArchive);
};

$('[data-close]', archiveEl).onclick = closeArchive;

/* ── menu, backup, theme ───────────────────────────────── */

$('#menuBtn').onclick = e => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
  $('#menuBtn').setAttribute('aria-expanded', String(!menu.hidden));
};

document.addEventListener('click', e => {
  if (!menu.hidden && !e.target.closest('#menu') && !e.target.closest('#menuBtn')) {
    menu.hidden = true;
    $('#menuBtn').setAttribute('aria-expanded', 'false');
  }
});

menu.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.locale) { menu.hidden = true; $('#menuBtn').setAttribute('aria-expanded', 'false'); setLocale(b.dataset.locale); return; }
  menu.hidden = true;
  $('#menuBtn').setAttribute('aria-expanded', 'false');
  const act = b.dataset.act;
  if (act === 'projects') openProjects();
  if (act === 'archive') openArchive();
  if (act === 'theme') toggleTheme();
  if (act === 'density') toggleDensity();
  if (act === 'addcol') addColumn();
  if (act === 'sortproj') sortBoard();
  if (act === 'archive-last') archiveLastColumn();
  if (act === 'export') exportBackup();
  if (act === 'import') $('#importFile').click();
});

// The menu is the only place that names the last stage, so label it live.
$('#menuBtn').addEventListener('click', () => {
  const col = state.columns[state.columns.length - 1];
  const n = col ? state.tasks.filter(t => t.columnId === col.id && onBoard(t)).length : 0;
  $('#act-archive-last').textContent = col
    ? `Archive ${col.name.toLowerCase()}${n ? ` (${n})` : ''}`
    : 'Archive finished';
  $('#act-density').setAttribute('aria-pressed', String(state.density === 'compact'));
});

function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  save();
}

function toggleDensity() {
  state.density = state.density === 'compact' ? 'comfortable' : 'compact';
  // flip() so every card glides to its new rect instead of the board snapping
  flip(() => { document.documentElement.dataset.density = state.density; });
  $('#act-density').setAttribute('aria-pressed', String(state.density === 'compact'));
  save();
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `board-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Backup saved');
}

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const next = JSON.parse(await file.text());
    if (!Array.isArray(next.columns) || !Array.isArray(next.tasks)) throw new Error('shape');
    snapshot();
    state = C.migrate(next); // also upgrades a v1 backup on the way in
    save();
    render();
    toast(`Imported ${state.tasks.length} tasks`, undo);
  } catch (err) {
    toast('That file is not a board backup');
  }
  e.target.value = '';
});

/* ── archive ───────────────────────────────────────────────
   The board can only archive; only the archive can delete. That is the whole
   safety property: nothing on the board is one click from gone, and the one
   irreversible action lives in one place, behind a confirm.

   Archiving keeps the task row (so the weekly report still resolves its real
   title) and only sets archivedAt. */

function archiveTasks(list) {
  if (!list.length) return 0;
  snapshot();
  const at = Date.now();
  list.forEach(t => {
    const col = state.columns.find(c => c.id === t.columnId);
    t.archivedAt = at;
    t.archivedFrom = col ? col.name : '—';   // stages get renamed and deleted
  });
  save();
  render();
  if (!archiveEl.hidden) renderArchive();
  return list.length;
}

function archiveLastColumn() {
  const col = state.columns[state.columns.length - 1];
  if (!col) return;
  const list = state.tasks.filter(t => t.columnId === col.id && onBoard(t));
  if (!list.length) { toast(`${col.name} is already empty`); return; }
  archiveTasks(list);
  toast(`Archived ${list.length} from ${col.name}`, undo);
}

function restoreTask(id) {
  const t = byId(id);
  if (!t) return;
  snapshot();
  // Its old stage may be gone; fall back to the first one.
  const home = state.columns.some(c => c.id === t.columnId)
    ? t.columnId
    : state.columns[0].id;
  state.tasks.filter(x => x.columnId === home && onBoard(x)).forEach(x => { x.order += 1; });
  t.columnId = home;
  t.order = 0;
  delete t.archivedAt;
  delete t.archivedFrom;
  save();
  render();
  renderArchive();
  toast(tr('restore'), () => { undo(); renderArchive(); });
}

function deleteForever(ids) {
  if (!ids.length) return;
  snapshot();
  const gone = new Set(ids);
  state.tasks = state.tasks.filter(t => !gone.has(t.id));
  save();
  render();
  renderArchive();
  // The report still lists these — it keeps a title snapshot on every event.
  toast(locale === 'es' ? `Eliminada${ids.length === 1 ? '' : 's'} ${ids.length}` : `Deleted ${ids.length}`, () => { undo(); renderArchive(); });
}

/* ── undo + toast ──────────────────────────────────────── */

let undoSnap = null;

function snapshot() { undoSnap = clone(state); }

function undo() {
  if (!undoSnap) return;
  state = undoSnap;
  undoSnap = null;
  save();
  render();
}

const toastEl = $('#toast');
const toastMsg = $('#toast-msg');
const toastUndo = $('#toast-undo');
let toastTimer = null;

function toast(msg, action, ms = 5200) {
  clearTimeout(toastTimer);
  toastMsg.textContent = msg;
  toastUndo.hidden = !action;
  toastUndo.onclick = () => { if (action) action(); hideToast(); };
  toastEl.classList.remove('out');
  toastEl.hidden = false;
  toastTimer = setTimeout(hideToast, ms);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.classList.add('out');
  setTimeout(() => { toastEl.hidden = true; }, 180);
}

/* ── scrim + keys ──────────────────────────────────────── */

function syncScrim() {
  scrim.hidden = editor.hidden && panel.hidden && reportEl.hidden && archiveEl.hidden;
}

scrim.onclick = () => { closeEditor(); closeProjects(); closeReport(); closeArchive(); };

qInput.addEventListener('input', () => {
  query = qInput.value.trim().toLowerCase();
  flip(renderBoard);
});
qInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { qInput.value = ''; query = ''; qInput.blur(); flip(renderBoard); }
});

$('#newTask').onclick = () => openEditor(null);

/* Paste a resume command onto the board and it becomes a card, session already
   filled, caret in the title. Capture starts where the command already is. */
const RESUME = /\b(?:claude|codex)\b.*\bresume\b/i;

document.addEventListener('paste', e => {
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  if (!editor.hidden || !panel.hidden || !reportEl.hidden || !archiveEl.hidden) return;

  const text = (e.clipboardData || window.clipboardData).getData('text') || '';
  const line = text.split('\n').map(s => s.trim()).find(s => RESUME.test(s));
  if (!line) return;

  e.preventDefault();
  openEditor(null);
  fSession.value = line;
  fTitle.focus();
});

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;

  if (e.key === 'Escape') {
    if (!menu.hidden) { menu.hidden = true; return; }
    if (!weeksEl.hidden) { weeksEl.hidden = true; return; }
    if (!editor.hidden) { closeEditor(); return; }
    if (!reportEl.hidden) { closeReport(); return; }
    if (!panel.hidden) { closeProjects(); return; }
    if (!archiveEl.hidden) { closeArchive(); return; }
    closeComposer();
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); qInput.focus(); }
    return;
  }

  if (!reportEl.hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    goWeek(C.addDays(repWeek, e.key === 'ArrowRight' ? 7 : -7));
    return;
  }

  // On an empty board the only sensible action is "write something", so any
  // character starts the first card instead of firing a shortcut.
  if (boardIsEmpty() && e.key.length === 1 && editor.hidden && panel.hidden && reportEl.hidden) {
    e.preventDefault();
    openComposer(state.columns[0].id);
    const ta = $('.composer textarea', board);
    if (ta) { ta.value = e.key; ta.dispatchEvent(new Event('input')); }
    return;
  }

  if (e.key === 'n') { e.preventDefault(); openEditor(null); }
  else if (e.key === 'r') { e.preventDefault(); openReport(); }
  else if (e.key === 'p') { e.preventDefault(); openProjects(); }
  else if (e.key === 'a') { e.preventDefault(); openArchive(); }
  else if (e.key === 't') { e.preventDefault(); toggleTheme(); }
  else if (e.key === 'd') { e.preventDefault(); toggleDensity(); }
  else if (e.key === '/') { e.preventDefault(); qInput.focus(); }
});

/* ── weekly report ─────────────────────────────────────── */

const reportEl = $('#report');
const weeksEl = $('#weeks');
const repLabel = $('#rep-label');

let repWeek = null;        // Monday of the week on screen
let repEntries = [];
let repSel = new Set();               // taskIds ticked for export, this week
const repSelByWeek = new Map();       // monday → that week's ticks

$('#reportBtn').innerHTML = ICON.week;
$('#rep-prev').innerHTML = ICON.left;
$('#rep-next').innerHTML = ICON.right;
$('#rep-close').innerHTML = ICON.close;

/** Monday morning is report time, so on Mondays open the week that just ended. */
function defaultWeek() {
  const today = C.ymd();
  const monday = C.mondayOf(today);
  return C.weekdayIndex(today) === 0 ? C.addDays(monday, -7) : monday;
}

function openReport() {
  closeComposer();
  repSelByWeek.clear();
  repWeek = defaultWeek();
  reportEl.hidden = false;
  scrim.hidden = false;
  renderReport(true);
}

function closeReport() {
  reportEl.hidden = true;
  weeksEl.hidden = true;
  $('#rep-week').setAttribute('aria-expanded', 'false');
  syncScrim();
}

function lookupTask(taskId) {
  const t = byId(taskId);
  if (!t) return null;
  const p = projectOf(t);
  return { title: t.title, project: p ? p.name : null };
}

const selected = () => repEntries.filter(e => repSel.has(e.taskId));

/** Weeks you can reach: first activity through this week. */
function weekBounds() {
  const weeks = C.weeksWithActivity(state.events, C.ymd());
  return weeks.length
    ? { first: weeks[weeks.length - 1].monday, last: weeks[0].monday }
    : { first: repWeek, last: repWeek };
}

function goWeek(monday) {
  const { first, last } = weekBounds();
  if (monday < first || monday > last) return;
  repWeek = monday;
  renderReport(true);
}

function renderReport(reset) {
  repEntries = C.aggregateWeek(state.events, repWeek, lookupTask);

  // Selections live per week, so stepping away and back does not silently
  // throw away a partial pick.
  const known = new Set(repEntries.map(e => e.taskId));
  let sel = repSelByWeek.get(repWeek);
  if (!sel) {
    sel = new Set(repEntries.filter(e => e.include).map(e => e.taskId));
    repSelByWeek.set(repWeek, sel);
  } else {
    [...sel].forEach(id => { if (!known.has(id)) sel.delete(id); });
  }
  repSel = sel;

  repLabel.textContent = C.weekLabel(repWeek, locale);

  const thisWeek = C.mondayOf(C.ymd());
  const rel = repWeek === thisWeek ? tr('thisWeek')
    : repWeek === C.addDays(thisWeek, -7) ? tr('lastWeek') : null;
  const done = state.columns[state.columns.length - 1].name;
  $('#rep-sum').textContent = repEntries.length
    ? [rel, C.summaryLine(repEntries, done, locale)].filter(Boolean).join(' · ')
    : (rel || '');

  const body = $('#rep-body');
  body.innerHTML = '';

  if (!repEntries.length) {
    body.innerHTML = `<p class="rep-empty">${tr('nothingMoved')}</p>`;
  } else {
    const order = state.projects.map(p => p.name);
    C.groupByProject(repEntries, order).forEach(g => {
      const p = state.projects.find(x => x.name === g.project);
      const head = document.createElement('div');
      head.className = 'rep-group';
      if (p) head.style.setProperty('--c', p.color);
      head.innerHTML = `<span class="dot"></span>${esc(g.project)}`;
      body.append(head);
      g.entries.forEach(e => body.append(reportRow(e)));
    });
  }

  $('#rep-count').textContent = `${repSel.size} / ${repEntries.length}`;
  $('#rep-all').textContent = repSel.size === repEntries.length && repEntries.length ? tr('selectNone') : tr('selectAll');
  $('#rep-copy').disabled = !repSel.size;
  $('#rep-save').disabled = !repSel.size;

  const { first, last } = weekBounds();
  $('#rep-prev').disabled = repWeek <= first;
  $('#rep-next').disabled = repWeek >= last;
}

function reportRow(e) {
  const row = document.createElement('div');
  row.className = 'rep-row' + (repSel.has(e.taskId) ? ' on' : '') + (e.netZero ? ' zero' : '');
  row.innerHTML = `
    <span class="tick">${ICON.check}</span>
    <span class="rt">${esc(e.title)}</span>
    <span class="rf">${e.netZero
      ? `${esc(e.to)} <i>&#8634;</i>`
      : `${esc(e.from)}<i>&#8594;</i>${esc(e.to)}`}</span>
    <button class="rd" title="${tr('weeklyReport')}">${C.dayLabel(e.day, locale)}</button>`;

  row.onclick = () => {
    if (repSel.has(e.taskId)) repSel.delete(e.taskId); else repSel.add(e.taskId);
    row.classList.toggle('on');
    if (!stillMotion.matches) {
      $('.tick', row).animate(
        [{ transform: 'scale(.8)' }, { transform: 'scale(1)' }],
        { duration: 180, easing: EASE }
      );
    }
    $('#rep-count').textContent = `${repSel.size} / ${repEntries.length}`;
    $('#rep-all').textContent = repSel.size === repEntries.length ? tr('selectNone') : tr('selectAll');
    $('#rep-copy').disabled = !repSel.size;
    $('#rep-save').disabled = !repSel.size;
  };

  $('.rd', row).onclick = ev => { ev.stopPropagation(); editDay(row, e); };
  return row;
}

/** Re-date a row: every event behind it moves, so it lands in another week's report. */
function editDay(row, entry) {
  const btn = $('.rd', row);
  if (!btn) return;

  const input = document.createElement('input');
  input.type = 'date';
  input.value = entry.day;
  btn.replaceWith(input);
  input.focus();
  try { input.showPicker(); } catch (err) { /* keyboard entry still works */ }

  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    const day = input.value;
    if (!day || day === entry.day) { renderReport(false); return; }

    const conflict = C.rewriteConflict(state.events, entry, day);
    if (conflict) {
      renderReport(false);
      toast(conflict === 'before' ? 'That is before this card existed' : 'Not a date');
      return;
    }

    snapshot();
    C.rewriteDay(state.events, entry, day);
    save();
    const gone = !C.contains(repWeek, day);
    renderReport(false);
    if (gone) toast(`Moved to ${C.weekLabel(C.mondayOf(day))}`, undo);
  };

  input.addEventListener('change', commit);
  input.addEventListener('blur', () => setTimeout(commit, 60));
  input.addEventListener('keydown', ev => { if (ev.key === 'Escape') { settled = true; renderReport(false); } });
}

function reportMarkdown() {
  return C.toMarkdown(selected(), repWeek, {
    projectOrder: state.projects.map(p => p.name),
    doneStage: state.columns[state.columns.length - 1].name,
    locale,
  });
}

$('#reportBtn').onclick = openReport;
$('#rep-close').onclick = closeReport;
$('#rep-prev').onclick = () => goWeek(C.addDays(repWeek, -7));
$('#rep-next').onclick = () => goWeek(C.addDays(repWeek, 7));

$('#rep-all').onclick = () => {
  if (repSel.size === repEntries.length) repSel.clear();
  else repSel = new Set(repEntries.map(e => e.taskId));
  renderReport(false);
};

$('#rep-copy').onclick = async () => {
  const ok = await copyText(reportMarkdown());
  toast(ok ? tr('reportCopied') : tr('couldNotCopy'));
};

$('#rep-save').onclick = () => {
  const blob = new Blob([reportMarkdown()], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = C.reportFilename(repWeek, locale);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${locale === 'es' ? 'Guardado' : 'Saved'} ${C.reportFilename(repWeek, locale)}`);
};

$('#rep-week').onclick = e => {
  e.stopPropagation();
  if (!weeksEl.hidden) { weeksEl.hidden = true; $('#rep-week').setAttribute('aria-expanded', 'false'); return; }

  weeksEl.innerHTML = '';
  C.weeksWithActivity(state.events, C.ymd(), locale).forEach(w => {
    const b = document.createElement('button');
    b.setAttribute('aria-pressed', String(w.monday === repWeek));
    b.innerHTML = `${w.label}<span class="c">${w.count || '—'}</span>`;
    b.onclick = () => {
      repWeek = w.monday;
      weeksEl.hidden = true;
      $('#rep-week').setAttribute('aria-expanded', 'false');
      renderReport(true);
    };
    weeksEl.append(b);
  });

  const r = $('#rep-week').getBoundingClientRect();
  weeksEl.style.top = `${r.bottom + 8}px`;
  weeksEl.style.left = `${r.left}px`;
  weeksEl.style.right = 'auto';
  weeksEl.hidden = false;
  $('#rep-week').setAttribute('aria-expanded', 'true');
};

document.addEventListener('click', e => {
  if (!weeksEl.hidden && !e.target.closest('#weeks') && !e.target.closest('#rep-week')) {
    weeksEl.hidden = true;
    $('#rep-week').setAttribute('aria-expanded', 'false');
  }
});

/* ── go ────────────────────────────────────────────────── */

/* Test seam: tests/dom.test.html drives the real app through this.
   Functions are already global; these bindings are not. Named __board because
   the top-level `board` binding is the board element. */
window.__board = {
  get state() { return state; },
  set state(v) { state = v; },
  get repEntries() { return repEntries; },
  get repWeek() { return repWeek; },
  set repWeek(v) { repWeek = v; },
};

render();
