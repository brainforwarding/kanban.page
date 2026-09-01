# Joining a synced board — explicit replace or explicit combine

Status: reviewed implementation specification.

## Problem

A sync link identifies one encrypted remote board and grants full read/write
access to it. Opening a different link is not merely "adding a device": it may
change which board this browser follows and may copy the browser's current
board into another set of devices.

The current client has three ambiguities:

1. Its receiving path is QR/link-first but has no visible place on another
   desktop to paste the link.
2. A non-pristine local board is automatically merged into the linked board.
   Scanning another device normally means "show that board here," so merging
   local work into every linked device must be explicit.
3. A device already synced to board X may open a link for board Y. Adoption
   begins before X is protected; a late X request or a bad Y link can damage
   the relationship state.

These are client state and interaction problems. They require no accounts,
device registry, relay endpoint, or new merge algorithm.

## Product rules

1. One local board namespace has at most one active sync relationship.
2. A device already synced to a different board cannot join, switch to, or
   combine with a second board. It must disconnect from its current sync first,
   then open the new link again. This deliberate two-step is the product rule;
   the blocked flow never offers "disconnect and continue."
3. Opening the same link while already synced is a no-op that opens the normal
   connected sheet and says it is already connected.
4. A pristine starter board uses the linked board directly. Starter content
   never leaks into a real board and needs no choice.
5. Any non-pristine unsynced board chooses explicitly between:
   - **Replace with linked board:** replace the work in this local namespace
     with the linked board. Upload none of the old local work.
   - **Combine both boards:** merge the local and linked boards, then upload the
     union to the linked board for all of its devices.
6. Replace appears first and is primary because it matches normal pairing
   intent. Neither option is preselected and Enter cannot commit one
   implicitly. Combine remains visually secondary because it changes the board
   for every linked device.
7. A candidate link is parsed, fetched, authenticated, decrypted, and
   schema-checked before the current board or sync configuration changes.
8. An invalid, deleted, corrupt, newer-schema, or unreachable link changes
   nothing. Retry exists only for temporary transport failure.
9. Disconnect and global deletion remain separate:
   - **Disconnect this device** forgets the secret here and keeps the board
     local. Other devices continue syncing.
   - **End sync on all devices** deletes the relay copy and disconnects every
     device, while each device keeps its local board.

## State table

| Current local state | Candidate | Required result |
|---|---|---|
| Actively synced to the same secret | Same board | Open connected state; do not fetch, reset versions, merge, or replace |
| Actively synced to another secret | Different board | Block before fetching or changing state; discard candidate and direct the user to disconnect first |
| Unsynced pristine starter board | Valid board | Replace starter board and begin syncing |
| Unsynced non-pristine board | Valid board | Show Replace/Combine after validation |
| Any unsynced board | Invalid/deleted/corrupt/newer board | Explain permanent failure; preserve local state |
| Any unsynced board | Temporary network/relay failure | Offer retry; preserve local state and keep candidate only in memory |

"Non-pristine" uses the existing `seed` marker, not task count. An empty board
may still contain meaningful stages, projects, history, or user decisions.

## Entry points

### Opening or scanning a sync link

Read `#sync=…`, remove the secret from the address bar/history immediately,
then follow the state table. If the link's `?ns=` differs from the current
namespace, navigate to that namespace on this installation and let its own
local board run the same guard and choice. A full link must behave identically
whether opened, scanned, or pasted.

### Desktop receiving path

The off sheet adds a compact secondary action under **Start syncing this
board**:

**Join with a sync link**

It reveals one labeled input, **Paste sync link**, with **Continue** and
**Cancel**. Accept a full kanban.page sync link or the 43-character secret; the
app continues to display/share the full link and never introduces a short
numeric code. Malformed text fails locally without a request. Submitting clears
the input immediately.

## UI states and exact copy

Keep one Sync sheet. Add compact transient states rather than a wizard, tabs,
or board-management screen.

### Off

**Sync across devices**

Keep this board up to date on your devices.

Actions: **Start syncing this board** (primary), **Join with a sync link**
(secondary).

### Checking

**Checking sync link…**

No choice appears until the candidate has been validated. Candidate attempt
identity makes close, cancel, or a superseding link render every late response
inert.

### Already synced to another board

**Already syncing another board**

This device can sync with one board at a time. Disconnect it first, then open
the new sync link again.

