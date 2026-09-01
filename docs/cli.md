# kanban CLI — spec

*Status: draft, revised after review. Nothing here is implemented yet.*

## Why this exists

The board lives in `localStorage`, which only a browser can reach. That is fine
for a person and hostile to everything else: to let an agent add a card today
you need Chrome running, the extension connected, the right profile selected and
a tab open on the right namespace — and every operation is a multi-second round
trip through a browser that can drop its connection between two calls.

The relay already solves this. A synced board is addressed by one secret over
three HTTP verbs, and `core.js` holds every rule about how two copies of a board
reconcile. `core.js` already runs unmodified in Node:

```
node v26.5.1 | CompressionStream: function | subtle: object
roundtrip: {"hi":1} token len: 43
```

So the CLI is not a new implementation of the board. It is a second, headless
client of the same relay, reusing the same merge, the same clocks and the same
crypto. Everything below follows from that framing.

## Non-goals

- **No local-only boards.** The CLI reaches boards through the relay. A board
  with sync off is not addressable, and the CLI says so rather than guessing.
- **No board creation.** `PUT` at `ver: 0` mints a board (`relay/worker.js:181`).
  The CLI never does this: a relay board with no device behind it is a board
  nobody can see, and it would burn the creation budget. Sync is turned on in
  the app, which is also where a person consents to the network the first time.
- **No `DELETE`.** The CLI never issues a relay delete. Ending sync everywhere
  is a real confirmation in the app.
- **No re-implementation of anything in `core.js`.** See Invariants.
- **No daemon, no watch, no cache.** One command, one exchange, exit.
- **Not a TUI.** Reading a board comfortably is what the app is for.

## Addressing

A board on the relay is identified by **(relay origin, secret)** — each Worker
deployment has its own Durable Object namespace (`relay/worker.js:128`), so the
same secret names different boards on different relays. In practice the origin
is pinned (see Security) and the secret is the whole address: not a profile, not
a window, not a URL, not a namespace. The app's own invariant — one namespace
follows at most one remote — makes the mapping 1:1.

The app emits the address as a link (`app.js:866`):

```
https://kanban.page/app/?ns=work#sync=<43-char base64url secret>
```

The CLI parses it with the app's grammar (`app.js:2684`): a bare 43-character
secret, or any URL with `#sync=<secret>`. The `?ns=` is a browser-side hint
about which `localStorage` key to open; it means nothing to the relay and is
discarded.

```
kanban board add work      # prompts, or reads the link on stdin
kanban board ls
kanban board default work
kanban board forget work   # local only; never touches the relay
```

`board add` **never takes the secret as an argument.** Arguments land in shell
history, in `ps` output and in any process the shell spawns. It reads the link
from a TTY prompt with echo off, or from stdin when piped:

```
pbpaste | kanban board add work
```

`--secret-stdin` is the documented interface for automation. `KANBAN_SECRET` is
honoured for CI and is scrubbed from the environment of any subprocess the CLI
spawns. There is no `--board-secret` flag.

### Where the secret is stored

**In the OS keychain where one exists.** The secret is full read/write to the
board with no account behind it, no rotation and no audit. On macOS the CLI
invokes `security` directly — never through a shell, and never with the secret
in `argv`:

```
security add-generic-password -U -s kanban.page -a <name> -w   # value over stdin
security find-generic-password -s kanban.page -a <name> -w
```

`-w` with **no value** makes `security` read the secret from stdin. Passing it
as an argument instead puts it in `ps` output and — the reason this is a rule
and not a preference — Node copies the whole argv into the `Error.message` of a
failed spawn, so any keychain error prints the secret to the terminal. A review
found exactly that: `board replace` failed on every duplicate item and printed
the freshly pasted secret one line after promising not to show it. The
top-level error handler therefore prints `err.message` only for the CLI's own
error classes, and a generic line for anything else.

