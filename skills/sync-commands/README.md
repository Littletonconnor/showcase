# sync-commands

Copy showcase's `/showcase-*` slash commands into Claude Code's or Cursor's
commands directory (or any custom one), so the one-verb loops work without the
plugin marketplace.

## What it does

- Finds the `commands/showcase-*.md` files (local checkout first, GitHub
  otherwise) and copies them into a commands directory of your choice.
- Asks where to sync: Claude Code (`~/.claude/commands/` or the project's
  `.claude/commands/`), Cursor (`~/.cursor/commands/` or `.cursor/commands/`),
  or a custom directory you name.
- Overwrites only `showcase-*.md` files, so re-running it is how you pick up
  command updates; nothing else in the directory is touched.

## When to use it

- "Sync the showcase commands" / "install /showcase-review in Cursor".
- You use Cursor (or another tool without a plugin marketplace) and want the
  same one-verb commands the Claude Code plugin ships.
- You want the commands in a project's checked-in `.claude/commands/` so
  teammates get them from the clone.

## When to skip it

- You already installed the Claude Code plugin
  (`/plugin marketplace add Littletonconnor/showcase`); the plugin manages the
  same commands and keeps them updated.
- You want the skills, not the commands: use the plugin, or
  `npx skills@latest add Littletonconnor/showcase --skill <name>`.
- You are authoring a new command (edit `commands/` in the repo instead).

## What you get

The `showcase-*.md` command files in your chosen directory, so
`/showcase-review`, `/showcase-explain`, `/showcase-teach`, `/showcase-last`,
and `/showcase-watch` appear in that tool's slash-command list, prefixed so
they cannot clash with your other commands.

## Install

```sh
npx skills@latest add Littletonconnor/showcase --skill sync-commands
```

or `/plugin marketplace add Littletonconnor/showcase` in Claude Code.

## Dependencies

None to sync: it copies markdown files (from a local checkout, or GitHub when
there is none). The commands themselves expect a running showcase server
(default `http://localhost:8229`) with its MCP tools connected when you invoke
them.
