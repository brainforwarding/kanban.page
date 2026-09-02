# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal kanban board that runs from a file: open `index.html` in Chrome. Vanilla HTML/CSS/JS — no build step, no dependencies, no framework. All state lives in `localStorage` (`board.v2`, or `board.v2.<ns>` when opened with `?ns=<name>` — use a namespace for a scratch board that never touches real data).

Optional device sync is the one thing that touches the network, and only after the user turns it on: an end-to-end encrypted Cloudflare Worker relay in `relay/`, addressed by a secret with no account anywhere. `docs/sync.md` is the design record; the invariants an agent can break are below.
A synced board is also reachable headlessly through `cli/` — same relay, same
merge, no browser.

## Commands

```bash
npm test                                                    # core + CLI, no deps
node --test tests/core.test.js                              # unit tests, no deps
node --test tests/cli.test.js                               # CLI, against a fake relay
node --test --test-name-pattern="markdown" tests/core.test.js   # one test by name
```

DOM tests drive the real app in an iframe: open `tests/dom.test.html` in Chrome and read pass/fail from the page title. They run against `?ns=test`. Headless recipe (used because the suite needs real timers and drag events):

```bash
python3 -m http.server 8642 --directory . &
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --user-data-dir=/tmp/board-test-profile --remote-debugging-port=9223 about:blank &
curl -s -X PUT "http://localhost:9223/json/new?http://localhost:8642/tests/dom.test.html"
# poll until the tab title starts with PASS/FAIL (~40s; the suite uses real sleeps):
curl -s http://localhost:9223/json | grep -oE '"title": "(PASS|FAIL)[^"]*"'
```

Per-test failures live in `window.__results` on that page. Keep the README's test counts in sync when adding tests.

## Architecture

The browser app is four files, strict split:

- `core.js` — pure logic, zero DOM: dates/weeks, report aggregation, markdown export, event log, storage migration, the sync merge and its crypto. Exposed as the `BoardCore` global and via CommonJS for the node tests. New logic with edge cases belongs here, where it's unit-testable.
- `app.js` — everything else: rendering, drag, editor, composer, projects, report modal. Classic script (no modules); top-level function declarations are deliberately global — the DOM tests call them (`openReport`, `addTask`, …) plus the `window.__board` seam for state.
- `styles.css` — design tokens at the top (light + dark via `[data-theme]`), then every component.
- `index.html` — static markup shells; `app.js` fills them.

`cli/` is a **second client of the same relay**, not a second implementation:
`kanban.js` (entry/dispatch), `boards.js` (name → secret; keychain), `relay.js`
(GET/PUT and the status taxonomy), `ops.js` (mutations, each mirroring its
`app.js` counterpart) and `format.js`. It `require`s `core.js` directly — never
vendored, never re-implemented — so it inherits the merge, the clocks and the
crypto. Zero dependencies, Node 20+. `docs/cli.md` is its design record and
`docs/agents.md` is the file a user drops into their own project so an agent
knows the commands. The rules it must not break are the sync ones below, plus:
it never creates a board, never issues a relay `DELETE`, never reorders or adds
a stage, and never takes the secret as an argument.

`docs/design-brief.md` is the original spec and still explains intent (data model rationale, motion spec, type/voice rules); where it conflicts with README.md, the README is current — e.g. the exported markdown no longer matches the brief's sample (see below).

### The event log is the source of truth for reports

`state.events` is append-only. Events snapshot **stage names and titles as strings** at event time, so renaming or deleting a stage can never corrupt history; the report prefers a task's *live* title when it still exists and falls back to the snapshot when deleted. `at` (epoch ms) orders within a day only; `day` (`YYYY-MM-DD` in **America/Santiago**) is what reports group by, and date overrides rewrite `day`, never `at`.

**Never compute dates from epoch arithmetic.** Chile has DST; every date decision goes through calendar-date helpers in `core.js` (`ymd`, `mondayOf`, `addDays`). Weeks run Monday–Sunday in America/Santiago.

