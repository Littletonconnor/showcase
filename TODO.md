# showcase — project guide & roadmap

The single doc to read before working on showcase — especially in a background
session. Sections 1–5 are "how it works / how to work here" (stable reference);
section 6 is the roadmap (what to build); sections 7–8 are open decisions and
how to pick up work autonomously. Architecture detail lives in `AGENTS.md`.

---

## 1. What it is

A live visual surface for AI: an agent publishes **surfaces** (cards built from
typed parts — html, markdown, mermaid, diff, terminal, image, json, code, trace)
and they render in a browser you watch and comment on. Today the agent lives in
your editor (Cursor / Claude Code) and reaches _out_ to showcase. The roadmap
(section 6, Pillar A) turns showcase into a **local Claude chat app** where the
AI runs server-side and surfaces are its inline visual artifacts.

**Stack:** runtime-agnostic Hono server (`server/`) + a React 19 / zustand /
Tailwind v4 / shadcn viewer (`viewer/`, Vite → one self-contained
`index.html`) + a stdio/HTTP MCP server (`mcp/`) + a zero-dep CLI (`bin/`).
Local JSON-file store. `server/themes.ts` is the single color source for both
the chrome and the sandboxed part-iframes.

---

## 2. Operating guide

**Run it** (needs Node ≥ 22.18 — the nvm default here is v20, too old; use v24):

```sh
cd ~/personal/showcase
npm run serve            # API + viewer on http://localhost:8229  (keep running)
# rebuild the viewer + restart after viewer changes:
npm run build:viewer
node bin/showcase.js demo   # seed example sessions to look around
```

**Create a surface** — in Cursor/Claude Code, ask "diagram X on showcase" /
"sketch this on showcase"; the agent calls `publish_surface` and a card appears.
Or directly: `node bin/showcase.js mermaid flow.mmd --title "Flow"` (also
`publish`, `diff`, `markdown`, `code`, `image`, …).

**Iterate** — the agent calls `update_surface {id, parts}` → _same card, new
version_ (the `v2 ⌄` Select flips versions). You comment under any card → it
reaches the agent (section 4).

**Both editors are wired** to the same `showcase` MCP server (stdio, proxies the
local API), pinned to the v24 node binary:

- Claude Code — user scope in `~/.claude.json`, `SHOWCASE_AGENT=claude-code`.
- Cursor — global `~/.cursor/mcp.json`, `SHOWCASE_AGENT=cursor`.
  Only requirement: keep `npm run serve` running, then talk to either agent.
  Restart the editor after MCP config changes.

---

## 3. Architecture map

- `server/app.ts` — Hono app (runtime-agnostic): routes, SSE `/api/events`,
  long-poll `/api/comments`, the `/s/:id` sandboxed renderer, and the shared
  flow functions REST + MCP both call.
- `server/types.ts` — data model + `Store` interface. `server/storage.ts` —
  `JsonFileStore` (the only store; the Cloudflare SqlStore was removed).
- `server/surfacePage.ts` / `themes.ts` / `kits.ts` — sandboxed rendering, the
  theme registry (single color source), and opt-in html-part style bundles.
- `viewer/` — React 19 + zustand store (`state.ts`) + Tailwind v4 + shadcn
  (`components/ui/`). `index.css` bridges shadcn/Tailwind tokens to the theme
  vars; `styles.css` is just the `:root` design tokens now.
- `mcp/server.ts` — stdio MCP (thin client over the HTTP API).
  `server/mcpHttp.ts` — streamable HTTP MCP at `/mcp`.
- **Core invariant:** agent-authored HTML renders ONLY inside sandboxed,
  opaque-origin iframes — never `innerHTML`/`dangerouslySetInnerHTML` in the
  trusted viewer origin. Two safe paths: build a string → sandbox iframe
  (`SandboxedPart`, `renderHtmlPage`), or keep it data → render with React text
  nodes (image/trace). When adding a part kind, pick one.

---

## 4. The agent feedback loop (contract)

**The server never pushes to your editor — the agent pulls.** A comment you type
is `POST /api/comments` with `author=user`, stored on the surface → its session.
The agent receives it when it next touches showcase:

1. **Piggyback** — its next publish/update response carries `userFeedback[]`.
2. **Blocking wait** — `wait_for_feedback` long-polls its session for
   `author=user` comments.
