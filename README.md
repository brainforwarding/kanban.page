# kanban.page

A personal kanban that keeps your work organised by stage and by project.
Free, works offline, no account. The board lives in your browser; turn on sync
and it reaches your other devices through a server that cannot read it.

**[Open the board →](https://kanban.page/)**

![the board](docs/shots/board.png)

## What's different

**Your agent moves its own cards.** Once a board syncs it is reachable from a
terminal, so Claude Code or Codex can read it, move a card and add one with no
browser open anywhere — see [From a terminal](#from-a-terminal). And each card
carries the session working it (`claude --resume …`, `codex resume …`), so you
can see which thread owns which task: click it and it's on your clipboard, and
copying one from a terminal then pressing `⌘V` on the board starts a card with
that session already attached.

**Friday's update is already written.** `R` opens the week — everything you
created or moved, Monday to Sunday, split into what shipped and what is still in
flight. Finished work arrives ticked; tick anything else worth mentioning. The
export is exactly what is ticked, and narrower than the view — title only, no
routes, no counts:

```markdown
# Progress — 10–16 Aug 2026

## Shipped
- Onboarding tour v2 · Website
- Rate limiting for the public API · API

## In flight
- Invoice PDF export · API
```

Which stage counts as done is **position, not a name**: the rightmost one. So
drag a new stage to where it belongs rather than renaming stages to fake it.

**Your phone too, with no account.** **⋯ → Sync devices** shows a QR code and a
link — scan it, and it's the same board on both. The link *is* the key, so
anyone you give it to can read and edit the board, while the server only ever
holds bytes it cannot decrypt. Every device keeps a complete local copy, and
sync is reversible from either end. See [docs/sync.md](docs/sync.md).

**Want it to work differently? Ask your agent.** ~4,000 lines of vanilla HTML/CSS/JS,
no build step, no dependencies, and a `CLAUDE.md` that lands an agent oriented
instead of guessing.

![dark mode](docs/shots/dark.png)

## Fork it

You get your own board at your own URL — and because it's a fork, you can pull
new versions whenever you want them.

1. [Fork the repository](https://github.com/brainforwarding/kanban.page/fork).
2. **Settings → Pages → Source: GitHub Actions**.
3. The **Actions** tab → enable workflows, then push any commit.

Yours is then at `https://<you>.github.io/kanban.page/app/`, installable and
self-updating, with your changes in it.

## Keys

| | |
|---|---|
| `N` | new task |
| `R` | weekly report |
| `P` | projects |
| `A` | archive |
| `/` or `⌘K` | search |
| `T` | light / dark |
| `D` | compact cards |
| `F` | flag / unflag the focused card |
| `⌘V` | paste a resume command as a new card |
| `⌥` + arrows | move the focused card between stages or up and down |
| `Esc` | close whatever is open |

Stage names are editable in place — click one and type. A stage can only be
deleted once it's empty.

## Good to know

- **Joining is explicit.** Paste a link through **Join with a sync link** on
  another computer. A device with an existing local board chooses Replace or
  Combine; a device already synced elsewhere must disconnect first.
- **Move a board with `⋯ → Export backup`**, then `Import backup`. Worth doing
  occasionally regardless: a cleared browser is a cleared board.
- **Nothing is one click from gone.** The board archives; only the archive
  deletes, behind a two-step confirm.
- **Several boards:** open with `?ns=<name>` and you get a separate one with its
  own storage. Handy as a scratch board.
- **Install it:** visit once online, then use your browser's install menu. It
  opens offline after that, and offers **Update** when a new version ships —
  which changes the app files, never your cards.

## From a terminal

Once a board syncs, it is reachable from a terminal — so a script, or an
agent, can read and edit it without a browser open anywhere. Same relay, same
merge rules, same end-to-end encryption; it is simply a second client.

```bash
npm i -g github:brainforwarding/kanban.page
```

Turn on sync in the app (**⋯ → Sync devices**), copy the sync link, then hand
it to the CLI **through a pipe** — never as an argument, where it would land
in your shell history:

```bash
pbpaste | kanban board add work        # macOS; stores the secret in the keychain
kanban ls                              # read the board
kanban add "ship the thing" --project Sales
kanban done 4f2a                       # ids take any unambiguous prefix
kanban report --md                     # this week's progress, as markdown
```

Every write prints the board it fetched before it changes anything, because a
write reaches every device you have open in about a second:

```
work · INBOX 27 / DOING 18 / DONE 63 · ver 412
  +  INBOX  ship the thing  · Sales
ok · ver 413
```

Add `--dry-run` to stop before the write, or `--json` to get one object on
stdout instead of prose. `kanban help` lists everything.

**The sync link is a password.** It is the whole capability — anyone holding it
can read and edit the board, and there is no account to revoke. The CLI keeps
it in your OS keychain, never accepts it as an argument, and never prints it.

### Letting an agent use it

Drop [`docs/agents.md`](docs/agents.md) into your own project as `AGENTS.md`
(or paste it into a `CLAUDE.md`) and an agent has what it needs: the commands,
the id rules, and the two things it must not assume. It only needs a board
already registered with `kanban board add`.

The CLI cannot create a board and never deletes one — sync is turned on, and
ended, in the app. See [`docs/cli.md`](docs/cli.md) for the design and the
invariants it holds to.

## Develop

```bash
node --test tests/core.test.js     # 114 unit tests, no dependencies
node --test tests/cli.test.js      # 23 CLI tests, against a fake relay
```

They cover what is easy to get silently wrong: calendar dates across DST,
Monday–Sunday boundaries across month and year ends, report aggregation,
markdown output, storage migration, and the sync merge — clocks, tombstones,
and three replicas converging. The CLI suite covers the ways a headless
writer could lose work: a lost response double-adding a card, a retry
restamping clocks, a concurrent delete losing to a stale edit, and a
future schema being written back as an old one. Then open `tests/dom.test.html` in Chrome for
50 interaction tests — they drive the real app in an iframe and report
pass/fail in the page title, against a `?ns=test` board that never touches
your data.

```
index.html   markup
styles.css   design tokens + every component
core.js      pure logic: dates, weeks, report aggregation, markdown, migration, merge
app.js       the app: rendering, drag, editor, projects, report, sync
qr.js        vendored QR encoder (MIT, Project Nayuki), loaded only by the sync sheet
cli/         the headless client: same relay, same merge, no browser
relay/       the sync relay: one Cloudflare Worker, deploy your own with `wrangler deploy`
```

## License

[MIT](LICENSE)
