# kanban.html

A personal kanban with no build step, account, or backend. Use it at the hosted
URL (installable and offline-capable after the first visit), or download it and
open `index.html` in your browser.

![the board](docs/shots/board.png)

It looks and moves like a polished app because the details are tuned by hand: cards lift and tilt when you drag them and the others step aside to make room, typing a card and clicking away just saves it, everything has an undo, and dark mode is a keystroke away. Vanilla HTML/CSS/JS, ~3,500 lines, zero dependencies.

![dark mode](docs/shots/dark.png)

## Use it your way

- **Use the web app:** [brainforwarding.github.io/kanban.html](https://brainforwarding.github.io/kanban.html/)
  is the canonical version. Visit it once online; you can then install it from
  your browser and use it offline. It offers **Update** (or **Actualizar** in
  Spanish) when a new version is ready.
- **Run it locally:** clone or download this repository, then open
  `index.html`. This remains fully private and offline, but you update it by
  downloading newer files yourself.
- **Make it yours:** [fork the repository](https://github.com/brainforwarding/kanban.html/fork)
  on GitHub, change it however you like, and optionally publish your own fork
  with GitHub Pages.

## Run locally in 30 seconds

```bash
git clone https://github.com/brainforwarding/kanban.html.git   # or Code → Download ZIP
open kanban.html/index.html                                    # macOS — or just double-click it
```

That's it. The board lives in that browser's `localStorage`; nothing ever leaves your machine.

## Web app, offline use, and updates

The canonical web app is the URL above. Visit it once online, then install it
from your browser's app/install menu if you like. It will open offline after
that first visit. When a new version is published, the running app offers
**Update** / **Actualizar**. Your cards remain in your browser — an update changes the app
files, not your board data. The downloadable `file://` version remains
supported, but cannot update itself; download a newer release to update it.

Moving from a downloaded board to the web app is a one-time manual move:
**Export backup** in the downloaded board, then **Import backup** on the web.

## Make it feel like an app

The board is happiest as its own window, pinned to your dock or taskbar:

- **Chrome / Edge**: open the board, then **⋮ → Cast, save and share → Create shortcut…** (on some versions: *More tools → Create shortcut*), tick **Open as window**. You get a chromeless window and a dock icon.
- Or launch it that way directly: `open -na "Google Chrome" --args --app="file:///path/to/board/index.html"` (macOS) / `chrome --app=file:///path/to/board/index.html` (Linux/Windows).
- Or make it your morning start page: browser settings → *On startup* → open the board's URL.

## What it does

- **Capture fast.** Click `+` on any stage (or press `N`) and type. Enter files the card and keeps the field open for the next thought; clicking anywhere else saves what you typed — words are never silently lost. Esc is the only way to throw a draft away.
- **Drag that feels physical.** Cards lift with a shadow and a tilt that follows your hand; neighbours animate out of the way; the drop flies into place. Respects reduced-motion.
- **Projects with color.** Filter chips across the top, a color-coded edge on every card. Drag projects to reorder them — that order carries into the report, the export, and **⋯ → Sort by project**, which tidies every column into it: stable within a project, unassigned cards last, one Undo away.
- **Flag what matters.** Hover a card and star it (or press `F` on a focused card). While anything is flagged, a ★ chip beside **All** counts them — a category of its own: press it and the board shows just the flagged cards, across all projects. Flags are planning state, not history — they never touch the weekly report or the age stamp.
- **Two densities.** **⋯ → Compact cards** (or `D`) fits more of the board on screen: tighter padding and type, notes clamp to one line, and columns stretch to use the whole window — long titles stop wrapping, so cards get shorter. On a crowded board columns narrow instead. Every card glides to its new place; the choice is remembered.
- **A weekly report your team can actually read.** One key (`R`) shows everything created or moved that week, Monday to Sunday, split into what you shipped and what is still in flight. Finished work arrives ticked; tick anything else you want to mention. The export is exactly what is ticked — clean Markdown, title only.
- **Made for terminal-agent workflows.** Every card can hold the resume command your coding agent printed (`claude --resume …`, `codex resume …`). Click it on the card and it's on your clipboard; copy one from a terminal and **paste it onto the board** to start a card with the session attached.
- **Nothing is one click from gone.** The board archives; only the archive deletes, behind a two-step confirm. Deleting a project or clearing cards never damages past weekly reports.

![weekly report](docs/shots/report.png)

## The weekly report

`R` opens the week — every card **created** or **moved to another stage**, grouped by project, with the route it took and an editable day stamp (move a row to another day and it hops to that week's report). Untick anything; the export is whatever is ticked.

The exported Markdown is deliberately narrower than the view: title only, no routes, no counts. It is grouped by **tense** — did the card end the week in the last stage, or not — with the project as a suffix, in your project order:

```markdown
# Progress — 10–16 Aug 2026

## Shipped
- Onboarding tour v2 · Website
- Rate limiting for the public API · API

## In flight
- Invoice PDF export · API
```

Finished work under a project arrives ticked, so the default export is exactly what it has always been: what you shipped. Everything else that moved is listed underneath, unticked — tick it and it joins the file under **In flight**. A section with nothing ticked prints no heading, so a quiet week never files an empty one. The count in the footer is always what the file will contain.

Which stage counts as "done" is **position, not a name**: the rightmost one. That is why stages can be dragged — put a new stage where it belongs rather than renaming stages to fake a position.

Weeks run Monday–Sunday. On Monday morning the report opens on the week that just ended, ready to send.

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
| `⌘V` | paste a resume command as a new card |
| `Esc` | close whatever is open |
| `F` | flag / unflag the focused card |
| `⌥` + arrows | move the focused card between stages or up and down |

Stage names are editable in place — click one and type. Stages can be added and removed; a stage can only be deleted once it's empty. Drag a stage by its header (or the grip that appears on hover) to move it. Order matters: the **rightmost stage is the done stage**, which is what the weekly report counts as finished — so put a new stage where it belongs rather than renaming stages to fake a position.

## Scope, honestly

This is a **single-person, single-browser** tool by design. State lives in `localStorage` on one machine — that's what makes it install-free and instant. It is not optimized for phones, and there's no sync or team sharing. Those are natural ways to extend it (a mobile layout, an optional sync backend, shared boards) and PRs are welcome — but the core promise stays: open a file, get a board.

Practical notes:

- **Back up occasionally.** `⋯ → Export backup` writes the whole board as JSON; `Import backup` restores it. A cleared browser is a cleared board.
- **Multiple boards:** open with `?ns=<name>` (e.g. `index.html?ns=writing`) and you get a separate board with its own storage. Also handy as a scratch board.

## Tests

```bash
node --test tests/core.test.js     # 65 unit tests, no dependencies
```

They cover the parts that are easy to get silently wrong: calendar dates across DST, Monday–Sunday week boundaries across month and year ends, report aggregation, markdown output, re-dating guards, and storage migration.

Then open `tests/dom.test.html` in Chrome for 29 interaction tests — they drive the real app in an iframe (drag a card, chain the composer, generate a report, undo) and report pass/fail in the page title, against a `?ns=test` board that never touches your data.

## Files

```
index.html   markup
styles.css   design tokens + every component
core.js      pure logic: dates, weeks, report aggregation, markdown, storage migration
app.js       the app: rendering, drag, editor, projects, report
```

## License

[MIT](LICENSE)
