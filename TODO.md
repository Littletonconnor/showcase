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
(section 6, Pillar B) turns showcase into a **local Claude chat app** where the
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
   check_. Reducing this friction is a roadmap item (Pillar C). Surface URLs handed
   to humans are the viewer deep link (`/session/:sid/s/:id`), not `/s/:id`.

---

## 5. How to work in this repo (read before any change)

- **Branch gate.** Don't commit redesign/feature work on `main`. Branch first;
  merge (fast-forward) when a chunk is green and reviewed.
- **The oracle is the merge gate.** `e2e/loop.spec.ts` (Playwright) drives a real
  browser through publish → render → comment. Run `npx playwright test`. It
  asserts only on trusted-origin DOM hooks (`.card[data-id]`, per-part
  `<iframe>`s, and `.thread .cmt.user` carrying the comment text) so it survives
  a restyle but catches a broken change. **Keep these hooks intact.** (Gap: desktop-chromium
  only — see Pillar F.)
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
rough first-cut estimate, not a commitment. The order below is roughly by
leverage — **A and B are where the product actually wins.**

### Shipped (the foundation — don't redo it, build on it)

The viewer redesign and the full design-polish backlog are complete. This is the
stable base everything below assumes.

- **Redesign** — viewer ported Solid → React 19 + zustand + Tailwind v4 + shadcn;
  styling fully on Tailwind utilities (no `styles.css` rules); one self-contained
  `index.html`.
- **Slimmed** — removed the Stream/Timeline toggle (stream-only), the server-side
  session-trace pipeline, the Cloudflare SqlStore, and the multi-theme engine —
  now one fixed GitHub light/dark theme with `server/themes.ts` as the single
  color source for chrome + sandboxed parts.
- **Chat thread** — the comment thread is a real chat-bubble UI (sender shown by
  alignment + colour, no labels) with a persistent composer.
- **claude.ai-grade chrome (Pillar F, F1–F17 — all done)** — shadcn `Sidebar`
  (collapsible rail, mobile offcanvas, persisted state), per-session overflow menu
  (rename / delete / copy-link), live search, refined rows/groups/header/footer, a
  proper app header, surface-card chrome, skeletons + empty states, a unified
  lucide icon set, a subtle motion pass, Sonner toasts, one type/spacing scale,
  and a dark-mode pass.

### Pillar A ⭐ — Richer surfaces (the main priority)

The output side is the least-developed, highest-upside part of the product: html
parts and kits make surfaces _interactive explainers_, not static pictures — and
that's the thing no terminal can do. **Build here first.**

The richest explainer primitives ship self-contained (no CDN) — the project
bundles its libraries rather than relying on jsdelivr/unpkg.

- [x] **Charts (shipped).** A native first-class `chart` part (Recharts) — bar /
      line / area / pie, rendered as themed SVG in the trusted viewer (data, not
      markup, so no sandbox), accent-led palette, re-themes with the board.
      `showcase chart <spec.json>` + guide + demo.
- [x] **Math (shipped).** Markdown parts render `$inline$` / `$$display$$` via
      KaTeX with `output: "mathml"` — browser-native, no fonts/CSS shipped, fully
      self-contained. Verified crisp in Chromium + WebKit. (Integrated into
      markdown rather than a standalone kit — math rides with prose.)