**The log records user moves, not state.** A card's `columnId` can change with no event appended — `deleteColumn` (which does not rehome its tasks), `restoreTask`, and `migrate`'s rehoming all do it, and archiving logs nothing either. Anything derived from "where is this card now" is therefore not reconstructible from the log, and replaying the log to a past date would resurrect archived cards. Report features that read only the log are safe; ones that read the board are not.

### Report vs. export — two different views

The report modal shows every card created or moved that week, with routes and per-row ticks. The exported markdown (`toMarkdown`) is narrower: title only, no summary counts, no stage routes.

Both are grouped by **tense** — `shipped` when the row **crossed the done line this week** (`to === doneStage && from !== doneStage`), `inflight` otherwise. The second clause is load-bearing: without it a card that was already done, got reopened and re-closed in the same week announces itself as shipped-this-week, and Select all is one click from putting that in someone else's inbox. No `doneStage` means no tense at all — never guess `shipped`. `aggregateWeek` computes `r.tense` beside `r.include`, from the same expression, and it is the only question anyone asks about a stage. Project order (user-draggable in the Projects panel) sorts within a section and becomes the ` · Project` suffix on each bullet.

Both tenses are pure functions of (events, period): nothing reads live board state, so opening a week from March gives March's answer and no section needs an "as of today" caveat. **Live state may annotate a row but must never classify it** — `lookupTask` reports `archived`, and the row marks it `⊘` beside the route, exactly as netZero marks `↺`. That door is how present-tense state keeps trying to get back in.

The modal shows the route (`from → to`) precisely because the export does not: after tenses, that display is what makes ticking an in-flight row an informed choice rather than a rubber stamp. A later density pass must not quietly drop it.

**The tick is the only filter.** `toMarkdown` emits exactly the entries it is handed and has no opinion of its own; the opinion lives in `aggregateWeek`'s `include` flag, which pre-ticks work that finished (`to === doneStage`) under a project. Everything else is listed, unticked, and one click from being exported anyway. This split is deliberate and load-bearing: it used to re-filter after the tick, so the modal could read "3 / 3" while the clipboard said "Nothing finished." Never reintroduce a filter downstream of the tick — if a rule should shape the export, it belongs in `include` where the user can see and overrule it.

### Sync: the rules that keep a merge from eating work

`merge(local, remote)` in `core.js` is pure and unit-tested; the client loop in `app.js` is what has to be careful. These rules will silently lose data if changed carelessly:

**Clocks are wound in exactly one place.** `stampChanges` diffs the state being saved against the last-saved state (`lastStamped`) and stamps what changed. Never add a `touch()` at a mutation site — the diff is what makes every path correct without one, `undo()` included (restoring a snapshot is a change, so what undo brings back is stamped *now* and beats the remote copy it is undoing). Stamps are logical, not wall-clock: always past `clockMax`, so a device with a wrong clock cannot win forever.

**A task has field clocks, an aggregate content clock, a placement clock, and an existence generation, and they must stay apart.** `fieldMt` merges title, notes, session, project, flag and archive independently; `mt` is their aggregate compatibility clock; `pmt` is placement (`columnId`/`order`); `existMt` is creation/explicit restore. Placement churns impersonally — `addTask` bumps every sibling's order, "Sort by project" rewrites the board — so it must never advance content or existence. `updatedAt` is display metadata, not a content clock once a legacy row is stamped. Only `existMt` argues with a tombstone: an old offline edit cannot resurrect a permanently deleted card through a third device, while Undo or settling a draft after observing its deletion deliberately starts a newer generation.

**Stage order is atomic; stage identity is not.** Items merge per id (two devices adding a stage keep both); the order is one vector under `columnsMt`. A stage the winning vector never saw is inserted *before* its last entry, because the last column is the done stage and an arriving stage must never redefine what the report calls finished. Merge is commutative and idempotent but not associative for that middle order — a documented, self-healing trade, see `docs/sync.md`.

