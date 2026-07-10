---
name: sync-commands
description: Sync showcase's slash commands (the commands/showcase-*.md files) into an editor's commands directory - Claude Code or Cursor by default, or any custom directory the user names. Use when asked to "sync the showcase commands", install the /showcase-* commands, or get the commands working outside the plugin. Do NOT use for installing skills (that is the plugin marketplace or the skills CLI), or for authoring new commands.
---

# sync-commands

Copy the `showcase-*.md` command files into a commands directory the user's
editor reads, so `/showcase-review`, `/showcase-explain`, `/showcase-teach`,
`/showcase-last`, and `/showcase-watch` work without the Claude Code plugin
(or in tools that have no plugin marketplace, like Cursor).

## Steps

1. **Locate the source files.** First match wins:
   - `commands/showcase-*.md` in the current repo (a showcase checkout), or
     next to this skill at `../../commands/` if the whole repo was copied.
   - Otherwise fetch each file from
     `https://raw.githubusercontent.com/Littletonconnor/showcase/main/commands/`
     (the five names above, plus any other `showcase-*.md` listed in the repo's
     `commands/` directory).

2. **Ask where to sync.** Skip the question only if the user already named a
   destination. Offer, in this order:
   - **Claude Code**: `~/.claude/commands/` (personal, every project), or
     `.claude/commands/` in the current repo (this project only).
   - **Cursor**: `~/.cursor/commands/` (personal), or `.cursor/commands/`
     in the current repo (this project only).
   - **Custom directory**: any path the user gives, used verbatim.

3. **Copy.** Create the destination directory if needed, then copy every
   source file, keeping the `showcase-` prefixed filenames. Overwrite existing
   `showcase-*.md` files (the prefix marks them as owned by this sync; that is
   what makes re-running an update). Never touch other files in the directory.

4. **Report.** List each synced command with its one-line description and the
   destination path. Note that re-running the skill re-syncs after a showcase
   update, and that the commands expect a running showcase server (default
   `http://localhost:8229`) with its MCP tools connected.

## Notes

- The files are plain markdown with YAML frontmatter. Claude Code reads the
  `description` / `argument-hint` frontmatter; Cursor ignores frontmatter it
  does not know, harmlessly. Copy the files as-is, no rewriting.
- This skill never deletes: to uninstall, tell the user to remove the
  `showcase-*.md` files from the destination directory.
- No showcase server is needed to sync (only to run the commands afterwards);
  offline with no local checkout is the one case that fails, so say so and
  stop rather than inventing command text.