3. Background watch (CLI).
   Per-session, exactly-once (an `agentSeq` cursor). **Gotcha:** after a turn the
   agent isn't listening — the reliable pattern is _comment → tell the agent to
   check_. Reducing this friction is a roadmap item (Pillar E). Surface URLs handed
   to humans are the viewer deep link (`/session/:sid/s/:id`), not `/s/:id`.

---

## 5. How to work in this repo (read before any change)

- **Branch gate.** Don't commit redesign/feature work on `main`. Branch first;
  merge (fast-forward) when a chunk is green and reviewed.
- **The oracle is the merge gate.** `e2e/loop.spec.ts` (Playwright) drives a real
  browser through publish → render → comment. Run `npx playwright test`. It
  asserts only on trusted-origin DOM hooks (`.card[data-id]`, per-part
  `<iframe>`s, `.thread .cmt.user .who`="you") so it survives a restyle but
  catches a broken change. **Keep these hooks intact.** (Gap: desktop-chromium
  only — see Pillar E.)
- **Verify before reporting done** (all must pass): `npm run typecheck`
  (node + viewer tsc), `npm run lint` (oxlint, warnings = errors),
  `npm run build:viewer`, `npx playwright test`. For UI, screenshot via a headless
  Playwright script and look at it. `npm run format` last.
- **Node:** prefix shells with
  `export PATH=/Users/connorlittleton/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin:/usr/local/bin`.
  This shell aliases `cat`→a missing tool (use Read/`sed`) and lacks `lsof`
  (kill servers via `ps ax | grep server/index.ts | awk | xargs kill`).
- **Styling:** Tailwind utilities + shadcn on the JSX — do NOT add rules to
  `styles.css`. New palette needs go through the `index.css` `@theme` bridge.
- **Commits:** Conventional Commits; end with the Co-Authored-By line. One
  logical change per commit; verify before each.
- **LLM code:** anything calling Claude must use `@anthropic-ai/sdk`, model
  `claude-opus-4-8`, `thinking:{type:"adaptive"}`, and streaming. Consult the
  `claude-api` skill before writing it. Never hardcode keys — read
  `ANTHROPIC_API_KEY` from env.

---

## 6. Roadmap

Each pillar is scoped enough to execute solo: **problem → approach → acceptance
→ effort (AI time)**. Pillars are independent; do them in any order. Effort is a
rough first-cut estimate, not a commitment.

### Pillar A ⭐ — In-browser chat (turn showcase into a local Claude app)

The flagship direction. A polished, claude.ai-style chat in the viewer where the
AI runs **server-side** and emits surfaces as inline artifacts.

- **Problem:** today you can only _watch_ an editor agent. You want to _talk_ to
  an AI in the browser — create chats, see history, delete them — with a
  beautifully designed interface, and have surfaces be its visual output.
- **Approach (server-hosted agent):**
  - Server runs the agent loop with `@anthropic-ai/sdk` (model `claude-opus-4-8`,
    adaptive thinking, `client.messages.stream`), OR the **Claude Agent SDK**
    (`@anthropic-ai/claude-agent-sdk` — Claude Code's engine, with bash/file/MCP
    tools) for a real "local Claude Code in the browser." Decide which — see §7.
  - Reuse the data model: a **chat = a session** (sidebar create/delete/history
    already exists), turns stored as messages, **`publish_surface` is a tool the
    agent calls** so cards render inline as the AI's artifacts.
  - Stream tokens to the browser over the existing SSE channel (`/api/events`)
    or a new `/api/chat` SSE; the composer posts a user turn.
  - Tools to expose: `publish_surface`/`update_surface` (always), then optionally
    web search/fetch (research) and bash/edit (local work — heed the security
    notes in the `claude-api` tool-use docs; sandbox/allowlist).
  - **The injection caveat is real:** this does NOT drive your Cursor/Claude Code
    _app_ session — it's its own local Claude. (A separate, lesser "bridge to the
    editor agent via the comment loop" is possible but constrained; not this.)
- **Acceptance:** type a message in the browser → streamed Claude response →
  agent publishes a surface that renders inline in the thread → you reply and it
  revises. Chats persist, list in the sidebar, delete cleanly. Oracle still green.