Linux and Windows have no store the CLI can assume. There it falls back to
`~/.config/kanban/secrets.json`, created with `O_CREAT|O_EXCL` at mode `0600`
inside a `0700` directory, refusing to follow a symlink. The fallback requires
an explicit `--store-plaintext` on first use and prints one line saying what
happened. On Windows, where POSIX modes mean little, the fallback is opt-in only
and the help text says the file is not protected by the OS.

`~/.config/kanban/config.json` holds the non-secret part: board names, which is
default, and the relay origin per board. **It is still not unconditionally safe
to accept from source control** — see Security.

Secrets, derived tokens, pairing URLs and sealed envelopes never appear in
output, in `--json`, in error messages or in debug logging.

## The read–modify–write cycle

Every mutating command runs the same cycle. It splits deliberately into a
**build** phase that runs exactly once and a **land** phase that may repeat,
because re-running the build is how a retry silently adds a card twice.

### Build (runs once)

1. `{token, key} = await C.deriveSync(secret)`
2. `GET /v1/board`, `Authorization: Bearer <token>`, `redirect: 'error'`
   - `200` → `{ver, env}`; validate both fields are present and `ver` is a
     non-negative integer.
   - `404` → no board for this token **at this origin**. That means sync is off,
     or the secret is wrong, or the relay is wrong — say all three, do not
     assert the first.
   - `410` → sync was ended everywhere. Refuse; suggest `board forget`.
   - `401`/`429`/`4xx`/`5xx` → see Status handling.
3. `remote = await C.unseal(key, env)`. **Then validate it before trusting it.**
   `unseal` only decrypts and `JSON.parse`s (`core.js:922`); it makes no promise
   about shape. Reject `(remote.v || 2) > 2` exactly as the browser does
   (`app.js:522`) with a message telling the user to upgrade the CLI, and check
   that `columns` is a non-empty array and `tasks`/`events`/`tombstones` have
   their expected types.

   > **This check is the difference between a stale CLI and data loss.**
   > `C.syncable` hard-codes `v: 2` and copies only the fields it knows
   > (`core.js:564`). Writing back a `v: 3` board would silently drop every
   > field a newer app added. The validator belongs in `core.js` so the app and
   > the CLI cannot drift apart on what a valid board is.

4. `prev = structuredClone(remote)` — the diff baseline.
5. Apply the mutation to a clone, mirroring the app's own function (see Command
   semantics). Append the event the app would append — and only if the app
   would. Generate the task id and event id **here, once**.
6. `C.stampChanges(prev, next)` — the only place clocks are wound. Also once.
7. `next = C.unionFloor(next, {events: remote.events, tombstones: remote.tombstones})`
8. `baseVer = ver`

### Land (may repeat; never rebuilds)

9. `env = await C.seal(key, C.syncable(next))`; `PUT {baseVer, env}`
   - `200` → print the new `ver`, exit 0.
   - `409 {ver, env}` → another device wrote first.
     `theirs = await C.unseal(key, body.env)`, validated as in step 3;
     `next = C.merge(next, theirs)`; **`baseVer = body.ver`** — the version is
     the relay's field, not a field of the decrypted payload, which has `v` and
     no `ver` at all (`relay/worker.js:176`, `core.js:564`). Do **not** re-run
     step 5 or step 6. Loop, up to 4 attempts, then exit with the contention
     code.
   - `410` → deleted mid-flight. Fail, no retry.
   - `413` → too large. Fail, no retry. The relay does not return the size
     (`relay/worker.js:161`); compute the UTF-8 byte length locally to print it.
   - network error or `5xx` → **ambiguous.** See below.

### The ambiguous failure, and why ids are the idempotency key

A `PUT` that is accepted but whose response is lost looks exactly like a `PUT`
that never arrived. Restarting the cycle from step 1 would mint a second task id
and a second event, so the card lands twice. Instead:

- Re-`GET` the head and look for the id generated in step 5. Every mutation that
  appends an event carries a unique event id; for `edit` and `archive`, which
  append none, look for the changed task carrying the exact `fieldMt` clock
  stamped in step 6.
