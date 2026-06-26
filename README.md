# showcase

**A live visual surface for terminal coding agents.**

Your coding agent works in a wall of text. showcase gives it a screen: it
publishes **surfaces** — multi-part cards combining mermaid diagrams, rendered
markdown, syntax-highlighted diffs, charts, terminal output, JSON trees, images,
and sandboxed interactive HTML — that render live in your browser while it works.
You watch, drop a comment or pin a note to a spot on any card, and that feedback
flows straight back to the agent. That two-way loop — **publish → live render →
comment → revise** — is the whole point. No GitHub thread or terminal scrollback
does this.

Forked from [sideshow](https://github.com/modem-dev/sideshow) (MIT) and stripped
to the local-only engine: a Hono server, a React viewer, an MCP server, and a
zero-dependency CLI.

---

## What it's for

Two flagship workflows:

### 🔍 Visual PR review

_"The future of code review is multimodal."_ Run `showcase review <branch>` and
your agent reviews it and publishes one **finding card** per issue via the
`review_finding` tool — each a severity **badge** (Bug / Nit /
Question / Praise), a plain-English explanation, the **diff inline**, and an
optional **mermaid diagram** of the relevant flow. You read, push back in the
thread, approve or dismiss to burn down a live verdict bar, and the agent revises
the fix in place. Far faster than a wall of inline comments.

**showcase doesn't review — it renders.** The analysis is delegated to the
agent's own **`code-review` skill** (a generic, showcase-agnostic review skill);
showcase only takes the findings and formats them into finding cards + a verdict.
The contract is the skill _name_: `showcase review` tells the agent to run its
`code-review` skill, so anyone using showcase either has that skill or drops their
own in under that name. The dependency is one-way — showcase knows about
`code-review`, `code-review` knows nothing about showcase — so the reviewer stays
reusable outside showcase, and showcase stays usable with any reviewer. A
`code-review` skill can in turn dispatch to language-specific hygiene skills
(e.g. Java, TypeScript) without showcase ever knowing the difference.

**Make it _your_ reviewer:** drop a `~/.showcase/review.md` (or point
`$SHOWCASE_REVIEW_PROFILE` at one) holding your standing review conventions and
any extra skills to load — `showcase review` folds it into every review prompt on
top of the `code-review` handoff, so the agent applies your standards each time.

### 📚 Understand & explain code

Ask the agent to map an architecture, trace a data flow, or explain a gnarly
module, and _see_ it — diagram + prose + the real source — instead of reading a
paragraph. Ideal for onboarding to an unfamiliar codebase or making sense of your
own large branch before it ships.

**Plus the everyday uses:** visualize data (native charts), render math (KaTeX),
sketch UI ideas (sandboxed HTML), or compose a walk-through deck with the
`slides` kit.

---

## Quickstart

**Requirements:** Node ≥ 22.18 (the server and CLI run TypeScript directly via
native type-stripping — no build step).

```sh
npm install
npm run build:viewer     # builds viewer/dist/index.html (once, and after viewer edits)
npm run serve            # API + viewer on http://localhost:8229
```

1. Open **http://localhost:8229**.
2. Seed example sessions to look around: `node bin/showcase.js demo`.
3. List the CLI: `node bin/showcase.js --help`.

> Tip: install the CLI globally with `npm link` so `showcase` is on your PATH;
> the examples below assume that. Otherwise use `node bin/showcase.js …`.

---

## Use it from your agent (MCP)

Cursor and Claude Code talk to showcase over **MCP** — a stdio server
(`mcp/server.ts`) that proxies the local HTTP API. Keep `npm run serve` running,
then register the server once.

**Claude Code:**

```sh
claude mcp add showcase \
  --env SHOWCASE_URL=http://localhost:8229 \
  --env SHOWCASE_AGENT=claude-code \
  -- node /ABSOLUTE/PATH/TO/showcase/mcp/server.ts
```

**Cursor** — add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "showcase": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/showcase/mcp/server.ts"],
      "env": { "SHOWCASE_URL": "http://localhost:8229", "SHOWCASE_AGENT": "cursor" }
    }
  }
}
```

Restart the editor after changing MCP config. The agent's tools: `publish_surface`,
`update_surface`, `wait_for_feedback`, `reply_to_user`, `list_surfaces`,
`upload_asset`, `get_design_guide`.

Then just ask in plain language:

- _"Diagram this auth flow on showcase."_
- _"Review this branch against main and publish a visual review to showcase."_

A good PR-review prompt to paste:

```text
Review this branch against main and publish a visual review to showcase.
Run your code-review skill to do the analysis, then render its findings:
call get_design_guide first, then ONE publish_review call — a verdict card plus
one card per finding (severity badge, explanation, the diff, optional diagram).
Then wait_for_feedback and revise cards in place as I comment.
```

Shell-only agents can skip MCP entirely and drive showcase with the CLI or curl —
see `guide/AGENT_SETUP.md` (served live at `/setup`).

---

## From the shell (CLI)

Session grouping is automatic; every command takes `--title` and `--session-title`.

```sh
showcase mermaid flow.mmd --title "Request flow"
showcase markdown notes.md --title "Design notes"
showcase diff change.patch --title "Add retry" --layout split
showcase publish sketch.html --diff change.patch --title "Retry flow"   # combined [html, diff]
showcase chart latency.json --title "p99 latency"                       # native SVG chart
showcase code src/cache.ts --title "Cache layer" --language ts
echo '<p>hi</p>' | showcase publish - --title "Quick note"

