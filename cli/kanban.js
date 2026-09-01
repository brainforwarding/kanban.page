#!/usr/bin/env node
'use strict';
/* kanban — a headless client of the same relay the app syncs through.
   See docs/cli.md. The load-bearing shape is build-once / land-many: the
   mutation and its clocks are computed a single time, and every retry reuses
   that exact result, because rebuilding is how a card lands twice. */

const C = require('../core.js');
const ops = require('./ops.js');
const fmt = require('./format.js');
const boards = require('./boards.js');
const { Relay, RelayError, OFFICIAL, checkOrigin } = require('./relay.js');

const clone = x => JSON.parse(JSON.stringify(x));

/* ── args ────────────────────────────────────────────── */

const FLAGS = new Set(['--flag', '--no-flag', '--no-project', '--all', '--json', '--dry-run',
  '--secret-stdin', '--store-plaintext', '--force', '--md']);

function parseArgs(argv) {
  const out = { _: [], opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (FLAGS.has(a)) { out.opts[key] = true; continue; }
    const eq = a.indexOf('=');
    if (eq > -1) { out.opts[a.slice(2, eq).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a.slice(eq + 1); continue; }
    out.opts[key] = argv[++i];
  }
  return out;
}

const readStdin = () => new Promise(resolve => {
  if (process.stdin.isTTY) return resolve('');
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', () => resolve(buf));
});

/** Ask for the link on a terminal, echo off — it is a password, and scrollback
    is forever. Piped input wins, so scripts never see a prompt. */
function promptSecret(label) {
  return new Promise((resolve, reject) => {
    const readline = require('readline');
    const mute = new (require('stream').Writable)({
      write(chunk, enc, cb) { if (!this.muted) process.stdout.write(chunk, enc); cb(); },
    });
    const rl = readline.createInterface({ input: process.stdin, output: mute, terminal: true });
    process.stdout.write(label);
    mute.muted = true;
    rl.question('', answer => { mute.muted = false; process.stdout.write('\n'); rl.close(); resolve(answer); });
    rl.on('SIGINT', () => { mute.muted = false; rl.close(); reject(new boards.BoardError('usage', 'cancelled')); });
  });
}

/** Piped input if there is any, else a prompt. */
async function readLink() {
  const piped = (await readStdin()).trim();
  if (piped) return piped;
  if (!process.stdin.isTTY) return '';
  return (await promptSecret('Sync link (paste; it will not be shown): ')).trim();
}

/* ── the cycle ───────────────────────────────────────── */

async function connect(opts) {
  const stdinText = opts.secretStdin ? await readStdin() : null;
  const sel = boards.select({ board: opts.board, secretStdin: stdinText, relay: opts.relay });
  const bad = checkOrigin(sel.relay, { trusted: !!opts.relay });
  if (bad) throw new RelayError('credential', bad);
  const { token, key } = await C.deriveSync(sel.secret);
  return { sel, key, relay: new Relay({ origin: sel.relay, token }) };
}

async function fetchBoard(opts) {
  const { sel, key, relay } = await connect(opts);
  const head = await relay.head(key);
  if (!head) {
    throw new RelayError('not-found',
      'the relay holds no board for this secret. Either sync is off in the app, or the secret is for a different board or a different relay.');
  }
  return { sel, key, relay, ver: head.ver, state: head.payload };
}

/** build → stamp → floor → land. The only path that writes. */
async function mutate(opts, build) {
  const { sel, key, relay, ver, state } = await fetchBoard(opts);
  const built = build(state);

  const out = { board: sel.name, ver, fingerprint: fmt.fingerprint(sel.name, state, ver) };

  if (built.noop) {
    out.noop = true;
    out.summary = built.summary;
    return out;
  }

  const prev = clone(state);
  let next = built.state;
  C.stampChanges(prev, next);                 // the one place clocks are wound
  next = C.unionFloor(next, { events: state.events, tombstones: state.tombstones });

  // The probe is this command's idempotency key: it recognises THIS change in a
  // head fetched later, so an ambiguous failure never re-runs the mutation.
  const probe = built.probe || built.probeFromStamped(next);

  out.summary = built.summary;
  if (opts.dryRun) { out.dryRun = true; return out; }

  const landed = await relay.land({ key, state: next, baseVer: ver, probe });
  out.newVer = landed.ver;
  out.contended = landed.contended;
  return out;
}

/* ── commands ────────────────────────────────────────── */

const CMDS = {};

CMDS.add = async (args, opts) => mutate(opts, st => ops.add(st, {
  title: args[0], notes: opts.notes, session: opts.session, project: opts.project,
  projectId: opts.projectId, stage: opts.stage, stageId: opts.stageId, flag: opts.flag,
}));

CMDS.mv = async (args, opts) => mutate(opts, st => ops.move(st, {
  id: args[0], stage: args[1], stageId: opts.stageId,
}));

CMDS.done = async (args, opts) => mutate(opts, st => ops.move(st, { id: args[0], done: true }));

CMDS.edit = async (args, opts) => {
  const fields = ['title', 'notes', 'session', 'project', 'projectId'];
  const given = fields.some(f => opts[f] !== undefined) || opts.flag || opts.noFlag || opts.noProject;
  if (!given) throw new ops.OpError('usage', 'edit needs at least one field: --title --notes --session --project/--no-project --flag/--no-flag');
  return mutate(opts, st => ops.edit(st, {
    id: args[0], title: opts.title, notes: opts.notes, session: opts.session,
    project: opts.project, projectId: opts.projectId, noProject: opts.noProject,
    flag: opts.flag ? true : opts.noFlag ? false : undefined,
  }));
};

CMDS.archive = async (args, opts) => mutate(opts, st => ops.archive(st, { id: args[0] }));
CMDS.restore = async (args, opts) => mutate(opts, st => ops.restore(st, { id: args[0] }));

CMDS.ls = async (args, opts) => {
  const { sel, ver, state } = await fetchBoard(opts);
  return {
    board: sel.name, ver, fingerprint: fmt.fingerprint(sel.name, state, ver),
    read: fmt.list(state, { stage: opts.stage, project: opts.project, all: opts.all }),
    tasks: opts.json ? ops.live(state).map(t => ({
      id: t.id, title: t.title, stage: ops.colName(state, t.columnId),
      project: ops.projectName(state, t), flag: !!t.flag, order: t.order,
    })) : undefined,
  };
};

CMDS.show = async (args, opts) => {
  const { sel, ver, state } = await fetchBoard(opts);
  const t = ops.resolveTask(state, args[0], { archived: true });
  return { board: sel.name, ver, read: fmt.show(state, t), task: opts.json ? t : undefined };
};

CMDS.report = async (args, opts) => {
  const { sel, ver, state } = await fetchBoard(opts);
  const monday = C.mondayOf(opts.week || C.ymd(new Date()));
  const lookup = id => {
    const t = (state.tasks || []).find(x => x.id === id);
    return t ? { title: t.title, project: ops.projectName(state, t), archived: !!t.archivedAt } : null;
  };
  const done = ops.doneStage(state).name;
  const entries = C.aggregateWeek(state.events, monday, lookup, done);
  const locale = opts.locale || 'en';
  const read = opts.md
    ? C.toMarkdown(entries.filter(e => e.include), monday,
      { projectOrder: (state.projects || []).map(p => p.name), locale })
    : entries.map(e => `${e.include ? '[x]' : '[ ]'} ${e.tense || '—'}  ${e.from} → ${e.to}  ${e.title}`).join('\n');
  return { board: sel.name, ver, week: monday, read: read || '(nothing this week)' };
};

CMDS.board = async (args, opts) => {
  const [sub, name] = args;
  const cfg = boards.readConfig();

  if (!sub || sub === 'ls') {
    const rows = Object.entries(cfg.boards).map(([n, b]) =>
      `${n === cfg.default ? '*' : ' '} ${n}${b.relay && b.relay !== OFFICIAL ? '  ' + b.relay : ''}`);
    return { read: rows.join('\n') || 'no boards configured', boards: Object.keys(cfg.boards) };
  }
  if (sub === 'add' || sub === 'replace') {
    if (!name) throw new boards.BoardError('usage', `kanban board ${sub} <name>  (link on stdin)`);
    const entry = await readLink();
    if (!entry) throw new boards.BoardError('usage', 'no sync link given. Paste it when asked, or pipe it in: `pbpaste | kanban board add work`');
    const res = sub === 'add'
      ? boards.addBoard(name, entry, { relay: opts.relay || OFFICIAL, plaintextOk: opts.storePlaintext })
      : boards.replaceBoard(name, entry, { plaintextOk: opts.storePlaintext });
    const where = res.where || 'the keychain';
    if (sub === 'add') return { read: `board "${name}" added · secret in ${where}` };
    return { read: `board "${name}" replaced · the previous secret is kept as "${res.previous}" until you run \`kanban board forget ${name} --force\`` };
  }
  if (sub === 'default') {
    if (!cfg.boards[name]) throw new boards.BoardError('not-found', `no board named "${name}"`);
    cfg.default = name; boards.writeConfig(cfg);
    return { read: `default board is now "${name}"` };
  }
  if (sub === 'forget') {
    if (!opts.force) {
      throw new boards.BoardError('usage',
        `this deletes this machine's copy of "${name}"'s secret (and any kept by an earlier replace), which may exist nowhere else. It does NOT end sync on other devices. Re-run with --force.`);
    }
    const res = boards.forgetBoard(name);
    return { read: `forgot "${name}" locally${res.hadPrev ? ', including the secret a previous replace kept' : ''}. Other devices are still synced.` };
  }
  throw new boards.BoardError('usage', 'board subcommands: ls, add, replace, default, forget');
};

/**
 * Only OUR errors carry text known to be free of the secret. Anything else — a
 * failed spawn, a thrown Node error — can embed argv, an environment, or a URL
 * fragment, so it gets a generic line and nothing more. This is the backstop
 * that would have contained the keychain argv leak.
 */
function safeErrorLine(err) {
  const kind = (err && err.kind) || 'protocol';
  const ours = err instanceof boards.BoardError
    || err instanceof RelayError
    || err instanceof ops.OpError;
  return ours ? `${kind}: ${err.message}` : `${kind}: unexpected failure in ${(err && err.name) || 'the CLI'}`;
}

/* ── main ────────────────────────────────────────────── */

const USAGE = `kanban — headless client for a synced kanban.page board

  kanban add "<title>" [--notes N] [--session S] [--project P] [--stage S] [--flag]
  kanban mv <id> <stage>            kanban done <id>
  kanban edit <id> [--title T] [--notes N] [--session S] [--project P|--no-project] [--flag|--no-flag]
  kanban archive <id>               kanban restore <id>
  kanban ls [--stage S] [--project P] [--all]
  kanban show <id>
  kanban report [--week YYYY-MM-DD] [--locale en|es] [--md]
  kanban board [ls|add <name>|replace <name>|default <name>|forget <name> --force]

  global: --board <name> --json --dry-run --secret-stdin --relay <origin>

The secret is never taken as an argument. Pipe the sync link in:
  pbpaste | kanban board add work`;

async function main() {
  const { _: argv, opts } = parseArgs(process.argv.slice(2));
  const [cmd, ...args] = argv;

  if (!cmd || cmd === 'help' || opts.help) { console.log(USAGE); return 0; }
  if (!CMDS[cmd]) { console.error(`unknown command "${cmd}"\n\n${USAGE}`); return fmt.EXIT.usage; }

  const res = await CMDS[cmd](args, opts);

  if (opts.json) { console.log(JSON.stringify(res, null, 2)); return 0; }

  if (res.fingerprint) console.log(res.fingerprint);
  if (res.summary) console.log(fmt.summaryLine(res.summary));
  if (res.read) console.log(res.read);
  if (res.noop) console.log('no change');
  else if (res.dryRun) console.log('dry run · nothing written');
  else if (res.newVer) console.log(`ok · ver ${res.newVer}${res.contended ? ' (merged a concurrent write)' : ''}`);
  return 0;
}

if (require.main === module) {
  main().then(code => process.exit(code || 0)).catch(err => {
    const kind = err.kind || 'protocol';
    // Only OUR errors carry text known to be free of the secret. Anything else
    // — a failed spawn, a thrown Node error — can embed argv, an environment,
    // or a URL fragment, so it gets a generic line and nothing more. This is
    // the backstop that would have contained the keychain argv leak.
    console.error(safeErrorLine(err));
    process.exit(fmt.EXIT[kind] ?? 1);
  });
}

module.exports = { main, parseArgs, mutate, CMDS, safeErrorLine };
