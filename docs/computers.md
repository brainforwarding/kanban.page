# Computers — every session knows where it lives

*Status: implemented on branch `team-boards`; reviewed (1 round). Screens:
[Figma](https://www.figma.com/design/vSnalYHVilevj2WbJ5M1c9), page
"03 · Proposal — computers". Companion to `docs/team.md` (rule 8).*

## Problem

A card's **Session** holds an agent resume command (`claude --resume …`,
`codex resume …`). It only works on the computer that ran it, from the folder
it started in. With a laptop and a desktop, a pasted session is a guess about
where to go. On a team board it is worse: the command is private and useless
to anyone else, and today it would sync to every teammate.

## Product rules

1. **A session carries its computer.** The chip ends with the computer's icon
   and name; the one you are on reads in full ink.
2. **One extra click at most.** Pasting a session fills the computer with the
   one you are on. The picker beside the field changes it.
3. **Computers are registered once**, in ⋯ → **Computers**: a name you choose
   and one of four icons (laptop, desktop, mini, server).
4. **The list follows you; "here" does not.** Your computers sync across your
   devices through the personal board. Which computer *this* device is stays
   on this device.
5. **Sessions are private.** Personal-board sessions already are. A session
   on a team card lives on your personal board and is shown only to you.
6. **The CLI knows where it is.** Told once (`kanban here "Mac mini"`); until
   then it matches this computer's hostname against your computer names and
   uses the match only when exactly one fits, saying which it picked.

## Data model (personal board)

### `machines`

```js
machines: [{ id, name, icon: 'laptop'|'desktop'|'mini'|'server', mt }]
machinesMt: number        // order vector clock (drag to reorder)
```

- Merges exactly like `projects`, through `mergeLists`: per-item `mt`, one
  atomic order vector under `machinesMt`, tombstones on delete. The name dedupe
  for independent histories is **right** here — two devices that each
  registered "MacBook" before syncing mean the same computer — and its alias
  map remaps every `sessionMachine` that pointed at the dropped id, as it
  remaps `projectId`.
- Deleting a computer tombstones it; sessions that named it show the command
  with no computer rather than a wrong one.

### Sessions on personal cards — the `session` field group grows

```js
['session', ['session', 'sessionMachine', 'sessionCwd']]   // TASK_FIELDS
```

One atomic group: a command without its computer is exactly the ambiguity
this removes, so they merge together. `sessionCwd` is set by the CLI (the
browser cannot know it) and shown in the editor; copying on the matching
computer prefixes `cd <cwd> && `.

### Sessions on team cards — `privateSessions`

```js
privateSessions: { [JSON.stringify([teamId, taskId])]: { session, sessionMachine, sessionCwd, mt } }
```

Per key by `mt`. Clearing writes `{ session: '' }` with a newer `mt` and
**erases `sessionMachine` and `sessionCwd`** — no path survives a clear.
Leaving a team deletes every private session keyed to it. When the stored
team board shows a card tombstoned, its private session is cleared the same
way. Task ids are never reused, so a cleared key cannot reattach.

**The session firewall.** `validateSyncable(x, 'team')` refuses any task with
`session`, `sessionMachine` or `sessionCwd` — before persistence, merge and
push — rather than stripping it. The team editor writes only
`privateSessions`; it re-checks after the editor closes that the card still
exists on the team board and drops the private write if it does not, so a
session edit never resurrects a remotely deleted card.

### Schema

`machines`, `machinesMt` and `privateSessions` are **v3 triggers** alongside
`members`/`teams`/`teamsLeft` (`docs/team.md` → Schema), for the same reason:
an older client's `syncable` whitelist would drop them, and its rebuilt
`fieldMt` would lose the grown `session` group's new keys. A card only gets a
`sessionMachine` once a machine exists, so a v2 board never carries one.
`sessionMachine` **or** `sessionCwd` on any task also forces v3 (`hasV3Data`),
so a v2 board never carries half a session group. `validateSyncable` checks
their shapes; `machines`/`privateSessions` are legal only on the personal
(null) namespace.

### Here — device-local