The header close control is sufficient; the only body/footer action is **View
current sync**. It opens the ordinary connected state. The candidate is
discarded and never fetched.

### Choose how to connect

**This device already has a board**

Choose what happens when you connect to the linked board.

Show a compact signature for each snapshot so the choice is concrete:
**Linked board · 24 cards · 4 stages** and **This device · 9 cards · 4
stages**. Count archived cards too: they remain meaningful local work. A board
with none reads **This device · 0 cards · 4 stages**, never “Empty board,”
because it may still contain projects or history. Singular labels use
**1 card** and **1 stage**.

**Replace with linked board** — primary option row

Removes the board currently stored here. Nothing from it is added to the linked
board.

**Combine both boards** — secondary option row

Adds this device's board to the linked board. The combined result syncs to its
other devices and cannot be globally undone.

Supporting actions: **Export current board first** and **Cancel**. Export uses
the existing backup download and returns to the unchanged choice.

### Candidate failures

Permanent:

**This sync link no longer works**

Ask for a new link. The board on this device is unchanged.

Temporary:

**Couldn't reach that board**

Check your connection and try again.

Actions: **Retry**, **Cancel**.

### Connected

The main content begins:

**Add another device**

Scan the QR, or open this link on your other device.

Keep the QR, read-only full link, Copy action, password warning, and status.
Move relationship-ending actions out of the crowded footer into two compact
rows below the pairing area; leave status alone in the footer.

**Disconnect this device**

Keeps this board here. Other devices continue syncing.

**End sync on all devices…** — the only red row

Each device keeps its board, but they stop updating each other.

The global action opens a real inline confirmation state rather than changing
its label to “Sure?”:

**End sync on all devices?**

Each device will keep its current board, but they will stop updating each
other. This sync link will stop working.

Actions: **Cancel**, **End sync** (destructive).

### Success

- Pristine/Replace: **Connected. This device now shows the linked board.**
- Combine: **Boards combined. Every linked device will update.**
- Same active link: inline **Already connected to this board.**

No join path offers generic Undo. Restoring a discarded local board while
connected would silently turn Replace into Combine; a pushed Combine cannot be
globally undone. The pre-action export is the explicit safety path.

## Data behavior

### Replace with linked board

1. Preserve device preferences: theme, density, filters, language, and report
   date behavior stay local.
2. Replace columns, projects, cards, events, tombstones, and clocks with the
   validated linked snapshot.
3. Set the linked version/snapshot as the known remote head before persisting,
   so Replace performs no contaminating PUT.
4. Commit the relationship and board atomically from the client's perspective,
   then start watch/pull.

### Combine both boards

1. Use existing `merge(local, linked, { preferOrder: 'remote' })`; the linked
   stage order wins adoption so its done stage retains its meaning.
2. Save and push the union through the existing optimistic-version loop.
3. The choice is confirmation. Once the union reaches the relay, no UI claims
   either a local or global Undo.

## Cross-tab content and relationship generations

Ordinary writes from another tab continue to merge. An intentional connection
transition must not: a stale tab holding X can otherwise merge X straight back
or keep pushing it after another tab connects to Y.

One marker cannot safely mean both "replace this board" and "change its sync
relationship." Combine changes the relationship but must still merge an
unsaved draft from another tab. Store two device-local generations on the full
board, both excluded from `syncable()`. Use deterministically comparable
`{ at, id }` values: logical timestamp first, random id as a simultaneous-tab
tie-break.

**Content generation** decides board data behavior:

- higher replaces local board state;
- equal is the same local board lineage and merges normally;
- lower is a stale pre-replacement write, is ignored, and the winning state is
  immediately re-persisted because the stale tab already overwrote
  localStorage.

Pristine adoption, Replace, unsynced Import, and Undo of such an Import advance
content generation. Combine deliberately does not: another tab's unsaved local
draft must still merge into the combined board rather than be discarded.

**Binding generation** decides which sync engine may run:

- Start sync, Disconnect, sync loss/global deletion, pristine adoption,
  Replace, and Combine each advance it;
- seeing a higher binding generation immediately suspends the old engine,
  before any interaction barrier or board rendering;
- persisted sync config carries the same binding generation as the board and
  may run only while they match.

When content generations are equal but binding generations differ, merge the
content and keep the higher binding. This preserves a stale tab's legitimate
draft without allowing its old relationship to resume. Re-persist the union
under the winning binding.