- **Found** → the write landed. Report success with the head's `ver`.
- **Not found** → merge the head into `next`, set `baseVer` from it, and repeat
  step 9. Still no rebuild.
- **The `GET` also fails** → exit with the `outcome-unknown` code and say so in
  those words. The write may or may not have landed; the CLI does not guess, and
  an agent reading `--json` can re-`GET` later and decide.

Two attempts at the ambiguous resolution (1s, then 3s), then stop.

### Three properties worth stating

**It cannot truncate history.** The floor exists in the app because a long-lived
tab holds a board that may be older than the relay's. The CLI holds nothing: its
baseline *is* the head it just fetched, so the union in step 7 is a no-op by
construction. It stays in the code as the assertion that it is one.

**It does not resurrect deleted cards, and cannot pretend to.** A permanently
deleted card is absent from the fetched head, so `edit <id>` reports *not found*
— there is nothing to restore, because a tombstone deliberately keeps no
content. If a delete arrives in a `409` head after the CLI stamped, `merge`
correctly drops the CLI's older existence generation (`core.js:736`): the delete
wins. The app's explicit-restore path exists only because it holds an open draft
and re-stamps it against newly observed tombstones (`app.js:527`); a stateless
CLI has no draft and must not imitate one.

**The `409` path merges rather than replays.** `C.merge(next, theirs)` is the
plain two-argument form, the commutative one. `preferOrder` is never passed —
that option names an adoption, which is a relationship decision the CLI does not
make.

## Command semantics

Each mutating command mirrors a function in `app.js`. Where this spec and
`app.js` disagree, `app.js` is right and this spec is a bug.

`--board <name>` is global. Board selection precedence, highest first:
`--board`, `KANBAN_SECRET`, `--secret-stdin`, the configured default. When none
resolves, the CLI errors and lists the configured boards; it never picks one.

### Name and id resolution

Duplicate stage names are legal and must both survive (`CLAUDE.md:72`), and the
app permits duplicate project names too. So **every resolver fails on ambiguity
rather than picking**: multiple matches print each match with its id and exit
with the usage code. `--stage-id` and `--project-id` take an id directly.

Card ids are 15 characters (`core.js:12`). Commands accept an unambiguous
prefix of at least 4 characters. Prefix resolution is command-scoped: `restore`
and `show` search archived cards, `mv`/`done`/`archive` do not.

### `kanban add "<title>" [--notes N] [--session S] [--project P] [--stage S] [--flag]`

Mirrors `addTask` (`app.js:1408`): the card lands in `columns[0]` unless
`--stage` says otherwise, at `order: 0`, every sibling in that column gets
`order += 1`, and a `created` event is appended through `makeEvent` with the
stage name snapshotted as a string.

The sibling bump rewrites every sibling's `order`, which advances their `pmt`
and nothing else — verified, not assumed:

```
aaa1 mt 5000 -> 5000 (held) | pmt 5000 -> 1788… (moved) | existMt 5000 -> 5000 (held)
```

That is exactly why placement has its own clock. Any implementation that makes
`add` advance a sibling's `mt` or `existMt` is wrong.

An empty or whitespace-only title is a usage error. `--project` and `--stage`
resolve against existing names and **never create**: a typo would otherwise
mint "Kanban Bord" on every device forever. Project creation, if it is ever
wanted, gets its own `kanban project add` with its own colour handling and
concurrency tests — not a flag on `add`.

### `kanban mv <id> <stage>` / `kanban done <id>`

Mirrors the keyboard move (`app.js:1449`):

- Refuse archived cards.
- **If the destination equals the source, it is a no-op**: no event, no `PUT`,
  exit 0. The app logs a move only when the stage actually changed
  (`core.js:269`), so a `Done → Done` row must never enter the log — the report
  reads tense off `from`/`to` and a self-move would announce work as newly
  shipped.
- Otherwise set `columnId`, set `order = -1`, reindex the destination, set
  `updatedAt`, and append a `moved` event snapshotting the title, the project
  name and both stage names (`app.js:1024`).