**`merge` is for two boards, and only two boards.** It reads whole-board meaning into both arguments — an empty `columns: []` used to win the order vector and sort the real stages by id, moving the done line. So the push floor is unioned directly (`unionFloor`), never merged, and an empty list can no longer win an order. For the same reason the name dedupe only collapses a genuine cross-board coincidence: one id known *only* to each side. Two stages named "Done" on one board are legal and must both survive.

**Joining is an explicit relationship decision.** One namespace follows at most one remote. A link for Y is blocked while X is active; the user must Disconnect and reopen it. A pristine starter adopts Y directly. A real unsynced board chooses Replace (install Y without uploading the old local board) or Combine (merge, with `preferOrder: 'remote'`, then push the union). Candidate fetch/decrypt/validation never borrows the active sync globals and a candidate-attempt id makes late results inert.

**Remote applies merge; intentional local replacements carry a content generation.** Remote pulls and ordinary same-tab-lineage `storage` writes merge, never mid-interaction. Replace, pristine adoption, unsynced Import, and Import Undo advance `_contentGen`: a higher generation replaces, an equal one merges, and a lower stale write is rejected and the winner re-persisted. A separate `_bindingGen` advances on every relationship transition, including Combine, and the sync config may run only while its generation matches the board. Keeping the two separate is load-bearing: Combine must stop X while still merging an unsaved draft from another tab. `syncBusy()` is the shared render barrier, but a higher binding suspends the old engine immediately. The editor is the sharp one: its `draft` is a clone from open time, so applying underneath it lets the following save clobber the remote edit.

**Async sync work belongs to one immutable session.** Push, pull, watch, retry, and DELETE capture the relationship epoch/secret/binding and re-check them after every await before touching state, version, status, keys, floor, config, or rendering. Disconnect, loss, deletion, cross-tab rebinding, and Join invalidate that epoch first. The board is persisted before the matching sync config, and both storage listeners plus startup enforce the binding match, so a crash or event-order reversal fails safely off rather than pushing Y's content to X.

**The floor never shrinks.** Events and tombstones known to be on the relay are unioned into every push, so no snapshot write (an import, an undo) can truncate the server's history. While sync is on, Import merges.

**Transport retry and destructive deletion are different.** Failed pushes/pulls own one bounded retry timer even if the WebSocket still looks live. Delete-from-server never retries itself and never forgets the secret until the relay confirms `204` or `410`; otherwise the user must be able to try again with the same capability.

### Rendering model and its one big gotcha

`render()` rebuilds the whole board with `board.innerHTML = ''` (wrapped in `flip()` so cards animate rect-to-rect; `flip()` also preserves per-column scroll). Consequence: Chrome fires `blur` on a focused element **mid-teardown while it still reads as connected** — any commit-on-blur logic must defer a tick and re-check `isConnected` (see the composer in `composerEl`). `save()` is debounced 120ms — tests sleep ~200ms before asserting on `localStorage`.

### Safety properties to preserve

- **The board archives; only the archive deletes.** Nothing on the board is one click from gone; the single irreversible action lives in the archive behind a two-step confirm.
- **Closing a text surface = saving.** `closeComposer()` commits any typed text as a card, and closing the editor — including clicking outside it — calls `saveEditor()`. Only a deliberate gesture discards: Esc, or the editor's ✕. The editor used to do the opposite and destroy the draft silently, with no undo, because `undo()` restores board state and a draft was never in state.
- **Damaged boards keep their event log** — the log is the only copy of the history (see migration tests). Sync obeys this too: merge unions events and never drops one, and the push floor stops a snapshot from truncating the relay's copy.
- **Sync is opt-in and reversible from either end.** Disconnect this device forgets this device's key (Undo toast — the secret may exist nowhere else) but keeps its local board and leaves other devices connected. End sync on all devices uses a real confirmation; relay `410` makes stale devices stop without deleting any device's local board.

### Touch, and the three responsive axes

