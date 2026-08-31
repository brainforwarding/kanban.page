# kanban.page

A personal kanban that keeps your work organised by stage and by project.
Free, works offline, no account. The board lives in your browser — there is no
server to send it to.

**[Open the board →](https://kanban.page/)**

![the board](docs/shots/board.png)

## What's different

**Every card can hold an agent session.** If you run Claude Code or Codex in a
terminal, keep the resume command on the card (`claude --resume …`, `codex
resume …`). Click it and it's on your clipboard; copy one from a terminal and
`⌘V` on the board starts a card with that session attached.

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

**Your agent can change the board itself.** ~4,000 lines of vanilla HTML/CSS/JS,
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

- **Your phone too, with no account.** **⋯ → Sync devices** shows a QR code;
  scan it and that device has the same board, updating live as you work. There
  is no sign-up and no password: the link *is* the key, so anyone you give it
  to can read and edit the board — and the server only ever holds bytes it
  cannot decrypt. Sync is off until you turn it on, and every synced device
  still keeps a complete local copy. See [docs/sync.md](docs/sync.md).
- **Move a board with `⋯ → Export backup`**, then `Import backup`. Worth doing
  occasionally regardless: a cleared browser is a cleared board.
- **Nothing is one click from gone.** The board archives; only the archive
  deletes, behind a two-step confirm.
- **Several boards:** open with `?ns=<name>` and you get a separate one with its
  own storage. Handy as a scratch board.
- **Install it:** visit once online, then use your browser's install menu. It
  opens offline after that, and offers **Update** when a new version ships —
  which changes the app files, never your cards.

## Develop

```bash
node --test tests/core.test.js     # 93 unit tests, no dependencies
```

They cover what is easy to get silently wrong: calendar dates across DST,
Monday–Sunday boundaries across month and year ends, report aggregation,
markdown output, storage migration, and the sync merge — clocks, tombstones,
and three replicas converging. Then open `tests/dom.test.html` in Chrome for
36 interaction tests — they drive the real app in an iframe and report
pass/fail in the page title, against a `?ns=test` board that never touches
your data.

```
index.html   markup
styles.css   design tokens + every component
core.js      pure logic: dates, weeks, report aggregation, markdown, migration, merge
app.js       the app: rendering, drag, editor, projects, report, sync
qr.js        vendored QR encoder (MIT, Project Nayuki), loaded only by the sync sheet
relay/       the sync relay: one Cloudflare Worker, deploy your own with `wrangler deploy`
```

## License

[MIT](LICENSE)
