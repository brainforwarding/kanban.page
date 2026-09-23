/* board — local kanban for agent-driven work.
   Everything lives in localStorage. No network, no build step. */

/* ── helpers ───────────────────────────────────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => BoardCore.uid();
const clone = o => JSON.parse(JSON.stringify(o));
const EASE = 'cubic-bezier(.2,.8,.25,1)';

const ICON = {
  image: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="2.2" y="3" width="11.6" height="10" rx="1.8"/><circle cx="5.9" cy="6.5" r="1.1"/><path d="M2.6 11.6l3.6-3.3 2.6 2.3 1.9-1.6 2.9 2.6"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10M6.4 4.5V3h3.2v1.5M4.4 4.5l.6 8.5h6l.6-8.5"/></svg>',
  download: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.8v7.4M4.9 7.3L8 10.4l3.1-3.1M3 13h10"/></svg>',
  prev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5L5.5 8l4.5 4.5"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
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
const PARAMS = new URLSearchParams(location.search);
const NS = PARAMS.get('ns');
const KEY = NS ? `board.v2.${NS}` : 'board.v2';
const LEGACY_KEY = NS ? null : 'board.v1';

/* Board kind (docs/team.md). A team board lives in a namespace derived from
   its secret (t-…); every other board is personal-kind. Personal and team
   data never mix, and validation is told which one it is guarding.
   HOME is the personal board this page belongs to — normally the null
   namespace. Tests pin it with ?home= so a scratch run never reads, queues
   against or reports from the real personal board. */
const IS_TEAM = C.isTeamNs(NS);
const KIND = IS_TEAM ? 'team' : 'personal';
const TEAM_ID = IS_TEAM ? NS.slice(2) : null;
const HOME = PARAMS.get('home');
const HOME_KEY = HOME ? `board.v2.${HOME}` : 'board.v2';
const HOME_SYNC_KEY = HOME ? `board.sync.${HOME}` : 'board.sync';
const IS_HOME = !IS_TEAM && (NS || null) === (HOME || null);
const REQ_PREFIX = HOME ? `board.req.${HOME}.` : 'board.req.';
const HERE_KEY = HOME ? `kanban.here.${HOME}` : 'kanban.here';
const boardUrl = ns => {
  const q = new URLSearchParams();
  if (ns) q.set('ns', ns);
  else if (HOME) q.set('ns', HOME);
  if (HOME) q.set('home', HOME);
  const qs = q.toString();
  return location.pathname + (qs ? `?${qs}` : '');
};

/* The forward guard. A board written by a newer release is shown but never
   saved or synced from here: migrate() would rewrite its `v` and a save would
   strip what this release does not know. */
let readOnly = false;

// Device-local generations never travel through syncable(). Content answers
// "merge or replace this tab's board?"; binding answers "which sync engine may
// run?" They are separate so Combine preserves another tab's pending draft
// while still shutting the old remote down immediately.
const ZERO_GEN = Object.freeze({ at: 0, id: '' });
const localGen = (st, key) => {
  const g = st && st[key];
  return g && Number.isFinite(g.at) && typeof g.id === 'string' ? g : ZERO_GEN;
};
const compareGen = (a, b) => (a.at || 0) - (b.at || 0) || String(a.id || '').localeCompare(String(b.id || ''));
const sameGen = (a, b) => compareGen(a, b) === 0;
const maxGen = (a, b) => compareGen(a, b) >= 0 ? a : b;
const nextGen = (...held) => ({
  at: Math.max(Date.now(), ...held.map(g => (g && g.at || 0) + 1)),
  id: C.uid(),
});
const contentGenOf = st => localGen(st, '_contentGen');
const bindingGenOf = st => localGen(st, '_bindingGen');

/** First ever run: one card, so the session line is discoverable. `seed`
    marks the board replaceable when a sync link adopts it — stampChanges
    clears it on the first real change, so content is never inferred. */
function firstRun() {
  const s = C.defaultBoard(locale);
  s.seed = true;
  // A team namespace starts bare: it is either about to adopt a linked board
  // or to become a new team, and a demo card with a session would be exactly
  // what the session firewall refuses.
  if (IS_TEAM) return s;
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
    { taskId: t.id, title: t.title, type: 'created', from: null, to: s.columns[1].name, toColumnId: s.columns[1].id },
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
  if (C.isFutureBoard(raw)) readOnly = true;
  return raw ? C.migrate(raw) : firstRun();
}

function applyLocale() {
  document.documentElement.lang = locale;
  document.title = 'kanban.page';
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
  $('#imagesLabel').textContent = tr('images');
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
  const menuText = { projects: tr('projects'), archive: tr('archive'), theme: tr('theme'), addcol: tr('addStage'), sortproj: tr('sortProject'), export: tr('export'), import: tr('import'), sync: tr('syncDevices'), computers: tr('computers'), leave: tr('leaveTeam') };
  $('#syncTitle').textContent = tr('sync');
  $('[data-close]', $('#sync')).title = tr('close');
  $('#sync-copy').title = tr('copy');
  $('#sync-url').setAttribute('aria-label', tr('pairingLink'));
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
  if (!$('#sync').hidden) renderSync();
  $('#menuBtn').focus();
}

let state = load();
applyLocale();
let saveTimer = null;

// The reference the sync clocks are wound against: the state as of the last
// save (or the last applied external state). stampChanges diffs against it,
// which is what makes every mutation path — undo included — stamp correctly
// without a single touch() call anywhere else.
let lastStamped = clone(state);

function writeStateNow() {
  if (readOnly) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('board: could not write storage —', err);
    toast(tr('storageUnavailable'), null, 8000);
    return false;
  }
}

function installLocalState(next) {
  if (readOnly) return false;
  const migrated = C.migrate(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(migrated));
  } catch (err) {
    console.warn('board: could not write storage —', err);
    toast(tr('storageUnavailable'), null, 8000);
    return false;
  }
  state = migrated;
  lastStamped = clone(state);
  return true;
}

function linkedReplacement(remote) {
  const prefs = {
    theme: state.theme,
    density: state.density,
    flagFilter: !!state.flagFilter,
    filter: state.filter,
  };
  const next = C.migrate({ ...state, ...clone(remote), ...prefs });
  // docs/attachments.md: the old board's image references must not ride
  // along into the board being joined (and so never upload there).
  if (remote.attachments) next.attachments = clone(remote.attachments); else delete next.attachments;
  if (next.filter && !(next.projects || []).some(p => p.id === next.filter)) next.filter = null;
  delete next.seed;
  return next;
}

function flushSave() {
  clearTimeout(saveTimer);
  C.stampChanges(lastStamped, state);
  lastStamped = clone(state);
  writeStateNow();
  if (sync) schedulePush();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; flushSave(); }, 120);
}

/** Write a save still sitting in the debounce — and only then. An
    unconditional write here would resurrect a board that something else
    just cleared, since this fires while the page is being torn down. */
