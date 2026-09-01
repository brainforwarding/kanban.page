# Sync hardening — small, dependable multi-device sync

Status: implemented 2026-08-31.

This release strengthens the existing encrypted snapshot-and-merge design. It
does not introduce accounts, a server-side history, a CRDT framework, manual
conflict screens, or a new relay protocol. Three personal devices — for
example a computer, phone, and second computer — remain an ordinary supported
case.

## Outcomes

1. A transient failed push or pull retries by itself, even while the live
   WebSocket still appears connected. Retry uses bounded exponential backoff
   and resets after the local board is confirmed at the relay head.
2. **Delete from server** forgets the secret only after the relay confirms the
   deletion (`204`) or confirms that the slot is already gone (`410`). A
   network or server failure leaves sync enabled and asks the user to retry.
3. Concurrent edits to different fields of one card are combined. Mutable card
   fields carry independent logical stamps for:
   - title
   - notes
   - session command
   - project
   - flag
   - archive state (`archivedAt` and `archivedFrom`, atomically)
4. Concurrent edits to the same field still have one deterministic winner.
   This is intentional: automatic text merging and a conflict UI are outside
   the product's scale.
5. Placement remains independent from content. Moving a card may update its
   human-facing `updatedAt`, but can never make stale title or notes beat a
   remote edit.
6. Remote-device and same-browser-tab writes use the same interaction barrier.
   An open editor, composer, drag, inline stage/project rename, or report date
   edit settles before an external merge rebuilds the screen.
7. Deleting a project while another device edits one of its cards cannot leave
   a dangling project id. The card survives and becomes unassigned unless a
   same-name surviving project provides an unambiguous destination.
8. Permanent card deletion converges across three or more devices. An ordinary
   stale edit or move cannot recreate the card through a third replica. Undo,
   or saving a draft after the client has observed the delete, starts a newer
   restore generation and intentionally brings it back.

## Compatibility

The board schema stays at `v: 2`. Field clocks are an additive `fieldMt` map on
tasks, and delete/restore uses an additive existence generation (`existMt`). A
task without `fieldMt` is treated as having the same legacy `mt` for every
field; a task without `existMt` uses its creation time (then legacy content
clock) as its generation. On its first new-client change, those baselines are
materialized before the relevant clock advances. This keeps old boards
readable and lets mixed versions continue to merge under the existing
documented limitations.

`mt` remains the aggregate content clock for old clients and unknown future
fields. `pmt` remains the placement clock. Only creation or an explicit restore
advances `existMt`; ordinary content and placement changes do not. Tombstones,
stage/project clocks, event union, encryption, relay versions, and the pairing
secret are unchanged.

## Retry contract

- Failed network pushes and pulls schedule a retry at 1, 2, 4, 8, 16, then 30
  seconds.
- Only one retry timer exists per tab.
- Focus, visibility, and `online` events may retry immediately without
  creating parallel loops.
- A successful pull resets the backoff only when there is no outbound work. A
  successful push always resets it.
- Permanent `413` (board too large) does not retry until the board changes.
- `410` stops sync as it does today.
- Deletion is never retried automatically: it is destructive and requires the
  user's explicit retry.

## Required coverage

Pure merge tests must cover disjoint and same-field card edits, legacy tasks,
move-versus-edit, tombstones, project deletion, and convergence across three
replicas. Browser tests must cover an external tab write during an open editor,
automatic recovery after a transient failed upload, and failed versus
confirmed server deletion. The existing calendar, report, migration, crypto,
and interaction suites must continue to pass.

## Non-goals

- Collaborative character-by-character editing
- Preserving both versions of a same-field conflict
- Device membership or presence
- Accounts or recovery email
- Relay-side plaintext, history, or merge logic
- Tombstone garbage collection
- WebSocket leader election between tabs
