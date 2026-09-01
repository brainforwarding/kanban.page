'use strict';
/* name → secret. The secret is full read/write to the board with no account
   behind it, no rotation and no audit, and it may exist nowhere else — so it
   never travels through argv (shell history, ps, any spawned process), and
   forgetting it is a deliberate, confirmed act. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { OFFICIAL } = require('./relay.js');

const SERVICE = 'kanban.page';
const DIR = path.join(os.homedir(), '.config', 'kanban');
const CONFIG = path.join(DIR, 'config.json');
const FALLBACK = path.join(DIR, 'secrets.json');

class BoardError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

/** The app's own grammar (app.js:2684): a bare secret, or any URL with #sync=. */
function parseEntry(text) {
  const s = (text || '').trim();
  if (/^[A-Za-z0-9_-]{43}$/.test(s)) return s;
  let url;
  try { url = new URL(s); } catch (err) { return null; }
  const m = url.hash.match(/[#&]sync=([A-Za-z0-9_-]{43})(?:&|$)/);
  return m ? m[1] : null;
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
  catch (err) { return { boards: {}, default: null }; }
}

function writeConfig(cfg) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

const hasKeychain = () => process.platform === 'darwin';

function keychainGet(name) {
  try {
    return execFileSync('/usr/bin/security',
      ['find-generic-password', '-s', SERVICE, '-a', name, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (err) { return null; }
}

/**
 * `-w` with NO value makes `security` read the password from stdin, so the
 * secret never enters argv — where `ps` can read it and, worse, where Node
 * copies it verbatim into the Error.message of a failed spawn. This function
 * used to pass it as an argument while a comment right here claimed it did
 * not; `board replace` then failed on every duplicate item and printed the
 * freshly pasted secret to the terminal one line after promising not to.
 *
 * `-U` updates an existing item instead of failing on it, which is what makes
 * replace possible at all. The catch is deliberately blind: the underlying
 * error text is exactly the thing that must not reach a terminal.
 */
function keychainSet(name, secret) {
  try {
    execFileSync('/usr/bin/security',
      ['add-generic-password', '-U', '-s', SERVICE, '-a', name, '-w'],
      { input: `${secret}\n${secret}\n`, stdio: ['pipe', 'ignore', 'ignore'] });
  } catch (err) {
    throw new BoardError('credential', 'the keychain refused to store the secret');
  }
}

function keychainDelete(name) {
  try {
    execFileSync('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', name],
      { stdio: 'ignore' });
    return true;
  } catch (err) { return false; }
}

function fallbackRead() {
  try { return JSON.parse(fs.readFileSync(FALLBACK, 'utf8')); } catch (err) { return {}; }
}

function fallbackWrite(map) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const tmp = FALLBACK + '.tmp';
  try { fs.unlinkSync(tmp); } catch (err) { /* fresh */ }
  const fd = fs.openSync(tmp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  fs.writeSync(fd, JSON.stringify(map, null, 2) + '\n');
  fs.closeSync(fd);
  fs.renameSync(tmp, FALLBACK);
}

function getSecret(name) {
  if (hasKeychain()) {
    const s = keychainGet(name);
    if (s) return s;
  }
  const s = fallbackRead()[name];
  return s || null;
}

/** Overwrites. Callers that must not overwrite (addBoard) check first. */
function putSecret(name, secret, { plaintextOk = false } = {}) {
  if (hasKeychain()) { keychainSet(name, secret); return 'keychain'; }
  if (!plaintextOk) {
    throw new BoardError('usage',
      `no OS keychain on ${process.platform}. Re-run with --store-plaintext to keep the secret in ${FALLBACK} (mode 0600, not protected by the OS).`);
  }
  const map = fallbackRead();
  map[name] = secret;
  fallbackWrite(map);
  return 'file';
}

function addBoard(name, entry, { relay = OFFICIAL, plaintextOk = false } = {}) {
  const cfg = readConfig();
  // `.previous` is where replace parks a displaced secret, so a board by that
  // name would share a keychain slot with another board's backup and the next
  // `replace` would overwrite a live capability. -U made that silent.
  if (/\.previous$/.test(name)) {
    throw new BoardError('usage', 'names ending in ".previous" are reserved — that is where a replaced secret is kept. Pick another name.');
  }
  // Never overwrite: the secret being replaced may exist nowhere else. Both
  // stores are checked, because keychainSet now passes -U and would happily
  // clobber a surviving item if config.json were lost or corrupt (readConfig
  // swallows a parse error and returns an empty map).
  if (cfg.boards[name] || getSecret(name)) {
    throw new BoardError('usage', `board "${name}" already has a stored secret. Use \`kanban board replace ${name}\` to change it.`);
  }
  const secret = parseEntry(entry);
  if (!secret) throw new BoardError('usage', 'that is not a kanban sync link or a 43-character secret');
  const where = putSecret(name, secret, { plaintextOk });
  cfg.boards[name] = { relay };
  if (!cfg.default) cfg.default = name;
  writeConfig(cfg);
  return { where, isDefault: cfg.default === name };
}

/** The slot holding the secret a replace displaced. ONE per board, not one per
    replace: a timestamped name left an item nothing tracked, listed or could
    remove, quietly accumulating capabilities in the keychain. */
const previousOf = name => `${name}.previous`;

function replaceBoard(name, entry, { plaintextOk = false } = {}) {
  const cfg = readConfig();
  if (!cfg.boards[name]) throw new BoardError('not-found', `no board named "${name}"`);
  const secret = parseEntry(entry);
  if (!secret) throw new BoardError('usage', 'that is not a kanban sync link or a 43-character secret');
  const old = getSecret(name);
  // Kept because the displaced secret may exist nowhere else; overwritten each
  // time so there is only ever one, and named so `board forget` can find it.
  // Both writes go through putSecret so the plaintext gate has exactly one
  // implementation. Hardcoding plaintextOk here, or writing the fallback file
  // inline, would let a secret reach disk on a machine whose owner never
  // consented to that — the gate would still be there, just not on this path.
  if (old) putSecret(previousOf(name), old, { plaintextOk });
  putSecret(name, secret, { plaintextOk });
  return { kept: !!old, previous: old ? previousOf(name) : null };
}

/** Local only. Never issues a relay DELETE — ending sync everywhere is the app's job. */
function forgetBoard(name) {
  const cfg = readConfig();
  if (!cfg.boards[name]) throw new BoardError('not-found', `no board named "${name}"`);
  const secret = getSecret(name);
  delete cfg.boards[name];
  if (cfg.default === name) cfg.default = Object.keys(cfg.boards)[0] || null;
  writeConfig(cfg);
  const prev = previousOf(name);
  const hadPrev = !!getSecret(prev);
  if (hasKeychain()) { keychainDelete(name); keychainDelete(prev); }
  else { const m = fallbackRead(); delete m[name]; delete m[prev]; fallbackWrite(m); }
  return { had: !!secret, hadPrev };
}

/** --board, then KANBAN_SECRET, then --secret-stdin, then the configured default. */
function select({ board, secretStdin, relay } = {}) {
  const cfg = readConfig();

  if (board) {
    if (!cfg.boards[board]) throw new BoardError('not-found', `no board named "${board}". Known: ${Object.keys(cfg.boards).join(', ') || '(none)'}`);
    const secret = getSecret(board);
    if (!secret) throw new BoardError('credential', `board "${board}" has no stored secret`);
    return { name: board, secret, relay: relay || cfg.boards[board].relay || OFFICIAL };
  }
  if (process.env.KANBAN_SECRET) {
    const secret = parseEntry(process.env.KANBAN_SECRET);
    if (!secret) throw new BoardError('credential', 'KANBAN_SECRET is not a sync link or a 43-character secret');
    return { name: '(env)', secret, relay: relay || OFFICIAL };
  }
  if (secretStdin) {
    const secret = parseEntry(secretStdin);
    if (!secret) throw new BoardError('credential', 'stdin did not contain a sync link or a 43-character secret');
    return { name: '(stdin)', secret, relay: relay || OFFICIAL };
  }
  if (cfg.default) {
    const secret = getSecret(cfg.default);
    if (!secret) throw new BoardError('credential', `default board "${cfg.default}" has no stored secret`);
    return { name: cfg.default, secret, relay: relay || cfg.boards[cfg.default].relay || OFFICIAL };
  }
  throw new BoardError('usage', 'no board selected. Run `kanban board add <name>` first.');
}

/** Any subprocess we spawn must not inherit the capability. */
function scrubbedEnv() {
  const env = { ...process.env };
  delete env.KANBAN_SECRET;
  return env;
}

module.exports = {
  BoardError, parseEntry, readConfig, writeConfig, addBoard, replaceBoard, forgetBoard,
  select, getSecret, scrubbedEnv, previousOf, CONFIG, FALLBACK, DIR,
};
