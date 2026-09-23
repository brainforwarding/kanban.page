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
  '--secret-stdin', '--store-plaintext', '--force', '--md', '--mine']);

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
  const built = build(state, sel);

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
  // The firewall, before anything leaves this machine: a team board never
  // carries a session, and team and personal data never mix.
  const bad = C.validateSyncable(C.syncable(next), ops.isTeam(next) ? 'team' : 'personal');
  if (bad) throw new ops.OpError('usage', `refusing to write: ${bad}`);

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

/* ── identity and computers ──────────────────────────── */

/** The member this CLI is on the selected board — stored beside the board's
    config entry by `kanban whoami`, and only if the roster still has it. */
function identity(sel, st) {
  const entry = boards.readConfig().boards[sel.name];
  const id = entry && entry.member;
  return id ? (st.members || []).find(m => m.id === id) || null : null;
}

const normal = s => String(s || '').toLowerCase().replace(/\.local$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Which computer this is, for a session written from here: the stored
    `here`, else the one computer whose name the hostname contains — only on
    exactly one fit, and said out loud. */
function thisComputer(sel, st) {
  const entry = boards.readConfig().boards[sel.name] || {};
  const list = st.machines || [];
  if (entry.here && list.some(m => m.id === entry.here)) return { id: entry.here };
  const hit = computerFromHostname(list, require('os').hostname());
  if (hit) return { id: hit.id, note: `computer: ${hit.name} (from hostname)` };
  return { id: null, note: list.length ? 'computer: unknown · run `kanban here "<this computer>"` once' : null };
}

/** `Sebastians-Mac-mini.local` → "Mac mini". Whole words only, and only when
    exactly one computer fits; anything else is no answer, never a guess. */
function computerFromHostname(list, hostname) {
  const host = normal(hostname);
  const hits = (list || []).filter(m => normal(m.name) && ` ${host} `.includes(` ${normal(m.name)} `));
  return hits.length === 1 ? hits[0] : null;
}

/** The personal board, for commands that write your private data: the one
    `kanban here` was run on. Never guessed. */
function personalBoardName(cfg) {
  if (cfg.personal && cfg.boards[cfg.personal]) return cfg.personal;
  return null;
}

/* ── commands ────────────────────────────────────────── */

const CMDS = {};

/** add/edit with --session: stamps the computer and the folder, or refuses on
    a team board (one board per command — see `kanban session`). */
async function withSession(opts, build) {
  if (!opts.session) return mutate(opts, (st, sel) => build(st, {}, sel));
  let note = null;
  const res = await mutate(opts, (st, sel) => {
    if (ops.isTeam(st)) return build(st, {}, sel); // ops refuse it with the hint
    const pc = thisComputer(sel, st);
    note = pc.note;
    return build(st, { sessionMachine: pc.id, sessionCwd: process.cwd() }, sel);
  });
  if (note) res.note = note;
  return res;
}

CMDS.add = async (args, opts) => withSession(opts, (st, s, sel) => ops.add(st, {
  title: args[0], notes: opts.notes, session: opts.session, project: opts.project,
  projectId: opts.projectId, stage: opts.stage, stageId: opts.stageId, flag: opts.flag,
  me: meFor(sel, st), ...s,
}));

/** Identity for an attributed write; null when unknown (unattributed). */
const meFor = (sel, st) => ops.isTeam(st) ? identity(sel, st) : null;

CMDS.mv = async (args, opts) => mutate(opts, (st, sel) => ops.move(st, {
  id: args[0], stage: args[1], stageId: opts.stageId, me: meFor(sel, st),
}));

CMDS.done = async (args, opts) => mutate(opts, (st, sel) => ops.move(st, { id: args[0], done: true, me: meFor(sel, st) }));

CMDS.whoami = async (args, opts) => {
  const { sel, state } = await fetchBoard(opts);
  if (!ops.isTeam(state)) throw new ops.OpError('usage', 'this board has no roster; identities belong to team boards');
  if (!args[0] && !opts.memberId) {
    const me = identity(sel, state);
    return { read: me ? `you are ${me.name} on ${sel.name}` : `no identity on ${sel.name} · roster: ${state.members.map(m => m.name).join(', ')}` };
  }
  // picks an existing member; the CLI never creates one
  const m = ops.resolveMember(state, args[0], opts.memberId);
  const cfg = boards.readConfig();
  cfg.boards[sel.name] = { ...(cfg.boards[sel.name] || {}), member: m.id };
  boards.writeConfig(cfg);
  return { read: `you are ${m.name} on ${sel.name}` };
};

CMDS.assign = async (args, opts) => mutate(opts, (st, sel) => ops.assign(st, {
  id: args[0], to: args[1], memberId: opts.memberId, me: meFor(sel, st),
}));

CMDS.here = async (args, opts) => {
  let made = null;
  const res = await mutate(opts, st => { const b = ops.here(st, { name: args[0], icon: opts.icon, machineId: opts.machineId }); made = b.machine; return b; });
  if (made && !opts.dryRun) {
    const cfg = boards.readConfig();
    const name = res.board;
    cfg.boards[name] = { ...(cfg.boards[name] || {}), here: made.id };
    cfg.personal = name; // the board that holds your computers is your personal board
    boards.writeConfig(cfg);
  }
  res.read = made ? `this computer is ${made.name} · remembered for ${res.board}` : res.read;
  return res;
};

/** A private session for a team card. Reads the team board, writes only the
    personal board — one board per command, so a failure can never leave half
    of it landed and a retry can never duplicate a card. */
CMDS.session = async (args, opts) => {
  const [cardId, command = ''] = args;
  const team = await fetchBoard(opts);
  if (!ops.isTeam(team.state)) {
    throw new ops.OpError('usage', 'on a personal board, use `kanban edit <card> --session "<cmd>"`');
  }
  const t = ops.resolveTask(team.state, cardId, { archived: true });
  const teamId = await C.teamIdOf(team.sel.secret);
  const cfg = boards.readConfig();
  const personal = personalBoardName(cfg);
  if (!personal) {
    throw new ops.OpError('usage', 'no personal board known. Run `kanban here "<this computer>" --board <personal>` once.');
  }
  let note = null;
  const res = await mutate({ ...opts, board: personal, secretStdin: false }, (st, sel) => {
    const pc = thisComputer(sel, st);
    note = pc.note;
    return ops.privateSession(st, {
      teamId, taskId: t.id, title: t.title,
      session: command.trim(), sessionMachine: command.trim() ? pc.id : null,
      sessionCwd: command.trim() ? process.cwd() : null,
    });
  });
  if (note) res.note = note;
  return res;
};

CMDS.edit = async (args, opts) => {
  const fields = ['title', 'notes', 'session', 'project', 'projectId'];
  const given = fields.some(f => opts[f] !== undefined) || opts.flag || opts.noFlag || opts.noProject;
  if (!given) throw new ops.OpError('usage', 'edit needs at least one field: --title --notes --session --project/--no-project --flag/--no-flag');
  return withSession(opts, (st, s) => ops.edit(st, {
    id: args[0], title: opts.title, notes: opts.notes, session: opts.session,
    project: opts.project, projectId: opts.projectId, noProject: opts.noProject,
    flag: opts.flag ? true : opts.noFlag ? false : undefined, ...s,
  }));
};

CMDS.archive = async (args, opts) => mutate(opts, st => ops.archive(st, { id: args[0] }));
CMDS.restore = async (args, opts) => mutate(opts, st => ops.restore(st, { id: args[0] }));

CMDS.ls = async (args, opts) => {
  const { sel, ver, state } = await fetchBoard(opts);
  let mine = null;
  if (opts.mine) {
    const me = identity(sel, state);
    if (!me) throw new ops.OpError('usage', '--mine needs to know who you are: run `kanban whoami <your name>` on this board');
    mine = me.id;
  }
  return {
    board: sel.name, ver, fingerprint: fmt.fingerprint(sel.name, state, ver),
    read: fmt.list(state, { stage: opts.stage, project: opts.project, all: opts.all, mine }),
    tasks: opts.json ? ops.live(state).map(t => ({
      id: t.id, title: t.title, stage: ops.colName(state, t.columnId),
      project: ops.projectName(state, t), flag: !!t.flag, order: t.order,
      session: t.session || '',
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
  const doneCol = ops.doneStage(state);
  const entries = C.aggregateWeek(state.events, monday, lookup, { id: doneCol.id, name: doneCol.name });
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
  kanban ls [--stage S] [--project P] [--all] [--mine]
  kanban show <id>
  kanban whoami [<name>] [--member-id ID]     who you are on a team board
  kanban assign <id> <name|nobody>            hand a card to someone
  kanban here "<computer>" [--icon laptop|desktop|mini|server]   on your personal board
  kanban session <id> "<cmd>"                 your private session for a team card
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
  if (res.note) console.log(res.note);
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

module.exports = { main, parseArgs, mutate, CMDS, safeErrorLine, computerFromHostname };
