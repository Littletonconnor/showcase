# showcase

Publish live visual surfaces (diagrams, UI sketches, dashboards, explainers,
code reviews) from your terminal agent to a local browser board, and get the
user's comments back.

## What it does

- Bootstraps the agent onto a running showcase server: it fetches the server's
  live playbook and design guide, so instructions always match the installed
  version instead of a stale copy.
- Covers the publish -> live render -> comment -> revise loop: multi-part
  surfaces (html, markdown, mermaid, diff, code, chart, image, terminal,
  json, trace), typed preset tools, and the exactly-once feedback channel.

## When to use it

- The user asks you to illustrate, visualize, sketch, diagram, or demo
  something.
- A code review the user will adjudicate visually (`publish_decisions`).
- Any time a visual would carry the explanation better than terminal text and
  the user has a showcase board.

## When to skip it

- No showcase server is running or installed, and the user has not asked for
  one. Answer in the terminal.
- Plain-text answers, quick lookups, or work with no visual component.
- Artifacts meant to be committed (docs, READMEs); showcase surfaces are a
  live working view, not files.

## What you get

A session in the browser at `localhost:8229`: cards that render as you
publish, update in place as you revise, and a reply line whose comments reach
the agent exactly once.

## Install

```sh
npx skills@latest add Littletonconnor/showcase --skill showcase
```

or `/plugin marketplace add Littletonconnor/showcase` in Claude Code.

## Dependencies

Expects the showcase server (`showcase serve`, default
`http://localhost:8229`) and, for the tool-call path, its MCP server. Without
a reachable server this skill has nothing to draw on; skip it.
