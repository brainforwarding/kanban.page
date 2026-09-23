---
name: kanban
description: Log and track work on the user's kanban.page board with the `kanban` CLI. Use when the user asks to add, register, move, finish, or find a task/card, asks what's on their board or what they're working on, or wants this session's work tracked. Always looks for the card already tied to the current Claude session before creating one.
---

# kanban.page board

The user's board is reachable from the terminal with `kanban` (npm package
`kanban.page`, 1.1.1 or later). Use it instead of opening a browser.

## Setup

Check before relying on it:

```bash
kanban board ls        # configured boards; the default is marked *
```

- `command not found`: ask the user to run `npm i -g kanban.page`.
- `no boards configured`: ask the user to turn on sync in the app
  (**⋯ → Sync devices**), copy the sync link, and run
  `pbpaste | kanban board add work`. **Never ask for the sync link in chat and
  never put it in an argument** — it is the whole capability to the board,
  like a password.

Use the default board unless the user says otherwise. If they keep several,
their `CLAUDE.md` may name the one to use — then pass `--board <name>` on
every command. Never add, replace, or switch boards yourself.

## This session's card

Every card made from a Claude session carries a session line that reopens that
session in the right folder:

```
cd /absolute/path/to/project && claude --resume <session-id>
```

The session id is `$CLAUDE_CODE_SESSION_ID`; the folder is the session's
working directory. Quote the path if it contains spaces. Use the absolute
path, never `~`.

**Before creating a card, look for the one already tied to this session:**

```bash
kanban ls --json | python3 -c '
import json, os, sys
sid = os.environ["CLAUDE_CODE_SESSION_ID"]
for t in json.load(sys.stdin)["tasks"]:
    if sid in t.get("session", ""):
        print(t["id"][:6], t["stage"], "·", t["title"], "·", t["project"] or "-")'
```

- **Found one:** update it (`kanban edit`, `kanban mv`, `kanban done`) instead
  of adding a duplicate. If the work has drifted into something clearly
  separate, ask whether it deserves its own card.
- **Found none:** create it with the session line:

  ```bash
  kanban add "title" --project "<existing project>" \
    --session "cd $PWD && claude --resume $CLAUDE_CODE_SESSION_ID"
  ```

The CLI also records the computer and folder beside the session. If it can't
tell which computer this is, suggest the user run
`kanban here "<computer name>"` once on this machine.

## Writing the title and note

The card is for the user, not for an agent: it should tell them at a glance
what got done in the session. Technical detail — commands, flags, file paths,
version internals — stays in the conversation, which the session line reopens.

- **Title:** a few words in plain language saying what was done or needs doing,
  the way the user would say it to a colleague. No commands, paths, or jargon.
  Good: "Publish the new CLI and teach Claude to use the board".
  Bad: "publish kanban.page 1.1.0 + 1.1.1 to npm, add kanban skill".
- **Note:** optional, one or two short sentences in simple everyday language —
  what changed for the user, or what's left. Leave it empty rather than pad it.
  Good: "Claude now finds this session's card before making a new one."
  Bad: "ls --json includes each card's session. Skill at ~/.claude/skills/…".
- Write both in the language the user is speaking in the session.
- When updating an existing card as the work grows, rewrite the title and note
  to describe the whole session so far; don't append a changelog.

## Choosing the project

- Pick from the projects that already exist (`kanban ls` shows them as
  `· Project` suffixes). **Projects are never created** — an unknown name is
  an error. If unsure which fits, ask; offer the two or three likeliest.
- Finished work goes straight to done: `kanban add …` then `kanban done <id>`.

## Commands

```bash
kanban ls                          # whole board by stage
kanban ls --stage Doing            # one stage
kanban ls --project Sales          # one project
kanban show <id>                   # one card, with notes and session
kanban report                      # this week's moves (--md to paste)

kanban add "title" --project P --notes "..." --stage Inbox --flag
kanban mv <id> Doing
kanban done <id>                   # the LAST stage, whatever it's named
kanban edit <id> --title "..." --notes "..." --session "..."
kanban archive <id>                # strongest action; there is no delete
```

Ids take any unambiguous prefix of 4+ characters. Add `--json` for machine
output, `--dry-run` to preview a write.

## Rules

- **Confirm the first write of a session** unless the user already asked for
  it explicitly. Writes reach every open device in about a second.
- **Never rerun a command whose outcome is unknown** (exit 7,
  `outcome-unknown`): run `kanban ls` and look first, or you may add the same
  card twice.
- Stages are never created or reordered; permanent deletion and sync settings
  happen in the app, by the user.
- Exit codes: `0` ok · `2` usage · `3` config · `4` not found · `5` sync ended ·
  `6` contention · `7` outcome unknown · `8` transport · `9` protocol.