The responsive layer is organised by **axis**, not by screen: `(hover: none)`
and `(pointer: coarse)` are about the INPUT, `(max-width: 640px)` is about
SPACE. Keep them apart — a sizing rule keyed to a width silently misses a touch
laptop, and a reveal keyed to a width misses an iPad.

**A media query adds no specificity.** `.sheet { top }` at (0,1,0) lost to
`.sheet.wide` (0,2,0) while still winning `bottom`, and the box stretched
between the two — 768px of sheet for 519px of content. The other (0,2,0) rules
that beat a naive override: `.pill.add`, `.pill.flagpill`, `.icon.sm`,
`[data-density="compact"] .chip`, and `[data-density="compact"] .col:not(.ghost-col)`
at (0,3,0). Match or beat the competitor, or the rule half-applies.

**`width` never wins on a flex main axis while shrink is on.** `.col` is
`flex: 1 1 var(--col-w)`, so `width: min(84vw, …)` did nothing and columns
measured 272px. State a flex size, not a width.

**`opacity: 0` still hit-tests.** Every hover-gated control was invisible AND
live on touch — two taps at an unseen button's coordinates deleted an archived
task. Reveal under `(hover: none)` rather than leaving a landmine.

**The gesture split.** A mouse can spend movement on a drag because the pointer
was already somewhere before it pressed. A finger has one gesture and the
scrollers need it, so on touch a card is lifted by holding still for 320ms and
any earlier movement hands the gesture back to the browser. The 5px threshold
keeps its value and inverts its meaning. The gate is `e.pointerType === 'touch'`
— an explicit opt-in, so the suite's PointerEvents (which omit `pointerType`,
defaulting to `""`) keep the unchanged mouse path.

**A tap's compatibility click is hit-tested fresh**, after any scrim raised on
`pointerup` is already up. That is why opening the editor used to close it
again on touch, and why the scrim only closes on a click whose press also
landed on it.

**Verifying on a phone: bypass the service worker.** This ships as a PWA, and a
reused Chrome profile will serve a cached `app.js` — a fix can measure as
broken when it is fine. Use `Network.setBypassServiceWorker` plus
`setCacheDisabled`, and set `Emulation.setDeviceMetricsOverride` BEFORE
`setEmulatedMedia`, or the metrics override resets the emulated media.

The DOM suite's iframe is 900x560 and headless reports `pointer: fine`, so the
input axes never fire by default; the touch tests ask for `pointerType: 'touch'`
explicitly and the layout test resizes the frame to 390px and restores it.

### Drag pattern (cards, stages, and project rows share it)

Pointer listeners on `document` (no pointer capture — synthetic test events depend on this), a fixed-position ghost clone that follows the pointer with velocity-based tilt, FLIP animation for displaced siblings, and a ghost "flight" to the resting rect on drop. `prefers-reduced-motion` collapses all of it. `dragColumn` is the horizontal case: it must skip the trailing `.ghost-col` (the "add stage" affordance is also a `.col`), and because `render()` rebuilds the board it re-queries the landed column for the flight target.

**Stage order is a semantic, not a preference.** The last column is the done stage everywhere (`columns[columns.length - 1]`) — position, never a name — so reordering stages changes what the report counts as finished. That is the point: before stages could be dragged, a new stage always landed on the right and the only way to place one was to rename stages into each other's positions, which silently moved "done" while the event log kept the old names forever.

### Design voice

Monospace means "the machine said this" (stage names, counts, session commands, dates); Avenir Next is the human voice (titles, notes). One accent — amber `#FFB454`. Project colors are the only other chroma. Match existing motion timings and easing (`EASE`, `var(--ease)`) rather than inventing new ones.

### Test conventions

DOM tests must be date-stable: `openReport()` opens *last* week on Mondays, so report tests go through the `openThisWeek()` helper in `dom.test.html`. Unit tests pin exact markdown output — update them deliberately when the export format changes, and check the README's format description at the same time.
