# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal kanban board that runs from a file: open `index.html` in Chrome. Vanilla HTML/CSS/JS — no build step, no dependencies, no framework, no network. All state lives in `localStorage` (`board.v2`, or `board.v2.<ns>` when opened with `?ns=<name>` — use a namespace for a scratch board that never touches real data).

## Commands

```bash
node --test tests/core.test.js                              # unit tests, no deps
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

Four files, strict split:

- `core.js` — pure logic, zero DOM: dates/weeks, report aggregation, markdown export, event log, storage migration. Exposed as the `BoardCore` global and via CommonJS for the node tests. New logic with edge cases belongs here, where it's unit-testable.
- `app.js` — everything else: rendering, drag, editor, composer, projects, report modal. Classic script (no modules); top-level function declarations are deliberately global — the DOM tests call them (`openReport`, `addTask`, …) plus the `window.__board` seam for state.
- `styles.css` — design tokens at the top (light + dark via `[data-theme]`), then every component.
- `index.html` — static markup shells; `app.js` fills them.

`docs/design-brief.md` is the original spec and still explains intent (data model rationale, motion spec, type/voice rules); where it conflicts with README.md, the README is current — e.g. the exported markdown no longer matches the brief's sample (see below).

### The event log is the source of truth for reports

`state.events` is append-only. Events snapshot **stage names and titles as strings** at event time, so renaming or deleting a stage can never corrupt history; the report prefers a task's *live* title when it still exists and falls back to the snapshot when deleted. `at` (epoch ms) orders within a day only; `day` (`YYYY-MM-DD` in **America/Santiago**) is what reports group by, and date overrides rewrite `day`, never `at`.

**Never compute dates from epoch arithmetic.** Chile has DST; every date decision goes through calendar-date helpers in `core.js` (`ymd`, `mondayOf`, `addDays`). Weeks run Monday–Sunday in America/Santiago.

### Report vs. export — two different views

The report modal shows every card created or moved that week, with routes and per-row ticks. The exported markdown (`toMarkdown`) is narrower by design: only ticked cards that ended in the done stage (last column), grouped by project in `state.projects` order, title only — no summary counts, no stage routes, and unassigned cards stay out. Project order is user-draggable in the Projects panel and drives the filter chips, the report grouping, and the export.

### Rendering model and its one big gotcha

`render()` rebuilds the whole board with `board.innerHTML = ''` (wrapped in `flip()` so cards animate rect-to-rect; `flip()` also preserves per-column scroll). Consequence: Chrome fires `blur` on a focused element **mid-teardown while it still reads as connected** — any commit-on-blur logic must defer a tick and re-check `isConnected` (see the composer in `composerEl`). `save()` is debounced 120ms — tests sleep ~200ms before asserting on `localStorage`.

### Safety properties to preserve

- **The board archives; only the archive deletes.** Nothing on the board is one click from gone; the single irreversible action lives in the archive behind a two-step confirm.
- **Closing the quick composer = saving.** `closeComposer()` commits any typed text as a card; only Esc (`{ discard: true }`) throws a draft away.
- **Damaged boards keep their event log** — the log is the only copy of the history (see migration tests).

### Drag pattern (cards, stages, and project rows share it)

### Design voice

Monospace means "the machine said this" (stage names, counts, session commands, dates); Avenir Next is the human voice (titles, notes). One accent — amber `#FFB454`. Project colors are the only other chroma. Match existing motion timings and easing (`EASE`, `var(--ease)`) rather than inventing new ones.

### Test conventions

DOM tests must be date-stable: `openReport()` opens *last* week on Mondays, so report tests go through the `openThisWeek()` helper in `dom.test.html`. Unit tests pin exact markdown output — update them deliberately when the export format changes, and check the README's format description at the same time.
