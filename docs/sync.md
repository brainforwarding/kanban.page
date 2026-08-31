# Sync — the same board on another device

How device sync works, and why it is shaped this way. Companion to
`design-brief.md`, which explains the board itself.

The promise the board started with was "there is no server to send it to."
Sync qualifies that promise rather than abandoning it: there is now a server,
it holds your board, and it cannot read a word of it.

## No account, ever

A board is addressed by a **secret**: 256 random bits, generated on the device
that turns sync on, and never sent anywhere except inside the pairing link the
user chooses to move to their other device.

```
secret ──HKDF('kanban.page auth')──▶ token   (Bearer, what the relay sees)
secret ──HKDF('kanban.page enc')───▶ key     (AES-GCM-256, never sent)
relay stores:  SHA-256(token) → { ver, ciphertext }
```

The relay never sees the secret, never sees the key, and never stores the
token — only a hash of it. A dump of the whole service is a pile of hashes and
sealed envelopes: no titles, no notes, no session commands, not even stage
names. The envelope's metadata (`v`, `gz`) is authenticated as AAD, so the
relay cannot flip a flag to make a client fail in a chosen way.

Anyone holding the link can read and edit the board. That is the feature —
it is how a phone gets paired, and later how a second person joins — and the
sheet says so in plain words next to the link. Lose every device *and* the
link and the board is gone; that is the accepted cost of having no account to
recover, and Export backup sits directly above Sync devices in the menu.

**Login would buy exactly one thing: recovery.** It is deliberately deferred.
An optional "add a recovery email" can be added later without any of this
changing, because identity would sit beside sync rather than in front of it.

## The clock, and why it is not the wall clock

Every mergeable thing carries a stamp. The stamp is *derived* from
`Date.now()` but is always at least one more than the highest stamp the device
has ever seen (`clockMax`), which makes it a hybrid logical clock rather than a
wall clock.

This is load-bearing. With bare wall-clock stamps, a laptop whose clock is a
year fast poisons every future merge: its stale edits beat correct ones for a
year, and a deletion made on a slow-clock device loses to a copy that was made
before it. Stamping past everything observed means a causally later edit always
wins, whatever the two clocks say.

Stamps are wound in exactly **one** place — `stampChanges`, called by `save()`
before every write — by diffing against the last-saved state. Nothing else in
the app calls a `touch()`, so no future feature can forget to. It also means
`undo()` stamps correctly for free: restoring an old snapshot is a change like
any other, so what undo brings back is stamped *now* and beats the remote copy
it is undoing.

Each task carries **two** stamps:

- `mt` — content: title, notes, session, project, flag, archive fields.
- `pmt` — placement: `columnId` and `order`.

They are separate because placement moves constantly and impersonally.
`addTask` bumps every sibling's `order`; one "Sort by project" rewrites the
whole board. Under a single whole-row stamp, tidying the desk on the laptop
would stamp a stale copy of every card and silently eat a title edited on the
phone. Splitting them also means **a reorder can never resurrect a deleted
card** — only the content clock argues with a tombstone.

## merge(local, remote)

Pure, in `core.js`, unit-tested. Never mutates its inputs.

- **Preferences never travel.** Theme, density, filters and `asOf` are
  properties of a device, not of the work. Sync moves work, not taste.
- **Tasks** merge per row: content by `mt`, placement by `pmt`, independently.
- **Tombstones** (`deleteForever`, and deleting a stage or project) are ids
  and a timestamp, never content — a tombstone must not preserve what someone
  deliberately destroyed. A tombstone deletes unless the content clock is
  newer, so an edit or an undo that came after the delete wins and the data
  survives the conflict.
- **Stages and projects** merge per item — so two devices adding a stage each
  keep both — while their **order is one atomic vector** under its own clock.
  Order is semantics here: the last column is the done stage, and the weekly
  report is defined by it. A stage the winning order never saw is inserted
  *before* its last entry, so an arriving stage can never redefine what the
  week calls finished. Boards with independent histories that both have an
  "Inbox" are deduplicated by name, and tasks follow to the survivor.
- **The event log only grows.** Union by id; a same-id collision can only be a
  `rewriteDay`, resolved by stamp. Even when a row's content loses, the loser's
  events still land. The log is the only copy of the history, and no merge, no
  import, and no undo may shrink it.

Ties break on a canonical serialization (keys sorted), so both devices pick the
same winner whichever way the arguments arrive.

**Known trade, deliberately taken.** Merge is commutative and idempotent, but
not fully associative: the *middle* order of stages added concurrently on two
devices depends on the order the merges happened in. The stage set converges,
the done line converges, and the next reorder settles it everywhere. The
alternative — a per-stage order key, fully associative — lets a stage added
elsewhere sort last and silently redefine the report. A cosmetic divergence
that heals beats a semantic one that does not.

## The relay

`relay/worker.js` — a Cloudflare Worker with one SQLite-backed Durable Object
per board. Around 150 lines, no dependencies, deployed with `wrangler deploy`.
A fork points at its own by changing one constant in `app.js`.

```
GET    /v1/board        → { ver, env } | 404 | 410
PUT    /v1/board        { baseVer, env } → { ver } | 409 { ver, env } | 413
DELETE /v1/board        → 204, and the slot answers 410 from then on
GET    /v1/board/watch  → WebSocket; every accepted write broadcasts { ver }
```

- **Optimistic concurrency.** A PUT lands only if `baseVer` still matches; a
  409 hands back the current head so the client can merge and retry from it.
  The Durable Object is the serialization point.
