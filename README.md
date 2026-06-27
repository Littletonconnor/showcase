# showcase

**A visual surface for terminal coding agents — built for the two moments an
LLM's output is hardest to trust: reviewing the code it wrote, and understanding
what it's explaining.**

An agent produces a diff, or a dense explanation, faster than you can vet it in a
terminal scrollback — and the hard part isn't generating the output, it's
_understanding_ it well enough to trust it. showcase gives the agent a **screen**.
Its output arrives as live, reviewable **cards** — a syntax-highlighted diff, a
diagram, prose, a chart — that render in your browser as it works. You read,
comment on a card, or pin a note to an exact spot, and that feedback flows
straight back to the agent. The loop — **publish → live render → comment →
revise** — is the whole point. No GitHub thread or terminal scrollback does this.

![A PR-review verdict card on the showcase surface: a risk band over size/surface/sensitivity/tests, a risk-weighted file manifest, and a findings summary table](docs/images/pr-review.png)

A self-contained local-only engine: a Hono server, a React viewer, an MCP
server, and a zero-dependency CLI. It runs entirely on your machine.

> **See it in 30 seconds:** `npm install && npm run build:viewer && npm run serve`,
> then `node bin/showcase.js demo` and open <http://localhost:8229>. Every
> screenshot in this README is a real `showcase demo` session.

---

## What it's for

Two flagship workflows for making an agent's output legible — plus a third for
deciding before you build.

### 🔍 Review the code it wrote

_"The future of code review is multimodal."_ When an agent (or a human) hands you
a branch, run `showcase review <branch>`. The agent reviews it and publishes a
**verdict card** — a risk read over four signals, a priority-ranked file manifest
(sensitive first, mechanical collapsed away), and a findings summary — followed by
**one finding card per issue**: a severity **badge** (Bug / Nit / Question /
Praise), a plain-English explanation, and the **diff inline**. You read top-down,
push back in the thread, and **Approve** or **Dismiss** to burn down a live
verdict. Far faster than scrolling a wall of inline comments to decide whether the
change is safe.

Each finding reads the same way no matter the PR — **the problem, then the fix as
a before → after diff, then why it's better** — so big and small reviews stay
scannable.

![A review finding rendered as a card: the problem in prose above a syntax-highlighted before-and-after diff of the fix](docs/images/finding-diff.png)

**showcase doesn't review — it renders.** The analysis is delegated to the
agent's own **`code-review` skill** (a generic, showcase-agnostic reviewer);
showcase only formats the findings into cards + a verdict. The contract is the
skill _name_: `showcase review` tells the agent to run its `code-review` skill, so
anyone using showcase either has that skill or drops their own in under that name.
The dependency is one-way — showcase knows about `code-review`, `code-review`
knows nothing about showcase — so the reviewer stays reusable outside showcase,
and showcase stays usable with any reviewer.

**Make it _your_ reviewer:** drop a `~/.showcase/review.md` (or point
`$SHOWCASE_REVIEW_PROFILE` at one) holding your standing review conventions and
extra skills to load — `showcase review` folds it into every review prompt, so the
agent applies your standards each time.

### 📚 Understand what it's explaining

When an agent traces an auth flow, maps an architecture, or explains a gnarly
algorithm, the answer is usually a dense paragraph you have to decode. Ask it to
draw instead, and you _see_ the thing — a labeled diagram, prose, rendered math
(KaTeX), and the real source, side by side — so a hard idea lands in a glance
instead of a re-read. Ideal for onboarding to an unfamiliar codebase, vetting an
unfamiliar dependency, or making sense of your own large branch before it ships.

![An agent explaining a JWT refresh flow as a color-coded sequence diagram — client, guarded API, and refresh endpoint — with a prose note on where the tokens live](docs/images/explainer-jwt.png)

### 🧭 Weigh a decision before you build

Hand the agent a design doc — or a fuzzy _"how should we build X?"_ — and it lays
the options out as cards, one per approach, each **status-badged** and rolled up
at the top so the shape of the decision reads at a glance: what's `Preferred`,
what's still an `Option`, what's an `Open` question. A live **table of contents**
tracks where you are as the thread grows past a screen. Comment on any card to
push back, or **Approve** to lock the direction — and the agent revises in place.

![A design-options session: the session sidebar, a live table of contents down the options, the status roll-up, and a Preferred recommendation card with a sequence diagram](docs/images/design-review.png)

**Plus the everyday uses:** visualize data (native charts), render math (KaTeX),
sketch UI ideas (sandboxed HTML), or compose a walk-through deck with the
`slides` kit.

![A profiling session on the showcase surface: a native before/after bar chart of queue-wait percentiles over a green-and-red 24h histogram, with a KaTeX-rendered Little's Law derivation in the card below](docs/images/data-viz.png)

![An interactive sandboxed-HTML card explaining exponential backoff: a live base-delay slider and a full-jitter toggle drive a stack of doubling delay bars from 200 ms to 3.2 s](docs/images/interactive-html.png)

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
2. Seed the example sessions above to explore: `node bin/showcase.js demo`.
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
`update_surface`, `publish_review`, `reply_to_user`, `wait_for_feedback`,
`list_surfaces`, `upload_asset`, `get_design_guide`.

Then just ask in plain language:

- _"Diagram this auth flow on showcase."_
- _"Lay out the options for realtime notifications on showcase and recommend one."_
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

showcase wait --session <id> --timeout 600     # block until the user gives feedback
```

`showcase --help` lists every command (`publish`, `diff`, `markdown`, `mermaid`,
`code`, `chart`, `json`, `terminal`, `image`, `trace`, `review`, `update`, `wait`,
`watch`, `demo`, `kits`, …).

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
| `chart`    | native SVG chart — bar / line / area / pie / treemap / scatter        |
| `terminal` | monospace output with ANSI colors                                     |
| `json`     | a collapsible JSON tree                                               |
| `image`    | an uploaded image                                                     |
| `trace`    | an agent step timeline                                                |

A surface can also carry a **badge** (`{tone, label}`) — the colored chip a card
leads with. The session header rolls every badge up into a scannable status
summary (the row of chips at the top of each screenshot above).

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

[MIT](LICENSE)
