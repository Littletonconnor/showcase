# showcase — project guide & roadmap

The single doc to read before working on showcase — especially in a background
session. Sections 1–5 are "how it works / how to work here" (stable reference);
section 6 is the roadmap (what to build); sections 7–8 are open decisions and
how to pick up work autonomously. Architecture detail lives in `AGENTS.md`.

---

## 1. What it is

A live visual surface for AI: an agent publishes **surfaces** (cards built from
typed parts — html, markdown, mermaid, diff, terminal, image, json, code, trace)
and they render in a browser you watch and comment on. The agent lives in your
editor (Cursor / Claude Code) and reaches _out_ to showcase over MCP.

**The product is two flagship workflows** (section 6), not a pile of features:

1. **Visual PR review** (flagship) — _"the future of code review is multimodal."_
   An agent reviews a diff and publishes **finding cards** that combine prose, a
   control-flow **mermaid** diagram of the bug, and the **fix diff** in one card;
   you read, push back, and it revises the fix in place; the review carries a
   severity-tagged verdict you can share. No GitHub thread renders like that.
2. **Learning & explainers** — share a screenshot/snippet with your agent and get
   back an **animated, interactive** explainer you can scrub and ask questions of.

Everything else in the roadmap is _supporting capability_ in service of those two.

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

The roadmap is organized by **workflow**, not by capability. The two flagship
workflows (§1) come first and set priority; the **supporting capabilities** below
them are tagged with the workflow they serve. Each item is scoped to execute
solo: **problem → approach → acceptance → effort (AI time)**. Effort is a rough
first-cut, not a commitment.

**Why workflows, not features:** the rendering primitives for a great review card
already exist — the multimodal card in the product screenshot is just a
`[prose, mermaid, diff]` surface, and the diff renderer already does file
headers, line numbers, syntax highlighting, and unchanged-line folding. What's
missing is the _workflow_ that makes an agent produce those cards by default, and
the review-level structure (severity, verdict, line comments, share-back) that
turns a pile of cards into a review. That's Workflow 1.

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

### Shipped capabilities (foundation for both workflows)

These are done — build _on_ them, don't redo them. They're the primitives the two
workflows compose.

- [x] **Charts** — native `chart` part (Recharts), themed SVG, `showcase chart`.
- [x] **Math** — markdown renders `$inline$`/`$$display$$` via KaTeX → MathML,
      self-contained, crisp in Chromium + WebKit.
- [x] **Drill-down loop** — a surface's `sendPrompt()` renders as a **"Suggested
      by this surface"** chip with a one-tap **Send to agent** relay (can't
      impersonate the user). Closes output → tap → revise.
- [x] **Kit gallery / guide pass** — copy-paste markup for the `issues` / `slides`
      kits + the drill-down pattern documented.
- [x] **Editor-agent chat (was Pillar B — complete).** In-browser chat talks to the
      user's running Claude Code / Cursor over the MCP bridge (no hosted SDK).
      Presence/responding state, session-level chat, sidebar presence dots, the
      arm flow, and no-SDK auto-start (`showcase chat` + MCP `instructions`) all
      shipped and proven live. The one inherent limit — showcase can't _push_ a
      turn into an idle editor (MCP is pull-based) — is surfaced honestly in the UI.
- [x] **Anchored annotations** — a 📍 toggle drops a pin at a clicked spot and
      stores the comment with a resolution-independent `anchor` (`{xPct, yPct}`)
      that rides through to the agent. _(Point anchor; line/element anchor is R4.)_
- [x] **Structured feedback** — one-tap **Approve** (👍) posts a recognizable
      `author:"user"` signal; the composer is "request a change."
- [~] **Pinned Library** — _cut_ (see UX_VISION.md). The pin/Library wiring was
      removed end-to-end; a "save for later" almost nobody revisits.
- [x] **Hardened oracle** — `render-smoke.spec.ts` (every part kind renders at a
      real size) + an opt-in real-Chrome Playwright lane.

---

### Workflow 1 ⭐⭐ — Visual PR review (FLAGSHIP — build here first)

> _An agent reviews a diff and publishes multimodal **finding cards**; you read,
> push back, and it revises the fix in place; the review carries a severity-tagged
> verdict you can share._ The rendering already works — this builds the workflow
> and the review-level structure around it. Do these roughly in order; R1 unlocks
> the rest and reproduces the product screenshot by default.

- [x] **R1 — Finding cards: severity tags + the recipe + a demo (shipped).** A
      generic `Surface.badge` (`{tone, label}`) renders as a colored chip in the card
      header (critical→Bug / warning→Nit / info→Question / success→Praise / neutral),
      validated once and threaded through REST + both MCP transports + the CLI demo.
      The finding-card recipe (`[badge, prose, mermaid, diff]`, lead with a verdict
      card, revise in place) lives in `PLAYBOOK`, and `bin/demoData.js` seeds a
      review session reproducing the product screenshot. Store-contract + API + a
      real-DOM oracle cover it. _Proven live_ reviewing a real santafe branch.
- [x] **R2 — Review summary / verdict surface (shipped).** The session header now
      carries a **live verdict bar** derived from the finding-card badges — scannable
      per-label chips ("1 Bug · 1 Request changes · 1 Nit"), worst-severity first,
      each jumping to its finding. It's automatic (no agent authoring) and stays
      accurate as findings are added/resolved; the agent's verdict card adds the
      verdict word + table + coverage on top. Oracle-guarded. **Decisions roll in
      too:** a finding the user **Approves** (👍) or **Dismisses** (⊘, new action)
      resolves and its chip strikes through, so you watch the review burn down.