- **Effort:** large — break into (1) server chat loop + streaming, (2) chat UI
  (message list, streaming composer), (3) tools wiring, (4) polish. ~a few
  focused sessions; do behind a flag so the existing publish/watch flow keeps
  working.

### Pillar B — Showing other people

- **Static export** — `showcase export <session>` → one self-contained read-only
  `.html` to send anyone. The viewer is already single-file; bake a session
  snapshot in via the `host.ts` seam, disable the live/comment bits.
  _Acceptance:_ the file opens offline and renders the session. _Effort:_ ~1–2h.
- **Present mode** — full-bleed, arrow-key deck nav over a session's cards (builds
  on the `slides` kit). _Effort:_ ~1–2h.
- **Live share** — re-add a Cloudflare Workers deploy, or a `cloudflared` tunnel,
  so others watch live / it works on a phone. _Effort:_ Workers ~2–3h; tunnel ~20m.

### Pillar C — Richer explainers (mostly kits)

Kits are the cheap extension point: a registry entry in `server/kits.ts` + a
guide bullet, no new part kind. The html-part CSP already allowlists
jsdelivr/cdnjs/unpkg, so CDN libs work today.

- **KaTeX kit** (math) and a **chart kit** (Vega-Lite / Chart.js). _Effort:_
  ~30–45m each.
- **Drill-down loop** — html parts can already call `sendPrompt()`; make
  "explain this deeper" buttons idiomatic so an interactive explainer asks the
  agent to go further in place. _Effort:_ ~1–2h + a guide pattern.

### Pillar D — Personal knowledge base

- **Persistent / pinned surfaces** — a "library" of diagrams that survives the
  session; a visual wiki for "understand a system." _Effort:_ ~2–4h (store +
  a pinned view).
- **Reading/learning mode** — focused, one-explainer-at-a-time view. _Effort:_ ~2h.

### Pillar E — Loop + foundation (keeps everything else safe)

- **Tighten feedback** — structured approve/reject/revise buttons via the
  `sendPrompt` bridge; element-level annotations (click a diagram box → ask about
  it); reduce the "comment doesn't reach the agent until I nudge it" gotcha
  (esp. once Pillar A's server agent can be actively listening).
- **Harden the oracle** — add WebKit + a mobile viewport + a per-part-kind render
  check; consider a CI workflow (none today) so background changes are gated
  automatically.

### Polish / tech debt

- The agent guide (`guide/AGENT_HOWTO.md`, `DESIGN_GUIDE.md`) still has light
  stale wording (e.g. the trace part "timeline") — sweep for references to the
  removed theming/timeline.
- The theme engine is dormant-but-present (fixed GitHub now, no switcher) — fine,
  but if multi-theme never returns, it could be simplified.
- A dedicated aesthetic polish pass (header, type scale, motion, empty states) —
  cheap now that the viewer is all-Tailwind.

---

## 7. Open decisions (flag to the user before building the affected pillar)

- **Pillar A engine:** plain `@anthropic-ai/sdk` agent loop (full control, build
  the tool surface ourselves) vs the **Claude Agent SDK** (Claude Code's engine,
  bash/file/MCP/subagents out of the box). The Agent SDK is the strongest fit for
  a "local Claude Code in the browser"; the plain SDK is leaner for an
  explainer-focused assistant. Confirm which.
- **Pillar A tool surface:** explainer-only (publish_surface + web tools) vs
  full coding agent (also bash/edit). Affects the security posture.
- **API key handling:** read `ANTHROPIC_API_KEY` from env; confirm where it lives
  (`.env`, shell). Never commit it.
- **Auth/sharing for Pillar B live share:** the one-board/one-user stance means
  shared views should default to read-only.

---

## 8. Picking up work in a background session

1. Read sections 1–5 of this file and `AGENTS.md`.
2. `git branch --show-current` — if not on a task branch, branch from `main`.
3. Pick a pillar/item; if it's Pillar A or another "open decision" item, confirm
   the decision in §7 first.
4. Build in small commits; after each, run the §5 verify suite. For UI, screenshot
   and look.
5. Keep the oracle green; if you change behavior it covers, update the oracle in
   the same commit.
6. When the chunk is green + reviewed, fast-forward merge to `main`.