- **Live updates.** The watch socket is what makes an edit on the phone appear
  on an open laptop in about a second. It uses the Hibernation API, so an idle
  watcher costs nothing, and it stays open while the page is open — a laptop
  behind another window is current the moment you look at it. Polling every 30s
  is the fallback for when the socket is down.
- **The token rides in `Sec-WebSocket-Protocol`**, because browsers cannot set
  headers on a WebSocket, and never in the URL where proxies and logs would
  see it.
- **Deletion is durable.** The ciphertext goes and a sentinel stays, so a
  stale device cannot quietly recreate a board its owner wiped. Re-enabling
  mints a new secret, which is a new slot.
- **Creating a board is the only unauthenticated act**, so it is the only one
  with a budget: 20 per hour per address, 400 globally, counted in one Durable
  Object. Reading and writing an existing board is never throttled — that
  traffic already needs a secret nobody can guess, and a user on a flaky
  connection must not be locked out of their own board. (The platform's
  rate-limit binding measured permissive on this account, so it is kept only
  as defence in depth.)
- CORS is `*` on purpose: the bearer token is the entire capability and no
  cookie is ever used, so an origin allowlist would add nothing and would
  break forks.

## The client loop

- **Push** after each debounced save, coalesced ~1.2s. On 409: merge, apply,
  retry from the new base, at most three times — the next pull converges.
- **Pull** on load, on focus, on becoming visible, on the watch socket's
  signal, and on the 30s fallback.
- **The floor.** Events and tombstones known to have reached the relay are
  unioned into every push. This is what stops a snapshot write from shrinking
  the server's history — an imported backup or an undo can never truncate the
  log for every other device. While sync is on, Import *merges*.
- **One interaction barrier.** A remote change is fetched immediately but
  applied only when the screen is safe: never during a card, stage or project
  drag, an open composer, an open editor, an inline stage rename, or a report
  date edit. Each has a settle point that already existed. The editor matters
  most: its draft is a clone taken at open time, so applying underneath it
  would let the save that follows clobber the remote edit — or silently drop
  the draft if the remote deleted that card.
- **Same-machine tabs** need no network: a `storage` event carries one tab's
  save to the others, and it is *merged*, not adopted, because this tab may
  hold edits still inside its own save debounce.

## The surface

Sync lives at the end of the ⋯ menu's backup group — Export, Import, Sync
devices are all answers to "where does my data live", and sync is their
escalation from a point-in-time copy to a standing arrangement. The menu item
carries the same amber tick that "Compact cards" uses, which is the only
standing indication anywhere that this board leaves the machine. There is no
status dot on the board and no badge: a sync indicator is a permanent anxiety
object asking the user to supervise something built to heal itself, and the
board already *is* the display — cards arriving is what working sync looks
like.

One sheet, four states:

- **off** — the pitch, and Enable sync.
- **on** — the QR on the left, the pairing link and its warning on the right,
  the status in the footer, and two exits.
- **adopting** — shown synchronously when a `#sync=` link is opened, so the
  first-run demo card never flashes and vanishes behind it.
- **failed** — explains a dead link, or offers Try again when the network was
  the problem.

**The QR is graphite on white in both themes**, on its own plate that nothing
dims. It is read by a camera, not by a reader, and a themed or tinted code
fails on a large share of camera apps. It is also the only *safe* way to move
the link: typing 43 base64 characters is not real, and messaging it to
yourself puts the board's password in a third-party log forever — six pixels
under a sentence telling you not to. That is why the encoder is vendored, and
why it loads on demand: a quarter of the app's JavaScript should not be in the
cold start of a feature most boards never turn on. If it fails to load, the
link stands alone; the QR is never load-bearing.

**Status is machine voice, and reports outbound only.** `live · 14:02` means
the socket is genuinely open and a change elsewhere will arrive unasked;
`synced · 14:02` means current, but on the polling fallback. An inbound change
never touches the footer — it explains itself by moving the board, and a status
line flickering on every remote save would undo that explanation. The clock is
Santiago, like every other date in the app.

**A remote change is never marked.** No badge, no flash, no highlight. The FLIP
is the explanation: a card that moved elsewhere glides, one that arrived gets
the same entrance a locally created card gets. A marker would also imply
attribution, and there is no identity here — the other device is you.

**The two exits are different weights.** *Stop syncing* forgets this device's
key; the board stays whole and local and other devices carry on. Nothing is
lost, so it takes an Undo toast rather than a confirm — but the secret may
exist nowhere else, which is why it gets one. *Delete from server* ends sync
everywhere, so it takes the archive's armed two-step and offers no Undo,
because undoing it means a network write that can itself fail. It also forgets
the local secret, or this device's push loop would immediately recreate what
was just deleted.

## Known limits

- **Mixed app versions.** Fields are additive on `v: 2` and `migrate`'s spread
  carries unknown ones through, so a tab on an older release is merged rather
  than ignored. It can still lose a concurrent field edit, and its
  `deleteForever` writes no tombstone, so a card it deleted comes back. Both
  are recoverable, both are brief — the PWA offers the update on next load —
  and both beat the alternative of a version split where two tabs silently
  edit different boards.
- **An old installed shell** opening a `#sync=` link does not know what to do
  with it, but it also does not strip it: accepting the update prompt reloads
  with the fragment intact and the link adopts.
- **Every open tab holds its own socket.** Fine at the scale of one person's
  devices; leader election is the answer if that stops being true.
- **Tombstones are kept forever.** Safe garbage collection needs a membership
  model, and an offline device can come back arbitrarily late. They are ids
  and a number.