function flushPendingSave() {
  if (saveTimer === null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  flushSave();
}

/* ── tab sync ──────────────────────────────────────────────
   Another same-origin tab saved this board; fold its write into ours. A
   merge, not a replace: this tab may hold edits still inside the save
   debounce, and a replace would silently drop them. Deferred while a drag is
   mid-air (the rebuild would yank the card) or a composer is open (the
   rebuild recreates the textarea empty, and its blur guard would discard the
   words) — the next settle applies the latest write. */

let pendingExternal = null;

function queueExternal(external) {
  if (!pendingExternal) {
    pendingExternal = clone(external);
    return;
  }
  const heldContent = contentGenOf(pendingExternal);
  const heldBinding = bindingGenOf(pendingExternal);
  const nextContent = contentGenOf(external);
  const nextBinding = bindingGenOf(external);
  const cmp = compareGen(nextContent, heldContent);
  if (cmp > 0) pendingExternal = clone(external);
  else if (cmp === 0) pendingExternal = C.merge(pendingExternal, external);
  pendingExternal._contentGen = clone(maxGen(heldContent, nextContent));
  pendingExternal._bindingGen = clone(maxGen(heldBinding, nextBinding));
}

function applyExternal(rawJson) {
  let raw = null;
  try { raw = JSON.parse(rawJson); } catch (err) { return; }
  if (!raw) return;
  // A newer tab wrote this board. Folding it into this model would downgrade
  // it; stop editing here instead and let the update prompt do its job.
  if (C.isFutureBoard(raw)) { enterReadOnly(); return; }
  const external = C.migrate(raw);
  const contentCmp = compareGen(contentGenOf(external), contentGenOf(state));
  const bindingCmp = compareGen(bindingGenOf(external), bindingGenOf(state));

  // Relationship transitions stop the old wire immediately, even if an open
  // editor makes the visual replacement wait. Otherwise that editor could
  // settle Y's board and an old tab would still upload it to X.
  if (bindingCmp > 0) {
    syncBindingSuspended = true;
    suspendSyncRuntime();
  }
  if (syncBusy()) { queueExternal(external); return; }

  if (contentCmp <= 0) {
    C.stampChanges(lastStamped, state, undefined, external.tombstones);
  }
  if (contentCmp > 0) {
    state = linkedReplacement(external);
  } else if (contentCmp === 0) {
    state = C.merge(state, external);
  } // lower content generation is a stale pre-replacement write: ignore it

  state._contentGen = clone(maxGen(contentGenOf(state), contentGenOf(external)));
  state._bindingGen = clone(maxGen(bindingGenOf(state), bindingGenOf(external)));
  lastStamped = clone(state);
  render();
  if (!panel.hidden) renderProjects();
  if (!archiveEl.hidden) renderArchive();
  if (!reportEl.hidden) renderReport(false);
  clearOrphanSessions();

  const differs = C.canon(C.syncable(state)) !== C.canon(C.syncable(external))
    || !sameGen(contentGenOf(state), contentGenOf(external))
    || !sameGen(bindingGenOf(state), bindingGenOf(external));
  // A lower-generation tab already overwrote localStorage. Re-persisting the
  // winner is mandatory, not an optimization. Equal-generation unions use
  // the same write-back and terminate when every tab holds the same board.
  if (differs) {
    writeStateNow();
    if (sync && sameGen(bindingGenOf(sync), bindingGenOf(state))) schedulePush();
  }
  if (bindingCmp !== 0 || contentCmp !== 0) reconcileStoredSync();
}

function flushExternal() {
  if (pendingExternal != null) {
    const queued = pendingExternal;
    pendingExternal = null;
    applyExternal(JSON.stringify(queued));
  }
  if (pendingRemote != null && sync) {
    const p = pendingRemote;
    pendingRemote = null;
    applyRemote(p.remote, p.ver, p.ctx);
  }
}

window.addEventListener('storage', e => {
  if (e.key === KEY && e.newValue != null) applyExternal(e.newValue);
  if (e.key === SYNC_KEY) reconcileStoredSync();
  // The personal board is the registry: requests land there, and every other
  // page follows what it says (membership, identity, computers).
  if (IS_HOME && e.key && e.key.startsWith(REQ_PREFIX) && e.newValue != null) ingestRequests();
  if (!IS_HOME && (e.key === HOME_KEY || (e.key && e.key.startsWith(REQ_PREFIX)))) { followTeamEntry(); render(); }
});

/* ── device sync ───────────────────────────────────────────
   No accounts. A 256-bit secret pairs the devices; HKDF splits it into the
   bearer token the relay sees and the AES key it never sees, so the relay
   stores only ciphertext under a hash (see relay/worker.js and
   docs/sync-spec.md). The engine pushes after every save, pulls on
   focus/visibility, and holds a WebSocket so another device's edit lands
   here in about a second. Remote updates converge through C.merge; an
   explicit Join/Replace is the only path that replaces local board data. */

const RELAY = 'https://kanban-relay.quiet-bush-25b1.workers.dev';

/* Test seam, like window.__board: tests/team.dom.test.html drives several
   namespaces through page navigations, and a freshly loaded page talks to the
   relay before any override could be installed. When — and only when — this
   page is framed by a same-origin harness that provides a fake relay, every
   relay call goes there. Unframed, or framed cross-origin, this is inert. */
const testRelay = (() => {
  try { return window.parent !== window ? window.parent.__kanbanTestRelay || null : null; }
  catch (err) { return null; }
})();
const relayHttp = (url, opts) => (testRelay ? testRelay.fetch : window.fetch)(url, opts);
const SYNC_KEY = NS ? `board.sync.${NS}` : 'board.sync';

let sync = null;        // { secret, ver } — presence = the feature is on
let syncKeys = null;    // { secret, token, key } derived from the active secret
let syncStatus = 'off'; // off | ok | syncing | offline | error
let syncedAt = null;    // epoch ms of the last successful exchange
let remoteHead = '';    // serialized syncable known to equal the server head
let rejectedPayload = ''; // exact payload rejected as too large; retry only after change
// The floor: events and tombstones known to have reached the relay. Unioned
// into every push, so no snapshot PUT — an import, an undo — can ever shrink
// the log or drop a tombstone from the server (the log only grows).
let floor = null;
let pendingRemote = null;
// True from an explicit Combine until its first push lands: the linked
// board's stage order wins rather than whichever clock happens to be higher.
let joiningOrder = false;
let pushTimer = null, pushing = false, pullQueued = false, pulling = false;
let syncRetryTimer = null, syncRetryAttempt = 0;
let watchSock = null, watchRetry = 0;
let uiDragLock = 0;     // column and project-row drags hold this
let syncRuntimeEpoch = 0;
let syncBindingSuspended = false;
let syncIncompatible = false; // the remote head can never be applied here

// Image transport state (docs/attachments.md) — declared here, beside the
// sync globals, because suspendSyncRuntime resets it and can run during boot.
const imgFail = new Map();   // blobId → 'full' | 'large' — permanent for this relationship
let boardFull = null;        // { used, quota } from the relay's 507
let uploading = false, uploadAgain = false;
let imgQueueOwner = 0;       // one queue per sync session; a new one takes over
let imgRetryTimer = null, imgRetryMs = 15000;
let uploadingNow = null;     // blobId in flight, for the status line
const imgUrls = new Map();   // blobId → object URL, for this page's life
const imgTried = new Map();  // blobId → last GET that found nothing
const imgWaiting = new Set();
let arrivingTimer = null, arrivingTries = 0;
let liveImgIndex = null;

try {
  const held = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
  if (held && !readOnly && sameGen(bindingGenOf(held), bindingGenOf(state))) sync = held;
} catch (err) { /* off */ }

function enterReadOnly() {
  if (readOnly) return;
  readOnly = true;
  clearTimeout(saveTimer);
  if (sync) suspendSyncRuntime();
  toast(tr('needsUpdate'), null, 10000);
}

const captureSync = () => sync ? {
  epoch: syncRuntimeEpoch,
  secret: sync.secret,
  binding: clone(bindingGenOf(sync)),
} : null;
const isCurrentSync = ctx => !!(ctx && sync
  && !syncBindingSuspended
  && ctx.epoch === syncRuntimeEpoch
  && ctx.secret === sync.secret
  && sameGen(ctx.binding, bindingGenOf(sync))
  && sameGen(ctx.binding, bindingGenOf(state)));

/** Invalidate every callback/request from the old relationship before board
    state can change underneath it. The persisted config is handled by the
    caller; this only cuts the live wire. */
function suspendSyncRuntime() {
  syncRuntimeEpoch++;
  resetImageQueue();
  clearTimeout(pushTimer);
  pushTimer = null;
  clearSyncRetry();
  dropWatch();
  pushing = false;
  pulling = false;
  pullQueued = false;
}

function saveSyncConfig() {
  try {
    if (sync) localStorage.setItem(SYNC_KEY, JSON.stringify(sync));
    else localStorage.removeItem(SYNC_KEY);
  } catch (err) { /* sync still works this session */ }
}

function clearSyncMemory() {
  sync = null;
  syncKeys = null;
  remoteHead = '';
  rejectedPayload = '';
  floor = null;
  pendingRemote = null;
  joiningOrder = false;
  syncBindingSuspended = false;
}

let reconcilingSyncStorage = false;
function reconcileStoredSync() {
  if (reconcilingSyncStorage) return;
  reconcilingSyncStorage = true;
  try {
    let rawBoard = null, config = null;
    try {
      rawBoard = localStorage.getItem(KEY);
      config = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
    } catch (err) { /* safest state is off */ }

    if (rawBoard) {
      let stored = null;
      try { stored = C.migrate(JSON.parse(rawBoard)); } catch (err) { /* keep live board */ }
      if (stored && (!sameGen(contentGenOf(stored), contentGenOf(state))
          || !sameGen(bindingGenOf(stored), bindingGenOf(state)))) {
        applyExternal(rawBoard);
        if (pendingExternal) return; // barrier holds state; old runtime is already suspended
      }
    }

    // The board is the commit record. A stale tab can finish an old-X request
    // just after another tab commits Y and overwrite only SYNC_KEY with X's
    // lower binding. If this runtime still owns the board's winning binding,
    // reject that config write and restore the matching relationship. A real
    // Disconnect writes a newer board binding first, so it cannot enter here.
    const currentOwnsBoard = sync && sameGen(bindingGenOf(sync), bindingGenOf(state));
    const configDisagrees = !config
      || !sameGen(bindingGenOf(config), bindingGenOf(state))
      || (currentOwnsBoard && config.secret !== sync.secret);
    if (currentOwnsBoard && configDisagrees) {
      syncBindingSuspended = false;
      saveSyncConfig();
      connectWatch();
      return;
    }

    if (!config || !sameGen(bindingGenOf(config), bindingGenOf(state))) {
      if (sync) suspendSyncRuntime();
      clearSyncMemory();
      setSyncStatus('off');
      if (!syncEl.hidden) { syncView = 'off'; renderSync(); focusSyncState(); }
      return;
    }

    if (sync && sync.secret === config.secret
        && sameGen(bindingGenOf(sync), bindingGenOf(config))) {
      syncBindingSuspended = false;
      // Do not copy a newer version into memory before pulling it: pull uses
      // the old number to recognize that the remote head must be applied.
      if (config.ver !== sync.ver) pull();
      else connectWatch();
      return;
    }

    suspendSyncRuntime();
    sync = config;
    syncBindingSuspended = false;
    syncKeys = null;
    remoteHead = '';
    rejectedPayload = '';
    floor = null;
    setSyncStatus('syncing');
    reflectExternalBinding(config.secret);
    connectWatch();
    pull();
  } finally {
    reconcilingSyncStorage = false;
  }
}

async function keysForContext(ctx) {
  if (!ctx) throw new Error('sync stopped');
  if (syncKeys && syncKeys.secret === ctx.secret) return syncKeys;
  const derived = { secret: ctx.secret, ...(await C.deriveSync(ctx.secret)) };
  if (!isCurrentSync(ctx)) throw new Error('stale sync');
  syncKeys = derived;
  return derived;
}

async function relayFetch(method, body, opts = {}, ctx = captureSync()) {
  if (!ctx) throw new Error('sync stopped');
  const derived = await keysForContext(ctx);
  return relayHttp(`${RELAY}/v1/board`, {
    method,
    headers: {
      Authorization: `Bearer ${derived.token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    keepalive: !!opts.keepalive,
  });
}

function setSyncStatus(s) {
  syncStatus = s;
  renderSyncStatus();
}

/* One interaction barrier for every surface a rebuild would trample: card /
   column / project drags, the composer, the open editor (its draft is a
   stale clone — applying under it would let a later save clobber the remote
   edit), an inline stage rename, a project rename, a report date edit.
   Remote payloads are still fetched and queued; they apply on settle. */
function syncBusy() {
  return !!drag || uiDragLock > 0 || composerCol !== null || !editor.hidden
  || (!reportEl.hidden && !!reportEl.querySelector('input[type="date"]'))
  || !!(document.activeElement && (
    document.activeElement.classList.contains('col-name')
    || (!panel.hidden && document.activeElement.matches('#proj-list input'))));
}

const syncableStr = st => C.canon(C.syncable(st));
/** merge(x, x) is a no-op that normalizes ordering — for comparisons only. */
const normalized = payload => C.canon(C.syncable(C.merge(payload, payload)));

/** Fold a decrypted remote payload into the live board — a merge, never a
    replace, deferred while the interaction barrier is up. */
function applyRemote(remote, ver, ctx = captureSync()) {
  if (!isCurrentSync(ctx)) return;
  // A newer app, a damaged payload, or the other kind of board. Validation
  // knows which kind this namespace is: a roster never lands on a personal
  // board, and a team board never accepts a session or a team list.
  const bad = C.validateSyncable(remote, KIND);
  if (bad) {
    setSyncStatus('error');
    // Terminal, not a retry loop: nothing this release can do will make a
    // newer schema or the wrong kind of board acceptable.
    if (/newer than this client|cannot land|needs its roster/.test(bad)) syncIncompatible = true;
    return;
  }
  floor = { events: remote.events || [], tombstones: remote.tombstones || {}, attachments: remote.attachments || {} };
  if (syncBusy()) { pendingRemote = { remote, ver, ctx }; return; }
  sync.ver = ver;
  saveSyncConfig();
  C.stampChanges(lastStamped, state, undefined, remote.tombstones); // pending drafts can explicitly restore
  const before = syncableStr(state);
  // While joining a board, its stage order wins — including through a 409
  // retry, which lands back here before the adoption has settled.
  const merged = C.merge(state, remote, joiningOrder ? { preferOrder: 'remote' } : {});
  remoteHead = normalized(remote);
  state = merged;
  lastStamped = clone(state);
  if (syncableStr(state) !== before) {
    render();
    if (!panel.hidden) renderProjects();
    if (!archiveEl.hidden) renderArchive();
    if (!reportEl.hidden) renderReport(false);
  }
  save(); // persist the union; schedules a push-back only if we knew more
  clearOrphanSessions();
  imagesAfterPull();
  const current = syncableStr(state);
  setSyncStatus(current === rejectedPayload && current !== remoteHead ? 'error' : 'ok');
  syncedAt = Date.now();
}

function schedulePush(ms = 1200) {
  if (!sync) return;
  if (syncableStr(state) === rejectedPayload) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(), ms);
}

function clearSyncRetry(reset = true) {
  clearTimeout(syncRetryTimer);
  syncRetryTimer = null;
  if (reset) syncRetryAttempt = 0;
}

/** Retry transport failures independently of the WebSocket: an HTTP request
    can fail while the live socket still looks open. One bounded backoff loop
    per tab is enough; pull first so a stale writer never blind-writes. */
function scheduleSyncRetry() {
  if (!sync || syncRetryTimer) return;
  const delay = Math.min(30000, 1000 * 2 ** syncRetryAttempt++);
  syncRetryTimer = setTimeout(() => {
    syncRetryTimer = null;
    if (!sync) return;
    flushExternal();
    connectWatch();
    pull();
  }, delay);
}

function retrySyncNow() {
  if (!sync) return;
  clearSyncRetry(false);
  flushExternal();
  connectWatch();
  pull();
}

async function push(opts = {}) {
  const ctx = captureSync();
  if (!isCurrentSync(ctx)) return;
  if (readOnly || syncIncompatible) { setSyncStatus('error'); return; }
  if (pushing) { schedulePush(600); return; }
  if (pendingRemote) { schedulePush(1000); return; } // merge the held remote first
  // Never blind-write over a head this session has not seen: the floor is
  // what guarantees a snapshot cannot shrink the relay's history.
  if ((sync.ver || 0) > 0 && !floor) { schedulePush(1500); pull(); return; }
  C.stampChanges(lastStamped, state);
  lastStamped = clone(state);
  if (floor) {
    // events and tombstones only — see unionFloor. This used to go through
    // merge() with an otherwise-empty board, which sorted the real stages by
    // id and moved the done line on any board whose stage clock was still 0.
    state = C.unionFloor(state, floor);
    lastStamped = clone(state);
  }
  // Nothing leaves this device unless it is a valid board of this kind — the
  // session firewall and the personal/team split, checked on the way out too.
  if (C.validateSyncable(C.syncable(state), KIND)) { setSyncStatus('error'); return; }
  if (syncableStr(state) === rejectedPayload) { setSyncStatus('error'); return; }
  if (syncableStr(state) === remoteHead) {
    joiningOrder = false; // nothing to send: the adoption has settled too
    clearSyncRetry();
    setSyncStatus('ok');
    return;
  }
  pushing = true;
  setSyncStatus('syncing');
  try {
    for (let attempt = 0; attempt < 3 && isCurrentSync(ctx); attempt++) {
      const payload = C.syncable(state);
      const snap = C.canon(payload);
      const { key } = await keysForContext(ctx);
      if (!isCurrentSync(ctx)) return;
      const env = await C.seal(key, payload);
      if (!isCurrentSync(ctx)) return;
      const res = await relayFetch('PUT', { baseVer: sync.ver || 0, env }, opts, ctx);
      if (!isCurrentSync(ctx)) return;
      if (res.status === 200) {
        const accepted = await res.json();
        if (!isCurrentSync(ctx)) return;
        sync.ver = accepted.ver;
        saveSyncConfig();
        remoteHead = snap;
        rejectedPayload = '';
        floor = { events: payload.events, tombstones: payload.tombstones, attachments: payload.attachments || {} };
        joiningOrder = false; // the adoption has settled
        clearSyncRetry();
        setSyncStatus('ok');
        syncedAt = Date.now();
        if (syncableStr(state) !== snap) schedulePush(300); // edits landed mid-flight
        uploadImages(); // the board is on the relay: its images may follow
        return;
      }
      if (res.status === 409) {
        // Someone else wrote first: fold their head in, then retry from it.
        const head = await res.json();
        if (!isCurrentSync(ctx)) return;
        const remote = head.env ? await C.unseal(key, head.env) : null;
        if (!isCurrentSync(ctx)) return;
        if (remote) applyRemote(remote, head.ver, ctx);
        else { sync.ver = head.ver; saveSyncConfig(); }
        if (pendingRemote) return; // the barrier holds the merge; settle resumes
        continue;
      }
      if (res.status === 410) { syncLost(); return; }
      if (res.status === 413) {
        rejectedPayload = snap;
        clearSyncRetry();
        setSyncStatus('error');
        return; // permanent until the board changes and schedules a fresh push
      }
      throw new Error(`relay ${res.status}`);
    }
    if (isCurrentSync(ctx)) scheduleSyncRetry(); // repeated contention
  } catch (err) {
    if (!isCurrentSync(ctx)) return;
    setSyncStatus('offline');
    scheduleSyncRetry();
  } finally {
    if (ctx.epoch === syncRuntimeEpoch) pushing = false;
  }
}

async function pull() {
  if (!sync || pulling) { pullQueued = !!sync; return; }
  const ctx = captureSync();
  if (!isCurrentSync(ctx)) return;
  pulling = true;
  try {
    const res = await relayFetch('GET', null, {}, ctx);
    if (!isCurrentSync(ctx)) return;
    if (res.status === 404) {
      if ((sync.ver || 0) > 0) { syncLost(); return; }
      schedulePush(0); // fresh enable — nothing on the server yet, seed it
      return;
    }
    if (res.status === 410) { syncLost(); return; }
    if (!res.ok) throw new Error(`relay ${res.status}`);
    const { ver, env } = await res.json();
    if (!isCurrentSync(ctx)) return;
    const { key } = await keysForContext(ctx);
    if (!isCurrentSync(ctx)) return;
    const remote = await C.unseal(key, env);
    if (!isCurrentSync(ctx)) return;
    // every decrypted head is validated, whatever its version says
    const badHead = C.validateSyncable(remote, KIND);
    if (badHead) { setSyncStatus('error'); if (/newer than this client|cannot land|needs its roster/.test(badHead)) syncIncompatible = true; return; }
    syncedAt = Date.now();
    if (ver !== sync.ver) {
      applyRemote(remote, ver, ctx);
    } else {
      floor = { events: remote.events || [], tombstones: remote.tombstones || {}, attachments: remote.attachments || {} };
      remoteHead = normalized(remote);
      const current = syncableStr(state);
      if (current === remoteHead) {
        clearSyncRetry();
        setSyncStatus('ok');
        uploadImages(); // in step: anything added offline can follow now
      } else if (current === rejectedPayload) {
        setSyncStatus('error'); // focus/pull must not disguise a blocked 413
      } else {
        setSyncStatus('ok');
        schedulePush(300);
      }
    }
  } catch (err) {
    if (!isCurrentSync(ctx)) return;
    setSyncStatus('offline');
    scheduleSyncRetry();
  } finally {
    if (ctx.epoch === syncRuntimeEpoch) {
      pulling = false;
      if (pullQueued) { pullQueued = false; pull(); }
    }
  }
}

/* The live channel: the relay broadcasts {ver} on every accepted write, and
   a newer ver triggers a pull. The socket stays open while the page is open
   — hidden tabs included, so a laptop behind another window is current the
   moment you look at it; a phone OS freezes the tab and the visibility pull
   covers re-entry. */

function connectWatch() {
  const ctx = captureSync();
  if (!isCurrentSync(ctx) || watchSock) return;
  keysForContext(ctx).then(({ token }) => {
    if (!isCurrentSync(ctx) || watchSock) return;
    let ws;
    try {
      if (testRelay) return; // the harness drives pulls itself
      ws = new WebSocket(`${RELAY.replace(/^http/, 'ws')}/v1/board/watch`, ['kanban.v1', token]);
    } catch (err) { return; }
    watchSock = ws;
    // `live` vs `synced` is the difference between "a change will arrive" and
    // "I will go and ask", so the footer has to hear the socket settle.
    ws.onopen = () => {
      if (!isCurrentSync(ctx) || watchSock !== ws) { try { ws.close(); } catch (err) { /* stale */ } return; }
      watchRetry = 0;
      renderSyncStatus();
    };
    ws.onmessage = e => {
      if (!isCurrentSync(ctx) || watchSock !== ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.deleted) { syncLost(); return; }
      if (m.ver !== sync.ver) pull();
    };
    ws.onclose = () => {
      if (!isCurrentSync(ctx) || watchSock !== ws) return;
      watchSock = null;
      renderSyncStatus();
      setTimeout(() => { if (isCurrentSync(ctx)) connectWatch(); }, Math.min(30000, 1000 * 2 ** watchRetry++));
    };
    ws.onerror = () => { try { ws.close(); } catch (err) { /* closing */ } };
  }).catch(() => { /* a pull/retry reports transport state */ });
}

function dropWatch() {
  if (!watchSock) return;
  const ws = watchSock;
  watchSock = null;   // onclose sees the mismatch and stays quiet
  ws.onclose = null;
  try { ws.close(); } catch (err) { /* closing */ }
}

/* Fallback heartbeat: only does work when the socket is down; also retries
   any apply the interaction barrier deferred. */
setInterval(() => {
  if (!sync) return;
  flushExternal();
  if (!watchSock || watchSock.readyState !== 1) { connectWatch(); pull(); }
}, 30000);

document.addEventListener('visibilitychange', () => {
  if (!sync) return;
  if (document.hidden) {
    // Best effort: get the last edits out before the tab is frozen.
    flushPendingSave();
    if (syncableStr(state) !== remoteHead) push({ keepalive: true });
  } else {
    retrySyncNow();
  }
});
window.addEventListener('focus', retrySyncNow);
window.addEventListener('online', retrySyncNow);
// A tab closed inside the save debounce must not lose its last edit.
window.addEventListener('pagehide', () => {
  flushPendingSave();
  if (sync && syncableStr(state) !== remoteHead) push({ keepalive: true });
});

/* ── sync lifecycle ───────────────────────────────────── */

/** `secret` is pre-minted only for a new team board: its namespace was
    derived from it before the page existed (docs/team.md). */
async function enableSync(secret = null) {
  // A team board reaches the wire only with its roster (board kind).
  if (IS_TEAM && !(state.members || []).length) return false;
  suspendSyncRuntime();
  state._bindingGen = nextGen(bindingGenOf(state));
  lastStamped = clone(state);
  if (!writeStateNow()) return false;
  sync = { secret: secret || C.randomSecret(), ver: 0, _bindingGen: clone(bindingGenOf(state)) };
  syncKeys = null;
  remoteHead = '';
  rejectedPayload = '';
  floor = null;
  saveSyncConfig();
  await push();
  if (!remoteHead) return false; // the first PUT never landed
  connectWatch();
  return true;
}

/** Forget the secret on this device only; other devices keep syncing. */
function syncStopped(msg) {
  const oldSecret = sync && sync.secret;
  if (sync) {
    flushPendingSave();
    suspendSyncRuntime();
    state._bindingGen = nextGen(bindingGenOf(state), bindingGenOf(sync));
    lastStamped = clone(state);
    writeStateNow(); // board first: a crash cannot run old X against new state
  }
  clearSyncMemory();
  saveSyncConfig();
  setSyncStatus('off');
  if (!$('#sync').hidden) { syncView = 'off'; renderSync(); focusSyncState(); }
  if (msg) toast(msg, null, 8000);
  return oldSecret;
}

/* "Failure is quiet" is right for a dropped connection and wrong for a
   permanent one. A board deleted from another device will never sync again,
   and retrying it silently forever tells the user they are synced when they
   are not — so this speaks once, then stops. */
let saidSyncLost = false;
function syncLost() {
  if (sync) {
    suspendSyncRuntime();
    state._bindingGen = nextGen(bindingGenOf(state), bindingGenOf(sync));
    lastStamped = clone(state);
    writeStateNow();
  }
  clearSyncMemory();
  saveSyncConfig();
  setSyncStatus('gone');
  if (!$('#sync').hidden) { syncView = 'off'; renderSync(); focusSyncState(); }
  if (!saidSyncLost) { saidSyncLost = true; toast(tr('syncLost'), null, 8000); }
}

/** Wipe the relay copy — durable: the slot answers 410 from then on, and
    every synced device sees the broadcast and stops. */
async function deleteFromServer() {
  const ctx = captureSync();
  if (!isCurrentSync(ctx)) return false;
  try {
    const res = await relayFetch('DELETE', null, {}, ctx);
    if (!isCurrentSync(ctx)) return false;
    if (res.status !== 204 && res.status !== 410) throw new Error(`relay ${res.status}`);
    syncStopped(); // forget the key only after the relay confirms the outcome
    return true;
  } catch (err) {
    if (!isCurrentSync(ctx)) return false;
    setSyncStatus('offline');
    return false;
  }
}

const syncLink = () => {
  const base = location.origin === 'null'
    ? 'https://kanban.page/app/'
    : location.origin + location.pathname + location.search; // keep ?ns=
  return `${base}#sync=${sync.secret}`;
};

/* Candidate inspection is deliberately side-effect free. It never borrows
   the active sync globals: a bad Y link cannot knock this device off X, and a
   late candidate response cannot act after Cancel or another link. */
let pendingSecret = null;
let pendingCandidate = null;
let joinAttempt = 0;

function reflectExternalBinding(secret) {
  if ($('#sync').hidden) return;
  const candidate = pendingSecret;
  joinAttempt++;
  pendingSecret = null;
  pendingCandidate = null;
  syncNoticeKey = candidate === secret ? 'alreadyConnected' : null;
  syncView = candidate && candidate !== secret ? 'blocked' : 'on';
  renderSync();
  focusSyncState();
}

const permanentCandidateError = message => Object.assign(new Error(message), { permanent: true });
const candidateBoardShape = raw => {
  if (!raw || typeof raw !== 'object' || (raw.v || 2) > C.SYNC_V) return false;
  if (!Array.isArray(raw.columns) || !raw.columns.length
      || !raw.columns.every(c => c && typeof c.id === 'string' && typeof c.name === 'string')) return false;
  if (!Array.isArray(raw.projects)
      || !raw.projects.every(p => p && typeof p.id === 'string' && typeof p.name === 'string')) return false;
  if (!Array.isArray(raw.tasks)
      || !raw.tasks.every(t => t && typeof t.id === 'string'
        && typeof t.title === 'string' && typeof t.columnId === 'string')) return false;
  if (!Array.isArray(raw.events)
      || !raw.events.every(e => e && typeof e.id === 'string' && typeof e.taskId === 'string')) return false;
  return !raw.tombstones || (typeof raw.tombstones === 'object' && !Array.isArray(raw.tombstones));
};

async function inspectCandidate(secret) {
  if (sync) {
    pendingSecret = null;
    pendingCandidate = null;
    joinAttempt++;
    syncView = secret === sync.secret ? 'on' : 'blocked';
    syncNoticeKey = secret === sync.secret ? 'alreadyConnected' : null;
    if ($('#sync').hidden) openSync(syncView);
    else { renderSync(); focusSyncState(); }
    return;
  }

  const attempt = ++joinAttempt;
  pendingSecret = secret;
  pendingCandidate = null;
  syncView = 'checking';
  if ($('#sync').hidden) openSync('checking');
  else { renderSync(); focusSyncState(); }

  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || C.b64uToBytes(secret).length !== 32) {
      throw permanentCandidateError('bad secret');
    }
    const keys = await C.deriveSync(secret);
    if (attempt !== joinAttempt || sync) return;
    let res;
    try {
      res = await relayHttp(`${RELAY}/v1/board`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${keys.token}` },
      });
    } catch (err) {
      throw Object.assign(err, { retryable: true });
    }
    if (attempt !== joinAttempt || sync) return;
    if ([408, 429].includes(res.status) || res.status >= 500) {
      throw Object.assign(new Error(`relay ${res.status}`), { retryable: true });
    }
    if (!res.ok) throw permanentCandidateError(`relay ${res.status}`);

    let head;
    try { head = await res.json(); } catch (err) { throw permanentCandidateError('bad response'); }
    if (attempt !== joinAttempt || sync) return;
    if (!head || !Number.isSafeInteger(head.ver) || head.ver < 0 || !head.env) {
      throw permanentCandidateError('bad response');
    }

    let raw;
    try { raw = await C.unseal(keys.key, head.env); }
    catch (err) { throw permanentCandidateError('cannot decrypt'); }
    if (attempt !== joinAttempt || sync) return;
    if (!candidateBoardShape(raw)) throw permanentCandidateError('bad board');
    // the other kind of board never lands here (routing already moved a team
    // board to its own namespace; this is the backstop)
    if (C.validateSyncable(raw, KIND)) throw permanentCandidateError('bad board');
    let remote;
    try { remote = C.migrate(raw); }
    catch (err) { throw permanentCandidateError('bad board'); }

    pendingCandidate = { secret, keys, ver: head.ver, remote };
    if (state.seed === true) commitCandidate('replace');
    else { syncView = 'choose'; renderSync(); focusSyncState(); }
  } catch (err) {
    if (attempt !== joinAttempt || sync) return;
    pendingCandidate = null;
    syncFailMsg = err && (err.retryable || !err.permanent) ? 'offline' : 'gone';
    syncView = 'failed';
    setSyncStatus('off');
    renderSync();
    focusSyncState();
  }
}

function commitCandidate(mode) {
  const candidate = pendingCandidate;
  if (!candidate || sync) return;
  joinAttempt++;
  pendingCandidate = null;
  pendingSecret = null;
  suspendSyncRuntime();

  const oldContent = contentGenOf(state);
  const oldBinding = bindingGenOf(state);
  let next = mode === 'combine'
    ? C.merge(state, candidate.remote, { preferOrder: 'remote' })
    : linkedReplacement(candidate.remote);
  next._contentGen = clone(mode === 'replace' ? nextGen(oldContent) : oldContent);
  next._bindingGen = nextGen(oldBinding);
  delete next.seed;
  if (!installLocalState(next)) {
    syncView = 'failed';
    syncFailMsg = 'offline';
    renderSync();
    focusSyncState();
    return;
  }

  sync = {
    secret: candidate.secret,
    ver: candidate.ver,
    _bindingGen: clone(bindingGenOf(state)),
  };
  syncKeys = { secret: candidate.secret, ...candidate.keys };
  remoteHead = normalized(candidate.remote);
  rejectedPayload = '';
  floor = { events: candidate.remote.events || [], tombstones: candidate.remote.tombstones || {}, attachments: candidate.remote.attachments || {} };
  joiningOrder = mode === 'combine';
  saveSyncConfig(); // board was written first and carries the matching binding
  syncNoticeKey = mode === 'combine' ? 'combinedLinked' : 'connectedLinked';
  setSyncStatus('ok');
  syncedAt = Date.now();
  syncView = 'on';
  render();
  renderSync();
  focusSyncState();
  connectWatch();
  if (mode === 'combine' && syncableStr(state) !== remoteHead) schedulePush(0);
  afterTeamAdoption();
}

const byId = id => state.tasks.find(t => t.id === id);
const projectOf = t => state.projects.find(p => p.id === t.projectId) || null;
const colName = id => (state.columns.find(c => c.id === id) || {}).name || '';

/** The report's source of truth. Stage names are snapshotted, never referenced. */
function logEvent(task, type, fromColId, toColId) {
  const p = projectOf(task);
  const who = me();
  state.events.push(C.makeEvent({
    taskId: task.id,
    title: task.title,
    project: p ? p.name : null, // so a deleted card still reports under its project
    type,
    from: fromColId ? colName(fromColId) : null,
    to: colName(toColId),
    // ids beside the names, and who — only on a team board, only when known
    fromColumnId: fromColId || null,
    toColumnId: toColId,
    by: who ? who.id : null,
    byName: who ? who.name : null,
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
  // controllerchange is the normal, atomic route. A few browser/PWA shells
  // fail to surface it reliably; after activation has had time to finish, a
  // reload is still safer than leaving someone on a stale release.
  setTimeout(() => {
    if (reloadingForUpdate) location.reload();
  }, 1800);
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
  if (IS_TEAM && state.assigneeFilter === 'mine' && t.assigneeId !== state.me) return false;
  if (IS_TEAM && state.assigneeFilter === 'unassigned' && t.assigneeId) return false;
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
  liveImgIndex = null;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.density = state.density;
  renderSwitcher();
  renderMembers();
  renderMe();
  renderFilters();
  flip(renderBoard);
}

const boardIsEmpty = () => !state.tasks.some(onBoard);

function renderFilters() {
  filtersEl.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'pill';
  all.setAttribute('aria-pressed', String(!state.filter && !state.flagFilter && !(IS_TEAM && state.assigneeFilter)));
  all.textContent = tr('all'); // no dot: the dot means "a project", and All is not one
  all.onclick = () => { state.filter = null; state.flagFilter = false; state.assigneeFilter = null; save(); render(); };
  filtersEl.append(all);
  // Mine / Unassigned compose with a project filter; they are preferences
  // of this device and never sync.
  assigneePills().forEach(pill => filtersEl.append(pill));

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
        <button class="grab" title="${tr('reorder')}">${ICON.grip}</button>
        <button class="icon sm" data-add title="${tr('newTask')}">${ICON.plus}</button>
        ${total === 0 && state.columns.length > 1 ? `<button class="icon sm" data-del title="${tr('delete')} ${tr('task')}">${ICON.close}</button>` : ''}
      </div>
      <div class="col-body"></div>`;

    // Two ways in, one code path: the handle, and any bare part of the head.
    // People try to drag a column by its header before they look for a grip.
    $('.col-head', el).onpointerdown = ev => {
      if (ev.target.closest('.col-name') || ev.target.closest('button:not(.grab)')) return;
      dragColumn(ev, el);
    };

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
      flushExternal();
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
  // A team card's session is yours alone, read from the personal board.
  const sess = IS_TEAM ? privateSessionFor(t.id) : (t.session ? t : null);
  const assignee = IS_TEAM ? memberOf(t.assigneeId) : null;
  const doneCol = state.columns[state.columns.length - 1];
  // who moved it across the done line — from the log, by column id
  const doneBy = IS_TEAM && t.columnId === doneCol.id ? C.doneByOf(state.events, t.id, doneCol.id) : null;
  const doneWho = doneBy ? (memberOf(doneBy.by) || { name: doneBy.byName || '?' }) : null;
  const fresh = isNewForMe(t);
  if (fresh) el.classList.add('fresh');
  const imgs = imagesOf(t.id);
  const imgBy = IS_TEAM && imgs.length ? memberOf(imgs[imgs.length - 1].by) : null;

  el.innerHTML = `
    <span class="edge"></span>
    <button class="flag" title="${t.flag ? 'Unflag' : 'Flag  F'}" aria-pressed="${t.flag ? 'true' : 'false'}">${t.flag ? ICON.starFill : ICON.star}</button>
    ${fresh ? `<span class="newtag">${esc(tr('newForYou'))}</span>` : ''}
    <h3>${esc(t.title)}</h3>
    ${t.notes ? `<p class="note">${esc(t.notes)}</p>` : ''}
    ${p || since || assignee || doneWho || imgs.length ? `<div class="meta">
        ${p ? `<span class="proj">${esc(p.name)}</span>` : ''}
        <span class="grow"></span>
        ${imgs.length ? `<span class="imgcount" title="${esc(tr(imgs.length === 1 ? 'oneImage' : 'nImages').replace('{n}', imgs.length))}">${ICON.image}${imgs.length}${imgBy ? avatarHtml(imgBy, 'xs') : ''}</span>` : ''}
        ${doneWho ? `<span class="doneby" title="${esc(doneWho.name)}">✓ ${esc(initials(doneWho.name))} · ${esc(age(doneBy.at) || tr('today'))}</span>` : ''}
        ${since && !doneWho ? `<span class="age" title="Untouched for ${since}">${since}</span>` : ''}
        ${assignee ? avatarHtml(assignee, 'sm') : ''}
      </div>` : ''}
    ${sess ? `<button class="chip" title="Copy session command">
        <span class="caret">&#9656;</span>
        <span class="cmd">${esc(sess.session)}</span>
        ${sess.sessionMachine ? machineHtml(sess.sessionMachine) : ''}
        <span class="ci">${ICON.copy}</span>
      </button>` : ''}`;

  const chip = $('.chip', el);
  if (chip) chip.onclick = e => { e.stopPropagation(); copyChip(chip, sessionCommand(sess)); };
  $('.flag', el).onclick = e => { e.stopPropagation(); toggleFlag(t.id); };

  el.addEventListener('keydown', e => {
    if (e.target !== el) return; // buttons inside the card keep their own keys
    if (e.key === 'Enter') { e.preventDefault(); openEditor(t.id); }
    if (e.key === 'f') { e.preventDefault(); toggleFlag(t.id); }
    if (e.altKey && e.key.startsWith('Arrow')) { e.preventDefault(); nudge(t.id, e.key); }
    if (e.key === 'c' && chip) { e.preventDefault(); copyChip(chip, sessionCommand(sess)); }
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
  // A team card has no session slot at all — the firewall checks presence.
  if (IS_TEAM) { delete t.session; delete t.sessionMachine; delete t.sessionCwd; }
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
  flushExternal();
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
  // A mouse has a spare gesture — the pointer is already somewhere before it
  // presses — so movement can mean "drag". A finger has only one, and the
  // scrollers need it: the column pans vertically and the board pages sideways.
  // So on touch a card is lifted by holding still, and any movement before the
  // hold hands the gesture back to the browser. Same 5px constant, opposite
  // polarity: on a mouse it ARMS the drag, on a finger it disarms it.
  const touch = e.pointerType === 'touch';
  let started = false;

  const move = ev => {
    if (!started) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < (touch ? 8 : 5)) return;
      if (touch) { off(); return; }        // it was a scroll, not a grab
      started = true;
      beginDrag(card, sx, sy);
    }
    lastPointer = { x: ev.clientX, y: ev.clientY };
    moveDrag(ev);
  };

  // Once the hold has lifted a card the finger must stop panning. Legal because
  // the browser cannot already have started a scroll during a stationary hold,
  // and preventDefault only works while the touchmove is still cancelable.
  const block = ev => { if (started) ev.preventDefault(); };
  const held = touch ? setTimeout(() => { started = true; beginDrag(card, sx, sy); }, 320) : 0;
  if (touch) document.addEventListener('touchmove', block, { passive: false });

  const off = () => {
    clearTimeout(held);
    document.removeEventListener('touchmove', block);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
  };
  const up = () => { off(); if (started) endDrag(); else openEditor(card.dataset.id); };
  // The browser fires pointercancel INSTEAD of pointerup the moment it claims
  // the gesture for itself — a touch scroll, a system edge-swipe, a second
  // finger. Without this the ghost stays on screen and body keeps cursor
  // 'grabbing' and user-select 'none' for the rest of the session; not even
  // closing the panel clears it. A cancel is not a tap, so it never opens
  // the editor the way pointerup does.
  const cancel = () => { off(); if (started) endDrag(); };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
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
  // The last board mutation with neither an event nor an undo — and the one a
  // mis-read swipe used to produce. A cross-stage move is in the log; a
  // reorder inside a column is not, so without this it cannot be taken back.
  snapshot();

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
  if (!landed || stillMotion.matches) { wrap.remove(); flushExternal(); return; }

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
  let flightDone = false;
  const settle = () => {
    if (flightDone) return;
    flightDone = true;
    wrap.remove();
    landed.classList.remove('landing');
    flushExternal(); // a tab write held back during the drag lands after the flight
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
  // The tombstone carries the delete to other devices; undo restamps the
  // restored column past it, so undo still wins after a sync.
  state.tombstones = state.tombstones || {};
  state.tombstones[id] = Math.max(Date.now(), C.clockMax(state) + 1);
  state.columns = state.columns.filter(c => c.id !== id);
  save();
  render();
  toast(tr('stageDeleted'), undo);
}

/** Columns reorder the way project rows do — same ghost, same FLIP, sideways.
    This exists because a new stage always lands on the right (addColumn pushes),
    and without a way to move it left the only workaround was to rename stages
    into each other's places. That quietly rewrites what "done" means: the report
    reads the LAST column as done, and the event log keeps the old names forever. */
function dragColumn(ev, srcCol) {
  if (ev.button !== 0) return;
  ev.preventDefault();
  const id = srcCol.dataset.id;
  const col = board.querySelector(`.col[data-id="${id}"]`);
  if (!col) return;

  // The trailing "add stage" affordance is also a .col — never a drop target,
  // and never the element we append past.
  const cols = () => [...board.querySelectorAll('.col:not(.ghost-col)')];
  const tail = board.querySelector('.ghost-col');

  const r = col.getBoundingClientRect();
  const wrap = document.createElement('div');
  wrap.className = 'col-ghost-wrap';
  const ghost = col.cloneNode(true);
  ghost.classList.add('col-ghost');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  wrap.append(ghost);
  wrap.style.transform = `translate3d(${r.left}px, ${r.top}px, 0)`;
  wrap.style.transformOrigin = `${ev.clientX - r.left}px ${ev.clientY - r.top}px`;
  document.body.append(wrap);
  void ghost.offsetWidth; // flush layout so the lift has a value to transition from
  ghost.classList.add('lift');

  col.style.flex = `0 0 ${r.width}px`;   // hold the slot open at its real width
  col.classList.add('drag-src');
  board.classList.add('dragging');
  document.body.style.cursor = 'grabbing';
  document.body.style.userSelect = 'none';
  uiDragLock++; // a remote apply mid-drag would rebuild the board under the ghost

  const ox = ev.clientX - r.left;
  let lastX = ev.clientX, px = ev.clientX, vx = 0, raf = null;

  const place = () => {
    const tilt = Math.max(-2.5, Math.min(2.5, vx * 0.2));
    wrap.style.transform =
      `translate3d(${lastX - ox}px, ${r.top}px, 0) rotate(${tilt.toFixed(2)}deg)`;
  };

  const retarget = x => {
    const others = cols().filter(c => c !== col);
    const next = others.find(o => {
      const b = o.getBoundingClientRect();
      return x < b.left + b.width / 2;
    });
    const same = next ? col.nextElementSibling === next : others[others.length - 1] === col.previousElementSibling;
    if (same) return;
    const before = new Map(others.map(o => [o.dataset.id, o.getBoundingClientRect().left]));
    board.insertBefore(col, next || tail);
    if (stillMotion.matches) return;
    others.forEach(o => {
      const dx = before.get(o.dataset.id) - o.getBoundingClientRect().left;
      if (dx) o.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }],
        { duration: 190, easing: EASE });
    });
  };

  const move = e => {
    vx = vx * 0.8 + (e.clientX - px) * 0.2;
    px = e.clientX;
    lastX = e.clientX;
    place();
    retarget(e.clientX);
  };

  // Settle the tilt and edge-scroll the board even while the pointer is still.
  const frame = () => {
    if (Math.abs(vx) > 0.05) { vx *= 0.86; place(); }
    const br = board.getBoundingClientRect();
    const zone = 64;
    if (lastX - br.left < zone) {
      board.scrollLeft -= 12 * (1 - (lastX - br.left) / zone);
      retarget(lastX);
    } else if (br.right - lastX < zone) {
      board.scrollLeft += 12 * (1 - (br.right - lastX) / zone);
      retarget(lastX);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);   // see the card drag
    cancelAnimationFrame(raf);
    board.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    uiDragLock--;
    const order = cols().map(x => x.dataset.id);
    const was = state.columns.map(x => x.id).join();
    // snapshot before the mutation, and only when it is a real move: stage
    // order decides which stage is done, so a reorder must be undoable.
    if (order.join() !== was) snapshot();
    state.columns.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (state.columns.map(x => x.id).join() !== was) save();

    // render() rebuilds the board, so the element we dragged is gone after this;
    // the ghost flies to wherever the freshly rendered column actually landed.
    render();
    const landed = board.querySelector(`.col[data-id="${id}"]`);

    let settled = false;
    const settle = () => { if (settled) return; settled = true; wrap.remove(); flushExternal(); };
    if (stillMotion.matches || !landed) { settle(); return; }

    const target = landed.getBoundingClientRect();
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
  document.addEventListener('pointercancel', up);
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
    id: C.uid(), // minted now, so an image still preparing knows its card
    title: '', notes: '', projectId: state.filter || null, session: '',
    flag: state.flagFilter || false, columnId: colId || state.columns[0].id,
    ...(IS_TEAM && state.assigneeFilter === 'mine' && state.me ? { assigneeId: state.me } : {}),
  };
  if (IS_TEAM) {
    // the team task never holds a session; the editor shows yours
    const mine = t ? privateSessionFor(t.id) : null;
    draft.session = mine ? mine.session : '';
    draft.sessionMachine = mine ? mine.sessionMachine || null : null;
    draft.sessionCwd = mine ? mine.sessionCwd || null : null;
    if (t) markSeen(t);
  }

  fTitle.value = draft.title;
  fNotes.value = draft.notes || '';
  fSession.value = draft.session || '';
  // Private on a team board: the lock takes the command caret's place.
  $('#f-session-wrap .caret').innerHTML = IS_TEAM ? `<span class="lock" title="${esc(tr('private'))}">${LOCK_ICON}</span>` : '&#9656;';
  renderAssignee();
  renderMachinePick();
  $('#f-archive').style.visibility = t ? 'visible' : 'hidden';
  $('#f-close').title = tr('discard');
  renderStage();
  renderProjectChooser();
  syncFlagBtn();
  beginDraftImages(t ? t.id : draft.id);

  scrim.hidden = false;
  editor.hidden = false;
  renderHistory();
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
  add.onclick = () => { saveEditor(); openProjects(); }; // closing = saving
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
  if (!draft.session) { draft.sessionMachine = null; draft.sessionCwd = null; }
  // Closing = saving: a card that is only a picture is still a card.
  if (!draft.title && draftImgs && draftImgs.adds.length) draft.title = imageTitle(draftImgs.adds[0]);

  if (!draft.title) { closeEditor(); return; }

  // Team board: the session firewall. The command, its computer and its
  // folder are pulled off the draft and written to your personal board after
  // the editor settles — the team task never carries them.
  let priv = null;
  if (IS_TEAM) {
    const before = editing !== 'new' ? privateSessionFor(editing) : null;
    const next = { session: draft.session, sessionMachine: draft.sessionMachine || null, sessionCwd: draft.sessionCwd || null };
    if ((before ? before.session : '') !== next.session || (before && before.sessionMachine) !== next.sessionMachine) priv = next;
    delete draft.session; delete draft.sessionMachine; delete draft.sessionCwd;
    const held = editing !== 'new' ? byId(editing) : null;
    if ((held ? held.assigneeId || null : null) !== (draft.assigneeId || null)) {
      if (!me()) draft.assigneeId = held ? held.assigneeId || null : null; // assigning needs an identity
      else { draft.assignedBy = me().id; draft.assignedAt = Date.now(); }
    }
  } else {
    if (!draft.sessionMachine) delete draft.sessionMachine;
    if (!draft.sessionCwd) delete draft.sessionCwd;
  }

  let savedId = null;
  if (editing === 'new') {
    savedId = addTask(draft).id;
  } else {
    const t = byId(editing);
    if (t) {
      const from = t.columnId;
      const moved = C.shouldLogMove(from, draft.columnId);
      Object.assign(t, draft, { updatedAt: Date.now() });
      if (IS_TEAM) { delete t.session; delete t.sessionMachine; delete t.sessionCwd; }
      if (!IS_TEAM && !draft.sessionMachine) delete t.sessionMachine;
      if (!IS_TEAM && !draft.sessionCwd) delete t.sessionCwd;
      if (moved) {
        t.order = -1;
        resequence(t.columnId);
        logEvent(t, 'moved', from, t.columnId);
      }
      savedId = t.id;
    }
    save();
    render();
  }
  if (savedId) { commitDraftImages(savedId); save(); render(); }
  closeEditor();
  // After the barrier lifts (closeEditor applies held remote changes): a card
  // deleted meanwhile gets no private session — a session edit must never be
  // what resurrects it.
  if (priv && savedId && byId(savedId)) {
    enqueue('session', privKey(savedId), priv);
    render();
  }
}

function closeEditor() {
  endDraftImages();
  closeLightbox();
  editor.hidden = true;
  editing = null;
  draft = null;
  syncScrim();
  if (seenChanged) { seenChanged = false; render(); }
  flushExternal(); // the editor was a sync barrier; apply what it held back
}

$('#f-save').onclick = saveEditor;
$('#f-close').innerHTML = ICON.close;
$('#f-close').onclick = closeEditor;   // the deliberate discard, now labelled
fFlag.onclick = () => { draft.flag = !draft.flag; syncFlagBtn(); popStar($('svg', fFlag), draft.flag); };
$('#f-session-copy').onclick = async () => {
  if (!fSession.value.trim()) return;
  const ok = await copyText(sessionCommand({ ...draft, session: fSession.value.trim() }));
  const wrap = $('#f-session-wrap');
  const btn = $('#f-session-copy');
  if (!ok) return;
  wrap.classList.add('copied');
  btn.innerHTML = ICON.check;
  setTimeout(() => { wrap.classList.remove('copied'); btn.innerHTML = ICON.copy; }, 1200);
};
$('#f-archive').onclick = () => {
  const id = editing;
  saveEditor(); // closing = saving: typed text and new images land first
  const t = byId(id);
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
        <button class="grab" title="${tr('reorder')}">${ICON.grip}</button>
        <div class="palette">${COLORS.map((c, i) =>
          `<button style="--c:${c}" aria-pressed="${c === p.color}" title="${COLOR_NAMES[i]}"></button>`).join('')}</div>`;

      $$('.palette button', row).forEach((b, i) => b.onclick = () => {
        p.color = COLORS[i];
        openSwatch = null;
        save(); render(); renderProjects();
      });
    } else {
      row.innerHTML = `
        <button class="grab" title="${tr('reorder')}">${ICON.grip}</button>
        <button class="swatch" title="Change color"></button>
        <input value="${esc(p.name)}" spellcheck="false">
        <span class="n">${n}</span>
        <button class="icon sm" title="Delete">${ICON.close}</button>`;

      $('input', row).addEventListener('change', e => {
        p.name = e.target.value.trim() || p.name;
        save(); render(); renderProjects();
        flushExternal();
      });
      $('.swatch', row).onclick = () => { openSwatch = p.id; renderProjects(); };
      $('.icon', row).onclick = () => {
        snapshot();
        state.tombstones = state.tombstones || {};
        state.tombstones[p.id] = Math.max(Date.now(), C.clockMax(state) + 1);
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
  uiDragLock++; // a remote apply mid-drag would rebuild the list under the ghost

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
    document.removeEventListener('pointercancel', up);   // see the card drag
    cancelAnimationFrame(raf);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    uiDragLock--;

    const order = [...list.querySelectorAll('.prow')].map(x => x.dataset.id);
    const before = state.projects.map(x => x.id).join();
    // project order drives the filter chips, the report grouping and the
    // export, so a reorder must be undoable like every other change
    if (order.join() !== before) snapshot();
    state.projects.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (state.projects.map(x => x.id).join() !== before) { save(); render(); }

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      wrap.remove();
      renderProjects();
      flushExternal();
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
  document.addEventListener('pointercancel', up);
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

/* ── sync sheet ────────────────────────────────────────────
   One shell owns both sides of pairing: Start shares this board; Join accepts
   the same link on a desktop. Candidate inspection is a state, not a mutation,
   and a real local board chooses Replace or Combine explicitly. */

const syncEl = $('#sync');
let syncView = 'off';       // off | join | checking | blocked | choose | failed | on | end
let syncFailMsg = null;     // which failure the failed view explains
let syncingSince = 0;       // when the in-flight push started
let syncNoticeKey = null;   // transient inline result for the connected view
let syncReturnFocus = null;

$('[data-close]', syncEl).innerHTML = ICON.close;
$('#sync-copy').innerHTML = ICON.copy;

/** Santiago, like every other date in the app: a second device-local clock
    could disagree with the day boundary printed beside it. */
const SYNC_CLOCK = new Intl.DateTimeFormat('en-GB',
  { timeZone: C.TZ, hour: '2-digit', minute: '2-digit', hour12: false });

function syncWhen(ms) {
  const day = C.ymd(ms), today = C.ymd();
  if (day === today) return SYNC_CLOCK.format(new Date(ms));
  if (day === C.addDays(today, -1)) return tr('yesterday');
  return day;
}

/** The footer reports OUTBOUND only. An inbound change explains itself by
    moving the board (see flip()), and a status line flickering every time
    the phone saves would undo that explanation. */
function syncStatusLine() {
  if (syncView === 'checking') return tr('checkingLink');
  if (syncView === 'failed') return syncFailMsg === 'gone' ? tr('linkNotFound') : tr('syncNoAnswer');
  if (!sync) return '';
  switch (syncStatus) {
    // below ~400ms the round trip is invisible and the timestamp is the news
    case 'syncing': return Date.now() - syncingSince > 400 ? tr('syncing') : lastStatusText;
    case 'offline': return tr('syncOffline');
    case 'gone': return tr('syncGone');
    case 'error': return tr('syncTooBig');
    default: {
      const when = syncedAt ? syncWhen(syncedAt) : '';
      if (!when) return '';
      // `live` means the socket is genuinely open, never optimism: a change
      // on the other device will arrive here without anyone asking.
      const live = watchSock && watchSock.readyState === 1;
      return tr(live ? 'syncLive' : 'syncedAt', { when });
    }
  }
}

let lastStatusText = '';

function renderSyncStatus() {
  if (syncEl.hidden) return;
  const el = $('#sync-status');
  const next = syncStatusLine();
  lastStatusText = next;
  // role="status" re-announces on every assignment, so only write on change
  if (el.textContent !== next) el.textContent = next;
}

/* The QR encoder is a quarter of the app's JavaScript for a feature most
   boards never turn on, so it arrives when the sheet first needs to draw
   one — a plain classic script from the same directory, so `file:` keeps
   working. If it cannot load, the link column stands alone: the QR is never
   load-bearing. */
let qrLoad = null;
function ensureQr() {
  if (window.qrcodegen) return Promise.resolve(true);
  if (!qrLoad) {
    qrLoad = new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'qr.js';
      s.onload = () => resolve(!!window.qrcodegen);
      s.onerror = () => resolve(false);
      document.head.append(s);
    });
  }
  return qrLoad;
}

/** One inline SVG, one path. Graphite on white in both themes. */
function qrSvg(text) {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) d += `M${x} ${y}h1v1h-1z`;
  }
  return `<svg viewBox="0 0 ${qr.size} ${qr.size}" role="img" aria-label="${tr('pairingLink')}"`
    + ` shape-rendering="crispEdges"><path d="${d}"/></svg>`;
}

function boardSignature(st, label) {
  const cards = (st.tasks || []).length;
  const stages = (st.columns || []).length;
  return `${label} · ${cards} ${tr(cards === 1 ? 'card' : 'cards')}`
    + ` · ${stages} ${tr(stages === 1 ? 'stage' : 'stages')}`;
}

function setSyncOutsideInert(on) {
  for (const el of document.body.children) {
    if (el === syncEl || el === scrim || el.tagName === 'SCRIPT') continue;
    el.inert = on;
  }
}

function focusSyncState() {
  requestAnimationFrame(() => {
    if (syncEl.hidden) return;
    if (syncView === 'join') { $('#sync-join-input').focus(); return; }
    if (syncView === 'off') { $('#sync-enable').focus(); return; }
    if (syncView === 'on') { $('#sync-url').focus(); $('#sync-url').select(); return; }
    $('#sync-state-title').focus();
  });
}

syncEl.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const focusable = $$('button:not([hidden]):not([disabled]), input:not([hidden]):not([disabled]), [tabindex]:not([tabindex="-1"])', syncEl)
    .filter(el => !el.closest('[hidden]'));
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === $('#sync-state-title'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

function renderSync() {
  if (syncEl.hidden) return;
  const view = syncView;
  const title = $('#sync-state-title');
  const say = $('#sync-say');
  const titleKey = view === 'off' || view === 'join' ? 'syncOffTitle'
    : view === 'checking' ? 'checkingLink'
    : view === 'blocked' ? 'alreadyOtherTitle'
    : view === 'choose' ? 'chooseJoinTitle'
    : view === 'failed' ? (syncFailMsg === 'gone' ? 'deadLinkTitle' : 'offlineLinkTitle')
    : view === 'end' ? 'endSyncTitle' : 'addDevice';
  const sayKey = view === 'off' || view === 'join' ? 'syncPitch'
    : view === 'blocked' ? 'alreadyOtherBody'
    : view === 'choose' ? 'chooseJoinBody'
    : view === 'failed' ? (syncFailMsg === 'gone' ? 'deadLinkBody' : 'offlineLinkBody')
    : view === 'end' ? 'endSyncBody'
    : view === 'on' && syncNoticeKey ? syncNoticeKey : null;
  title.textContent = tr(titleKey);
  say.hidden = !sayKey;
  say.textContent = sayKey ? tr(sayKey) : '';

  $('#sync-join').hidden = view !== 'join';
  $('#sync-choice').hidden = view !== 'choose';
  $('#sync-pair').hidden = view !== 'on';
  $('#sync-actions').hidden = view !== 'on';

  $('#sync-join-label').textContent = tr('pasteSyncLink');
  $('#sync-join-go').textContent = tr('continue');
  $('#sync-enable').hidden = view !== 'off';
  $('#sync-enable').textContent = tr('enableSync');
  $('#sync-join-open').hidden = view !== 'off';
  $('#sync-join-open').textContent = tr('joinSyncLink');
  $('#sync-view').hidden = view !== 'blocked';
  $('#sync-view').textContent = tr('viewCurrentSync');
  $('#sync-cancel').hidden = !['join', 'checking', 'choose', 'failed', 'end'].includes(view);
  $('#sync-cancel').textContent = tr('cancel');
  $('#sync-retry').hidden = !(view === 'failed' && syncFailMsg === 'offline');
  $('#sync-retry').textContent = tr('tryAgain');
  $('#sync-end-confirm').hidden = view !== 'end';
  $('#sync-end-confirm').textContent = tr('endSync');

  if (view === 'choose' && pendingCandidate) {
    $('#sync-replace-label').textContent = tr('replaceLinked');
    $('#sync-replace-desc').textContent = tr('replaceLinkedDesc');
    $('#sync-combine-label').textContent = tr('combineBoards');
    $('#sync-combine-desc').textContent = tr('combineBoardsDesc');
    $('#sync-linked-signature').textContent = boardSignature(pendingCandidate.remote, tr('linkedBoard'));
    $('#sync-local-signature').textContent = boardSignature(state, tr('thisDevice'));
    $('#sync-export').textContent = tr('exportCurrent');
  }

  if (view === 'on') {
    const link = syncLink();
    $('#sync-scan').textContent = tr('syncScanLine');
    $('#sync-url').value = link;
    // once the personal board carries team secrets, its link reaches them too
    $('#sync-warn').textContent = IS_HOME && (state.teams || []).length
      ? `${tr('syncWarning')} ${tr('personalLinkTeams')}` : tr('syncWarning');
    $('#sync-cli-summary').textContent = tr('syncCli');
    $('#sync-cli-say').textContent = tr('syncCliSay');
    // The link is never interpolated here: it is a password, and this block is
    // the one part of the sheet a person is likely to screenshot.
    $('#sync-cli-cmd').textContent =
      'npm i -g kanban.page\nkanban board add mine';
    const plate = $('#sync-qr');
    ensureQr().then(ok => {
      // the sheet may have moved on while the script loaded
      if (syncEl.hidden || syncView !== 'on') return;
      plate.hidden = !ok;
      if (ok) plate.innerHTML = qrSvg(syncLink());
    });
    $('#sync-stop-label').textContent = tr('disconnectDevice');
    $('#sync-stop-desc').textContent = tr('disconnectDesc');
    $('#sync-del-label').textContent = tr('endSyncAll');
    $('#sync-del-desc').textContent = tr('endSyncAllDesc');
  }

  renderSyncStatus();
}

function openSync(view, returnFocus = null) {
  closeComposer();
  disarm();
  if (syncEl.hidden) {
    const active = document.activeElement;
    syncReturnFocus = returnFocus
      || (active && active.closest && active.closest('#menu') ? $('#menuBtn') : active);
  }
  syncView = view || (sync ? 'on' : 'off');
  syncEl.hidden = false;
  scrim.hidden = false;
  setSyncOutsideInert(true);
  renderSync();
  focusSyncState();
}

function closeSync() {
  joinAttempt++;
  pendingCandidate = null;
  pendingSecret = null;
  syncEl.hidden = true;
  disarm();
  syncNoticeKey = null;
  syncView = sync ? 'on' : 'off';
  setSyncOutsideInert(false);
  syncScrim();
  const back = syncReturnFocus;
  syncReturnFocus = null;
  if (back && back.isConnected && typeof back.focus === 'function') back.focus();
}

$('[data-close]', syncEl).onclick = closeSync;

$('#sync-enable').onclick = async () => {
  const b = $('#sync-enable');
  b.disabled = true;
  syncingSince = Date.now();
  setSyncStatus('syncing');
  const ok = await enableSync();
  b.disabled = false;
  if (!ok) { toast(tr('syncFailed')); syncStopped(); renderSync(); return; }
  syncView = 'on';
  renderSync();
  focusSyncState();
};

$('#sync-retry').onclick = () => {
  if (!pendingSecret) { closeSync(); return; }
  inspectCandidate(pendingSecret);
};

$('#sync-join-open').onclick = () => { syncView = 'join'; renderSync(); focusSyncState(); };

function parseSyncEntry(value) {
  const text = value.trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return { secret: text, search: location.search };
  let url;
  try { url = new URL(text); } catch (err) { return null; }
  const match = url.hash.match(/[#&]sync=([A-Za-z0-9_-]{43})(?:&|$)/);
  return match ? { secret: match[1], search: url.search } : null;
}

$('#sync-join').onsubmit = e => {
  e.preventDefault();
  const input = $('#sync-join-input');
  const parsed = parseSyncEntry(input.value);
  input.value = '';
  if (!parsed) {
    syncFailMsg = 'gone';
    syncView = 'failed';
    renderSync();
    focusSyncState();
    return;
  }
  if (parsed.search !== location.search) {
    location.assign(`${location.pathname}${parsed.search}#sync=${parsed.secret}`);
    return;
  }
  presentCandidateWhenSettled(parsed.secret);
};

$('#sync-replace').onclick = () => commitCandidate('replace');
$('#sync-combine').onclick = () => commitCandidate('combine');
$('#sync-export').onclick = exportBackup;
$('#sync-view').onclick = () => { syncNoticeKey = null; syncView = 'on'; renderSync(); focusSyncState(); };
$('#sync-cancel').onclick = () => {
  if (syncView === 'end') { syncView = 'on'; renderSync(); focusSyncState(); return; }
  if (syncView === 'join') { syncView = 'off'; renderSync(); focusSyncState(); return; }
  closeSync();
};

/* Copy confirms in place, the way the editor's session line does — no toast.
   Every copy in this app with a surface to show a state uses it. */
$('#sync-copy').onclick = async () => {
  if (!sync) return;
  const ok = await copyText(syncLink());
  if (!ok) { toast(tr('couldNotCopy')); return; }
  const wrap = $('#sync-url-wrap');
  const btn = $('#sync-copy');
  wrap.classList.add('copied');
  btn.innerHTML = ICON.check;
  setTimeout(() => { wrap.classList.remove('copied'); btn.innerHTML = ICON.copy; }, 1200);
};

/* Stopping forgets this device's key: the board stays whole and local, and
   other devices keep syncing. No card is lost, so an armed confirm would be
   ceremony — but the secret may exist nowhere else, so it takes the app's
   other safety idiom instead. undo() cannot serve: it restores board state,
   and the secret lives outside state by design. */
$('#sync-stop').onclick = () => {
  const was = sync && clone(sync);
  syncStopped();
  closeSync();
  toast(tr('syncStopped'), () => {
    if (!was || sync) return;
    suspendSyncRuntime();
    state._bindingGen = nextGen(bindingGenOf(state), bindingGenOf(was));
    lastStamped = clone(state);
    if (!writeStateNow()) return;
    sync = { ...was, _bindingGen: clone(bindingGenOf(state)) };
    syncKeys = null;
    remoteHead = '';
    rejectedPayload = '';
    floor = null;
    saveSyncConfig();
    connectWatch();
    pull();
  });
};

$('#sync-del').onclick = () => { syncView = 'end'; renderSync(); focusSyncState(); };

$('#sync-end-confirm').onclick = async () => {
  const b = $('#sync-end-confirm');
  b.disabled = true;
  const deleted = await deleteFromServer();
  b.disabled = false;
  if (!deleted) {
    syncView = 'on';
    renderSync();
    focusSyncState();
    toast(tr('syncDeleteFailed'), null, 8000);
    return;
  }
  closeSync();
  toast(tr('serverDeleted'));
};

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
  if (act === 'sync') openSync(null, $('#menuBtn'));
  if (act === 'computers') openComputers();
  if (act === 'leave') leaveTeam();
});