`done` targets `columns[columns.length - 1]`. The done stage is a position,
never a name (`CLAUDE.md:72`); `done` resolves it by index and must never look
for a stage called "Done".

### `kanban edit <id> [--title T] [--notes N] [--session S] [--project P|--no-project] [--flag|--no-flag]`

Field writes only; appends no event, because the log records moves and
creations, not edits. `--session` is first-class: it is an independently merged
field (`core.js:407`). An `edit` with no field flags is a usage error, not a
no-op write.

### `kanban archive <id>` / `kanban restore <id>`

`archive` sets `archivedAt`/`archivedFrom`; `restore` mirrors the app's archive
restoration (`app.js:2907`). Archiving an archived card is a no-op.

**There is no `kanban rm`.** The board archives; only the archive deletes, and
the single irreversible action stays behind the app's two-step confirm where a
person can see it.

### `kanban ls [--stage S] [--project P] [--all]` / `kanban show <id>`

Read-only; no `PUT`. Hides archived cards unless `--all`.

### `kanban report [--week YYYY-MM-DD] [--locale en|es] [--md]`

`aggregateWeek(events, monday, lookup, doneStage)` (`core.js:112`) is not pure
over `(events, period)` — it needs a task lookup for live annotations and the
last column's name. The CLI builds `lookup` from the fetched tasks and passes
`columns[columns.length - 1].name` as `doneStage`, mirroring `app.js:3168`.

`--week` must be a Monday, or is normalised through `C.mondayOf`; weeks run
Monday–Sunday in America/Santiago (`CLAUDE.md:46`) and an arbitrary date would
silently report a different span.

`--md` emits the entries `aggregateWeek` pre-ticked via `include`, matching what
the app's export copies when the user changes no ticks. Locale is a device
preference and is not synced, so parity requires an explicit `--locale`
(default `en`).

## Safety

**Every mutating command prints what it is about to touch, before it touches
it.** Picking the wrong board is not a local mistake — the relay broadcasts to
every watching device in about a second.

```
$ kanban add "explore right margin" --project "Kanban Board"
work · INBOX 27 / DOING 18 / DONE 63 · ver 412
  + INBOX  explore right margin  · Kanban Board
ok · ver 413
```

The fingerprint is the stage names and counts of the board actually fetched. It
costs one line and turns a silent misfire into something a person or an agent
notices.

`--dry-run` runs build and stops before the `PUT`, printing the fingerprint and
the diff. `--json` replaces human output with one object on stdout.

## Security

**The relay origin is pinned** to `https://kanban-relay.quiet-bush-25b1.workers.dev`
(`app.js:329`). Every request carries the derived bearer token, so an origin is
an authentication destination: a config file that can silently change it is a
credential-exfiltration vector, and the token grants full read/write *and*
`DELETE` on the real relay slot even though it never reveals plaintext. A custom
origin therefore requires `--relay` plus a recorded, explicit trust decision,
must be `https:` (except `localhost`), and every fetch uses `redirect: 'error'`
so a redirect cannot move the token to another host.

**Forgetting a board is recoverable.** The secret may exist nowhere else
(`CLAUDE.md:93`), so:

- `board add` **rejects an existing name** rather than overwriting it, checking
  the config *and* the keychain — `keychainSet` passes `-U`, so a lost or
  corrupt `config.json` would otherwise let an add clobber a live secret
  (`readConfig` swallows a parse error and returns an empty map).
- Names ending in `.previous` are **reserved**: that is where `replace` parks a
  displaced secret, so a board by that name would share a slot with another
  board's backup and the next `replace` would overwrite a live capability —
  silently, because `keychainSet` passes `-U`.
- Replacing a board's secret is a separate `board replace`, and the displaced
  secret is kept in **one** slot per board, `<name>.previous`. One slot, not one
  per replace: a timestamped backup left keychain items nothing tracked, listed
  or could remove.
