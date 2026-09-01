# Editing a kanban.page board

This project's kanban board is reachable from the terminal with the `kanban`
command. Use it instead of opening a browser.

Check it is set up before relying on it:

```bash
kanban board ls        # lists configured boards; the default is marked *
```

If that prints `no boards configured`, stop and ask the person to run
`kanban board add <name>` with their sync link. **Never ask them to paste the
sync link into a chat, and never put it in a command argument** — it is the
whole capability to their board, like a password, and it belongs in a pipe:
`pbpaste | kanban board add work`.

## Reading

```bash
kanban ls                          # the whole board, by stage
kanban ls --stage Doing            # one stage
kanban ls --project Sales          # one project
kanban ls --all                    # include archived cards
kanban show 4f2a                   # one card, with its notes
kanban report                      # this week's moves
kanban report --md                 # the same as markdown, ready to paste
kanban report --week 2026-08-24    # an earlier week (must be a Monday)
```

Add `--json` to any command to get one object on stdout instead of prose.

## Writing

```bash
kanban add "title" --project Sales --notes "..." --stage Inbox --flag
kanban mv 4f2a Doing
kanban done 4f2a
kanban edit 4f2a --title "..." --notes "..." --project Sales --no-flag
kanban archive 4f2a
kanban restore 4f2a
```

Card ids take any unambiguous prefix of 4+ characters. An ambiguous prefix
fails and lists the matches — it never guesses.

## Rules that matter

**Confirm before the first write of a session.** A write reaches every device
the person has open in about a second. Every mutating command prints the board
it fetched first:

```
work · INBOX 27 / DOING 18 / DONE 63 · ver 412
```

Use `--dry-run` to see that line and the intended change without writing.

**Stages and projects are never created.** `--project Sales` matches an
existing project by name; a typo is an error, not a new project. Run
`kanban ls` to see the real names. Duplicate names are legal, so an ambiguous
name fails with the ids — pass `--project-id` or `--stage-id` then.

**`done` means the last stage, whatever it is called.** Don't look for a stage
named "Done".

**There is no delete.** `archive` is the strongest thing available. Permanent
deletion, turning sync on, and ending sync all happen in the app, by a person.

**Don't rerun a command whose outcome you don't know.** If one exits with
`outcome-unknown`, the write may already have landed — run `kanban ls` and look
before doing anything else. Re-running blindly can add the same card twice.

## Exit codes

`0` success or no-op · `2` usage · `3` credential/config · `4` not found ·
`5` sync ended · `6` contention · `7` outcome unknown · `8` transport ·
`9` protocol. With `--json`, `error.code` carries the detail.