```
localStorage['kanban.here'] = machineId              // browser: per browser profile
~/.config/kanban/config.json → boards[<personal>].here   // CLI: per personal board
```

Not board state and never synced: it describes the device, not the work. A
browser profile or installed PWA on the same Mac sets its own here; the CLI
cannot set the browser's. A here naming a deleted computer is cleared.

## Surfaces

- **Card chip:** `▸ command … | [icon] Name`. Muted unless it is here.
- **Editor → Session:** the command field, then a computer picker (icon +
  name + caret). Hidden while the field is empty. On paste it defaults to
  here; with no here set it shows **Computer** and the list.
- **Picker:** each computer (icon, name; **here** marks this device; check on
  the chosen one), then **Add a computer…**, which opens Computers with a new
  row focused.
- **⋯ → Computers** (panel, beside Projects): rows with icon, name, **here**
  on this device's row. Tap a row to rename and pick its icon. On another
  row, **here** appears on hover/focus (always visible on touch) and moves
  this device's here to it. Drag to reorder. Add row at the bottom. Under the
  list, one mono line: `kanban here "<this computer>"`.
- **Paste-to-card** (`app.js`: pasting a resume command onto the board) stamps
  here as the machine.
- **Team card editor:** each person's own Session, the lock in place of the
  command caret, reading and writing their `privateSessions`. Nobody sees
  anyone else's.

## CLI

- `kanban here "<name>"` — needs the personal board configured (the one with
  no roster). Matches a machine by name (case-insensitive; ambiguous → list
  `name [id]`) or **creates** it (icon `laptop` by default; `--icon`), and
  stores the id under that personal board's config entry. Creating a computer
  is personal data on the user's own board — unlike stages or boards, which
  the CLI never creates.
- **Resolution for `--session`:** config `here` → else the one computer whose
  normalised name is contained in the normalised `os.hostname()`
  (`Sebastians-Mac-mini.local` → "mac mini"), printed as
  `computer: Mac mini (from hostname)` → else none, with the `kanban here`
  hint once.
- `add`/`edit --session` on a personal board write `sessionMachine` and
  `sessionCwd = process.cwd()`.
- **One board per command, always.** On a team board `--session` is refused
  with the hint to run `kanban session <card> "<cmd>"`, which writes only the
  personal board's `privateSessions`. A command that could land on one board
  and fail on the other would leave the retry to create a duplicate card.
- `kanban show` prints `session  <cmd>  · <computer> · <cwd>`.

## Invariants

- Sessions never reach a team board's payload.
- Here never syncs; the list does.
- Clocks only in `stampChanges` (machines, the session group and
  `privateSessions` go through the diff).
- A deleted computer never becomes a wrong computer: no machine is shown.

## Required coverage

Core: machines merge/order/tombstone and name-dedupe alias remapping
`sessionMachine` on tasks and in `privateSessions`; a team payload with a
session is refused; the session group merges atomically; `privateSessions`
per-key merge and clearing; v3 triggers; `validateSyncable` rejects machines
or privateSessions on a team namespace and a session on a team board written
by this release. DOM: picker defaults to here, hidden when empty, Add opens
the panel; chip muted vs here; here moves between rows; team editor writes
private sessions and a teammate's editor has no field. CLI: `here` create /
match / ambiguous, hostname resolution only on exactly one match,
`--session` stamps machine and cwd, team-board `--session` refused,
`kanban session` writes only the personal board.

## Review log

**Round 1** (codex `gpt-5.6-terra`, high). Accepted: a validation-level
session firewall on team payloads; one board per CLI command (`kanban
session` for team cards); `sessionCwd` as a v3 trigger (already in
`hasV3Data`); alias remapping inside `privateSessions` (already in `merge`);
clears erase machine and folder; leave deletes that team's private sessions;
tombstoned team cards clear theirs; here scoped per profile / per personal
board and cleared when its computer is deleted; the session-edit deletion
race. Dropped from v1 on the reviewer's advice: hardware fingerprints and
`hostKeys` (a stable cross-device fingerprint and a merge hazard) — replaced
by a hostname match that only acts on exactly one fit.