// The menu is the only place that names the last stage, so label it live.
$('#menuBtn').addEventListener('click', () => {
  const col = state.columns[state.columns.length - 1];
  const n = col ? state.tasks.filter(t => t.columnId === col.id && onBoard(t)).length : 0;
  $('#act-archive-last').textContent = col
    ? `${tr('archiveVerb')} ${col.name.toLowerCase()}${n ? ` (${n})` : ''}`
    : tr('archiveFinished');
  $('#act-density').setAttribute('aria-pressed', String(state.density === 'compact'));
  // The one place sync has standing presence: without it, someone who paired
  // three months ago has no way to learn this board leaves the machine.
  $('#act-sync').setAttribute('aria-pressed', String(!!sync));
  $('#act-computers').hidden = IS_TEAM;
  $('#act-leave').hidden = !IS_TEAM || !teamEntry() && !sync;
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

async function exportBackup() {
  // A backup travels; team secrets and device bookkeeping stay home. It
  // carries the image bytes too, and says so when it could not get them all.
  const out = C.exportable(state);
  const { images, missing } = C.liveAttachments(state).length ? await backupImages() : { images: {}, missing: [] };
  if (Object.keys(images).length) out.images = images;
  if (missing.length) out.imagesMissing = missing;
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `board-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(missing.length ? tr('backupPartial').replace('{n}', missing.length) : 'Backup saved', null, missing.length ? 8000 : 5200);
}

$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 200 * 1024 * 1024) throw new Error('size');
    const next = JSON.parse(await file.text());
    // image bytes go to the device store, never into board state — and only
    // once the file has proved to be a board this page may import
    const images = { images: next.images, attachments: next.attachments };
    delete next.images;
    delete next.imagesMissing;
    if (!Array.isArray(next.columns) || !Array.isArray(next.tasks)) throw new Error('shape');
    if (C.isFutureBoard(next) || readOnly) throw new Error('newer');
    // a backup never carries team secrets (exportable), and a file from the
    // other kind of board cannot be imported over this one
    for (const k of ['teams', 'teamsLeft', 'teamsReqApplied']) delete next[k];
    if (C.validateSyncable({ ...next, v: 2 }, KIND)) throw new Error('kind');
    await restoreImages(images);
    snapshot(!sync);
    const incoming = keepMembership(C.migrate(next), state); // also upgrades a v1 backup on the way in
    // While synced, importing MERGES. A replace would push a snapshot that
    // shrinks the relay's event log — and the log is the only copy of the
    // history, so no import may be able to truncate it for every device.
    if (sync) {
      state = C.merge(incoming, state);
      save();
    } else {
      incoming._contentGen = nextGen(contentGenOf(state), contentGenOf(incoming));
      incoming._bindingGen = clone(maxGen(bindingGenOf(state), bindingGenOf(incoming)));
      installLocalState(incoming);
    }
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
  // Tombstones carry the delete to other devices — ids only, never content:
  // a tombstone must not preserve what the user deliberately destroyed. The
  // clock outruns everything observed, so no stale copy can outvote it.
  const at = Math.max(Date.now(), C.clockMax(state) + 1);
  state.tombstones = state.tombstones || {};
  ids.forEach(id => { state.tombstones[id] = at; });
  state.tasks = state.tasks.filter(t => !gone.has(t.id));
  save();
  render();
  renderArchive();
  // The report still lists these — it keeps a title snapshot on every event.
  toast(locale === 'es' ? `Eliminada${ids.length === 1 ? '' : 's'} ${ids.length}` : `Deleted ${ids.length}`, () => { undo(); renderArchive(); });
}

/* ── undo + toast ──────────────────────────────────────── */

let undoSnap = null;
let undoReplacesBoard = false;

function snapshot(replacesBoard = false) {
  undoSnap = clone(state);
  undoReplacesBoard = replacesBoard;
}

/* Team membership and private sessions are never rolled back by a board
   snapshot: an import, or undoing one, must not drop a team you joined in the
   meantime or bring back one you left (docs/team.md). Leave has its own Undo,
   which is a rejoin request. */
const KEEP_ACROSS_SNAPSHOTS = ['teams', 'teamsLeft', 'teamsReqApplied', 'privateSessions'];
function keepMembership(next, from) {
  for (const k of KEEP_ACROSS_SNAPSHOTS) {
    if (from[k] !== undefined) next[k] = clone(from[k]); else delete next[k];
  }
  // Images are a set: a snapshot neither drops one a teammate added since
  // nor revives one removed since — per key, the newer entry stands.
  const images = C.unionFloor({ attachments: next.attachments }, { attachments: from.attachments }).attachments;
  if (images) next.attachments = clone(images); else delete next.attachments;
  return next;
}

function undo() {
  if (!undoSnap) return;
  const replacement = undoReplacesBoard;
  const next = keepMembership(undoSnap, state);
  undoSnap = null;
  undoReplacesBoard = false;
  if (replacement) {
    next._contentGen = nextGen(contentGenOf(state), contentGenOf(next));
    next._bindingGen = clone(maxGen(bindingGenOf(state), bindingGenOf(next)));
    installLocalState(next);
  } else {
    state = next;
    save();
  }
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
  const was = scrim.hidden;
  scrim.hidden = editor.hidden && panel.hidden && reportEl.hidden && archiveEl.hidden && syncEl.hidden
    && $('#computers').hidden;
  // A scrim that has just appeared has not been pressed yet. See below.
  if (was && !scrim.hidden) scrimPressed = false;
}

/* A tap dispatches pointerup and THEN a compatibility click, and the click is
   hit-tested fresh — by which time opening the editor has already raised the
   scrim under the finger. So the very gesture that opened a panel landed here
   and closed it again, and on a phone a card could not be opened at all:
   editorOpen was false 60ms and 560ms after a real touch tap, while the same
   gesture with a mouse opened it fine (a mouse click targets the down/up
   common ancestor, not a fresh hit test).
   Closing stays on click, so the desktop feel is unchanged — it just has to be
   a click whose press also landed on the scrim. */
let scrimPressed = false;
scrim.addEventListener('pointerdown', () => { scrimPressed = true; });
scrim.onclick = () => {
  if (!scrimPressed) return;
  scrimPressed = false;
  // Closing a text surface saves. The quick composer has always worked this
  // way; the editor did the opposite and silently threw the draft away, with
  // no undo — undo() restores board state, and a draft was never in state.
  // On a phone the scrim is 57% of the screen and is also how you dismiss the
  // keyboard, so the discard was one stray tap away. saveEditor() already
  // bails to closeEditor() on an empty title, so an accidental open costs
  // nothing. Esc and the ✕ remain the deliberate ways to throw work away.
  if (!editor.hidden) saveEditor(); else closeEditor();
  closeProjects(); closeReport(); closeArchive(); closeSync();
};

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
  // An image: into the open editor wherever the caret is, or on the bare
  // board as a new card — ahead of resume text in the same clipboard.
  const images = clipboardImages(e);
  if (images.length) {
    if (!editor.hidden) { e.preventDefault(); addImageFiles(images); return; }
    const typingElsewhere = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
    if (!typingElsewhere && panel.hidden && reportEl.hidden && archiveEl.hidden && syncEl.hidden && !readOnly) {
      e.preventDefault();
      openEditor(null);
      addImageFiles(images);
      return;
    }
  }
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  if (!editor.hidden || !panel.hidden || !reportEl.hidden || !archiveEl.hidden || !syncEl.hidden) return;

  const text = (e.clipboardData || window.clipboardData).getData('text') || '';
  const line = text.split('\n').map(s => s.trim()).find(s => RESUME.test(s));
  if (!line) return;

  e.preventDefault();
  openEditor(null);
  fSession.value = line;
  draft.sessionMachine = hereId(); // pasted here, so it lives here
  renderMachinePick();
  fTitle.focus();
});

document.addEventListener('keydown', e => {
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;

  if (lightboxEl) {
    if (e.key === 'Escape') { e.preventDefault(); closeLightbox(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); stepLightbox(e.key === 'ArrowLeft' ? -1 : 1); return; }
  }
  if (e.key === 'Escape') {
    if (!menu.hidden) { menu.hidden = true; return; }
    if (!weeksEl.hidden) { weeksEl.hidden = true; return; }
    if (!editor.hidden) { closeEditor(); return; }
    if (!reportEl.hidden) { closeReport(); return; }
    if (!panel.hidden) { closeProjects(); return; }
    if (!archiveEl.hidden) { closeArchive(); return; }
    if (!syncEl.hidden) { closeSync(); return; }
    if (!boardsMenu.hidden) { closeBoardsMenu(); return; }
    if (!machineMenu.hidden) { closeMachineMenu(); return; }
    if (!compPanel.hidden) { closeComputers(); return; }
    if (!profileMenu.hidden) { closeProfile(); return; }
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
  // character starts the first card instead of firing a shortcut — unless a
  // panel is open, where the keystroke belongs to whatever is on screen.
  if (boardIsEmpty() && e.key.length === 1
    && editor.hidden && panel.hidden && reportEl.hidden && archiveEl.hidden && syncEl.hidden) {
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
  reportFresh.clear();
  repWeek = defaultWeek();
  reportEl.hidden = false;
  scrim.hidden = false;
  renderReport(true);
  freshenReport();
}

function closeReport() {
  reportAttempt++; // a late read-only fetch is inert once the report closes
  reportEl.hidden = true;
  weeksEl.hidden = true;
  $('#rep-week').setAttribute('aria-expanded', 'false');
  syncScrim();
  flushExternal();
}

function lookupTask(taskId) {
  const t = byId(taskId);
  if (!t) return null;
  const p = projectOf(t);
  // byId does not filter the archive, and archiving logs no event — so a card
  // can leave the board without the log noticing. Report it as an annotation;
  // it must never decide which tense a row belongs to.
  return { title: t.title, project: p ? p.name : null, archived: !!t.archivedAt };
}

const selected = () => repEntries.filter(e => repSel.has(e.rowKey));

/** Every board this report reads, freshest copy first: this one, then the
    personal board and your teams (docs/team.md → my week). */
function reportBoards() {
  const srcs = reportSources().map(src => ({ ...src, board: reportFresh.get(src.ns) || src.board }));
  return srcs.filter(src => src.board && src.board.columns);
}
const reportEvents = () => [state.events, ...reportBoards().map(src => src.board.events || [])].flat();

/** Weeks you can reach: first activity through this week. */
function weekBounds() {
  const weeks = C.weeksWithActivity(reportEvents(), C.ymd());
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
  const doneCol = state.columns[state.columns.length - 1];
  const done = doneCol.name;
  // This board first, as ever; on a team board only your rows. Then the
  // other boards, each aggregated alone against its own done column — boards
  // are never merged into one log.
  repEntries = rowsFrom(state, NS || null, IS_TEAM ? teamLabel(teamEntry()) : null, IS_TEAM ? state.me : null);
  if (IS_TEAM && !state.me) repEntries = [];
  for (const src of reportBoards()) {
    repEntries = repEntries.concat(rowsFrom(src.board, src.ns, src.label, src.me));
  }
  repEntries.forEach(e => { e.active = (e.ns || null) === (NS || null); });

  // Selections live per week, so stepping away and back does not silently
  // throw away a partial pick. Keyed by board and card: a task id on two
  // boards is two rows and can never tick the wrong one.
  const known = new Set(repEntries.map(e => e.rowKey));
  let sel = repSelByWeek.get(repWeek);
  if (!sel) {
    sel = new Set(repEntries.filter(e => e.include).map(e => e.rowKey));
    repSelByWeek.set(repWeek, sel);
  } else {
    [...sel].forEach(id => { if (!known.has(id)) sel.delete(id); });
  }
  repSel = sel;

  repLabel.textContent = C.weekLabel(repWeek, locale);

  const thisWeek = C.mondayOf(C.ymd());
  const rel = repWeek === thisWeek ? tr('thisWeek')
    : repWeek === C.addDays(thisWeek, -7) ? tr('lastWeek') : null;
  // A team copy the report tried and failed to refresh says how old it is.
  const staleSrc = reportSources().find(src => src.label && reportStale.has(src.ns));
  let stale = null;
  if (staleSrc) {
    const at = Number(readJson(`board.read.${staleSrc.ns || ''}`)) || 0;
    stale = at ? tr('teamStale', { time: new Intl.DateTimeFormat('en-GB', { timeZone: C.TZ, hour: '2-digit', minute: '2-digit' }).format(at) }) : tr('teamOffline');
  }
  const finished = repEntries.filter(e => e.to === e.done).length;
  const summary = reportSources().length ? summaryAcross(repEntries, finished) : C.summaryLine(repEntries, done, locale);
  $('#rep-sum').textContent = repEntries.length
    ? [rel, summary, stale].filter(Boolean).join(' · ')
    : [rel, stale].filter(Boolean).join(' · ');

  const body = $('#rep-body');
  body.innerHTML = '';

  if (!repEntries.length) {
    body.innerHTML = `<p class="rep-empty">${tr('nothingMoved')}</p>`;
  } else {
    const order = reportProjectOrder();
    // Grouped by tense, exactly as the export is, so you can see which section
    // a row will land in before deciding to tick it. Project order still sorts
    // within a section.
    [['shipped', tr('shipped')], ['inflight', tr('inFlight')]].forEach(([tense, label]) => {
      const section = repEntries.filter(e => (e.tense || 'shipped') === tense);
      if (!section.length) return;
      const head = document.createElement('div');
      head.className = 'rep-tense';
      head.textContent = label;
      body.append(head);
      C.groupByProject(section, order).forEach(g => g.entries.forEach(e => body.append(reportRow(e))));
    });
  }

  syncRepFoot();

  const { first, last } = weekBounds();
  $('#rep-prev').disabled = repWeek <= first;
  $('#rep-next').disabled = repWeek >= last;
}

/** The footer is the promise: this count is what Copy will hand you. */
function syncRepFoot() {
  const n = repSel.size;
  $('#rep-count').textContent = n || !repEntries.length
    ? `${n} / ${repEntries.length}`
    : `${n} / ${repEntries.length} · ${tr('tickToExport')}`;
  $('#rep-all').textContent = n === repEntries.length && repEntries.length ? tr('selectNone') : tr('selectAll');
  const exportable = n > 0 || !repEntries.length;
  $('#rep-copy').disabled = !exportable;
  $('#rep-save').disabled = !exportable;
}

/** Project order across boards: the personal board's, then team-only names. */
function reportProjectOrder() {
  const personal = IS_TEAM ? (homeBoard().projects || []) : state.projects;
  const order = personal.map(p => p.name);
  const extra = new Set();
  repEntries.forEach(e => { if (e.project && !order.includes(e.project)) extra.add(e.project); });
  return [...order, ...[...extra].sort((a, b) => a.localeCompare(b))];
}
function summaryAcross(entries, finished) {
  const n = entries.length;
  const es = locale === 'es';
  const created = entries.filter(e => e.created).length;
  const parts = [es ? `${n} ${n === 1 ? 'tarjeta' : 'tarjetas'}` : `${n} card${n === 1 ? '' : 's'}`];
  if (created) parts.push(es ? `${created} cread${created === 1 ? 'a' : 'as'}` : `${created} created`);
  if (finished) parts.push(es ? `${finished} finalizada${finished === 1 ? '' : 's'}` : `${finished} finished`);
  return parts.join(' · ');
}

function reportRow(e) {
  const personalProjects = IS_TEAM ? (homeBoard().projects || []) : state.projects;
  const p = personalProjects.find(x => x.name === e.project) || state.projects.find(x => x.name === e.project);
  const row = document.createElement('div');
  row.className = 'rep-row' + (repSel.has(e.rowKey) ? ' on' : '') + (e.netZero ? ' zero' : '');
  const color = p ? p.color : e.color;
  if (color) row.style.setProperty('--c', color);
  // Off the board — archived or deleted. Marked in the route slot, the same
  // slot and the same language as a round trip's ↺: something happened to this
  // card that the week's route alone does not tell you.
  const gone = e.deleted || e.archived;
  row.innerHTML = `
    <span class="tick">${ICON.check}</span>
    <span class="rt">${esc(e.title)}</span>
    <span class="rp">${e.project ? esc(e.project) : '—'}</span>
    <span class="rf">${e.netZero
      ? `${esc(e.to)} <i>&#8634;</i>`
      : `${esc(e.from)}<i>&#8594;</i>${esc(e.to)}`}${
      gone ? ` <i title="${tr('offBoard')}">&#8856;</i>` : ''}${
      e.boardLabel ? ` <span class="rtag">${esc(e.boardLabel)}</span>` : ''}</span>
    ${e.active ? `<button class="rd" title="${tr('weeklyReport')}">${C.dayLabel(e.day, locale)}</button>`
      : `<span class="rd static">${C.dayLabel(e.day, locale)}</span>`}`;

  row.onclick = () => {
    if (repSel.has(e.rowKey)) repSel.delete(e.rowKey); else repSel.add(e.rowKey);
    row.classList.toggle('on');
    if (!stillMotion.matches) {
      $('.tick', row).animate(
        [{ transform: 'scale(.8)' }, { transform: 'scale(1)' }],
        { duration: 180, easing: EASE }
      );
    }
    syncRepFoot();
  };

  // Dates are edited on the board that owns the row; another board's rows
  // show the date without the editor in v1.
  if (e.active) $('.rd', row).onclick = ev => { ev.stopPropagation(); editDay(row, e); };
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
    if (!day || day === entry.day) { renderReport(false); flushExternal(); return; }

    const conflict = C.rewriteConflict(state.events, entry, day);
    if (conflict) {
      renderReport(false);
      toast(conflict === 'before' ? 'That is before this card existed' : 'Not a date');
      flushExternal();
      return;
    }

    snapshot();
    C.rewriteDay(state.events, entry, day);
    save();
    const gone = !C.contains(repWeek, day);
    renderReport(false);
    if (gone) toast(`Moved to ${C.weekLabel(C.mondayOf(day))}`, undo);
    flushExternal(); // the date input was a sync barrier
  };

  input.addEventListener('change', commit);
  input.addEventListener('blur', () => setTimeout(commit, 60));
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { settled = true; renderReport(false); flushExternal(); }
  });
}

function reportMarkdown() {
  return C.toMarkdown(selected(), repWeek, {
    projectOrder: reportProjectOrder(),
    locale,
  });
}

$('#reportBtn').onclick = openReport;
$('#rep-close').onclick = closeReport;
$('#rep-prev').onclick = () => goWeek(C.addDays(repWeek, -7));
$('#rep-next').onclick = () => goWeek(C.addDays(repWeek, 7));

$('#rep-all').onclick = () => {
  // Mutate the set in place, never rebind it: renderReport restores repSel
  // from repSelByWeek on every pass, so a fresh Set here is discarded before
  // it reaches the screen. Select-none only ever worked because clear() mutates.
  if (repSel.size === repEntries.length) repSel.clear();
  else repEntries.forEach(e => repSel.add(e.rowKey));
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
  C.weeksWithActivity(reportEvents(), C.ymd(), locale).forEach(w => {
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

/* ── team boards & computers ───────────────────────────────
   docs/team.md and docs/computers.md. A team board is a board with a roster;
   everything here is invisible on a board without one. The personal board
   carries the teams you belong to, your computers and your private sessions
   for team cards — and only the personal board's own page ever writes them:
   other pages leave immutable request records that it ingests. */

const readJson = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (err) { return null; } };
function readStored(key) {
  const raw = readJson(key);
  if (!raw || typeof raw !== 'object' || C.isFutureBoard(raw)) return null;
  try { return C.migrate(raw); } catch (err) { return null; }
}
const homeBoard = () => IS_HOME ? state : (readStored(HOME_KEY) || { teams: [], machines: [], privateSessions: {} });

/* identity */

const memberOf = (id, st = state) => (st.members || []).find(m => m.id === id) || null;
/** The member this device is, on this team board — or null. */
function me() {
  if (!IS_TEAM || !state.me) return null;
  return memberOf(state.me);
}
const initials = name => {
  const words = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((words[0] || '?')[0] + (words.length > 1 ? words[words.length - 1][0] : (words[0] || '')[1] || '')).toUpperCase();
};
function avatarHtml(m, cls = '') {
  if (!m) return '';
  const pix = m.avatar && SPRITES[m.avatar];
  return `<span class="av ${pix ? 'pix ' : ''}${cls}" style="--c:${m.color || COLORS[7]}" title="${esc(m.name)}">${pix ? spriteSvg(m.avatar) : esc(initials(m.name))}</span>`;
}
function nextMemberColor() {
  const used = new Set((state.members || []).map(m => m.color));
  return COLORS.find(c => !used.has(c)) || COLORS[(state.members || []).length % COLORS.length];
}
function setMe(id) {
  state.me = id;
  // "New for you" only ever covers assignments made after this moment, on a
  // logical clock — so a reinstall or a fast-clock device never re-marks old
  // work as new.
  state.meSinceClock = C.clockMax(state);
  save();
}

/* request records — the only way a page reaches the personal board */

function reqRecords() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(REQ_PREFIX)) continue;
      const r = readJson(k);
      if (r && typeof r.reqId === 'string' && typeof r.order === 'number' && typeof r.key === 'string') out.push(r);
    }
  } catch (err) { /* storage unavailable: nothing queued */ }
  return out;
}
const reqGroup = r => (r.kind === 'session' ? 'session:' : r.kind === 'profile' ? 'profile:' : 'team:') + r.key;
const newerReq = (a, b) => b.order > a.order || (b.order === a.order && b.reqId > a.reqId) ? b : a;
function latestReq(group) {
  const list = reqRecords().filter(r => reqGroup(r) === group);
  return list.length ? list.reduce(newerReq) : null;
}

/** Order is causal: past every request this page has seen for the same team
    or session, and past `after` — so leave's Undo always follows its leave. */
function enqueue(kind, key, payload, after = 0) {
  const rec = { reqId: C.uid(), kind, key, payload, order: 0 };
  const group = reqGroup(rec);
  const home = homeBoard();
  const seen = Math.max(0, ...reqRecords().filter(r => reqGroup(r) === group).map(r => r.order),
    ((home.teamsReqApplied || {})[group]) || 0);
  rec.order = Math.max(Date.now(), seen + 1, after + 1);
  try { localStorage.setItem(REQ_PREFIX + rec.reqId, JSON.stringify(rec)); }
  catch (err) { toast(tr('storageUnavailable'), null, 8000); }
  if (IS_HOME) ingestRequests();
  return rec;
}

/** Personal page only. Per team (or session), the newest request applies;
    records at or below the persisted high-water mark are deleted — only after
    that mark has reached storage, so a superseded leave can never replay. */
function ingestRequests() {
  if (!IS_HOME || readOnly) return;
  const recs = reqRecords();
  if (!recs.length) return;
  state.teamsReqApplied = state.teamsReqApplied || {};
  const groups = new Map();
  recs.forEach(r => { const g = reqGroup(r); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
  let changed = false;
  for (const [g, list] of groups) {
    const top = list.reduce(newerReq);
    if (top.order > (state.teamsReqApplied[g] || 0)) {
      applyRequest(top);
      state.teamsReqApplied[g] = top.order;
      changed = true;
    }
  }
  if (changed) {
    clearTimeout(saveTimer); saveTimer = null;
    C.stampChanges(lastStamped, state);
    lastStamped = clone(state);
    if (!writeStateNow()) return; // not persisted: keep every record
    if (sync) schedulePush();
  }
  for (const r of recs) {
    if (r.order <= (state.teamsReqApplied[reqGroup(r)] || 0)) {
      try { localStorage.removeItem(REQ_PREFIX + r.reqId); } catch (err) { /* retried next ingest */ }
    }
  }
  if (changed) { render(); if (!compPanel.hidden) renderComputers(); }
}

function applyRequest(r) {
  if (r.kind === 'join') {
    const e = r.payload || {};
    if (!C.isTeamNs(e.ns) || !e.id) return;
    state.teams = state.teams || [];
    const held = state.teams.find(x => x.id === e.id);
    if (held) {
      if (e.memberId) held.memberId = e.memberId;
      if (e.secret) held.secret = e.secret;
    } else {
      state.teams.push({ id: e.id, ns: e.ns, label: e.label || tr('team'), secret: e.secret, memberId: e.memberId || null });
    }
  } else if (r.kind === 'leave') {
    state.teams = (state.teams || []).filter(x => x.id !== r.key);
    state.teamsLeft = state.teamsLeft || {};
    state.teamsLeft[r.key] = 0; // stampChanges stamps it past the join it ends
    // Your private sessions for that team go too — cleared, not deleted, so
    // the clear reaches your other devices.
    for (const k of Object.keys(state.privateSessions || {})) {
      try { if (JSON.parse(k)[0] === r.key) state.privateSessions[k] = { session: '' }; } catch (err) { /* foreign key */ }
    }
  } else if (r.kind === 'profile') {
    const p = r.payload || {};
    if (typeof p.name === 'string' && p.name.trim()) state.profile = { ...(state.profile || {}), name: p.name.trim(), avatar: p.avatar || null };
  } else if (r.kind === 'session') {
    let p = r.payload || {};
    let teamId = null;
    try { teamId = JSON.parse(r.key)[0]; } catch (err) { return; }
    // after a leave, a stale tab's session request cannot bring one back
    if (!(state.teams || []).some(t => t.id === teamId)) p = {};
    state.privateSessions = state.privateSessions || {};
    state.privateSessions[r.key] = p.session
      ? { session: p.session, ...(p.sessionMachine ? { sessionMachine: p.sessionMachine } : {}), ...(p.sessionCwd ? { sessionCwd: p.sessionCwd } : {}) }
      : { session: '' };
  }
}

/* teams, as this page sees them: the personal board plus what is queued */

function liveTeams() {
  const home = homeBoard();
  const teams = new Map((home.teams || []).map(t => [t.id, t]));
  for (const r of reqRecords()) {
    if (r.kind !== 'join' && r.kind !== 'leave') continue;
    const top = latestReq(reqGroup(r));
    if (top.order <= (((home.teamsReqApplied || {})[reqGroup(r)]) || 0)) continue;
    if (top.kind === 'leave') teams.delete(r.key);
    else if (top.kind === 'join' && top.payload) teams.set(r.key, { ...(teams.get(r.key) || {}), ...top.payload });
  }
  return [...teams.values()];
}
const teamEntry = (id = TEAM_ID) => liveTeams().find(t => t.id === id) || null;
const teamLabel = (entry) => (entry && entry.label) || tr('team');

/* private sessions for team cards */

const privKey = taskId => JSON.stringify([TEAM_ID, taskId]);
function privateSessionFor(taskId) {
  const key = privKey(taskId);
  const pend = latestReq('session:' + key);
  const home = homeBoard();
  if (pend && pend.order > (((home.teamsReqApplied || {})['session:' + key]) || 0)) {
    return pend.payload && pend.payload.session ? pend.payload : null;
  }
  const v = (home.privateSessions || {})[key];
  return v && v.session ? v : null;
}

/* computers */

const MACHINE_ICONS = {
  laptop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="3" y="3.5" width="10" height="7" rx="1.2"/><path d="M1.5 12.5h13" stroke-linecap="round"/></svg>',
  desktop: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="2.5" width="12" height="8.5" rx="1.2"/><path d="M8 11v2.5M5.5 13.5h5" stroke-linecap="round"/></svg>',
  mini: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="5.5" width="12" height="5.5" rx="1.8"/><path d="M4.8 8.25h1.2" stroke-linecap="round"/></svg>',
  server: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/><path d="M5 4.75h.6M5 11.25h.6" stroke-linecap="round"/></svg>',
};
const DOWN_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5L8 10l3.5-3.5"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="3.6" y="7" width="8.8" height="6.4" rx="1.6"/><path d="M5.6 7V5.4a2.4 2.4 0 0 1 4.8 0V7"/></svg>';
const LINK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6"/></svg>';

const machines = () => (IS_HOME ? state.machines : homeBoard().machines) || [];
const machineOf = id => machines().find(m => m.id === id) || null;
function hereId() {
  let id = null;
  try { id = localStorage.getItem(HERE_KEY); } catch (err) { /* none */ }
  return id && machineOf(id) ? id : null; // a here naming a deleted computer is no here
}
function setHere(id) {
  try { localStorage.setItem(HERE_KEY, id); } catch (err) { /* this session only */ }
}
function machineHtml(id) {
  const m = machineOf(id);
  if (!m) return '';
  return `<span class="mach${id === hereId() ? ' here' : ''}">${MACHINE_ICONS[m.icon] || MACHINE_ICONS.laptop}${esc(m.name)}</span>`;
}
/** What Copy hands you: on the session's own computer, from its folder. */
const sessionCommand = s => s && s.session
  ? (s.sessionCwd && s.sessionMachine && s.sessionMachine === hereId()
    ? `cd ${s.sessionCwd.replace(/(["\s'$`\\])/g, '\\$1')} && ${s.session}` : s.session)
  : '';

/* new for you */

const assigneeClock = t => (t.fieldMt && t.fieldMt.assignee) || t.mt || 0;
function isNewForMe(t) {
  return IS_TEAM && !!state.me && t.assigneeId === state.me && !!t.assignedBy && t.assignedBy !== state.me
    && assigneeClock(t) > (state.meSinceClock || 0)
    && ((state.seenAssign || {})[t.id]) !== assigneeClock(t);
}
let seenChanged = false;
function markSeen(t) {
  if (!isNewForMe(t)) return;
  state.seenAssign = { ...(state.seenAssign || {}), [t.id]: assigneeClock(t) };
  seenChanged = true; // the board behind the editor still shows it as new
  save();
}

/* the switcher */

const boardsMenu = $('#boardsMenu');
function renderSwitcher() {
  $('#sw-label').textContent = IS_TEAM ? teamLabel(teamEntry()) : tr('personal');
}
function closeBoardsMenu() { boardsMenu.hidden = true; $('#sw-btn').setAttribute('aria-expanded', 'false'); }
function openBoardsMenu() {
  boardsMenu.innerHTML = '';
  const item = (lead, label, on, onclick) => {
    const b = document.createElement('button');
    b.className = 'bm-item' + (on ? ' on' : '');
    b.innerHTML = `<span class="bm-lead">${lead}</span><span class="bm-label">${esc(label)}</span>${on ? `<span class="bm-check">${ICON.check}</span>` : ''}`;
    b.onclick = onclick;
    boardsMenu.append(b);
    return b;
  };
  item(`<span class="bm-lock">${LOCK_ICON}</span>`, tr('personal'), !IS_TEAM && IS_HOME, () => { location.assign(boardUrl(null)); });
  liveTeams().forEach(t => {
    const stored = readStored(`board.v2.${t.ns}`);
    const faces = ((stored && stored.members) || []).slice(0, 3).map(m => avatarHtml(m)).join('');
    item(`<span class="bm-faces">${faces || `<span class="bm-lock">${LINK_ICON}</span>`}</span>`, teamLabel(t), t.id === TEAM_ID,
      () => { location.assign(boardUrl(t.ns)); });
  });
  boardsMenu.append(document.createElement('hr'));
  item(`<span class="bm-lock">${ICON.plus}</span>`, tr('newTeamBoard'), false, () => { closeBoardsMenu(); newTeamBoard(); });
  const joinBtn = item(`<span class="bm-lock">${LINK_ICON}</span>`, tr('joinWithLink'), false, () => {
    const form = document.createElement('form');
    form.className = 'bm-join';
    form.innerHTML = `<input type="text" spellcheck="false" autocomplete="off" placeholder="${esc(tr('pasteTeamLink'))}">`;
    form.onsubmit = ev => { ev.preventDefault(); const v = $('input', form).value; $('input', form).value = ''; joinTeamLink(v); };
    joinBtn.replaceWith(form);
    $('input', form).focus();
  });
  const r = $('#sw-btn').getBoundingClientRect();
  boardsMenu.style.top = `${r.bottom + 8}px`;
  boardsMenu.style.left = `${Math.max(8, r.left)}px`;
  boardsMenu.style.right = 'auto';
  boardsMenu.hidden = false;
  $('#sw-btn').setAttribute('aria-expanded', 'true');
}
$('#sw-btn').onclick = e => { e.stopPropagation(); if (boardsMenu.hidden) openBoardsMenu(); else closeBoardsMenu(); };
document.addEventListener('click', e => {
  if (!boardsMenu.hidden && !e.target.closest('#boardsMenu') && !e.target.closest('#sw-btn')) closeBoardsMenu();
});

/* creating and joining */

async function newTeamBoard() {
  const secret = C.randomSecret();
  const id = await C.teamIdOf(secret);
  location.assign(`${boardUrl(C.teamNs(id))}#new=${secret}`);
}

/** A read of someone's board that is never a relationship: its own keys, no
    sync globals, no storage, no push. The report and link routing use it. */
async function fetchBoardReadonly(secret) {
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    const keys = await C.deriveSync(secret);
    const res = await relayHttp(`${RELAY}/v1/board`, { headers: { Authorization: `Bearer ${keys.token}` }, redirect: 'error' });
    if (!res.ok) return null;
    const head = await res.json();
    if (!head || !head.env) return null;
    const raw = await C.unseal(keys.key, head.env);
    if (C.validateSyncable(raw)) return null;
    return C.migrate(raw);
  } catch (err) { return null; }
}

async function joinTeamLink(text) {
  const parsed = parseSyncEntry(text || '');
  if (!parsed) { toast(tr('notATeamLink')); return; }
  const board = await fetchBoardReadonly(parsed.secret);
  if (!board || !(board.members || []).length) { closeBoardsMenu(); toast(tr('notATeamLink')); return; }
  const id = await C.teamIdOf(parsed.secret);
  location.assign(`${boardUrl(C.teamNs(id))}#sync=${parsed.secret}`);
}

/** Before any candidate is inspected: a board with a roster is a team board,
    however it arrived, and joins in its own derived namespace — never here on
    a personal board. Returns true when it navigated away. */
async function routeTeamCandidate(secret) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return false;
  const id = await C.teamIdOf(secret);
  if (IS_TEAM) {
    if (C.teamNs(id) === NS) return false;
    location.assign(`${boardUrl(C.teamNs(id))}#sync=${secret}`);
    return true;
  }
  const board = await fetchBoardReadonly(secret);
  if (!board || !(board.members || []).length) return false;
  location.assign(`${boardUrl(C.teamNs(id))}#sync=${secret}`);
  return true;
}

/** Re-attach this namespace to the secret it just left (leave's Undo). It is
    the same board it was synced with seconds ago, so an ordinary pull-merge
    is exactly right. */
function reconnectSync(secret) {
  suspendSyncRuntime();
  state._bindingGen = nextGen(bindingGenOf(state));
  lastStamped = clone(state);
  if (!writeStateNow()) return;
  sync = { secret, ver: 0, _bindingGen: clone(bindingGenOf(state)) };
  syncKeys = null; remoteHead = ''; rejectedPayload = ''; floor = null; syncIncompatible = false;
  saveSyncConfig();
  connectWatch();
  pull();
}

function leaveTeam() {
  if (!IS_TEAM) return;
  const entry = teamEntry() || {};
  const secret = sync ? sync.secret : entry.secret;
  const memberId = state.me || entry.memberId || null;
  const rec = enqueue('leave', TEAM_ID, {});
  if (sync) syncStopped();
  renderSwitcher();
  toast(tr('leftTeam'), () => {
    // Undo is a rejoin request strictly after the leave, carrying the key
    // this page still holds in memory.
    enqueue('join', TEAM_ID, { id: TEAM_ID, ns: NS, label: teamLabel(entry), secret, memberId }, rec.order);
    if (secret) reconnectSync(secret);
    renderSwitcher();
  }, 8000);
}

/* you: a profile and a pixel avatar ─────────────────────
   Your name and avatar belong to you, not to each team: they live on the
   personal board (synced to your devices) and fill your roster entry on every
   team you join, with no question asked. The sprites are 16×16 maps drawn as
   SVG squares, so they are sharp at 16/32/48px and cost no downloads. */

const SPRITES = {"blink":["Blink",{"k":"#1B1726","a":"#FFB454","b":"#E08A2A","c":"#FFE0A8","p":"#FF8FA3"},["................","....kkkkkkkk....","...kaaaaaaaak...","...kacaaaaaak...","...kacaaaaaak...","...kaaaaaaaak...","...kaakaakaak...","...kaakaakaak...","...kpaaaaaapk...","...kaaakkaaak...","...kaaaaaaaak...","...kbaaaaaabk...","...kbbbbbbbbk...","....kkkkkkkk....",".....kk..kk.....","................"]],"stick":["Stick",{"k":"#1B1726","a":"#FFE27A","b":"#E8BE3C","p":"#FF8FA3"},["................",".kkkkkkkkkkkkk..",".kaaaaaaaaaaak..",".kaaaaaaaaaaak..",".kaaaaaaaaaaak..",".kaaakaaaakaak..",".kaaakaaaakaak..",".kapaaaaaaaapk..",".kaaaaakkaaaak..",".kaaaaaaaaaaak..",".kaaaaaaaaaaak..",".kaaaaaaaaaabk..",".kaaaaaaaaabbk..",".kaaaaaaaabbbk..",".kkkkkkkkkkkkk..","................"]],"byte":["Byte",{"k":"#1B1726","a":"#B8C4D6","c":"#FFB454","d":"#27305A","e":"#8FE3FF","p":"#FF8FA3"},[".......k........","......kck.......",".......k........","..kkkkkkkkkkkk..","..kaaaaaaaaaak..","..kakkkkkkkkak..","..kakddddddkak..","..kakdeddedkak..","..kakdeddedkak..","..kakpdeedpkak..","..kakkkkkkkkak..","..kaaaaaaaaaak..","..kkkkkkkkkkkk..","....kaak.kaak...","....kkkk.kkkk...","................"]],"ember":["Ember",{"k":"#1B1726","a":"#FF7A2E","c":"#FFB454","d":"#FFD66B","p":"#FF8FA3"},[".......k........","......kck.......","......kcck......",".....kccak......","..k..kcaak..k...",".kck.kaaaak.kck.",".kcakaaaaaakack.",".kaaaaaaaaaaaak.","kaaddddddddddaak","kaaddkddddkddaak","kaaddkddddkddaak","kaadpddkkddpdaak",".kaddddddddddak.","..kaaddddddaak..","...kkkkkkkkkk...","................"]],"mochi":["Mochi",{"k":"#1B1726","w":"#FFF1F4","b":"#F7C6D2","c":"#FFFFFF","p":"#FF8FA3"},["................","................",".....kkkkkk.....","...kkwwwwwwkk...","..kwwcwwwwwwwk..",".kwwcwwwwwwwwwk.",".kwwwwwwwwwwwwk.","kwwwwkwwwwkwwwwk","kwwwwkwwwwkwwwwk","kwwppwwkkwwppwwk","kwwwwwwwwwwwwwwk",".kwwwwwwwwwwwwk.",".kbwwwwwwwwwwbk.","..kkbbbbbbbbkk..","....kkkkkkkk....","................"]],"boo":["Boo",{"k":"#1B1726","a":"#C9B6FF","b":"#A58BF0","c":"#EEE6FF","p":"#FF8FA3"},["................",".....kkkkkk.....","...kkaaaaaakk...","..kaacaaaaaaak..",".kaacaaaaaaaaak.",".kaaaaaaaaaaaak.",".kaaakaaaakaaak.",".kaaakaaaakaaak.",".kapaaakkaaapak.",".kaaaaaaaaaaaak.",".kaaaaaaaaaaaak.",".kbaaaaaaaaaabk.",".kbbkbbbbbbkbbk.",".kk..kkkkkk..kk.","................","................"]],"crunch":["Crunch",{"k":"#1B1726","a":"#FF8A3D","b":"#E06A1F","c":"#FFC08A","g":"#6BCB77","p":"#FF8FA3"},["......k..k......",".....kgkkgk.....","....kgcggcgk....",".....kggggk.....","....kkkkkkkk....","...kaaaaaaaak...","...kacaaaaaak...","...kakaaaakak...","...kakaaaakak...","...kpaakkaapk...","....kaabaaak....","....kaaaaaak....",".....kabaak.....",".....kaaak......","......kak.......",".......k........"]],"miso":["Miso",{"k":"#1B1726","a":"#F2A65A","c":"#FFB3C1","p":"#FF8FA3"},["................","..kk........kk..","..kck......kck..","..kaak....kaak..","..kaaakkkkaaak..",".kaaaaaaaaaaaak.",".kaaaaaaaaaaaak.",".kaakaaaaaakaak.",".kaakaaaaaakaak.",".kpaaaakkaaaapk.",".kaaaakaakaaaak.",".kaaaaaaaaaaaak.","..kaaaaaaaaaak..","...kkkkkkkkkk...","................","................"]],"pip":["Pip",{"k":"#1B1726","a":"#7ED67A","b":"#57B35A","w":"#FFFFFF","e":"#1B1726","p":"#FF8FA3"},["................","...kkk....kkk...","..kwwek..kewwk..","..kwwek..kewwk..","..kkaakkkkaakk..",".kaaaaaaaaaaaak.",".kaaaaaaaaaaaak.",".kpaaaaaaaaaapk.",".kaaakkkkkkaaak.",".kaaaaaaaaaaaak.","..kaaaaaaaaaak..",".kbbkaaaaaakbbk.",".kkkkkkkkkkkkkk.","................","................","................"]],"kit":["Kit",{"k":"#1B1726","a":"#FF8A3D","w":"#FFF4EA","c":"#FFC08A","p":"#FF8FA3"},["................",".kk..........kk.",".kak........kak.",".kaak......kaak.",".kaaakkkkkkaaak.",".kaaaaaaaaaaaak.","kaaaaaaaaaaaaaak","kaaakaaaaaakaaak","kaaakaaaaaakaaak","kwwpwaaaaaawpwwk",".kwwwwwkkwwwwwk.","..kwwwwwwwwwwk..","...kkwwwwwwkk...",".....kkkkkk.....","................","................"]],"pebble":["Pebble",{"k":"#1B1726","d":"#2E3A5C","w":"#FFFFFF","b":"#FFA24C","p":"#FF8FA3"},["................",".....kkkkkk.....","...kkddddddkk...","..kddddddddddk..","..kddwwwwwwddk..",".kddwwwwwwwwddk.",".kddwkwwwwkwddk.",".kddwkwwwwkwddk.",".kddpwwbbwwpddk.",".kddwwwwwwwwddk.","kdddwwwwwwwwdddk","kdddwwwwwwwwdddk",".kddwwwwwwwwddk.","..kddwwwwwwddk..","...kbbkkkkbbk...","................"]],"bun":["Bun",{"k":"#1B1726","w":"#FFFFFF","c":"#FFB3C1","b":"#E6E1EE","p":"#FF8FA3"},["...kk......kk...","..kwck....kcwk..","..kwck....kcwk..","..kwck....kcwk..","..kwwk....kwwk..","..kwwkkkkkkwwk..",".kwwwwwwwwwwwwk.","kwwwwwwwwwwwwwwk","kwwwkwwwwwwkwwwk","kwwwkwwwwwwkwwwk","kwwpwwwccwwwpwwk","kwwwwwwkkwwwwwwk",".kwwwwwwwwwwwwk.",".kbwwwwwwwwwwbk.","..kkkkkkkkkkkk..","................"]]};
const spriteCache = {};
function spriteSvg(key) {
  if (spriteCache[key]) return spriteCache[key];
  const s = SPRITES[key];
  if (!s) return '';
  const [, pal, rows] = s;
  let rects = '';
  rows.forEach((row, y) => {
    for (let i = 0; i < 16;) {
      const ch = row[i];
      if (ch === '.' || !pal[ch]) { i++; continue; }
      let j = i;
      while (j < 16 && row[j] === ch) j++;
      rects += `<rect x="${i}" y="${y}" width="${j - i}" height="1" fill="${pal[ch]}"/>`;
      i = j;
    }
  });
  return (spriteCache[key] = `<svg viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`);
}

/** The profile, as this page sees it: the personal board's, plus a change
    queued from this page that the personal board has not ingested yet. */
function myProfile() {
  const home = homeBoard();
  const pend = latestReq('profile:me');
  if (pend && pend.order > (((home.teamsReqApplied || {})['profile:me']) || 0)) return pend.payload || {};
  return (IS_HOME ? state.profile : home.profile) || {};
}
const profileColor = () => COLORS[2];

const profileMenu = $('#profileMenu');
let profileMode = null;     // null | 'join' | 'create'
let profileDraft = null;    // { name, avatar }

function renderMe() {
  const el = $('#me');
  const p = myProfile();
  const who = IS_TEAM ? me() : null;
  const face = who ? avatarHtml(who) : p.name || p.avatar
    ? avatarHtml({ name: p.name || '?', avatar: p.avatar, color: profileColor() })
    : '<span class="av empty"></span>';
  el.innerHTML = face;
  el.title = p.name || tr('you');
}

function openProfile(mode = null) {
  profileMode = mode;
  const p = myProfile();
  const who = IS_TEAM ? me() : null;
  profileDraft = { name: (who && who.name) || p.name || '', avatar: (who && who.avatar) || p.avatar || null };
  renderProfile();
  const r = $('#me').getBoundingClientRect();
  profileMenu.style.top = `${r.bottom + 8}px`;
  profileMenu.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  profileMenu.style.left = 'auto';
  profileMenu.hidden = false;
  requestAnimationFrame(() => { const i = $('#pf-name'); if (i) i.focus(); });
}

function renderProfile() {
  const d = profileDraft;
  const faces = Object.keys(SPRITES).map(k => `<button class="pf-tile${d.avatar === k ? ' on' : ''}" data-av="${k}" title="${esc(SPRITES[k][0])}">${spriteSvg(k)}</button>`).join('');
  profileMenu.innerHTML = `
    <label class="pf-row">${avatarHtml({ name: d.name || '?', avatar: d.avatar, color: me() ? me().color : profileColor() }, 'xl')}
      <input id="pf-name" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(tr('yourName'))}" value="${esc(d.name)}"></label>
    <div class="pf-grid">${faces}<button class="pf-tile initials${!d.avatar ? ' on' : ''}" data-av="" title="${esc(tr('initials'))}">${esc(initials(d.name || '?'))}</button></div>`;
  const input = $('#pf-name');
  input.addEventListener('input', () => { profileDraft.name = input.value; const t = $('.pf-tile.initials', profileMenu); if (t) t.textContent = initials(input.value || '?'); const av = $('.pf-row .av', profileMenu); if (av && !profileDraft.avatar) av.textContent = initials(input.value || '?'); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closeProfile(); } });
  $$('.pf-tile', profileMenu).forEach(b => b.onclick = e => {
    e.stopPropagation();
    profileDraft.avatar = b.dataset.av || null;
    profileDraft.name = input.value;
    renderProfile();
  });
}

/** Closing saves — the rule for every text surface in this app. */
async function closeProfile() {
  if (profileMenu.hidden) return;
  const input = $('#pf-name');
  const name = ((input && input.value) || profileDraft.name || '').trim();
  const avatar = profileDraft.avatar || null;
  const mode = profileMode;
  profileMenu.hidden = true;
  profileMode = null;
  if (!name) {
    // A new team cannot start without its first member: discard it.
    if (mode === 'create') discardNewTeam();
    render();
    return;
  }
  const p = myProfile();
  if (p.name !== name || (p.avatar || null) !== avatar) {
    if (IS_HOME) { state.profile = { ...(state.profile || {}), name, avatar }; save(); }
    else enqueue('profile', 'me', { name, avatar });
  }
  if (IS_TEAM) {
    const mine = me();
    if (mine) {
      if (mine.name !== name || (mine.avatar || null) !== avatar) { mine.name = name; mine.avatar = avatar; save(); }
    } else if (mode === 'create') await createTeamWithProfile();
    else joinWithProfile();
  }
  render();
}

function addMeToRoster() {
  const p = myProfile();
  const m = { id: C.uid(), name: p.name, color: nextMemberColor(), ...(p.avatar ? { avatar: p.avatar } : {}) };
  state.members = [...(state.members || []), m];
  setMe(m.id);
  flushPendingSave();
  return m;
}

/** Joining uses your profile: no picker, no question. */
function joinWithProfile() {
  if (!IS_TEAM || state.me || !myProfile().name) return false;
  addMeToRoster();
  if (sync) {
    const entry = teamEntry();
    enqueue('join', TEAM_ID, { id: TEAM_ID, ns: NS, label: teamLabel(entry), secret: sync.secret, memberId: state.me });
  }
  toast(tr('joinedTeam'));
  render();
  return true;
}

async function createTeamWithProfile() {
  if (!pendingNewSecret || !myProfile().name) return;
  const m = addMeToRoster();
  const ok = await enableSync(pendingNewSecret);
  if (!ok) { toast(tr('syncFailed')); return; }
  pendingNewSecret = null;
  enqueue('join', TEAM_ID, { id: TEAM_ID, ns: NS, label: tr('team'), secret: sync.secret, memberId: m.id });
  render();
  openSync('on');
}

function discardNewTeam() {
  try { localStorage.removeItem(KEY); } catch (err) { /* nothing to discard */ }
  readOnly = true; // nothing may re-save it on the way out
  location.assign(boardUrl(null));
}

let pendingNewSecret = null;
$('#me').onclick = e => { e.stopPropagation(); if (profileMenu.hidden) openProfile(); else closeProfile(); };
document.addEventListener('click', e => {
  if (!profileMenu.hidden && !e.target.closest('#profileMenu') && !e.target.closest('#me')) closeProfile();
});


/* team page boot: identity and membership follow the personal board */

function followTeamEntry() {
  if (!IS_TEAM) return;
  const entry = teamEntry();
  const home = homeBoard();
  // your devices agree on who you are: the entry's identity wins everywhere
  if (entry && entry.memberId && entry.memberId !== state.me && memberOf(entry.memberId)) setMe(entry.memberId);
  // and your profile is who you are on every team: a new name or avatar
  // reaches your roster entry here the next time this board opens
  const mine = me(), p = myProfile();
  if (mine && p.name && (mine.name !== p.name || (mine.avatar || null) !== (p.avatar || null))) {
    mine.name = p.name; mine.avatar = p.avatar || null; save();
  }
  // Left on another device: disconnect here too — forget the key, keep the board.
  if (!entry && home.teamsLeft && home.teamsLeft[TEAM_ID] != null && sync) syncStopped();
  renderSwitcher();
}

/** After a team board is adopted: know who you are, or ask. */
function afterTeamAdoption() {
  if (!IS_TEAM || !(state.members || []).length) return;
  followTeamEntry();
  if (!state.me) { if (!joinWithProfile()) openProfile('join'); }
  else if (sync) {
    const entry = teamEntry();
    if (!entry || !entry.secret) enqueue('join', TEAM_ID, { id: TEAM_ID, ns: NS, label: teamLabel(entry), secret: sync.secret, memberId: state.me });
  }
}

function bootTeamPage() {
  if (!IS_TEAM) return false;
  const m = location.hash.match(/[#&]new=([A-Za-z0-9_-]{43})(?:&|$)/);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    const secret = m[1];
    // A new team starts in a fresh namespace or not at all: the namespace must
    // be the one this secret derives, the board a never-touched seed, and no
    // relationship may already live here. An occupied one (a hand-typed ?ns=,
    // an old copy, a crafted link) is never quietly turned into a team.
    const fresh = state.seed === true && !sync && !readJson(SYNC_KEY)
      && !(state.members || []).length && !state.tasks.length && !state.events.length
      && !(state.projects || []).length && !Object.keys(state.tombstones || {}).length;
    C.teamIdOf(secret).then(id => {
      if (fresh && C.teamNs(id) === NS) {
        pendingNewSecret = secret;
        // your profile makes you the first member; only without one is there a question
        if (myProfile().name) createTeamWithProfile(); else openProfile('create');
      }
      else location.assign(boardUrl(null));
    }, () => location.assign(boardUrl(null)));
    return true;
  }
  followTeamEntry();
  const entry = teamEntry();
  // Your teams follow you: a team joined on another device adopts here on
  // first open, through the ordinary pristine path, with no question.
  if (!sync && entry && entry.secret && state.seed === true && !location.hash) {
    presentCandidateWhenSettled(entry.secret);
    return true;
  }
  if (sync && (state.members || []).length && !state.me) afterTeamAdoption();
  return false;
}

/** A team card deleted for good takes your private session for it along
    (docs/computers.md): no stale command outlives its card. */
function clearOrphanSessions() {
  if (!IS_TEAM) return;
  for (const id of Object.keys(state.tombstones || {})) {
    if (!byId(id) && privateSessionFor(id)) enqueue('session', privKey(id), {});
  }
}

/* rail: members, filters */

function renderMembers() {
  const el = $('#members');
  const list = IS_TEAM ? (state.members || []) : [];
  el.hidden = !list.length;
  if (!list.length) return;
  const mine = me();
  const others = list.filter(m => !mine || m.id !== mine.id);
  el.hidden = !others.length;
  el.innerHTML = others.slice(0, 5).map(m => avatarHtml(m)).join('');
  el.title = others.map(m => m.name).join(', ');
}
$('#members').onclick = e => { e.stopPropagation(); openProfile(); };

function assigneePills() {
  if (!IS_TEAM || !(state.members || []).length) return [];
  const live = state.tasks.filter(onBoard);
  const pills = [];
  const mineN = live.filter(t => t.assigneeId === state.me).length;
  const fresh = live.filter(isNewForMe).length;
  const mine = document.createElement('button');
  mine.className = 'pill mine';
  mine.setAttribute('aria-pressed', String(state.assigneeFilter === 'mine'));
  mine.innerHTML = `${avatarHtml(me(), 'sm')}${esc(tr('mine'))}${mineN ? ` <span class="n">${mineN}</span>` : ''}${fresh ? ` <span class="newcount">${esc(tr('newCount', { n: fresh }))}</span>` : ''}`;
  mine.onclick = () => { state.assigneeFilter = state.assigneeFilter === 'mine' ? null : 'mine'; state.flagFilter = false; save(); render(); };
  pills.push(mine);
  const un = document.createElement('button');
  un.className = 'pill';
  un.setAttribute('aria-pressed', String(state.assigneeFilter === 'unassigned'));
  const unN = live.filter(t => !t.assigneeId).length;
  un.innerHTML = `${esc(tr('unassigned'))}${unN ? ` <span class="n">${unN}</span>` : ''}`;
  un.onclick = () => { state.assigneeFilter = state.assigneeFilter === 'unassigned' ? null : 'unassigned'; state.flagFilter = false; save(); render(); };
  pills.push(un);
  return pills;
}

/* the editor: assignee, history, computer, private session */

const fAssignee = $('#f-assignee');
const fMachine = $('#f-machine');
const machineMenu = $('#machineMenu');

function renderAssignee() {
  const field = $('#assigneeField');
  field.hidden = !(IS_TEAM && (state.members || []).length);
  if (field.hidden) return;
  $('#assigneeLabel').textContent = tr('assignee');
  fAssignee.innerHTML = '';
  const canAssign = !!me();
  const choice = (label, id, m) => {
    const b = document.createElement('button');
    b.className = 'pill who';
    b.disabled = !canAssign;
    b.setAttribute('aria-pressed', String((draft.assigneeId || null) === id));
    b.innerHTML = `${m ? avatarHtml(m, 'sm') : ''}${esc(label)}`;
    b.onclick = () => { draft.assigneeId = id; renderAssignee(); };
    fAssignee.append(b);
  };
  choice(tr('nobody'), null, null); // first, like the project chooser's None
  [...state.members].sort((a, b) => a.name.localeCompare(b.name)).forEach(m => choice(m.name, m.id, m));
}

function renderHistory() {
  const box = $('#f-history');
  const t = editing && editing !== 'new' ? byId(editing) : null;
  box.hidden = !(IS_TEAM && t);
  if (box.hidden) return;
  const rows = state.events.filter(e => e.taskId === t.id).sort((a, b) => (a.at || 0) - (b.at || 0));
  const time = at => new Intl.DateTimeFormat(locale === 'es' ? 'es-CL' : 'en-GB', { timeZone: C.TZ, weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(at);
  const line = (m, name, words, at) => `<div class="h-row">${m ? avatarHtml(m, 'sm') : '<span class="av sm ghost"></span>'}<span class="h-what"><b>${esc(name)}</b> ${esc(words)}</span><span class="h-when">${esc(at ? time(at) : '')}</span></div>`;
  const items = rows.map(e => {
    const m = memberOf(e.by);
    return { m, name: m ? m.name : e.byName || tr('someone'),
      words: e.type === 'created' ? tr('created', { stage: e.to }) : tr('movedTo', { stage: e.to }), at: e.at || 0 };
  });
  // the current assignment is not in the log; it takes its place by time
  if (t.assignedBy) {
    const by = memberOf(t.assignedBy);
    const to = memberOf(t.assigneeId);
    items.push({ m: by, name: by ? by.name : tr('someone'),
      words: to ? tr('assigned', { name: to.name }) : tr('unassignedIt'), at: t.assignedAt || 0 });
  }
  items.sort((a, b) => a.at - b.at);
  box.innerHTML = `<div class="h-lbl">${esc(tr('history'))}</div>` + items.map(i => line(i.m, i.name, i.words, i.at)).join('');
}

function renderMachinePick() {
  const has = !!fSession.value.trim();
  const list = machines();
  fMachine.hidden = !has || (!list.length && !IS_HOME);
  if (fMachine.hidden) return;
  const m = machineOf(draft.sessionMachine);
  fMachine.innerHTML = m
    ? `${MACHINE_ICONS[m.icon] || MACHINE_ICONS.laptop}<span>${esc(m.name)}</span>${DOWN_ICON}`
    : `<span>${esc(tr('computer'))}</span>${DOWN_ICON}`;
  fMachine.classList.toggle('unset', !m);
}
fSession.addEventListener('input', () => {
  // pasting a session fills the computer with this one; one click changes it
  if (fSession.value.trim() && !draft.sessionMachine && hereId()) draft.sessionMachine = hereId();
  if (!fSession.value.trim()) { draft.sessionMachine = null; draft.sessionCwd = null; }
  renderMachinePick();
});
function closeMachineMenu() { machineMenu.hidden = true; fMachine.setAttribute('aria-expanded', 'false'); }
fMachine.onclick = e => {
  e.stopPropagation();
  if (!machineMenu.hidden) { closeMachineMenu(); return; }
  machineMenu.innerHTML = '';
  const here = hereId();
  machines().forEach(m => {
    const b = document.createElement('button');
    b.className = 'mm-item' + (draft.sessionMachine === m.id ? ' on' : '');
    b.innerHTML = `${MACHINE_ICONS[m.icon] || MACHINE_ICONS.laptop}<span class="mm-name">${esc(m.name)}</span>${m.id === here ? `<span class="mm-here">${esc(tr('here'))}</span>` : ''}${draft.sessionMachine === m.id ? `<span class="bm-check">${ICON.check}</span>` : ''}`;
    b.onclick = () => { draft.sessionMachine = m.id; closeMachineMenu(); renderMachinePick(); };
    machineMenu.append(b);
  });
  if (machines().length) machineMenu.append(document.createElement('hr'));
  const add = document.createElement('button');
  add.className = 'mm-item add';
  add.innerHTML = `${ICON.plus}<span class="mm-name">${esc(tr('addComputer'))}</span>`;
  add.onclick = () => {
    closeMachineMenu();
    if (IS_HOME) { saveEditor(); openComputers(true); }
    else { saveEditor(); location.assign(`${boardUrl(null)}#computers`); }
  };
  machineMenu.append(add);
  const r = fMachine.getBoundingClientRect();
  machineMenu.style.top = `${r.bottom + 6}px`;
  machineMenu.style.left = `${Math.max(8, r.right - 240)}px`;
  machineMenu.style.right = 'auto';
  machineMenu.hidden = false;
  fMachine.setAttribute('aria-expanded', 'true');
};
document.addEventListener('click', e => {
  if (!machineMenu.hidden && !e.target.closest('#machineMenu') && !e.target.closest('#f-machine')) closeMachineMenu();
});

/* the Computers panel (personal board) */

const compPanel = $('#computers');
let compOpenRow = null;
function openComputers(focusNew = false) {
  if (!IS_HOME) { location.assign(`${boardUrl(null)}#computers`); return; }
  closeComposer();
  compPanel.hidden = false;
  scrim.hidden = false;
  renderComputers();
  if (focusNew) requestAnimationFrame(() => $('#comp-name').focus());
}
function closeComputers() {
  compPanel.hidden = true;
  compOpenRow = null;
  syncScrim();
}
function renderComputers() {
  $('#computers h2').textContent = tr('computers');
  $('#comp-name').placeholder = tr('newComputer');
  $('#comp-add button').textContent = tr('add');
  const list = $('#comp-list');
  list.innerHTML = '';
  const here = hereId();
  (state.machines || []).forEach(m => {
    const row = document.createElement('div');
    row.className = 'comp-row' + (compOpenRow === m.id ? ' open' : '');
    row.innerHTML = `
      <div class="comp-top">
        <button class="comp-icon" title="${esc(m.name)}">${MACHINE_ICONS[m.icon] || MACHINE_ICONS.laptop}</button>
        <input class="comp-name" value="${esc(m.name)}" spellcheck="false" autocomplete="off">
        ${m.id === here ? `<span class="comp-here">${esc(tr('here'))}</span>` : `<button class="comp-make" title="${esc(tr('makeHere'))}">${esc(tr('here'))}</button>`}
        <button class="icon sm comp-del" title="${esc(tr('delete'))}">${ICON.close}</button>
      </div>
      ${compOpenRow === m.id ? `<div class="comp-icons">${C.ICONS.map(k => `<button data-icon="${k}" aria-pressed="${String((m.icon || 'laptop') === k)}">${MACHINE_ICONS[k]}</button>`).join('')}</div>` : ''}`;
    $('.comp-icon', row).onclick = () => { compOpenRow = compOpenRow === m.id ? null : m.id; renderComputers(); };
    const name = $('.comp-name', row);
    name.addEventListener('change', () => { const v = name.value.trim(); if (v && v !== m.name) { m.name = v; save(); render(); } else name.value = m.name; });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
    const make = $('.comp-make', row);
    if (make) make.onclick = () => { setHere(m.id); renderComputers(); render(); };
    $('.comp-del', row).onclick = () => {
      snapshot();
      state.machines = state.machines.filter(x => x.id !== m.id);
      state.tombstones = { ...(state.tombstones || {}), [m.id]: 0 }; // stampChanges stamps it past everything
      state.tasks.forEach(t => { if (t.sessionMachine === m.id) delete t.sessionMachine; });
      for (const v of Object.values(state.privateSessions || {})) if (v.sessionMachine === m.id) delete v.sessionMachine;
      save(); renderComputers(); render();
      toast(tr('delete'), undo);
    };
    $$('.comp-icons button', row).forEach(b => b.onclick = () => { m.icon = b.dataset.icon; save(); renderComputers(); render(); });
    list.append(row);
  });
  const hint = here ? machineOf(here) : null;
  $('#comp-cli').innerHTML = hint ? `<span class="caret">&#9656;</span> kanban here "${esc(hint.name)}"` : '';
}
$('#comp-add').onsubmit = e => {
  e.preventDefault();
  const input = $('#comp-name');
  const name = input.value.trim();
  if (!name) return;
  state.machines = state.machines || [];
  const m = { id: C.uid(), name, icon: /mini/i.test(name) ? 'mini' : /server|linux|box/i.test(name) ? 'server' : /imac|studio|desktop|pc/i.test(name) ? 'desktop' : 'laptop' };
  state.machines.push(m);
  if (!hereId()) setHere(m.id); // the first computer you add is usually the one you are on
  input.value = '';
  save();
  renderComputers();
  render();
};
$('[data-close]', compPanel).innerHTML = ICON.close;
$('[data-close]', compPanel).onclick = closeComputers;

/* my week: the report across the personal board and your teams */

/** Other boards whose rows belong in this device's report: the personal board
    (when this page is a team) and every team you belong to where you are
    known. Each comes with its own done column, lookup and project colors. */
function reportSources() {
  if (!IS_HOME && !IS_TEAM) return [];
  const out = [];
  if (IS_TEAM) {
    const home = homeBoard();
    if (home && home.columns) out.push({ ns: HOME || null, label: null, board: home, me: null, secret: (readJson(HOME_SYNC_KEY) || {}).secret || null });
  }
  liveTeams().forEach(t => {
    if (t.ns === NS) return;
    const stored = readStored(`board.v2.${t.ns}`);
    const me = (stored && stored.me) || t.memberId;
    if (!me) return;
    out.push({ ns: t.ns, label: teamLabel(t), board: stored, me, secret: t.secret || null });
  });
  return out;
}

let reportAttempt = 0;
const reportFresh = new Map(); // ns → a fresher read-only copy for this report
const reportStale = new Set(); // ns whose refresh failed while this report was open
function freshenReport() {
  const attempt = ++reportAttempt;
  reportStale.clear();
  reportSources().forEach(async src => {
    if (!src.secret) return;
    const fresh = await fetchBoardReadonly(src.secret);
    if (attempt !== reportAttempt || reportEl.hidden) return;
    if (!fresh) { reportStale.add(src.ns); renderReport(false); return; }
    try { localStorage.setItem(`board.read.${src.ns || ''}`, String(Date.now())); } catch (err) { /* label only */ }
    // a report-only merge: the stored copy may hold work not yet on the relay
    reportFresh.set(src.ns, src.board ? C.merge(src.board, fresh) : fresh);
    renderReport(false);
  });
}

function rowsFrom(board, ns, label, onlyMe) {
  if (!board || !board.columns || !board.columns.length) return [];
  const doneCol = board.columns[board.columns.length - 1];
  const lookup = id => {
    const t = (board.tasks || []).find(x => x.id === id);
    if (!t) return null;
    const p = (board.projects || []).find(x => x.id === t.projectId);
    return { title: t.title, project: p ? p.name : null, archived: !!t.archivedAt };
  };
  let rows = C.aggregateWeek(board.events || [], repWeek, lookup, { id: doneCol.id, name: doneCol.name });
  if (onlyMe) {
    rows = rows.filter(r => r.byIds.includes(onlyMe));
    // Your week: a card you created and someone else finished is listed, not
    // announced. The default tick needs you across the done line.
    rows.forEach(r => { r.include = r.include && r.doneBy === onlyMe; });
  }
  rows.forEach(r => {
    r.ns = ns;
    r.boardLabel = label;
    r.rowKey = JSON.stringify([ns, r.taskId]);
    const p = (board.projects || []).find(x => x.name === r.project);
    r.color = p ? p.color : null;
    r.done = doneCol.name;
  });
  return rows;
}

/* ── images (docs/attachments.md) ──────────────────────────
   The board carries references only. Bytes live in IndexedDB on this device
   and, sealed with a key of their own, beside the board on the relay. Nothing
   here ever touches a board push: a push carries references and never waits. */

const IMG_EDGE = 1600;
const IMG_SOURCE_MAX = 25 * 1024 * 1024;
const IMG_PIXELS_MAX = 40e6;
const IMG_PNG_KEEP = 600_000;
const IMG_CACHE_CAP = 200 * 1024 * 1024;
const IMG_NS = NS || '';
// The team DOM suite simulates two devices in one origin; each gets its own
// database through the same seam that gives it a relay. Inert otherwise.
const IMG_DB = 'kanban.images' + (testRelay && window.parent.__kanbanTestDevice ? '.' + window.parent.__kanbanTestDevice : '');

let imgDbP = null;
function imgDb() {
  if (!imgDbP) {
    imgDbP = new Promise((resolve, reject) => {
      // Keyed by [ns, blobId]: one board's bytes can never answer for another's.
      const req = indexedDB.open(IMG_DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains('blobs')) db.deleteObjectStore('blobs'); // v1 never shipped
        const store = db.createObjectStore('blobs', { keyPath: ['ns', 'blobId'] });
        store.createIndex('nsSha', ['ns', 'sha']);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    imgDbP.catch(() => { imgDbP = null; });
  }
  return imgDbP;
}
const idbReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const idbDone = tx => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
async function imgGet(id) { return idbReq((await imgDb()).transaction('blobs').objectStore('blobs').get([IMG_NS, id])); }
async function imgAll() { return idbReq((await imgDb()).transaction('blobs').objectStore('blobs').getAll()); }
async function imgBySha(sha) {
  return idbReq((await imgDb()).transaction('blobs').objectStore('blobs').index('nsSha').get([IMG_NS, sha]));
}
async function imgPut(rec) {
  const tx = (await imgDb()).transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(rec);
  return idbDone(tx);
}
/** `keys` are blob ids on this board, or [ns, blobId] pairs. */
async function imgDelete(keys) {
  if (!keys.length) return;
  const tx = (await imgDb()).transaction('blobs', 'readwrite');
  keys.forEach(k => {
    const key = Array.isArray(k) ? k : [IMG_NS, k];
    tx.objectStore('blobs').delete(key);
    if (key[0] === IMG_NS && imgUrls.has(key[1])) { URL.revokeObjectURL(imgUrls.get(key[1])); imgUrls.delete(key[1]); }
  });
  return idbDone(tx);
}

async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* The live-image index: one pass over the map per render, not per card. */
function imagesOf(taskId) {
  if (!liveImgIndex) {
    liveImgIndex = new Map();
    for (const a of C.liveAttachments(state)) {
      if (!liveImgIndex.has(a.task)) liveImgIndex.set(a.task, []);
      liveImgIndex.get(a.task).push(a);
    }
  }
  return liveImgIndex.get(taskId) || [];
}
const liveBlobIds = () => new Set(C.liveAttachments(state).map(a => a.blob));

/* ── preparing: every image is re-encoded, so no metadata leaves ── */

function encodeCanvas(canvas, type, q) {
  return new Promise(res => {
    try { canvas.toBlob(b => res(b), type, q); } catch (err) { res(null); }
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch (err) { /* fall back to an <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File → { blob, type, w, h, bytes, sha, name }. Throws 'type' | 'large' | 'decode'. */
async function prepareImage(file) {
  if (!file || file.size > IMG_SOURCE_MAX) throw new Error('large');
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
  const info = C.imageInfo(head);
  if (!info || !C.IMAGE_TYPES.includes(info.type)) throw new Error('type');
  if (info.w * info.h > IMG_PIXELS_MAX) throw new Error('large');
  let src;
  try { src = await decodeImage(file); } catch (err) { throw new Error('decode'); }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  try {
    if (!sw || !sh || sw * sh > IMG_PIXELS_MAX) throw new Error('decode');
    const k = Math.min(1, IMG_EDGE / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    g.drawImage(src, 0, 0, w, h);
    let out = null;
    if (info.type === 'image/png') {
      const png = await encodeCanvas(canvas, 'image/png');
      if (png && png.type === 'image/png' && png.size <= IMG_PNG_KEEP) out = png;
    }
    if (!out) {
      const webp = await encodeCanvas(canvas, 'image/webp', 0.82);
      if (webp && webp.type === 'image/webp') out = webp;
    }
    if (!out) {
      // no WebP encoder here: JPEG has no alpha, so give it a white ground
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = '#fff';
      g.fillRect(0, 0, w, h);
      const jpg = await encodeCanvas(canvas, 'image/jpeg', 0.85);
      if (jpg && jpg.type === 'image/jpeg') out = jpg;
    }
    if (!out) throw new Error('decode');
    if (out.size > C.MAX_IMAGE) throw new Error('large');
    const bytes = new Uint8Array(await out.arrayBuffer());
    const name = String(file.name || '').slice(0, 120);
    return { blob: new Blob([bytes], { type: out.type }), type: out.type, w, h, bytes: bytes.length, sha: await sha256Hex(bytes), name };
  } finally {
    if (src.close) src.close();
  }
}

/** Prepared image → a committed local record. The reference is added only
    after this resolves, so a failed write can never leave a dangling card. */
async function storeImage(prep) {
  const held = await imgBySha(prep.sha).catch(() => null);
  if (held) return held.blobId; // the same picture on this board: one blob
  const blobId = C.newBlobId();
  await imgPut({ blobId, ns: IMG_NS, type: prep.type, bytes: prep.blob, sha: prep.sha, sentTo: [], used: Date.now() });
  return blobId;
}

/** Local bytes nothing references any more — only ever a discarded draft's. */
async function dropIfUnreferenced(blobIds) {
  const held = new Set(Object.values(state.attachments || {}).map(a => a.blob));
  if (draftImgs) draftImgs.adds.forEach(a => a.blob && held.add(a.blob));
  const gone = blobIds.filter(id => id && !held.has(id));
  try {
    for (const id of gone) {
      const rec = await imgGet(id);
      if (rec && !(rec.sentTo || []).length) await imgDelete([id]);
    }
  } catch (err) { /* nothing else depends on this */ }
}

let persistAsked = false;
function requestPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (err) { /* best effort */ }
}

/* ── the relay: one session, one queue ── */

let blobKeys = null; // { secret, key, fp }
async function blobKeysFor(ctx) {
  if (blobKeys && blobKeys.secret === ctx.secret) return blobKeys;
  const derived = await keysForContext(ctx);
  const next = {
    secret: ctx.secret,
    key: await C.deriveBlobKey(ctx.secret),
    // which relay slot a record has reached: 128 bits of SHA-256(token)
    fp: (await sha256Hex(new TextEncoder().encode(derived.token))).slice(0, 32),
  };
  if (!isCurrentSync(ctx)) throw new Error('stale sync');
  blobKeys = next;
  return next;
}

async function blobFetch(method, blobId, body, ctx) {
  const derived = await keysForContext(ctx);
  return relayHttp(`${RELAY}/v1/blob/${blobId}`, {
    method,
    headers: { Authorization: `Bearer ${derived.token}`, ...(body ? { 'Content-Type': 'application/octet-stream' } : {}) },
    body: body || undefined,
  });
}


/** Called when the sync relationship changes: the old queue stops owning
    anything, and what it learned about the old slot is forgotten. */
function resetImageQueue() {
  imgQueueOwner++;
  uploading = false;
  uploadAgain = false;
  clearTimeout(imgRetryTimer);
  imgRetryTimer = null;
  imgRetryMs = 15000;
  imgFail.clear();
  boardFull = null;
  uploadingNow = null;
  clearTimeout(arrivingTimer);
  arrivingTimer = null;
  imgTried.clear();
}

async function uploadImages() {
  if (uploading) { uploadAgain = true; return; }
  const ctx = captureSync();
  if (!isCurrentSync(ctx) || !((sync.ver || 0) > 0) || readOnly || syncIncompatible) return;
  const owner = imgQueueOwner;
  const mine = () => owner === imgQueueOwner && isCurrentSync(ctx);
  uploading = true;
  let failed = false;
  try {
    const { key, fp } = await blobKeysFor(ctx);
    for (const blobId of liveBlobIds()) {
      if (!mine()) return;
      if (imgFail.has(blobId)) continue;
      const rec = await imgGet(blobId).catch(() => null);
      if (!mine()) return;
      if (!rec || (rec.sentTo || []).includes(fp)) continue;
      const sealed = await C.sealBlob(key, blobId, new Uint8Array(await rec.bytes.arrayBuffer()));
      if (!mine()) return;
      uploadingNow = blobId;
      refreshImageViews();
      const res = await blobFetch('PUT', blobId, sealed, ctx);
      if (!mine()) return;
      if (res.status === 204) {
        const fresh = await imgGet(blobId).catch(() => null) || rec;
        fresh.sentTo = [...new Set([...(fresh.sentTo || []), fp])];
        await imgPut(fresh);
      } else if (res.status === 507) {
        const body = await res.json().catch(() => ({}));
        if (!mine()) return;
        boardFull = { used: body.used || 0, quota: body.quota || 0 };
        imgFail.set(blobId, 'full');
      } else if (res.status === 413 || res.status === 400) {
        imgFail.set(blobId, 'large');
      } else if (res.status === 404 || res.status === 410) {
        break; // the board is not (or no longer) on the relay; a push brings us back
      } else {
        throw new Error(`relay ${res.status}`);
      }
    }
    imgRetryMs = 15000;
  } catch (err) {
    failed = mine();
  } finally {
    // only the owner releases the lock; a superseded queue touches nothing
    if (owner === imgQueueOwner) {
      uploading = false;
      uploadingNow = null;
      refreshImageViews();
    }
  }
  if (owner !== imgQueueOwner) return;
  if (failed) {
    // Its own bounded retry: an unchanged board never pushes again, so
    // waiting for the next push could wait forever.
    clearTimeout(imgRetryTimer);
    imgRetryTimer = setTimeout(uploadImages, imgRetryMs);
    imgRetryMs = Math.min(imgRetryMs * 2, 300000);
  } else if (uploadAgain) {
    uploadAgain = false;
    uploadImages();
  }
}

// An image whose reference arrived before its bytes. Blob uploads do not move
// the board's version, so no pull will say they landed: look again on a
// timer while the editor is open — soon at first, then every 30 s.
function scheduleArriving() {
  if (arrivingTimer || !draftImgs) return;
  const gen = draftImgs.gen;
  const ctx = captureSync();
  arrivingTimer = setTimeout(() => {
    arrivingTimer = null;
    if (!draftImgs || draftImgs.gen !== gen || !isCurrentSync(ctx)) return;
    arrivingTries++;
    imgTried.clear();
    refreshImageViews();
  }, [3000, 8000, 15000][arrivingTries] || 30000);
}

/** An attachment → { url } or { state: 'arriving' | 'missing' }. */
async function imageUrl(a) {
  if (imgUrls.has(a.blob)) return { url: imgUrls.get(a.blob) };
  const rec = await imgGet(a.blob).catch(() => null);
  if (rec) {
    if (!imgUrls.has(a.blob)) imgUrls.set(a.blob, URL.createObjectURL(rec.bytes));
    rec.used = Date.now();
    imgPut(rec).catch(() => {});
    return { url: imgUrls.get(a.blob) };
  }
  const ctx = captureSync();
  if (!isCurrentSync(ctx)) return { state: 'missing' };
  const last = imgTried.get(a.blob);
  if (last) { scheduleArriving(); return { state: 'arriving' }; }
  if (imgWaiting.has(a.blob)) return { state: 'arriving' };
  imgWaiting.add(a.blob);
  try {
    const res = await blobFetch('GET', a.blob, null, ctx);
    if (!isCurrentSync(ctx)) return { state: 'missing' };
    if (res.status !== 200) { imgTried.set(a.blob, Date.now()); scheduleArriving(); return { state: 'arriving' }; }
    const sealed = new Uint8Array(await res.arrayBuffer());
    const { key, fp } = await blobKeysFor(ctx);
    const bytes = await C.unsealBlob(key, a.blob, sealed);
    if (!isCurrentSync(ctx)) return { state: 'missing' };
    const info = C.imageInfo(bytes);
    if (!info) return { state: 'missing' };
    const blob = new Blob([bytes], { type: info.type });
    await imgPut({ blobId: a.blob, ns: IMG_NS, type: info.type, bytes: blob, sha: await sha256Hex(bytes), sentTo: [fp], used: Date.now() });
    imgTried.delete(a.blob);
    if (!imgUrls.has(a.blob)) imgUrls.set(a.blob, URL.createObjectURL(blob));
    evictImages();
    return { url: imgUrls.get(a.blob) };
  } catch (err) {
    imgTried.set(a.blob, Date.now());
    scheduleArriving();
    return { state: 'arriving' };
  } finally {
    imgWaiting.delete(a.blob);
  }
}

/** Above the cap, drop the least recently opened images that a relay holds.
    A record that has reached no relay may be the only copy: never evicted. */
let evicting = false;
async function evictImages() {
  if (evicting) return;
  evicting = true;
  try {
    const all = await imgAll();
    let total = all.reduce((n, r) => n + (r.bytes ? r.bytes.size : 0), 0);
    if (total <= IMG_CACHE_CAP) return;
    const drop = [];
    for (const r of all.filter(r => (r.sentTo || []).length).sort((x, y) => (x.used || 0) - (y.used || 0))) {
      if (total <= IMG_CACHE_CAP) break;
      drop.push([r.ns, r.blobId]);
      total -= r.bytes ? r.bytes.size : 0;
    }
    await imgDelete(drop);
  } catch (err) { /* best effort */ } finally { evicting = false; }
}

function imagesAfterPull() {
  imgTried.clear(); // something changed: arriving images may be there now
  refreshImageViews();
  uploadImages();
}

/* ── the editor's draft images: bound to one opening ── */

let editorGen = 0;
const editorOutcome = new Map(); // gen → { saved: taskId } | { discarded: true }
let draftImgs = null;            // { gen, taskId, adds: [], removes: Set }

function beginDraftImages(taskId) {
  draftImgs = { gen: ++editorGen, taskId, adds: [], removes: new Set(), dropped: [] };
  arrivingTries = 0;
  renderImages();
}

function commitDraftImages(taskId) {
  if (!draftImgs) return;
  const ready = draftImgs.adds.filter(a => !a.preparing);
  if (ready.length || draftImgs.removes.size) state.attachments = { ...(state.attachments || {}) };
  for (const a of ready) state.attachments[a.id] = attachmentEntry(a, taskId);
  for (const id of draftImgs.removes) {
    if (state.attachments[id]) state.attachments[id] = { ...state.attachments[id], gone: true };
  }
  draftImgs.saved = taskId;
}

function attachmentEntry(a, taskId) {
  const who = me();
  const out = { task: taskId, blob: a.blob, type: a.type, w: a.w, h: a.h, bytes: a.bytes, at: a.at };
  if (a.name) out.name = a.name;
  if (who) { out.by = who.id; out.byName = who.name; }
  return out;
}

function endDraftImages() {
  if (!draftImgs) return;
  const d = draftImgs;
  draftImgs = null;
  if (noticeFiles && noticeFiles.gen === d.gen) noticeFiles = null;
  clearTimeout(arrivingTimer);
  arrivingTimer = null;
  if (d.saved) {
    editorOutcome.set(d.gen, { saved: d.saved });
    // images added then removed before saving: free them once their Undo is gone
    const dropped = d.dropped.map(a => a.blob);
    if (dropped.length) setTimeout(() => dropIfUnreferenced(dropped), 9000);
  } else {
    editorOutcome.set(d.gen, { discarded: true });
    dropIfUnreferenced(d.adds.concat(d.dropped).map(a => a.blob));
  }
}

const imageTitle = a => (a && a.name ? a.name.replace(/\.[a-z0-9]+$/i, '') : '') || tr('image');

function clipboardImages(e) {
  const items = [...((e.clipboardData && e.clipboardData.items) || [])];
  return items.filter(it => it.kind === 'file' && /^image\//.test(it.type))
    .map(it => it.getAsFile()).filter(Boolean);
}

let noticeFiles = null;
async function addImageFiles(files) {
  if (!draftImgs || readOnly || !files.length) return;
  // D6: the first image on a team board, once per device
  if (IS_TEAM && !state.imageNoticeSeen) { noticeFiles = { gen: draftImgs.gen, files }; renderImages(); return; }
  requestPersist();
  const job = draftImgs;
  for (const file of files) {
    const ph = { id: C.uid(), preparing: true, name: String(file.name || '').slice(0, 120), at: Date.now() };
    job.adds.push(ph);
    if (draftImgs === job) renderImages();
    let prep = null, blobId = null;
    try {
      prep = await prepareImage(file);
      blobId = await storeImage(prep);
    } catch (err) {
      job.adds.splice(job.adds.indexOf(ph), 1);
      if (draftImgs === job) renderImages();
      const why = err && err.message;
      toast(tr(why === 'large' ? 'imageTooLarge' : why === 'type' ? 'imageNotSupported' : 'imageUnreadable'));
      continue;
    }
    Object.assign(ph, { preparing: false, blob: blobId, type: prep.type, w: prep.w, h: prep.h, bytes: prep.bytes });
    if (draftImgs === job) { renderImages(); continue; }
    // The editor closed while this was preparing: its outcome decides.
    job.adds.splice(job.adds.indexOf(ph), 1);
    const out = editorOutcome.get(job.gen);
    if (out && out.saved && byId(out.saved)) {
      state.attachments = { ...(state.attachments || {}), [ph.id]: attachmentEntry(ph, out.saved) };
      save();
      render();
    } else {
      dropIfUnreferenced([blobId]);
    }
  }
}

function draftImageList() {
  if (!draftImgs) return [];
  return C.liveAttachments(state, draftImgs.taskId).filter(a => !draftImgs.removes.has(a.id))
    .concat(draftImgs.adds);
}

function removeImage(id) {
  if (!draftImgs) return;
  const d = draftImgs;
  const i = d.adds.findIndex(a => a.id === id);
  let held = null;
  if (i >= 0) { held = d.adds.splice(i, 1)[0]; d.dropped.push(held); }
  else d.removes.add(id);
  renderImages();
  toast(tr('imageRemoved'), () => {
    if (draftImgs === d) {
      if (held) { d.dropped.splice(d.dropped.indexOf(held), 1); d.adds.splice(Math.min(i, d.adds.length), 0, held); }
      else d.removes.delete(id);
      renderImages();
      return;
    }
    // the editor has saved since: undo on the board itself
    const saved = state.attachments && state.attachments[id];
    if (saved && saved.gone) {
      state.attachments = { ...state.attachments, [id]: { ...saved } };
      delete state.attachments[id].gone;
      save();
      render();
    } else if (held && d.saved && byId(d.saved)) {
      state.attachments = { ...(state.attachments || {}), [id]: attachmentEntry(held, d.saved) };
      save();
      render();
    }
  });
}

/* ── the strip (B1) ── */

const fImages = $('#f-images');
const fImagesNote = $('#f-images-note');
const fImageFile = $('#f-image-file');

const kb = n => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

function renderImages() {
  if (!fImages) return;
  fImages.innerHTML = '';
  if (!draftImgs) return;
  if (noticeFiles && noticeFiles.gen !== draftImgs.gen) noticeFiles = null;
  if (noticeFiles) {
    const note = document.createElement('div');
    note.className = 'img-notice';
    note.innerHTML = `<p>${esc(tr('teamImageNotice'))}</p>
      <div class="img-notice-row"><button class="primary sm" data-a="ok">${esc(tr('addImage'))}</button><button class="ghost sm" data-a="no">${esc(tr('cancel'))}</button></div>`;
    note.querySelector('[data-a="ok"]').onclick = () => {
      state.imageNoticeSeen = true; // a device preference: never travels
      save();
      const files = noticeFiles.files;
      noticeFiles = null;
      addImageFiles(files);
    };
    note.querySelector('[data-a="no"]').onclick = () => { noticeFiles = null; renderImages(); };
    fImages.append(note);
    fImagesNote.textContent = '';
    return;
  }
  const list = draftImageList();
  list.forEach((a, i) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'img-tile';
    tile.dataset.id = a.id;
    const who = IS_TEAM && a.by ? memberOf(a.by) : null;
    if (a.preparing) {
      tile.classList.add('preparing');
      tile.innerHTML = `<span class="img-state">${esc(tr('preparing'))}</span>`;
    } else {
      tile.innerHTML = `<span class="img-state"></span>${who ? avatarHtml(who, 'xs') : ''}`;
      tile.title = a.name || '';
      imageUrl(a).then(r => {
        if (!tile.isConnected) return;
        if (r.url) {
          const img = document.createElement('img');
          img.alt = a.name || '';
          img.src = r.url;
          tile.prepend(img);
          tile.classList.add('ready');
        } else {
          tile.classList.add(r.state);
          $('.img-state', tile).textContent = tr(r.state === 'arriving' ? 'arriving' : 'notOnDevice');
        }
      });
      tile.onclick = () => openLightbox(i);
    }
    fImages.append(tile);
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'img-add';
  add.title = tr('addImage');
  add.innerHTML = `${ICON.plus}<span>${esc(tr('addPhoto'))}</span>`;
  add.onclick = () => fImageFile.click();
  fImages.append(add);
  renderImagesNote(list);
}

/** The line under the strip: a hint, or what the images are doing. */
async function renderImagesNote(list) {
  const d = draftImgs;
  const ready = list.filter(a => !a.preparing && a.blob);
  let text = tr('imagesHint');
  let cls = '';
  if (ready.some(a => imgFail.get(a.blob) === 'full') && boardFull) {
    text = `${tr('boardFull')} · ${kb(boardFull.used)} / ${kb(boardFull.quota)}`;
    cls = 'bad';
  } else if (ready.length) {
    const recs = await Promise.all(ready.map(a => imgGet(a.blob).catch(() => null)));
    if (draftImgs !== d) return;
    const fp = sync && blobKeys && blobKeys.secret === sync.secret ? blobKeys.fp : null;
    const unsent = recs.filter(r => r && !(r.sentTo || []).length && !(fp && (r.sentTo || []).includes(fp)));
    const arriving = ready.filter((a, i) => !recs[i]);
    if (unsent.length && !sync) { text = tr('onlyHere'); cls = 'warn'; }
    else if (unsent.length && syncStatus === 'offline') { text = tr('uploadWaiting'); cls = 'warn'; }
    else if (unsent.length || uploadingNow) { text = tr('uploadingN').replace('{n}', Math.max(1, unsent.length)); cls = 'busy'; }
    else if (arriving.length && sync) { text = tr('arrivingN').replace('{n}', arriving.length); cls = 'busy'; }
  }
  if (draftImgs !== d) return;
  fImagesNote.textContent = text;
  fImagesNote.className = `img-note ${cls}`;
}

function refreshImageViews() {
  if (draftImgs && !editor.hidden) renderImages();
}

if (fImageFile) {
  fImageFile.addEventListener('change', () => {
    const files = [...fImageFile.files];
    fImageFile.value = '';
    addImageFiles(files);
  });
}

// Drop anywhere on the sheet.
const hasFiles = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
editor.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  editor.classList.add('dropping');
});
editor.addEventListener('dragleave', e => {
  if (!editor.contains(e.relatedTarget)) editor.classList.remove('dropping');
});
editor.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  editor.classList.remove('dropping');
  addImageFiles([...e.dataTransfer.files].filter(f => /^image\//.test(f.type)));
});

/* ── the lightbox (C1) ── */

let lightboxEl = null, lightboxAt = 0;

function openLightbox(i) {
  closeLightbox();
  lightboxAt = i;
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox';
  lightboxEl.setAttribute('role', 'dialog');
  lightboxEl.setAttribute('aria-modal', 'true');
  document.body.append(lightboxEl);
  renderLightbox();
}

function closeLightbox() {
  if (!lightboxEl) return;
  lightboxEl.remove();
  lightboxEl = null;
}

function stepLightbox(dir) {
  const list = draftImageList().filter(a => !a.preparing);
  if (!list.length) { closeLightbox(); return; }
  lightboxAt = (lightboxAt + dir + list.length) % list.length;
  renderLightbox();
}

function renderLightbox() {
  if (!lightboxEl) return;
  const list = draftImageList().filter(a => !a.preparing);
  if (!list.length) { closeLightbox(); return; }
  lightboxAt = Math.min(lightboxAt, list.length - 1);
  const a = list[lightboxAt];
  const who = IS_TEAM && a.by ? (memberOf(a.by) || { name: a.byName || '?' }) : null;
  lightboxEl.innerHTML = `
    <header class="lb-head">
      <div class="lb-file"><span class="lb-name">${esc(a.name || tr('image'))}</span><span class="lb-facts">${kb(a.bytes || 0)} · ${a.w}×${a.h}</span></div>
      <span class="lb-count">${lightboxAt + 1} / ${list.length}</span>
      <div class="lb-actions">
        ${who ? `<span class="lb-who">${avatarHtml(who, 'xs')}${esc(who.name)} · ${esc(age(a.at) || tr('today'))}</span>` : ''}
        <button class="lb-btn" data-a="dl" title="${esc(tr('downloadImage'))}">${ICON.download}</button>
        <button class="lb-btn" data-a="rm" title="${esc(tr('delete'))}">${ICON.trash}</button>
        <button class="lb-btn" data-a="x" title="${esc(tr('close'))}">${ICON.close}</button>
      </div>
    </header>
    <div class="lb-stage">
      ${list.length > 1 ? `<button class="lb-nav prev" data-a="prev" title="←">${ICON.prev}</button>` : ''}
      <div class="lb-img"><span class="img-state"></span></div>
      ${list.length > 1 ? `<button class="lb-nav next" data-a="next" title="→">${ICON.next}</button>` : ''}
    </div>
    ${list.length > 1 ? `<div class="lb-thumbs">${list.map((x, j) => `<button class="lb-thumb${j === lightboxAt ? ' on' : ''}" data-j="${j}"></button>`).join('')}</div>` : ''}`;
  const box = $('.lb-img', lightboxEl);
  imageUrl(a).then(r => {
    if (!lightboxEl || !box.isConnected) return;
    if (r.url) { const img = document.createElement('img'); img.src = r.url; img.alt = a.name || ''; box.replaceChildren(img); }
    else $('.img-state', box).textContent = tr(r.state === 'arriving' ? 'arriving' : 'notOnDevice');
  });
  lightboxEl.querySelectorAll('.lb-thumb').forEach(t => {
    const x = list[+t.dataset.j];
    imageUrl(x).then(r => { if (r.url && t.isConnected) t.style.backgroundImage = `url(${r.url})`; });
    t.onclick = () => { lightboxAt = +t.dataset.j; renderLightbox(); };
  });
  lightboxEl.onclick = e => {
    const act = e.target.closest('[data-a]');
    if (!act) { if (e.target === lightboxEl || e.target.classList.contains('lb-stage')) closeLightbox(); return; }
    const k = act.dataset.a;
    if (k === 'x') closeLightbox();
    if (k === 'prev') stepLightbox(-1);
    if (k === 'next') stepLightbox(1);
    if (k === 'rm') { removeImage(a.id); renderLightbox(); }
    if (k === 'dl') imageUrl(a).then(r => {
      if (!r.url) return;
      const link = document.createElement('a');
      link.href = r.url;
      link.download = a.name || `image.${(a.type || 'image/webp').split('/')[1]}`;
      link.click();
    });
  };
}

/* ── backups carry the bytes ── */

/** Every live image's bytes as base64url; a synced board fetches what it
    lacks first. Returns { images, missing }. */
async function backupImages() {
  const images = {}, missing = [];
  for (const a of C.liveAttachments(state)) {
    if (images[a.blob]) continue;
    let rec = await imgGet(a.blob).catch(() => null);
    if (!rec) { imgTried.delete(a.blob); await imageUrl(a); rec = await imgGet(a.blob).catch(() => null); }
    if (!rec) { missing.push(a.blob); continue; }
    images[a.blob] = C.bytesToB64u(new Uint8Array(await rec.bytes.arrayBuffer()));
  }
  return { images, missing };
}

/** A backup's images → local records. Only ids the file's own references
    name, only real images within the limit, never over a different record. */
async function restoreImages(file) {
  const images = file.images;
  if (!images || typeof images !== 'object') return 0;
  const wanted = new Set(Object.values(file.attachments || {}).map(a => a && a.blob).filter(Boolean));
  let n = 0;
  for (const [blobId, b64] of Object.entries(images)) {
    if (!C.BLOB_ID.test(blobId) || !wanted.has(blobId) || typeof b64 !== 'string') continue;
    try {
      const bytes = C.b64uToBytes(b64);
      const info = C.imageInfo(bytes);
      if (!info || bytes.length > C.MAX_IMAGE) continue;
      const sha = await sha256Hex(bytes);
      const held = await imgGet(blobId).catch(() => null);
      if (held && held.sha !== sha) continue;
      if (!held) await imgPut({ blobId, ns: IMG_NS, type: info.type, bytes: new Blob([bytes], { type: info.type }), sha, sentTo: [], used: Date.now() });
      n++;
    } catch (err) { /* skip that one */ }
  }
  return n;
}

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
  get sync() { return sync; },
  set sync(v) {
    suspendSyncRuntime();
    sync = v ? { ...v, _bindingGen: clone(v._bindingGen || bindingGenOf(state)) } : null;
    syncKeys = null;
    remoteHead = '';
    rejectedPayload = '';
    floor = null;
  },
  get syncStatus() { return syncStatus; },
  get contentGen() { return contentGenOf(state); },
  get bindingGen() { return bindingGenOf(state); },
};

render();

/* Sync starts last, once there is a board on screen. A `#sync=` link is
   removed from the address bar immediately, then opens the checking state;
   an existing relationship still starts its normal watch/pull independently. */

let candidatePresentation = 0;
function presentCandidateWhenSettled(secret) {
  const id = ++candidatePresentation;
  closeComposer();
  if (!editor.hidden) saveEditor();
  closeProjects(); closeReport(); closeArchive();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
  const settle = async () => {
    if (id !== candidatePresentation) return;
    if (syncBusy()) { setTimeout(settle, 50); return; }
    if (await routeTeamCandidate(secret)) return;
    if (id !== candidatePresentation) return;
    inspectCandidate(secret);
  };
  settle();
}

function adoptFromHash() {
  const m = location.hash.match(/[#&]sync=([A-Za-z0-9_-]{43})(?:&|$)/);
  if (!m) return false;
  // The secret must not linger in the URL bar, in history, or in whatever the
  // phone's share sheet would copy.
  history.replaceState(null, '', location.pathname + location.search);
  presentCandidateWhenSettled(m[1]);
  return true;
}

// Pasting a pairing link into a tab that already has the board open is a hash
// change, not a load — no reload, so the boot path below never sees it.
window.addEventListener('hashchange', adoptFromHash);

if (IS_HOME) ingestRequests();
const teamBooted = bootTeamPage();
if (!teamBooted) adoptFromHash();
if (location.hash === '#computers') { history.replaceState(null, '', location.pathname + location.search); openComputers(true); }
if (readOnly) toast(tr('needsUpdate'), null, 10000);
if (sync) {
  connectWatch();
  pull();
}