- [x] **Drill-down loop (shipped).** A surface's `sendPrompt()` button now renders
      as a **"Suggested by this surface"** chip with a one-tap **Send to agent**
      relay (re-posts as a real user message → reaches the agent, keeping the
      trust boundary: surface markup still can't impersonate the user). Documented
      in the design guide with a copy-paste example; demo card included. Closes the
      output → tap → revise loop.
- [x] **Kit gallery / guide pass (shipped).** Added copy-paste markup examples
      for the `issues` and `slides` kits, and documented the `sendPrompt`
      drill-down pattern (above) — so agents reach for rich, interactive html
      parts instead of plain markdown.
- **Canvas view (bigger bet, opt-in).** An optional spatial board — arrange a
  session's surfaces freely (tldraw-style) instead of the vertical stream, for
  "map a whole system" layouts. Behind a flag; the stream stays the default.
  _Effort:_ large; only worth it if the system-explainer use case proves out.

### Pillar B ⭐ — Chat with your editor agent (NOT a hosted SDK)

**Decided direction (corrected):** the in-browser chat talks to the user's
already-running **Claude Code / Cursor** session over the existing MCP bridge —
it is NOT a server-hosted `@anthropic-ai/sdk` / Agent SDK runtime. The whole
point of the MCP server is to reach the editor agent. (See the memory note and
§7.) The bridge is already two-way: `wait_for_feedback` carries browser comments
→ agent; `reply_to_user` carries agent → browser (SSE).

**The load-bearing constraint:** it's **pull-based**. showcase cannot inject a
turn into Claude Code — the agent only receives a message while parked in
`wait_for_feedback` (or on its next tool call). When it's parked it's real-time;
otherwise messages queue until it checks. The UI must surface this honestly.

- [x] **Agent presence + responding state (shipped).** Server tracks active
      `wait_for_feedback` waiters per session (abort-aware) and broadcasts an
      `agent-presence` event; the sessions API seeds `listening` and `/api/events`
      sends it on connect. Viewer shows a live green **"Listening"** chip (or a
      clickable **"Agent idle"** that copies an arm-your-agent instruction) and a
      **"responding…"** typing indicator that clears on reply or a 90s timeout.
      Guide updated with the wait→reply→wait loop. Proven live end-to-end.
- [x] **Session-level chat (shipped).** `createComment` now accepts a surfaceless
      comment (`session` id → `surfaceId` null); a **"Chat with your agent"** panel
      at the bottom of the stream posts and shows these, with the same listening +
      responding indicators. `reply_to_user` takes an optional `surfaceId` (both
      MCP transports) — omit it to reply session-level. Proven live end-to-end.
- [x] **Sidebar presence dots (shipped).** A small pulsing green dot on each
      session row's meta line when that session's agent is parked listening (live
      via the same `agent-presence` SSE) — reachable agents at a glance.
- [x] **Tighten the arm flow (shipped).** Agent-guide phrasing strengthened
      (surface vs session-level comments, the wait→reply→wait loop), and CLI
      parity: `showcase comment --session <id>` posts a session-level reply.
- [x] **Auto-start the chat loop, no SDK (shipped).** Two no-SDK levers so the
      user doesn't paste an arm instruction every session: (1) the MCP server's
      `instructions` now prime the chat-loop behavior, so any connected Claude
      Code / Cursor learns wait→reply→wait automatically on connect (universal,
      server-side); (2) `showcase chat` launches Claude Code already armed with an
      opening prompt that enters the loop (`--print` emits the prompt for Cursor /
      paste). One command to start; the presence indicator shows the loop is alive.

**Pillar B is complete** (presence/responding, sidebar dots, drill-down relay,
session-level chat, arm flow, no-SDK auto-start). The only thing showcase still
cannot do is _push_ a turn into an idle editor — inherent to MCP; surfaced
honestly in the UI, and reduced to one command / one trigger.

### Pillar C — Sharpen the loop (the differentiator)

The reason showcase isn't just a prettier markdown viewer is the
publish → render → **comment** → revise loop. The redesign made the chrome
beautiful; this makes the _comment_ half as rich as the _publish_ half — the
things no editor-side rendering can do because the surface is live and in front
of you. Pairs naturally with Pillar A (rich html parts are what you annotate).

- **Anchored annotations.** Click a region of a surface — a diagram node, a diff
  line, a paragraph — and pin a comment to it, so the agent receives _"the user
  is asking about **this**"_ instead of a floating comment it has to guess at.
  The html-part sandbox bridge already round-trips clicks (`sendPrompt`,
  `openLink`); add an "annotate" mode that posts an anchor (selector or `{x,y}` +
  a label) alongside the comment text, render a pin on the card, and pass the
  anchor through on `userFeedback`. _Acceptance:_ click a part → leave a pinned
  note → it shows on the card and the agent's feedback carries the anchor.
  _Effort:_ medium (start with html parts, then diff/markdown).
- **Visual version diff.** Surfaces already version (`v1`, `v2 ⌄`); add a
  "compare" next to the version `Select` that shows what changed between two
  versions of a part — side-by-side or overlay. _Acceptance:_ pick `v2` vs `v1`
  on a diff/markdown/code part and see the delta. _Effort:_ ~2–3h for text-y
  parts; html parts are a later screenshot-diff problem.
- [x] **Structured feedback (shipped).** A one-tap **Approve** (👍) in the card
      footer (both before the first comment and under the composer) posts a
      recognizable author:"user" signal — the fast path for "yes, this is right"
      during iteration, vs typing it. "Request a change" is the composer. Works on
      any card; oracle-guarded. (Reject left out — a free-text comment covers it.)
- **Close the nudge gap.** Today a comment doesn't reach the editor agent until it
  next touches showcase (§4). This mostly dissolves once Pillar B's server agent
  is actively listening; until then, surface an unread badge / desktop
  notification when the agent has feedback it hasn't seen, so you know to nudge.
  _Effort:_ ~1–2h.

### Pillar D — Personal knowledge base

- **Persistent / pinned surfaces** — a "library" of diagrams that survives the
  session; a visual wiki for "understand a system." _Effort:_ ~2–4h (store +
  a pinned view).
- **Reading/learning mode** — focused, one-explainer-at-a-time view. _Effort:_ ~2h.

### Pillar E — Share & present (lower priority)

Showing other people — worthwhile, but after the product itself is richer.

- **Static export** — `showcase export <session>` → one self-contained read-only
  `.html` to send anyone. The viewer is already single-file; bake a session
  snapshot in via the `host.ts` seam, disable the live/comment bits.
  _Acceptance:_ the file opens offline and renders the session. _Effort:_ ~1–2h.
- **Present mode** — full-bleed, arrow-key deck nav over a session's cards (builds
  on the `slides` kit). _Effort:_ ~1–2h.