- **R3 — `showcase review` ingestion.** One command turns a PR/diff into a review
  session: read `gh pr diff <n>` / `git diff <range>`, create a session titled
  after the PR, and seed a verdict placeholder — so the agent starts from a
  scaffold instead of hand-building. _Acceptance:_ `showcase review 123` opens a
  ready review session. _Effort:_ ~2–3h.
- [x] **R4 — Line-anchored diff comments (shipped).** Click a diff line and a
      "Comment on line N" composer opens; the comment carries a line `anchor`
      (`{line, lineType}`) so the agent knows exactly what to fix. The in-frame
      bridge resolves the clicked line via `composedPath` (the lines live in
      @pierre/diffs shadow roots) and posts it out; `CommentAnchor` gained the line
      variant alongside the point one; the thread shows a "Line N" chip. Server +
      real-DOM oracle (composed-click through the sandboxed frame) cover it.

_(A GitHub round-trip — `gh pr review` with line comments — was considered and
**dropped**: showcase is its own surface, not a GitHub front-end. Sharing a
review with others is the static-export path under Supporting capabilities.)_

### Workflow 2 ⭐ — Learning & explainers

> _Share a screenshot/snippet with your agent; get back an animated, interactive
> explainer you can scrub and question._ Leans on html parts + the kit system.

- **L1 — Animation kit.** An opt-in `animate` kit (`server/kits.ts`) for html
  parts: self-contained CSS/JS scaffolds for step-through reveals, highlight
  passes, and transitions, with play / pause / scrub controls. Self-contained (no
  CDN). _Acceptance:_ an html part with `kits:["animate"]` plays a stepped
  explainer. _Effort:_ ~3–4h.
- **L2 — Screenshot → explainer recipe + demo.** The loop: paste a screenshot to
  your editor agent → "explain/animate this on showcase" → it publishes an
  animated html surface (image part for the source + an `animate` explainer).
  Mostly a guide recipe + a demo on top of L1. _Effort:_ ~1–2h.
- **L3 — Reading/learning mode.** A focused, one-explainer-at-a-time view (full
  width, distraction-free) for working through a Library of explainers. _(Moved
  from the old Pillar D.)_ _Effort:_ ~2h.

### Supporting capabilities (pick up when a workflow needs them)

Not flagship work; each is tagged with the workflow it serves. Don't build these
for their own sake.

- **Visual version diff** _(serves W1)_ — a "compare" next to the version `Select`
  showing what changed between two versions of a part. Pairs with R1's
  revise-the-fix-in-place loop. _Effort:_ ~2–3h for text-y parts.
- **Close the nudge gap** _(serves both)_ — an unread badge / desktop notification
  when the agent has feedback it hasn't seen, so you know to nudge an idle editor.
  _Effort:_ ~1–2h.
- **Static export** _(sharing)_ — `showcase export <session>` → one self-contained
  read-only `.html` of a review/explainer to send anyone. Bakes a snapshot via
  the `host.ts` seam, live/comment bits disabled. This is how you share a review,
  not a GitHub round-trip. _Effort:_ ~1–2h.
- **Present mode** _(serves W2)_ — full-bleed, arrow-key deck nav over a session's
  cards (builds on the `slides` kit). _Effort:_ ~1–2h.
- **Canvas view** _(serves W2)_ — opt-in spatial board (tldraw-style) for
  "map a whole system" layouts; the stream stays default. _Effort:_ large; only if
  the system-explainer use case proves out.
- **Store durability** _(foundation)_ — atomic/crash-safe `JsonFileStore` writes
  (write-temp-then-rename) before it holds real review history. _Effort:_ ~1h.
- **Live share** _(sharing, lower priority)_ — re-add a Workers deploy or
  `cloudflared` tunnel so others watch live. Workers means re-introducing a
  Durable-Object store behind `Store` (the contract test still holds it honest).

---

## 7. Open decisions (flag to the user before building the affected pillar)

- **~~Editor-agent engine~~ (DECIDED):** no SDK. The in-browser chat reaches the
  user's running editor agent over the existing MCP bridge — not a hosted
  `@anthropic-ai/sdk` / Agent SDK runtime. No API key, no injection surface.
  (Shipped — see "Editor-agent chat" under Shipped capabilities.)
- **No GitHub round-trip (DECIDED):** showcase is its own surface, not a GitHub
  front-end. Sharing a review means static export, not posting back to a PR.
- **Auth/sharing for live share:** the one-board/one-user stance means shared
  views default to read-only.

---

## 8. Picking up work in a background session

1. Read sections 1–5 of this file and `AGENTS.md`.
2. `git branch --show-current` — if not on a task branch, branch from `main`.
3. Workflow 1 (visual PR review) is shipped (R1–R4); Workflow 2 (learning &
   explainers) is next. If an item is an "open decision" in §7, confirm it first.
4. Build in small commits; after each, run the §5 verify suite. For UI, screenshot
   and look.
5. Keep the oracle green; if you change behavior it covers, update the oracle in
   the same commit.
6. When the chunk is green + reviewed, fast-forward merge to `main`.
