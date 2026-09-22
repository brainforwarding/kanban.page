# Team boards — assign a card, see it land

*Status: implemented on branch `team-boards`; reviewed in 4 rounds, rule 8 in the computers review. Screens:
[Figma — kanban.page team](https://www.figma.com/design/vSnalYHVilevj2WbJ5M1c9),
page "02 · Proposal — team". Where this document and the Figma file disagree,
this document is right.*

## Problem

A teammate wants to hand a card to someone and later see whether it got done.
Today every board is one person's: sync pairs *devices*, and `docs/sync.md`
says so outright — "there is no identity here — the other device is you." Two
people can already share a board by sharing its link, but the board cannot say
who a card belongs to or who moved it, and "who" is the whole question.

## Product rules

1. **Split by board, never by card.** A personal board stays as it is. A team
   works on a second, separately synced board. There are no private cards: one
   secret is one AES key, so everyone who syncs a board decrypts every card on
   it. Privacy that only the UI enforces is worse than none.
2. **A team board is a board with a roster.** No new board type in the UI. A
   board with no members renders exactly as today.
3. **Identity is attribution, not security.** A member is a name and a color.
   Anyone holding the link can pick any name, as they can already edit
   anything. No accounts, roles or permissions.
4. **Your teams follow you.** Join or create a team on one device and every
   device paired to your personal board gets it, already knowing who you are.
5. **One weekly report.** In the browser, your report is your week across your
   personal board and your teams, exported as one file.
6. **The teammate's check is the card.** A Done card carries who moved it
   across the done line; the editor shows the card's history.
7. **Minimal copy.** No explanatory subtitles, footnotes or step counters.
8. **Agent sessions are private, always.** A session command only works on
   the computer that ran it and may carry local paths. On a team card, your
   session is stored on **your personal board** keyed by `(teamId, taskId)`
   and shown only to you; the team board never holds a session. Each person's
   team editor shows their own Session field, marked with a lock; nobody ever
   sees anyone else's.
   Computers and how sessions attach to them are specified in
   `docs/computers.md`.

## Schema: team data is v3

Every board that carries team data — a roster (`members`), a team list
(`teams`) or a leave tombstone (`teamsLeft`) — is written as **`v: 3`**.
Boards with none of them stay `v: 2`, byte for byte. A personal board that
has left its last team still carries `teamsLeft` and so stays v3; otherwise
an old client could write it as v2 and a stale copy of the secret could come
back.

This is forced, not chosen. An older client keeps unknown task keys, but its
next content save rebuilds `fieldMt` from the groups it knows and drops the
`assignee` clock; the new aggregate `mt` then becomes the clock for the stale
assignee values and can overwrite a newer assignment (`materializeFieldMt`,
`fieldMtOf`, `core.js:415–435`). Its `syncable` also drops every top-level key
it does not know, so one push from it would strip the roster from the relay.

Every client already refuses a newer `v` (`validateSyncable`, `core.js:589`;
`applyRemote`, `app.js:522`): on pull it keeps its local board; on a 409 it
fails to apply the head, never advances `baseVer`, and retries without ever
overwriting it (`app.js:633–641`). So an out-of-date device **stops syncing a
team board or a personal board holding teams** until the PWA update lands — a
visible, safe stop instead of silent loss. Personal boards with no teams are
unaffected.

**Residual risk, accepted.** No new code can change an *old* tab. An old tab
left open in the same browser after an update can receive a v3 write through
the `storage` event, fold it into its v2 model and save, stripping `members` /
`teams` from local storage. A synced board recovers them from the relay on the
next pull by a current tab; an unsynced personal board recovers them from any
current tab's memory on its next save. The existing update prompt is the
mitigation. For the *next* bump, this release adds the forward guard:
the stored `v` is checked **before `migrate()`** (which today rewrites `v` to
2) on every path that reads a board — load, `storage` event, import, Replace
and adoption. A board whose `v` exceeds `SYNC_V` loads read-only: no save, no
sync start, no import over it. An incompatible remote head is a terminal
status, not a 409 retry loop. Rewriting `docs/sync.md`'s "Mixed app versions"
paragraph is part of the implementation change, not of this draft.

`SYNC_V` becomes 3. `validateSyncable(x, kind)` checks the shapes of
`members`, `teams` and `teamsLeft` (ids, names, colors, numeric clocks) and
rejects a malformed payload like any other damaged one. `migrate` carries all
three through; `syncable` emits them and writes `v: 3` exactly when any is
non-empty; `merge` merges them; `clockMax` includes every member `mt`, every
team entry's `joinMt`/`mt`/`memberMt` and every `teamsLeft` stamp, so a
fast-clock leave can never sit above a later rejoin.

## Data model

### Roster — `members` (team boards)

```js
members: [{ id, name, color, mt }]
```

- **Merge:** union by id; higher `mt` wins content (a rename); ties break
  canonically. Not `mergeLists`: no order vector (the UI sorts by name) and
  **no name dedupe** — two people who both join as "Ana" are two people.
- **Never deleted in v1**, no tombstones: events reference member ids forever.
- **Clocks:** `clockMax` includes member `mt`; `stampChanges` stamps a new or
  changed member through the same `itemContent` diff as projects.
- **Color:** first `COLORS` entry no member uses, else a hash of the id.
  Initials are derived at render, never stored.

### Board kind — enforced, not implied

A board is **personal** or **team**, and the two never mix:

- `members` is legal only on a team namespace (`t-…`) and there it must be
  **non-empty**; `teams`/`teamsLeft` only on the null namespace.
  `validateSyncable(x, kind)` rejects the other side's fields, and an empty
  roster on a team target, **before** adoption, merge or push.
- A team board always has members: New team board cannot turn sync on — so
  nothing reaches the wire — until its first member exists. "Has a roster" is
  therefore a reliable wire-level kind.
- **Any candidate with a roster is a team board**, however it arrives. The
  order is: parse, fetch, decrypt, structural validation (kind-free), detect
  the roster, derive the namespace, route there, and only then validate
  against the target kind and adopt. A full link or raw secret pasted on the
  personal board that decrypts to a roster is never adopted there.
  Raw-secret pairing into the current namespace remains only for boards
  without a roster — your own devices.

### Team identity and namespace

```js
teamId = HKDF(secret, 'kanban.page team')   // 128 bits → 22 chars base64url
ns     = 't-' + teamId                      // the full id, never truncated
```

Derived from the secret, so every device that joins the same team computes
the same `teamId` and the same namespace, with no coordination: two devices
joining concurrently produce one entry, not two. The derivation is one-way;
it reveals nothing about the key. Creating a team mints its secret **first**
(sync start accepts a pre-minted secret), derives the namespace, then
navigates.

**Collisions.** With the full 128-bit id in the namespace, a namespace can
only be occupied by the same team (joined before, then disconnected) or by a
hand-typed `?ns=`. Before any adoption, the incoming secret is checked against
`board.sync.<ns>`: a different bound secret leaves the team listed but
inactive, adopts nothing, and is resolved by disconnecting that namespace. A
non-pristine `board.v2.<ns>` with no sync config is the team's own old copy,
and `sync-joining.md`'s Replace/Combine choice applies to it as to any board.
Never an automatic Replace or Combine.

### Teams you belong to — `teams` (personal board only)

```js
teams: [{ id: teamId, ns, label, secret, memberId, joinMt, mt, memberMt }]
teamsLeft: { [teamId]: clock }       // leave tombstones
```

- Lives on the personal board, which only your own devices sync — that is
  what makes teams follow you (rule 4).
- **Merge:** entries union by `teamId`; `label` by `mt`, `memberId` by its own
  `memberMt`, so renaming a team never fights choosing who you are.
- **Leaving is a tombstone, not an edit.** Leave writes
  `teamsLeft[teamId] = clock` and removes the entry — secret and memberId
  included — like `deleteForever`. An entry whose `joinMt` is not newer than
  the tombstone is dropped by every merge, so a stale tab or an old snapshot
  cannot bring the secret back. Only an explicit **join** starts a newer
  generation. Both stamps stay in `stampChanges` and stay diffs: a new key in
  `teamsLeft` is stamped `clock`; an entry absent from the last-saved state
  and present in the next is a (re)join and gets `joinMt = clock`; an entry
  present in both keeps its `joinMt` whatever else changed. A stale tab
  editing a label it still holds cannot outvote a leave.
- **Leave's Undo is a join request, not a snapshot restore.** The app's
  generic Undo restores one namespace's snapshot, and a leave issued from a
  team page never touched that page's snapshot. The toast's Undo therefore
  enqueues a rejoin carrying the entry (secret and memberId held in memory
  until the toast expires), which the personal board ingests as any join.
- **Two devices, two different `memberId`s** (you joined as "Sebastián" on the
  laptop and added "Seba" on the phone at the same time): `memberMt` picks one
  deterministically and every device's `me` follows the entry. Both ids are
  you; events already written under the other stay yours, and the duplicate
  roster name is a rename away. No prompt.
- **Export omits `teams` and `teamsLeft`.** A backup travels and must not
  carry keys to other people's boards. **Every import — synced or not — and
  its Undo keeps the current `teams`/`teamsLeft`**, so importing your own
  backup never drops a team.
- **The personal link now reaches your teams.** The sync sheet's capability
  warning on the personal board says so once teams exist.

**Writes happen on the personal board only.** A team page never writes
another namespace's storage. Joining, creating or leaving from a team page
writes **one immutable request record** under its own key,
`board.teams.req.<reqId>` = `{ reqId, teamId, kind: 'join'|'leave', entry?,
order }` — no shared read-modify-write list, so two tabs enqueueing at once
cannot lose one.

- **Order is causal, not wall-clock.** `order = max(Date.now(), highest order
  this page has seen for that team + 1)`; leave's Undo is issued with
  `order = leave.order + 1`, so a rejoin always follows the leave it undoes,
  even within one millisecond or across a clock rollback. `reqId` breaks ties
  only between genuinely concurrent requests.
- **Apply.** The personal board's app instance ingests on load and on the
  `storage` event: per `teamId` only the request with the highest `order`
  applies. Applying is idempotent (a join for a live entry with the same
  memberId is a no-op; a leave for an absent entry only ensures the
  tombstone).
- **Acknowledge after persisting.** The personal board keeps a local
  high-water mark per team (`teamsReqApplied[teamId] = order`) in the same
  write as the result. Only after that write reaches storage — explicitly,
  not through the 120ms debounce — does it delete **every** record for that
  team with `order ≤` the mark, keeping newer ones. A record at or below the
  mark found later (a crash between write and delete) is deleted without
  being applied, so a superseded leave can never replay. Until the personal board opens on that
device, the team works locally but has not reached your other devices. A
personal board without sync keeps `teams` on this device only.

**On every device**, when the personal board applies `teams`:

- live entry, namespace free here → the switcher lists it; opening adopts
  through the pristine path with the entry's secret and sets
  `me = memberId`, so there is no **Who are you?** step;
- live entry, namespace bound to a different secret → inactive (collisions);
- tombstoned team, namespace synced here → Disconnect that namespace (forget
  its key, keep its local board), as the existing Disconnect does.

### Who I am — local preferences (team boards)

```js
me: memberId | null        // set from the teams entry, or by Who are you?
meSinceClock: number       // clockMax(board) at the moment `me` was set
seenAssign: { [taskId]: assigneeClock }
```

Never synced (`syncable` is a whitelist). A payload that lacks `members` never
clears a valid local `me`.

### Assignment — a task field group

```js
['assignee', ['assigneeId', 'assignedBy', 'assignedAt']]   // TASK_FIELDS
```

Atomic, like `archive`. Its own field clock, so reassigning never fights a
concurrent title edit. `assignedAt` is display time; the field clock decides
merges. **Assigning requires `me`** — without an identity the Assignee field
is shown disabled, so `assignedBy` is never empty. Clearing to Nobody writes
`assigneeId: null` with `assignedBy: me`.

**Assignment is not an event.** `aggregateWeek` treats every non-`created`
event as a move (`core.js:135`), so an `assign` event would be a phantom
`Inbox → Inbox` row. The editor shows the *current* assignment from the field
group. An assignment log needs `aggregateWeek` to skip the type first.

### Events — attribution and column ids

New events gain, when known:

```js
{ ...event, by, byName, fromColumnId, toColumnId }
```

- **`by` / `byName`** from the caller's `me` (team boards only). `byName`
  snapshots the name, as `title` does. Display prefers the live member name
  and falls back to the snapshot — the same rule as titles.
- **`fromColumnId` / `toColumnId`** on every new event, every board. Events
  store stage *names* today, and duplicate names are legal and stages rename,
  so "moved into the done column" cannot be read from a name.
- **Tense and done-by use ids when present.** `aggregateWeek` takes the done
  column as `{ id, name }` and keeps each row's endpoint column ids. A row
  whose endpoints carry ids is shipped when it ends in the done column's id
  and did not start there; done-by is the `by` of the event whose
  `toColumnId` is that id. Rows from legacy events fall back to today's name
  comparison for tense — documented as the legacy path — and never produce a
  done-by. This also fixes the existing personal report for new events: a
  move into a middle stage that happens to be named "Done" no longer reads as
  shipped.
- **Attribution fields are immutable.** The only event edit that exists is
  `rewriteDay`, which changes `day`; nothing may change `by`, `byName` or the
  column ids.
- **Missing means unknown, never guessed.** Existing events, a CLI without an
  identity and personal boards carry no `by`; legacy events carry no column
  ids and so never produce a done-by mark.

## Boards on one device

A board is a namespace (`?ns=` → `board.v2.<ns>` + `board.sync.<ns>`). The
personal board is the null namespace; a team's namespace is derived from its
secret (see Team identity), so every device lands the same team in the same
namespace. The existing rule ("if the link's `?ns=` differs, navigate to that
namespace") takes a team link there; a free namespace is pristine and adopts
directly. A namespace bound to a different secret is a collision and adopts
nothing.

**Switcher:** `kanban.page / <label> ▾` beside the wordmark. Items: Personal
(lock glyph), each live team (member avatars), **New team board…**, **Join
with a link…**. Choosing navigates to its `?ns=`. One board per tab; no
combined board view. The list is the personal board's `teams` plus any pending
local requests; a team page reads the personal board's storage read-only.

### New team board

1. Mint the secret, derive `teamId` and the namespace, navigate.
2. **Who are you?** with an empty roster: only **Add your name**. It cannot be
   dismissed into a usable board — a team board without its first member
   would be rosterless forever. Back returns to the previous board and
   discards the namespace.
3. Turn sync on (the network consent); the sync sheet opens connected, with
   the link to share. Queue the `teams` entry.

### Join

Paste a link or raw secret (**Join with a link…**) or open a link. The
candidate is fetched and decrypted first; if it has a roster, the app routes
to its derived namespace before adopting (board kind). Adoption there follows
`sync-joining.md`. Then, only if the adopted board has a roster and `me` is
not already known from your `teams`, show **Who are you?**. Pairing a phone to
your personal board has no roster and so no new step.

### Who are you?

- Title **Who are you?**, one row per member, a last row **+ Add your name**,
  footer **Back** / **Join**. No other copy.
- **Add your name** turns into a text field in place; initials and color
  preview as you type; Enter or **Join** commits. Blank names cannot commit.
  A name equal (case-insensitive) to an existing member's selects that row.
- Commit sets `me` and `meSinceClock`, queues the `teams` entry.
- When joining, dismissing leaves the board adopted with `me` unset: it syncs,
  attributes nothing, cannot assign, and the rail avatars offer the step again.
- **Rename:** tap the rail avatars, then your own (chosen) row again; it
  becomes a text field.

## Surfaces on a team board

- **Rail:** member avatars before search.
- **Filters:** **Mine** and **Unassigned** join the project pills, compose
  with a project filter (AND), and are preferences.
- **Card:** assignee avatar at the end of the meta row. A card in the done
  column shows `✓ <initials> · <age>` from the **last event whose
  `toColumnId` is the current done column's id** and which has a `by`. Else no
  mark.
- **Editor:** **Assignee** (members + **Nobody**) below Project; **History**:
  the card's events with avatar and Santiago time, plus the current
  assignment.
- **New for you:** `assigneeId === me`, `assignedBy !== me`, the assignee
  field clock `> meSinceClock`, and `seenAssign[taskId]` is not that clock.
  Opening the card records it. Amber **New** above the title; the count rides
  on the Mine pill. Both sides are logical clocks, so a fast-clock device
  cannot make an old assignment look new after a reinstall.

  This amends `sync.md`'s "a remote change is never marked": right for your
  own devices, but a teammate handing you work is a message, not a sync
  event. It is the only change marked.

## The weekly report — my week

The browser report opens the same from any board: **your** week across the
personal board and every live team where `me` is set.

**Aggregation.** Each board is aggregated separately with its own lookup and
its own done stage, then rows are concatenated — boards are never merged into
one event list. `aggregateWeek` additionally records per row:

- `byIds` — the set of `by` values among the row's week events;
- `doneBy` — the `by` of the event that crossed the done line, if any.

Team rows are kept when `byIds` contains `me`, and keep their full route (a
card Andrea created and you finished reads `New → Done`). Unattributed events
never qualify. **Default tick on a team row** requires `doneBy === me` on top
of the existing rule (shipped, under a project): a card you created and
someone else finished is listed, unticked. Personal rows are unchanged.

**Row identity.** Every row carries `{ ns, boardLabel, projectColor, rowKey }`
with `rowKey = JSON.stringify([ns, taskId])` — a canonical tuple, so no id
containing a delimiter can collide; selections key on `rowKey`, so a task id
shared across boards can never tick the wrong row. Date editing stays
available on active-board rows only; other boards' rows show the date without
the editor in v1.

**Projects.** Rows group by project name across boards. The caller builds one
order (the personal board's project order, then team-only names
alphabetically) and each row brings its own board's project color; a merged
group takes the personal color. `groupByProject` is unchanged — it groups the
strings it is given.

**Modal.** Team rows show a `Team` tag (the board's label). The exported
markdown is unchanged in format and does not mark them. The tick is still the
only filter.

**Freshness.** A board only pulls while a tab has it open, so a stored team
copy can be stale. Opening the report runs a new pure
`fetchBoardReadonly({ secret, attempt })` per other synced board: derives its
own keys, `redirect: 'error'`, validates, never touches `sync`, config,
generations, the floor or storage, never pushes. It is **not** candidate
inspection, which owns `joinAttempt`, drives the sync sheet and can adopt. A
report-scoped attempt id makes late answers inert on close or week change.
The result is merged transiently with the stored copy for rendering and
discarded. Each successful validated pull or read-only fetch records a
local-only `board.read.<ns>` time; on failure the stored copy is used and the
summary appends `team · as of 14:02` from that record (or `team · offline`
when there is none).

## CLI

- `kanban whoami <board> <name>` stores a member id beside that board's
  secret in the CLI's board config. It picks an **existing** member, refuses an
  ambiguous name (listing `name [id]`, with `--member-id` to choose), and
  never creates a member.
- With an identity, `add` / `move` write `by`, `byName` and column ids through
  `pushEvent`; without one they stay unattributed.
- `kanban assign <card> <name|nobody>` requires an identity (it writes
  `assignedBy`); `kanban list --mine`.
- **`kanban report` stays one board.** The one-report rule is the browser's.
- A CLI older than v3 refuses team boards through the shared
  `validateSyncable`.

## Invariants this must not break

- **The log classifies; live state annotates.** Report rows qualify by `by` in
  the log; done-by comes from the log; the live `assigneeId` decides nothing
  in the report.
- **Clocks are wound only in `stampChanges`**, members and teams included; the
  cross-namespace queue exists so no page stamps another board.
- **The log only grows**; attribution fields are immutable.
- **`merge` is for two boards.** The report never merges two boards; its only
  merge is a board with a fresher copy of itself.
- **One namespace follows one remote.** Report fetches are not relationships.
- **Preferences never travel:** `me`, `meSinceClock`, `seenAssign`, filters.
- **Capabilities never travel in a file:** export omits `teams`.

## Not in v1

Roles, permissions, per-card visibility; removing a member; assignment
history events, comments, due dates, email or push; a combined board view; a
synced board name; a cross-board CLI report.

## Required coverage

Core:

1. `v: 3` exactly when members, teams or teamsLeft exist; a v2 client refuses it and a
   v3 board with neither writes v2;
2. `validateSyncable` rejects malformed members/teams;
3. members: union by id, rename by `mt`, same-named members from two sides
   both survive, remote-only roster survives `merge`, skewed-clock rename
   stamps above the observed max;
4. teams: `teamsLeft` alone keeps a board v3 and survives merge/syncable;
   `clockMax` covers every team clock so a fast-clock leave loses to a later
   rejoin; union by derived `teamId` (two devices joining concurrently → one
   entry); `memberMt` resolves competing identities deterministically; a leave
   tombstone beats a stale label edit but loses to a re-add (Undo); export
   omits teams; synced and unsynced import and their Undo keep current teams;
5. board kind: `validateSyncable` rejects `members` on the null namespace,
   `members: []` on a team target, and `teams`/`teamsLeft` on a team
   namespace; routing validates structurally, detects the roster, then
   validates against the target kind; a raw secret whose board has a roster is
   routed to its derived namespace, never adopted into the personal board;
   collision with a different bound secret leaves the team inactive;
6. assignee group merges independently of title/notes;
7. events: `by`/`byName` only with `me`; column ids always; `rewriteDay`
   cannot alter attribution;
8. tense and done-by by column id: duplicate stage names, a renamed done
   stage, a middle stage named like the done stage, and legacy events (name
   fallback for tense, no done-by);
9. `aggregateWeek` `byIds`/`doneBy`; my-week: personal unchanged, team rows
   need `me` in `byIds`, default tick needs `doneBy === me`, per-board tense,
   same task id on two boards stays two rows, export format unchanged;
10. `meSinceClock` with a future-stamped assignment and a reinstall.

DOM (`?ns=test`):

11. a board with no roster renders with no team UI;
12. Who are you?: pick, add in place, duplicate name selects existing,
    required on New team board, dismissible on join; assign disabled without
    `me`;
13. assignee, avatar, Mine/Unassigned; New only after `meSinceClock`, clears
    on open;
14. request records: two tabs enqueue concurrently and both apply; leave then
    Undo in the same millisecond resolves to joined; after applying the
    rejoin, the older leave record is deleted and never replays on reload; a
    crash between write and delete leaves records at or below the mark,
    which are dropped unapplied; ingestion is idempotent; a session typed on
    a team card never appears in the team board's payload;
15. forward guard: a stored or incoming `v` above `SYNC_V` is refused before
    `migrate` on load, storage event, import and adoption; incompatible
    remote head is terminal;
16. teams: a synced `teams` entry lists
    the team and adoption skips Who are you?; a `left` entry disconnects;
17. report: tags, grouping, colors, `rowKey` selection, no date editor on
    other-board rows, one export; late read-only fetch inert after close;
    fetch while the current namespace is synced.

CLI: `whoami` unknown/ambiguous names; attributed and unattributed `move`;
`assign` requires identity; `--mine`; v2 CLI build refuses a v3 board.

Keep the README's test counts in sync.

## Review log

Reviewer: codex `gpt-5.6-terra`, high effort, read-only, every claim checked
against the code. Findings were verified before being accepted.

**Round 1** — accepted: v3 gating instead of an "accepted degradation" (old
clients drop the new field clock and top-level keys); a dedicated read-only
fetch instead of reusing candidate inspection; column ids on events; per-row
board provenance and `rowKey`; `byIds`/`doneBy` in `aggregateWeek` and a
by-me done crossing for the default tick; `meSinceClock` instead of epoch
time; assignment requires `me`; New team board requires a first member; CLI
report stays board-scoped; corrected claims about `groupByProject` and event
immutability. Declined: deferring the combined report — one report was the
user's explicit requirement; its scope is contained by the fetch, `rowKey`
and the date-editing limit.

**Added after round 1:** teams follow you (user request).

**Round 2** — accepted: `teamId` and namespace derived from the secret;
leave as a tombstone with `joinMt` generations; board kind enforced by
validation and routing; collision check against `board.sync.<ns>`; tense by
column id; imports keep current teams; canonical `rowKey`; persisted read
time; the old-tab residual risk and a forward guard. Answered, not adopted:
"silently changing `me`" — both competing ids are the same person, so
following the entry is correct and a prompt would ask a question with no
wrong answer.

**Round 3** — accepted: `teamsLeft` synced, validated, clocked and a v3
trigger; team clocks in `clockMax`; leave's Undo as a queued rejoin;
per-request immutable records; non-empty roster on team targets and kind
validation after routing; the full 128-bit id in the namespace; the forward
guard before `migrate` on every read path, with the `sync.md` rewrite moved
into the implementation change.

**Round 4** — no blockers. Accepted two majors: causal request order (Undo
strictly after its leave) and acknowledgement by a persisted per-team
high-water mark that deletes every superseded record.

**Added after round 4, not yet reviewed:** rule 8 — sessions on team cards
are private and live on the personal board (user request; see
`docs/computers.md`).