- `board forget` is local only and never issues a relay `DELETE`. It clears the
  board's secret *and* its `.previous` slot, so a capability never outlives the
  board it belonged to, and requires `--force`.

## Status handling

Every status gets a defined behaviour, not just the happy ones: `400` and `401`
are permanent and print the relay's message; `408`/`429`/`5xx` are retryable
under the ambiguous-failure rules; an unexpected redirect is a hard failure;
a non-JSON or malformed body is a protocol error and never a silent success.

Exit codes are a small stable taxonomy — `0` success or no-op, then usage,
credential/config, not-found, gone, contention, outcome-unknown, transport, and
protocol. Finer detail lives in `--json`'s `error.code`. Not one code per HTTP
status, and not `1` for everything.

## Invariants this must not break

From `CLAUDE.md`; they are why the CLI reuses `core.js` rather than talking to
the relay directly.

- **Clocks are wound in exactly one place.** The CLI calls `C.stampChanges` and
  never sets `mt`, `pmt`, `existMt` or `fieldMt` itself. If a mutation needs a
  clock the diff does not produce, the mutation is wrong, not the diff.
- **`merge` is for two boards, and only two boards.** Never merge against a
  partial or empty board to "just union the events" — that is the bug that once
  sorted stages by id and moved the done line. Use `unionFloor`.
- **Stage order is a semantic.** The last column is the done stage. The CLI
  never reorders stages and never adds one.
- **The log only grows.** The CLI appends events and never removes, rewrites or
  reorders one.
- **The board archives; only the archive deletes.**

## Implementation shape

```
cli/
  kanban.js       # entry, arg parsing, dispatch
  boards.js       # name → secret; keychain, guarded fallback, env
  relay.js        # GET / PUT, auth, status taxonomy, ambiguous resolution
  ops.js          # the mutations, each mirroring its app.js counterpart
  format.js       # human and --json output
tests/cli.test.js # node --test
```

Zero dependencies, matching the rest of the repo. Node 20+ (`crypto.subtle` and
`CompressionStream` as globals; verified on v26). `core.js` is `require`d
directly, never vendored. The board validator from step 3 is **added to
`core.js`** and called by the app too, so the two clients cannot drift on what a
valid board is.

## Testing

`tests/cli.test.js`, run by the same `node --test` as `tests/core.test.js`,
against an in-process fake relay implementing the real version-and-`409`
behaviour, injected instead of `fetch`. No network in tests.

The cases that would actually lose work:

1. `add` racing a concurrent write → `409` → merge → both cards survive, and the
   stage order is unchanged.
2. `add` advances no sibling's `mt` or `existMt`; only `pmt` and `order`.
3. A concurrent permanent delete **wins**: a tombstone arriving in the `409`
   head drops the CLI's card, and a card already deleted at `GET` time makes
   `edit` report *not found*.
4. A lost `200` response does not double-add: the ambiguous path finds its own
   event id in the head and reports success exactly once.
5. A `409` never re-runs `stampChanges` — clocks after a contended write equal
   clocks after an uncontended one.
6. `baseVer` on a `409` retry comes from the relay envelope, not the payload.
7. A `v: 3` head is refused and **nothing is written**.
8. `done` on an already-done card writes nothing and appends no event.
9. `done` targets the last column on a board whose last column is not named
   "Done".
10. Ambiguous stage and project names are refused, with ids printed.
11. A CLI `add` and an app `addTask` produce identical
    `C.canon(C.syncable(state))` modulo ids and clocks.
12. `report --md` equals the app's `toMarkdown` for the same week and locale.
13. Each status class produces its own exit code, and `410` does not retry.
14. No command's output or `--json` error ever contains the secret or token.

## Decisions taken from review

- **Project creation stays out of `--project`.** If it is wanted later it gets
  its own `kanban project add`.
- **CLI-first board creation stays out of the first release.** It needs its own
  design for secure secret presentation, default columns, the relay's creation
  budget and phone adoption — and it must never be an automatic fallback after a
  `404`.