showcase wait --session <id> --timeout 600     # block until the user comments
showcase comment "Updated, take a look" --surface <id>
```

`showcase --help` lists every command (`publish`, `diff`, `markdown`, `mermaid`,
`code`, `chart`, `json`, `terminal`, `image`, `trace`, `update`, `wait`, `watch`,
`comment`, `demo`, `kits`, …).

---

## Surfaces (part kinds)

A surface is an ordered list of **parts**. Combine them freely — a review finding
card is `[markdown, mermaid, diff]`.

| kind       | renders                                                               |
| ---------- | --------------------------------------------------------------------- |
| `html`     | sandboxed interactive markup — diagrams, UI sketches, data viz        |
| `markdown` | prose, tables, fenced code, LaTeX math (`$inline$`, `$$display$$`)    |
| `mermaid`  | flowchart / sequence / ERD / gantt → SVG                              |
| `diff`     | unified or git patch — syntax-highlighted, file headers, line folding |
| `code`     | a source file, shiki-highlighted                                      |
| `chart`    | native SVG chart — bar / line / area / pie                            |
| `terminal` | monospace output with ANSI colors                                     |
| `json`     | a collapsible JSON tree                                               |
| `image`    | an uploaded image                                                     |
| `trace`    | an agent step timeline                                                |

A surface can also carry a **badge** (`{tone, label}`) — the colored severity chip
review finding cards lead with.

**Security model:** agent-authored HTML only ever renders inside sandboxed,
opaque-origin iframes — never in the trusted viewer origin. Everything else is
rendered as data via React text nodes. See `CLAUDE.md` for the full invariant.

---

## How feedback reaches the agent

The server never pushes into your editor — the agent **pulls**. A comment you type
is stored on the surface and reaches the agent the next time it touches showcase,
three ways:

1. **Piggyback** — the next `publish`/`update`/`reply` response carries new comments.
2. **Blocking wait** — `wait_for_feedback` / `showcase wait` long-polls for comments.
3. **Background watch** — `showcase watch` streams them one per line.

While the agent is parked in a wait, the viewer shows a live **"Listening"** badge,
so you can tell it's actually reachable. Delivery is exactly-once across all
channels.

---

## Project layout

| Path               | What                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `server/`          | Runtime-agnostic Hono app: routes, SSE, the surface/comment model, sandboxed rendering. `server/storage.ts` is the local JSON-file store. |
| `viewer/`          | React 19 + zustand + Tailwind viewer, Vite-built to a single `viewer/dist/index.html`.                                                    |
| `mcp/`             | stdio MCP server — a thin client over the HTTP API.                                                                                       |
| `bin/showcase.js`  | Zero-dependency CLI (Node built-ins only).                                                                                                |
| `guide/`           | The instructions agents fetch at runtime (`/setup`, `/guide`, `/playbook`).                                                               |
| `skills/showcase/` | The Claude Code skill.                                                                                                                    |

---

## Develop

```sh
npm run dev          # server + viewer watch build, with live reload
npm test             # node --test (unit/API + store contract)
npm run typecheck    # node + viewer tsc programs
npm run lint         # oxlint (warnings are errors)
npm run test:e2e     # Playwright (publish → render → comment oracle)
```

The full developer guide and roadmap live in `CLAUDE.md` and `TODO.md`.

---

## License

[MIT](LICENSE) — inherits sideshow's license.
