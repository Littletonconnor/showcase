# showcase

**A live visual surface for my terminal coding agents.**

My agent works in a wall of text; showcase gives it a screen. It publishes
**surfaces** — mermaid diagrams, rendered markdown, syntax-highlighted diffs,
terminal output, JSON trees, images, and sandboxed interactive HTML — that render
live in the browser while it works. I watch, type a comment under any card, and
that comment flows back to the agent. That two-way loop (publish → live render →
comment → revise/reply) is the point.

Forked from [sideshow](https://github.com/modem-dev/sideshow) (MIT), stripped to
the local-only engine I actually use: the Hono server, the Solid viewer, the MCP
server, and the zero-dependency CLI. Cloudflare Workers, the TUI sibling, the Pi
extension, and the embeddable build were removed.

## What it's for

- **Understand a system** — ask the agent to diagram an architecture or trace a
  flow, and see it instead of reading a paragraph.
- **Work with LLMs** — the comment thread is a tight feedback loop on whatever the
  agent is showing.
- **Slideshows for coworkers** — compose markdown + html parts (the `slides` kit)
  into something you can walk through.

## Requirements

Node ≥ 22.18 (uses native TypeScript type-stripping — no build step for the
server/CLI). My nvm default is older, so commands below pin the v24 binary.

## Run it

```sh
npm install
npm run build:viewer          # builds viewer/dist/index.html (needed once, and after viewer edits)
npm run serve                 # API + viewer on http://localhost:8229
```

Open http://localhost:8229. `node bin/showcase.js demo` seeds example sessions to
look around. `node bin/showcase.js --help` lists the CLI.

## Use it from your agent

Both Cursor and Claude Code talk to showcase over **MCP** (a stdio server that
proxies the local HTTP API). Keep `npm run serve` running, then:

- **Claude Code** — registered at user scope as the `showcase` MCP server
  (`claude mcp list`).
- **Cursor** — registered globally in `~/.cursor/mcp.json` as `showcase`.

Then just ask: _"sketch this on showcase"_ / _"diagram this flow on showcase"_ and
watch the card appear. The agent's tools: `publish_surface`, `update_surface`,
`wait_for_feedback`, `reply_to_user`, `list_surfaces`, `upload_asset`,
`get_design_guide`.

Shell-only agents can skip MCP entirely and use the CLI or curl — see
`guide/AGENT_SETUP.md` (served at `/setup`).

## Layout

- `server/` — runtime-agnostic Hono app: routes, SSE, the surface/comment model,
  sandboxed rendering. `server/storage.ts` is the local JSON-file store.
- `viewer/` — Solid + Vite viewer, built to a single `viewer/dist/index.html`.
- `mcp/` — stdio MCP server, a thin client over the HTTP API.
- `bin/showcase.js` — zero-dependency CLI.
- `guide/` — the instructions agents fetch at runtime.
- `skills/showcase/` — the Claude Code skill.

## Develop

```sh
npm run dev          # server + viewer watch build
npm test             # node --test (unit/API + store contract)
npm run typecheck    # node + viewer tsc programs
npm run lint         # oxlint
```

## License

[MIT](LICENSE) — inherits sideshow's license.