- **Live share** — re-add a Cloudflare Workers deploy, or a `cloudflared` tunnel,
  so others watch live / it works on a phone. _Effort:_ Workers ~2–3h; tunnel ~20m.
  Note: the SqlStore was removed, so a Workers path means re-introducing a
  Durable-Object store behind the `Store` interface (the contract test still
  exists to hold it honest).

### Pillar F — Foundation & confidence

The polish backlog that used to live here is **shipped** (see Shipped, above).
What's left is a thin safety net — pick these up only when something below them
needs it, not for their own sake.

- **Harden the oracle** — `e2e/loop.spec.ts` is desktop-chromium only; add WebKit,
  a mobile (480px) viewport, and a per-part-kind render check so a broken part can
  never merge green. Most valuable once Pillar A adds new part/kit kinds worth
  guarding. _Effort:_ ~2–3h.
- **Store durability** — `JsonFileStore` is fine for one user today, but before
  the chat app (Pillar B) holds real history, confirm atomic/crash-safe writes
  (write-temp-then-rename) so a crash mid-write can't corrupt a board. _Effort:_ ~1h.

---

## 7. Open decisions (flag to the user before building the affected pillar)

- **~~Pillar B engine~~ (DECIDED):** no SDK. Pillar B chats with the user's
  running editor agent over the existing MCP bridge — not a hosted
  `@anthropic-ai/sdk` / Agent SDK runtime. No API key, no injection surface. The
  remaining Pillar B work is UX on top of that bridge (see Pillar B).
- **Auth/sharing for Pillar E live share:** the one-board/one-user stance means
  shared views should default to read-only.

---

## 8. Picking up work in a background session

1. Read sections 1–5 of this file and `AGENTS.md`.
2. `git branch --show-current` — if not on a task branch, branch from `main`.
3. Pick a pillar/item; if it's Pillar B or another "open decision" item, confirm
   the decision in §7 first.
4. Build in small commits; after each, run the §5 verify suite. For UI, screenshot
   and look.
5. Keep the oracle green; if you change behavior it covers, update the oracle in
   the same commit.
6. When the chunk is green + reviewed, fast-forward merge to `main`.