Write the board before its binding-bound sync config. A sync-config storage
listener always reads the current board from storage before starting a
relationship, so either storage-event delivery order converges safely. Config
removal immediately suspends the old engine without changing board content.
On startup, the client performs the same binding match before starting pull or
watch. A crash or storage failure between the two writes therefore leaves sync
safely off rather than running X against Y's board.

The existing interaction barrier may defer rendering a higher-generation board
until an editor/drag settles, but the old sync engine is suspended immediately
and the higher-generation replacement—not a merge—wins afterward.

## Async lifecycle safety

Every active sync relationship owns an in-memory session epoch. Disconnect,
loss, deletion, cross-tab config change, or joining invalidates it. Push, pull,
watch callbacks, retries, and DELETE capture the epoch/secret they began with
and verify both after every asynchronous boundary before touching state,
version, status, keys, floor, configuration, or rendering. A late X result is
therefore inert after Y begins.

Candidate inspection has a separate monotonically changing attempt id. Close,
Cancel, a new candidate, or successful commit invalidates the old attempt.
Inspection derives candidate credentials without assigning global `sync`,
replacing cached active keys, dropping a watch, or writing configuration.

Candidate failure classes:

- retryable: network error, timeout, `408`, `429`, `5xx`;
- permanent: malformed input, `401`, `404`, `410`, invalid JSON/envelope,
  authentication/decryption failure, invalid shape, or newer schema.

Same-link no-op applies to candidate adoption only. Normal page startup with an
existing relationship still starts watch and pull.

## Accessibility

- The sheet uses `aria-labelledby="syncTitle"`.
- While open, the rest of the app is inert and keyboard focus is contained in
  the sheet. Tab and Shift+Tab wrap through its visible controls.
- Option/action rows are real buttons; descriptions use `aria-describedby`.
- Focus enters transient states on their heading or Cancel, never on Replace or
  a destructive action. A focused heading has `tabindex="-1"`. Closing restores
  the prior focus when it still exists.
- Escape/header close discard candidates and invalidate their attempts.
- Visible keyboard focus and at least 44px touch targets remain intact.
- Checking, failure, and completion are announced through the sheet's polite
  live feedback only when text changes; success copy is not visually repeated
  in the footer status.
- Opening a link while another editor/drag is active uses the existing
  interaction-settle barrier before presenting or applying a choice.

## Required coverage

Browser tests must prove:

1. paste-link entry parses full links/raw secrets, preserves `?ns=`, clears the
   input/URL secret, and rejects malformed text without fetching;
2. the same active link is a candidate no-op while ordinary startup still
   pulls/watches;
3. a different active link is blocked without fetch or state/config change;
4. invalid/offline candidates and cancelled/superseded late responses preserve
   the local board;
5. pristine adoption replaces starter content without a choice;
6. Replace removes local work and makes no contaminating PUT;
7. Combine keeps both boards and pushes their union;
8. Cancel/export from the choice leaves both sides unchanged;
9. old X push, pull, watch, retry, and delete completions are inert after a
   binding generation changes;
10. board and sync-config storage events converge in either order;
11. higher content generation replaces, lower content generation is rejected/
    re-persisted, and equal-content writes still merge across a binding change;
12. a stale tab cannot reintroduce starter/X content after pristine/Replace/
    Combine, while a Combine still preserves a draft from that tab;
13. unsynced Import replacement and its Undo advance generation;
14. retryable and permanent candidate failures render the correct actions;
15. connected disconnect/global-delete controls retain their local/global data
    behavior.

Existing core and browser suites must remain green.

## Review decisions

The draft was reviewed for UI/UX economy, accessibility, and sync safety by
independent product and engineering reviewers plus Claude Opus 5.

Accepted: paste-link entry, concrete board signatures, consequence-led copy,
checking/error/success copy, action rows outside the footer, real global-end
confirmation, candidate identity, separate content/binding generations,
generation-bound config, stale async invalidation, focus containment, and
explicit accessibility/test contracts.

Not accepted: Opus proposed **Disconnect and continue** while holding the new
candidate. The product decision is the stricter user-requested two-step:
different links are blocked and discarded until the device is deliberately
disconnected. This adds one repeated open but prevents a single prompt from
both ending X and starting Y.

## Non-goals

- Syncing one local namespace to two remotes
- Server-to-server board merging
- Device lists, names, presence, or per-device revocation
- Accounts or recovery
- Short numeric codes
- History of old pairing secrets
- Automatically deleting an old remote after disconnect
