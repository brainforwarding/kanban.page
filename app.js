/* board — local kanban for agent-driven work.
   Everything lives in localStorage. No network, no build step. */

/* ── helpers ───────────────────────────────────────────── */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = () => BoardCore.uid();
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
  const menuText = { projects: tr('projects'), archive: tr('archive'), theme: tr('theme'), addcol: tr('addStage'), sortproj: tr('sortProject'), export: tr('export'), import: tr('import'), sync: tr('syncDevices') };
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

try {
  const held = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null');
  if (held && sameGen(bindingGenOf(held), bindingGenOf(state))) sync = held;
} catch (err) { /* off */ }

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
  return fetch(`${RELAY}/v1/board`, {
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
  if ((remote.v || 2) > 2) { setSyncStatus('error'); return; } // a newer app wrote this
  floor = { events: remote.events || [], tombstones: remote.tombstones || {} };
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
        floor = { events: payload.events, tombstones: payload.tombstones };
        joiningOrder = false; // the adoption has settled
        clearSyncRetry();
        setSyncStatus('ok');
        syncedAt = Date.now();
        if (syncableStr(state) !== snap) schedulePush(300); // edits landed mid-flight
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
    syncedAt = Date.now();
    if (ver !== sync.ver) {
      applyRemote(remote, ver, ctx);
    } else {
      floor = { events: remote.events || [], tombstones: remote.tombstones || {} };
      remoteHead = normalized(remote);
      const current = syncableStr(state);
      if (current === remoteHead) {
        clearSyncRetry();
        setSyncStatus('ok');
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

async function enableSync() {
  suspendSyncRuntime();
  state._bindingGen = nextGen(bindingGenOf(state));
  lastStamped = clone(state);
  if (!writeStateNow()) return false;
  sync = { secret: C.randomSecret(), ver: 0, _bindingGen: clone(bindingGenOf(state)) };
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
  if (!raw || typeof raw !== 'object' || (raw.v || 2) > 2) return false;
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
      res = await fetch(`${RELAY}/v1/board`, {
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
  floor = { events: candidate.remote.events || [], tombstones: candidate.remote.tombstones || {} };
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
    title: '', notes: '', projectId: state.filter || null, session: '',
    flag: state.flagFilter || false, columnId: colId || state.columns[0].id,
  };

  fTitle.value = draft.title;
  fNotes.value = draft.notes || '';
  fSession.value = draft.session || '';
  $('#f-archive').style.visibility = t ? 'visible' : 'hidden';
  $('#f-close').title = tr('discard');
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
  flushExternal(); // the editor was a sync barrier; apply what it held back
}

$('#f-save').onclick = saveEditor;
$('#f-close').innerHTML = ICON.close;
$('#f-close').onclick = closeEditor;   // the deliberate discard, now labelled
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
    $('#sync-warn').textContent = tr('syncWarning');
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
  inspectCandidate(parsed.secret);
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
    snapshot(!sync);
    const incoming = C.migrate(next); // also upgrades a v1 backup on the way in
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

function undo() {
  if (!undoSnap) return;
  const replacement = undoReplacesBoard;
  const next = undoSnap;
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
  scrim.hidden = editor.hidden && panel.hidden && reportEl.hidden && archiveEl.hidden && syncEl.hidden;
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
  if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  if (!editor.hidden || !panel.hidden || !reportEl.hidden || !archiveEl.hidden || !syncEl.hidden) return;

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
    if (!syncEl.hidden) { closeSync(); return; }
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
  const done = state.columns[state.columns.length - 1].name;
  repEntries = C.aggregateWeek(state.events, repWeek, lookupTask, done);

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
  $('#rep-sum').textContent = repEntries.length
    ? [rel, C.summaryLine(repEntries, done, locale)].filter(Boolean).join(' · ')
    : (rel || '');

  const body = $('#rep-body');
  body.innerHTML = '';

  if (!repEntries.length) {
    body.innerHTML = `<p class="rep-empty">${tr('nothingMoved')}</p>`;
  } else {
    const order = state.projects.map(p => p.name);
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

function reportRow(e) {
  const p = state.projects.find(x => x.name === e.project);
  const row = document.createElement('div');
  row.className = 'rep-row' + (repSel.has(e.taskId) ? ' on' : '') + (e.netZero ? ' zero' : '');
  if (p) row.style.setProperty('--c', p.color);
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
      gone ? ` <i title="${tr('offBoard')}">&#8856;</i>` : ''}</span>
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
    syncRepFoot();
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
    projectOrder: state.projects.map(p => p.name),
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
  else repEntries.forEach(e => repSel.add(e.taskId));
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
  const settle = () => {
    if (id !== candidatePresentation) return;
    if (syncBusy()) { setTimeout(settle, 50); return; }
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

adoptFromHash();
if (sync) {
  connectWatch();
  pull();
}
