# Images on cards — share a picture with a teammate

*Status: implemented and shipped; spec and implementation reviewed (log at the end). Screens:
[Figma — kanban.page image attachments](https://www.figma.com/design/mlNEgRxVZXplYXZkmPAAKR),
options A1 · B1 · C1 · D · E chosen. Where this document and the Figma file
disagree, this document is right.*

## Problem

A teammate wants to show you something — a screenshot of a bug, a photo of a
whiteboard — on the card it belongs to. Today a card holds text only, and the
board has no place a picture could live: the board is one JSON document in
`localStorage` (about 5 MB per origin, shared by every namespace) and every
save pushes the whole sealed board to a relay that refuses bodies over 600 KB
(`relay/worker.js`, `MAX_BODY`). One inline photo would end sync for the board.

## Product rules

1. **A picture travels with the board it is on.** On a team board everyone
   holding the team link sees it; on your personal board, your devices do.
   Nothing new to join, no account, no third-party host.
2. **The relay still cannot read anything.** Images are sealed on the device
   with a key derived from the board secret, exactly like the board.
3. **The board never carries image bytes.** It carries a ~150-byte reference
   per image; the bytes live beside the board on the relay and, per device, in
   IndexedDB. Board sync neither waits for nor re-sends an image.
4. **Each image crosses the network at most once each way per device.**
   Uploaded once by the device that added it, downloaded once by a device that
   opens its card, immutable after that.
5. **Offline first.** Adding an image works with no network; the card shows it
   immediately on this device and uploads when it can. Another device shows it
   as *arriving* until the bytes are there.
6. **The board archives; only the archive deletes.** Removing an image is
   undoable (the toast). No image is deleted from the relay in this version
   except by ending sync, which deletes the board and all of its images.
7. **Images only**: PNG, JPEG, WebP, GIF in (MIME type *and* magic bytes).
   Other files are a later change on the same pipe.
8. **No metadata leaves the device.** Every image is decoded and re-encoded
   through a canvas, whatever its format — EXIF, XMP, GIF comments and a phone
   photo's GPS position never reach a relay or a team. The cost: an animated
   GIF arrives as its first frame.
9. **The report and export are untouched.** Attaching is not an event and
   never appears in a weekly report.

## Schema: images are v4

A new top-level map on the synced board, keyed by attachment id:

```js
attachments: {
  "<attId>": {
    task: "<taskId>",          // the card it belongs to
    blob: "<blobId>",          // 22-char base64url, 128 random bits
    type: "image/webp",        // png | jpeg | webp (what re-encoding produces)
    w: 1600, h: 1200,          // pixels, for layout before the bytes arrive
    bytes: 184213,             // plaintext size, ≤ 1 MB
    name: "screenshot.png",    // optional, ≤ 120 chars, display only
    at: 1790000000000,         // added, epoch ms — strip order and "2h ago"
    by: "<memberId>", byName: "Ana",  // team boards, only when `me` is known
    gone: true,                // present = removed (a tombstone)
    mt: 1790000000123          // logical clock, stamped by stampChanges
  }
}
```

Why a top-level map, not a task field: task fields merge last-writer-wins per
field group (`TASK_FIELDS`), so two people adding a picture to the same card at
once would lose one. A map keyed by attachment id is a set: both survive. Why
`attId` ≠ `blob`: one picture on two cards is two attachments over one blob.

**v4, not v3.** Today's client already accepts v3 (`SYNC_V = 3`) and its
`syncable` whitelist drops unknown top-level keys, so it would pull a board
with images and push it back without them. Any `attachments` entry makes the
board **v4**; team/computer-only boards stay v3 and plain boards v2, byte for
byte. `SYNC_V` becomes 4, so every existing client — browser and CLI, which
share `core.js` — refuses a v4 board read-only instead of stripping it.

**Merge** (`merge`): per key, higher `mt` wins, ties go to the greater
canonical serialization — the rule `privateSessions` uses. An entry is never
physically removed; removal is `gone: true` with a newer `mt`, so a stale
device cannot bring a removed image back, and Undo (which clears `gone`) is
stamped newer and wins. Attachment clocks count in `clockMax`, so a fast-clock
device's entry can never outvote a later local remove or restore.

**Stamping** (`stampChanges`): an entry new or changed since `lastStamped` gets
`mt = clock`. **Absence is never a removal.** An entry that was in the last
save and is missing now is put back unchanged and unstamped: only an explicit
`gone` removes. Snapshot paths (Undo, Import-undo) carry the *current* map
across the snapshot (`KEEP_ACROSS_SNAPSHOTS`), so undoing an unrelated action
can never erase an image a teammate added in the meantime. The push floor
unions `attachments` per key like events and tombstones.

**Liveness is derived.** An attachment is live when it is not `gone` **and**
its card exists on this board (not tombstoned). Deleting a card from the
archive writes nothing to its attachments: they stop being live because the
card is gone, and they come back with it if the delete is undone. This also
covers the concurrent case — a teammate attaching to a card you are deleting
forever — without a rule of its own. A dead attachment is never rendered,
fetched or uploaded.

**Validation** (`validateSyncable`, both kinds): `attachments` is a map; each
entry has a string `task`, a `blob` matching `^[A-Za-z0-9_-]{22}$`, a `type`
from the allowed set, finite non-negative `w`, `h`, `bytes`, `bytes ≤ 1 MB`,
an optional string `name`, a numeric `mt`. Allowed on personal and team boards.

**Replace** (`linkedReplacement`) sets `attachments` to the linked board's map
(or none) explicitly: the old board's references must not ride along into the
board being joined, and so none of the old board's images are uploaded there.
Combine merges, and uploads what it contributes.

## Relay

Two routes beside the board, in the same Durable Object, addressed by the same
bearer token:

```
PUT /v1/blob/<blobId>   body: sealed bytes (application/octet-stream)
    → 204 stored (or already stored — idempotent)
    | 400 bad body | 404 no board here yet | 410 board deleted
    | 413 over MAX_BLOB | 429 slow down
    | 507 board full {used, quota, count, maxCount}
GET /v1/blob/<blobId>   → 200 sealed bytes | 404 | 410 | 429
```

- Storage: `b:<blobId>` → bytes, `s:<blobId>` → size, and `blobBytes` /
  `blobCount` running totals, written in **one** `put` so a crash cannot split
  them. `MAX_BLOB = 1_100_000` sealed bytes (1 MB image + IV + tag) against
  the 2 MB SQLite Durable Object value cap. The body's real length is checked
  after reading, not only its `Content-Length`; bodies under 28 bytes (IV +
  tag) are refused.
- **Per board:** `BLOB_QUOTA = 25 MB` and `MAX_BLOBS = 500`. A storage
  exception on write answers 507.
- **Per origin of traffic:** blob writes are budgeted in bytes by the `Gate`
  (per IP and global, per hour) and **fail closed** — unlike board creation,
  where the doorman must never lock out the building, a missing budget for
  new image bytes is a refusal. Blob reads and writes are also rate-limited
  per IP by a platform binding (`BLOB`), like `WATCH`.
- Re-PUTting a stored blob returns 204 without counting it twice or charging
  the budget.
- `DELETE /v1/board` deletes every `b:`/`s:` key and both totals along with the
  envelope, in batches of 128, before answering 204.
- GET answers `Cache-Control: no-store` like the board: devices cache in
  IndexedDB, where the rules below apply.

**507 is permanent for that board.** There is no per-blob DELETE and no
relay-side garbage collection in this version: the relay cannot read the board,
so it cannot tell a live blob from an orphan. Removing images does not free
space. The client says so plainly — "This board is full" with the meter — and
does not retry. The way out is to export a backup and end sync (a new sync link
is a new, empty slot).

## Crypto

`deriveBlobKey(secret)`: HKDF-SHA-256 over the secret with the fixed salt and
info `kanban.page blob`, → AES-GCM-256. A key of its own, so no IV space is
shared with the board's `enc` key.

Sealed format: `iv (12 bytes) ‖ ciphertext+tag`, AAD
`kanban.page:blob:v1:<blobId>` — the relay cannot answer one blob's request
with another blob's bytes.

**Blob ids are random, not content hashes.** A content hash would let anyone
holding a known picture confirm that a board contains it, and a keyed hash
needs a key an unsynced board does not have. Dedupe is local: IndexedDB keeps
`[ns, sha256]` → blobId, so pasting the same screenshot twice *on the same
board* reuses its blob. A blob id is never shared across namespaces.

## Device storage

One IndexedDB database per origin, `kanban.images`, store `blobs`, key
`[ns, blobId]` — one board's bytes can never answer for another's:

```js
{ blobId, ns, type, bytes: Blob, sha,
  sentTo: ["<slot>"],   // relay slots it is known to be on
  used: 1790000000000 } // last opened, for eviction
```

- A slot fingerprint is the first 128 bits of SHA-256 of the board's bearer
  token (hex). Upload runs whenever the current slot is absent from `sentTo`,
  so a rebinding (Combine) re-uploads to the new slot; PUT is idempotent.
- **An attachment reference is added only after its bytes are committed** to
  IndexedDB. A failed write adds nothing and says so.
- **Eviction:** above 200 MB per origin, least-recently-used records with a
  non-empty `sentTo` are dropped (they can be downloaded again). A record that
  has reached no relay is never evicted by the app.
- On the first attach, `navigator.storage.persist()` is requested. The browser
  can still evict best-effort storage; for an unsynced board the strip says
  *only on this device*, and a complete backup is the durable copy.
- **Leaving a team keeps the images**, as it keeps the local board. Nothing is
  deleted from IndexedDB on leave, disconnect or end-sync.

## Client flow

**Adding.** In the open editor: paste (⌘V, even with the caret in Notes), drop
files anywhere on the sheet, or the + tile (the file picker — how a phone
attaches). On the bare board with nothing open, ⌘V of an image opens a new card
with it attached; an image in the clipboard takes precedence over resume text.

**Preparing:**
1. Refuse anything that is not PNG/JPEG/WebP/GIF by MIME and magic bytes, or
   over 25 MB, or whose header declares more than 40 megapixels
   (`imageInfo(bytes)` in `core.js` reads the dimensions from the header before
   anything is decoded).
2. Decode with `createImageBitmap` (fallback: an `<img>` element), draw at ≤
   1600 px on the long side, close the bitmap, revoke any object URL.
3. Encode: a PNG source → PNG if the result is ≤ 600 KB (crisp screenshots),
   else WebP q0.82; everything else → WebP q0.82. Where WebP encoding is
   unavailable (`toBlob` gives `null` or another type), JPEG q0.85 over a white
   background. A `null` JPEG is a failure.
4. Over 1 MB after that: "Image too large", nothing added.

**Editor jobs are bound to one opening.** Every `openEditor` starts a new
editor generation, and a new card's id is minted when the editor opens. A tile
appears synchronously (*preparing…*) and its job re-checks the generation after
every await. When the editor closes, the generation's outcome is recorded:
*saved to card X* or *discarded*. A job that finishes after a save attaches to
X if X still exists; after a discard it deletes its unreferenced bytes.

**Closing = saving, as for every other field.** Save commits the draft's added
and removed images with the card, in one save. Opening Projects from the editor
and Archive from the editor now **save the draft first** (they used to close it
without saving, losing typed text as well). Only Esc and ✕ discard. A new card
with images but no title is saved with the first image's name as its title.

**Removing** (lightbox): the image leaves the strip at once, with an Undo
toast. Inside the editor it is part of the draft; after the editor has saved,
Undo clears `gone` on the saved entry.

**Uploading.** A per-page queue, owned by the sync session like push and pull:
it captures the session (epoch, secret, binding) and re-checks it after every
await. It runs after each successful push, after each applied pull, and on
startup when synced, uploading every live attachment's blob whose record lacks
the current slot, one at a time. 204 → add the slot. 404 (board not on the
relay yet) → wait for the next push. 507 → the board is full (permanent, see
above). 413 → too large (permanent). Network errors and 429 → the queue's own
bounded retry (15 s doubling to 5 min), independent of board pushes. The queue
never blocks, delays or changes a board push.

**Receiving.** Rendering a live attachment whose blob is not in IndexedDB:
not synced → *not on this device*; synced → GET; 200 → unseal (AAD-bound id),
check magic bytes, store, show; 404 → *arriving…*, retried after the next
applied pull and at most every 30 s while the editor is open. Only an opened
card fetches; the board itself never downloads images.

**Unsynced boards** keep images on the device only. Turning sync on uploads
them.

**Export / import.** A backup carries the bytes: `images: { "<blobId>":
"<base64url>" }` for every live attachment. A synced board first fetches what
it does not hold. If any live image is still missing, the file lists them in
`imagesMissing` and the toast says the backup is partial. Import accepts a file
up to 200 MB, reads only `images` entries referenced by the file's
`attachments`, checks each decodes to an allowed type by magic bytes and is ≤
1 MB, and never overwrites an existing different record with the same id.
`images` never enters board state.

## UI (Figma A1 · B1 · C1 · D · E)

- **Card (A1):** in the meta row, an image glyph and the count in mono, then
  the avatar of whoever added the latest image (team boards). Same in compact
  density. A card with no live images renders exactly as before.
- **Editor (B1, quieted after use):** an IMAGES row under Notes that exists
  only when the card has images: 72 px thumbnails with the adder's avatar
  (team boards). Adding is an image button in the footer (the file picker),
  paste, or a drop anywhere on the sheet, which outlines it as the target. No
  hint text. Under the thumbnails, a status line only when there is something
  to say on a synced board (uploading, arriving, retrying, board full with its
  meter); an unsynced board keeps images on the device by design and says
  nothing about it.
- **Lightbox (C1):** the board dims; top-left the file name, size and pixels
  in mono; centre `n / N`; top-right who added it and when, download, remove,
  close. Prev/next arrows and ← →; a thumbnail row; Esc closes the lightbox
  only.
- **Team boards (D6):** the first image added to a team board on this device
  asks once, inline in the strip: "Everyone with this team's link can see
  images you add here." — Add image / Cancel. The answer is a device
  preference (`imageNoticeSeen`) and never travels.
- **Phone (E):** the footer's image button opens the photo picker; the
  lightbox is full-screen.

## Invariants an agent can break

1. The board never contains image bytes; a board push never waits on, carries
   or retries an image.
2. `attachments` entries are never deleted from state and absence is never a
   removal; only `gone` removes.
3. Attachment clocks are wound only in `stampChanges` and count in `clockMax`.
4. Any attachment makes the board v4.
5. Every blob request goes through the captured sync session and is inert
   after that session ends; every editor image job is inert after its
   generation's outcome says discard.
6. A reference is added only after its bytes are committed locally; a record
   that has reached no relay is never evicted by the app.
7. Every image is re-encoded before it is stored.
8. Only the relay's board DELETE deletes blobs; the client deletes local bytes
   only when an editor job's outcome is discard.
9. Replace installs the linked board's attachments, never the old board's.

## Out of scope for this change

- `kanban attach` in the CLI (the relay routes make it cheap; it needs image
  handling without dependencies). The CLI shares `core.js`, so this release
  reads and writes v4 boards and carries `attachments` through untouched; a
  CLI published before it refuses a board with images until it is updated.
- Files other than images; relay-side garbage collection; per-blob deletion
  and a way to free a full board; prefetching on Wi-Fi; animated GIFs.

## Tests

- `tests/attachments.test.js`: v4 gating; concurrent adds keep both;
  commutative and idempotent; `gone` beats older; Undo beats `gone`; absence is
  not removal; ties canonical; skewed-clock remove/restore; clockMax; liveness
  follows the card's existence; validation on both kinds; the floor unions
  attachments; `exportable` keeps them; `sealBlob`/`unsealBlob` round trip,
  wrong id, tampering, wrong key; `imageInfo` for all four formats and junk.
- `tests/relay.test.js`: PUT/GET, idempotent re-PUT, 404 before a board, bad
  id, short body, 413 on real length, 507 on bytes and on count, budget
  refusal and fail-closed, DELETE removes blobs and totals.
- `dom.test.html`: pasting an image into the editor attaches it on save and
  the card shows the count; Esc discards it and frees its bytes; remove + Undo;
  an image on an unsynced board survives a reload.
- `team.dom.test.html`: an image added by one person appears for the other
  through the in-memory relay (which routes blob paths with 404/410/413/507
  semantics), with each simulated device on its own image database.

Keep the README's test counts in sync.

## Review log

Reviewer: codex `gpt-5.6-sol`, high effort, read-only, claims checked against
the code before acceptance.

**Round 1** — 19 findings, all accepted:
v4 instead of v3 (a current v3 client would strip `attachments`); absence is
never removal, the current map is kept across snapshots and unioned into the
floor (an unrelated Undo would have deleted a teammate's image); Replace sets
the linked map explicitly; attachment clocks in `clockMax`; liveness derived
from the card's existence (concurrent attach to a card deleted forever);
editor generations and a pre-minted card id for async image jobs; Projects and
Archive from the editor save the draft first; dedupe scoped per namespace and
upload keyed on the slot, 128-bit slot fingerprint; leaving a team keeps local
images; blob bytes budgeted per IP and globally, failing closed, plus a request
rate limit; real-length check, count limit, atomic totals, storage exceptions
as 507; 507 permanent and said plainly; every format re-encoded, not only JPEG;
header-checked size and pixel limits before decode, null-safe encoding and a
decode fallback; complete-or-declared-partial backups and bounded imports;
references only after a committed local write; the blob queue's own retry;
paste precedence and magic bytes; per-device image databases and a
path-routing fake relay in the team DOM suite.

**Round 2 — the implementation** (same reviewer). Accepted all seven:
the relay re-checks deletion, idempotency and totals after the budget call
with no outside await before the write, and DELETE commits its sentinel
before cleaning up (two racing uploads could overfill a board; an upload
could land in a deleted one); the upload queue has an owner token reset on
every relationship change, so a superseded upload cannot wedge it or carry a
507 into a new slot; an image whose bytes land after its reference is looked
for again on a timer (3 s, 8 s, 15 s, then 30 s) while its editor is open,
because blob uploads never move the board's version; IndexedDB keyed by
`[ns, blobId]`; the first-team-image notice belongs to its editor opening;
images removed before their first save are freed once their Undo closes, and
deleted records revoke their object URLs; import validates the board before
it writes any image bytes. Tests added for each.
