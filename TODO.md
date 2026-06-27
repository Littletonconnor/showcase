# showcase — project guide & roadmap

The single doc to read before working on showcase — especially in a background
session. Sections 1–5 are "how it works / how to work here" (stable reference);
section 6 is the roadmap (what to build); sections 7–8 are open decisions and
how to pick up work autonomously. Architecture detail lives in `AGENTS.md`.

**👉 Active focus is the decision-review form factor — see the phased plan
immediately below.** Sections 1–8 are the stable guide/roadmap underneath it.

---

## ⭐ Active focus — decision-review form factor

An agent decomposes a PR into a small, risk-ranked queue of **decisions** (a
plain-English Brief + an honesty ledger + evidence per decision), published via
`publish_decisions` / `POST /api/sessions/:id/review`, rendered inline in the
board for a `kind === "review"` session. North-star design: `docs/review-form-factor.md`.

This is a **dogfood-driven redesign** — built it, reviewed a real Java PR through
it (`wealthfront-lembas` `cl/ALLM-126`), and the phases below are the feedback
that surfaced. Get the human's intent right; this is UX, not just plumbing.

### Phase 0 — Shipped (do NOT redo — build on it)

- Inline board rendering: a review session takes over the main panel via
  `ReviewInline` → `ReviewView` (keyed off the server's `kind === "review"`).
- `Decision.proposal` field renders a "Suggested change" diff under the evidence.
- Server-side newline normalization in `coerceReview` (kills the "No newline at
  end of file" noise for new publishes).
- Content-keyed local adjudication (survives an agent re-publish) + a per-decision
  comment trail.
- The live loop: `publish_decisions` MCP tool, `review-updated` SSE event,
  `ReviewView` / `ReviewInline` / `ReviewPage`. **⚠️ Gap:** `publish_decisions`
  is only registered on the HTTP MCP (`server/mcpSpec.ts`), NOT on the stdio MCP
  server (`mcp/server.ts`) — so editor agents (Claude Code / Cursor, which use
  stdio) can't call it. `publish_review` is on both. Worth fixing.
- Sidebar: review sessions chip their verdict; the row opens the review inline.
- (Also fixed the `code-review` skill to scope depth per-slice so reviews stop
  fanning out 5 specialists over the whole diff — `~/Sites/ai-config`.)

### Phase 1 — Trust & transparency: the complete changed-file manifest

- **Problem:** the review only surfaces risk-ranked *decisions*, so files the
  agent deemed unremarkable just vanish — the human distrusts they're seeing the
  whole change ("gives a false sense; I lost trust that I'm seeing everything").
- **Approach:** add a **complete changed-file manifest** — every file in the diff,
  each tagged with its disposition (`has decision` / `reviewed · no comment` /
  `mechanical · skipped`) + line counts, linking to its decision when it has one.
  Nothing omitted. Design is open ("not sure how it should look") — propose a
  clean layout (collapsible "All N files changed" near the Brief, or a side rail).
- **Acceptance:** you can see every changed file and account for it, even the ones
  with no comment. Addresses the doc's "trusting the skip set" open question.

### Phase 2 — Interaction redesign: decision IDs + normal chat (the verbs are clunky)

- **Drop the "Verify" (`V`) verb entirely** — not needed.
- **Replace the bespoke verb buttons** (which post structured comments) with
  something lighter: **give each decision a short, stable, copy-pasteable
  UUID/ref.** The human copies a decision's ref and chats with the agent through
  the **normal agent-chat flow** (browser chat / editor), pasting the ref so the
  agent knows exactly which decision — then the agent revises and re-publishes.
- **Model it on the viz "send to agent" / drill-down relay** (how the
  visualizations already talk to the agent in the browser). The review's
  conversation should happen in normal chat, scoped by a copyable id — not a wall
  of special-purpose buttons.
- Likely **keep a lightweight local Accept** (burndown); lose Verify/Disagree as
  buttons. Stable decision IDs also replace content-keying (durability) and make
  the "trail" just be the normal chat.

### Phase 3 — Ledger clarity (the verbiage is confusing)

- The current labels ("High confidence" / "Checked" / "Not yet") read poorly and
  are unclear. **Reword so anyone instantly gets** what was verified, what wasn't,
  and how sure the agent is. Plain, unambiguous; propose clearer language.

### Phase 4 — Suggested fixes in the diffs

- When the agent thinks there should be a fix, the evidence diff should **show the
  suggested change** (the `Decision.proposal` before→after) clearly. Make the
  agent populate `proposal` whenever a concrete fix exists, and render it
  obviously alongside/under the evidence.

### Key files

- `server/types.ts` — `Review` / `Decision` / `DecisionProposal` + `Store`. (Add
  stable decision `id`s and a `manifest`/`files[]` field here.)
- `server/app.ts` — `coerceReview()` validation, `publishDecisions` flow,
  `/api/sessions/:id/review` routes, `/api/sessions` row decoration
  (`kind`, `reviewVerdict`).
- `server/mcpSpec.ts` — `publish_decisions` schema + field docs (update for new
  fields).
- `viewer/src/review/ReviewView.tsx` — the renderer (Brief, decision queue,
  ledger, sticky evidence). `ReviewInline.tsx` embeds it in the board;
  `ReviewPage.tsx` is the standalone `?review=` page.
- `guide/PLAYBOOK.md` — the "decision review" recipe the agent follows (teach it
  the manifest, decision IDs, and when to include a `proposal`).

### Run & verify

- Pinned Node: `export PATH="$HOME/.nvm/versions/node/v24.12.0/bin:$PATH"`.
  Port **8229**. `npm run dev` builds the viewer + restarts the server on save.
- Gate before "done": `npm run typecheck`, `npm test`, `npm run lint` (warnings =
  errors), `npm run format:check`. For UI, screenshot with a headless Playwright
  script and actually look — `http://localhost:8229/session/<reviewSessionId>`.

### Cautions

- **Parallel editing is happening** — the board is being refactored (`App.tsx`,
  `api.ts`, `state.ts`, `Card.tsx`, session `kind` work) in another editor. Don't
  clobber in-flight work; prefer `ReviewView.tsx` + server validation; confirm
  before big `App.tsx` edits.
- **Never `git commit` / `gh pr create` directly** (hooks block them); the human
  commits. Don't push. Keep changes small and typechecking at each step.

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
- **Node:** prefix shells with a pinned v24 on PATH, e.g.
  `export PATH="$HOME/.nvm/versions/node/v24.14.1/bin:/usr/bin:/bin:/usr/local/bin"`.
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
were never the hard part — the multimodal card in the product screenshot is just a
`[prose, mermaid, diff]` surface, and the diff renderer already does file
headers, line numbers, syntax highlighting, and unchanged-line folding. The work
was the _workflow_ that makes an agent produce those cards by default, plus the
review-level structure (severity, verdict, line comments, share-back) that turns a
pile of cards into a review — that's Workflow 1, now shipped (R1–R4).

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
- **Chat thread** — _**RETIRED** (commit `03c2693`)._ The per-surface comment
  thread + persistent composer (`Thread.tsx`, `Composer`) were removed. Surface
  feedback is now: Approve/Dismiss on finding cards, decision threads inside
  `ReviewView`, and "copy the card id from its header, mention it in your
  terminal" for everything else (see the Card.tsx footer comment).
- **claude.ai-grade chrome (Pillar F, F1–F17 — all done)** — shadcn `Sidebar`
  (collapsible rail, mobile offcanvas, persisted state), per-session overflow menu
  (rename / delete / copy-link), live search, refined rows/groups/header/footer, a
  proper app header, surface-card chrome, skeletons + empty states, a unified
  lucide icon set, a subtle motion pass, Sonner toasts, one type/spacing scale,
  and a dark-mode pass.

### Shipped capabilities (foundation for both workflows)

These are done — build _on_ them, don't redo them. They're the primitives the two
workflows compose.

- [x] **Charts** — native `chart` part (Recharts), themed SVG, `showcase chart`,
      and discoverable in the MCP schema (enum + description).
- [x] **Math** — markdown renders `$inline$`/`$$display$$` via KaTeX → MathML,
      self-contained, crisp in Chromium + WebKit.
- [~] **Drill-down loop** — _PARTIAL._ The `sendPrompt()` plumbing still exists
      (`surfacePage.ts` → `bridge.ts` posts an `author:"surface"` comment), but
      the **"Suggested by this surface"** chip + **Send to agent** button were
      removed along with the surface comment UI (commit `03c2693`). The relay has
      no entry point in the viewer today.
- [x] **Kit gallery / guide pass** — copy-paste markup for the `issues` / `slides`
      kits + the drill-down pattern documented.
- [~] **Editor-agent chat (was Pillar B) — _RETIRED / never shipped as described._**
      There is no in-browser chat-to-editor UI, no `showcase chat` command, no
      "arm" flow, and no presence dots. What survives is a single `listening`
      flag (the agent is parked in `wait_for_feedback`), rendered as a green dot
      in the sidebar. The real loop is the comment/`wait_for_feedback` pull in
      §4 — there is no session-level editor chat.
- [~] **Anchored annotations** — _**RETIRED** with the comment UI (commit `03c2693`)._
      The point-pin (📍) and the line-click composer (R4) are both gone; the
      `CommentAnchor` `{xPct,yPct}`/`{line,lineType}` types and the server-side
      `parseAnchor` still exist but are **vestigial** (no viewer produces them,
      and `onLineClick` pipes to nothing). Cleanup candidate.
- [x] **Structured feedback** — one-tap **Approve** (👍) and **Dismiss** (⊘) on
      finding cards post a recognizable `author:"user"` signal. _(Still shipped —
      these are the surviving surface-feedback affordances.)_
- [~] **Pinned Library** — _cut_ (the daily-use razor: not used most sessions).
      The pin/Library wiring was removed end-to-end; a "save for later" almost
      nobody revisits.
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
      real-DOM oracle cover it. _Proven live_ reviewing a real PR branch.
- [x] **R2 — Review summary / verdict surface (shipped).** The session header now
      carries a **live verdict bar** derived from the finding-card badges — scannable
      per-label chips ("1 Bug · 1 Request changes · 1 Nit"), worst-severity first,
      each jumping to its finding. It's automatic (no agent authoring) and stays
      accurate as findings are added/resolved; the agent's verdict card adds the
      verdict word + table + coverage on top. Oracle-guarded. **Decisions roll in
      too:** a finding the user **Approves** (👍) or **Dismisses** (⊘, new action)
      resolves and its chip strikes through, so you watch the review burn down.
- [x] **R3 — `showcase review` ingestion (shipped).** `showcase review <branch>
      [--base]` reads the branch diff, computes per-file churn + a churn-seeded
      manifest + risk, creates a "Review: <branch>" session, and seeds an "In
      review" verdict placeholder that `publish_review` later revises in place — so
      the agent starts from a scaffold instead of hand-building. The printed prompt
      **delegates the analysis to the agent's `code-review` skill** (which dispatches
      to language-specific hygiene skills) and then renders its findings via
      `publish_review`; showcase owns the rendering, not the review methodology.
- [~] **R4 — Line-anchored diff comments — _RETIRED (commit `03c2693`)._** The
      "Comment on line N" composer and the "Line N" thread chip were removed with
      the rest of the surface comment UI. The in-frame line-click bridge
      (`composedPath` through the @pierre/diffs shadow roots), the `onLineClick`
      prop chain (DiffPart→SandboxedPart→Card), and the server `CommentAnchor`
      line variant + `parseAnchor` all still exist but are **dead** — Card passes
      no `onLineClick`, so the posted line-click message is consumed by nobody.

_(A GitHub round-trip — `gh pr review` with line comments — was considered and
**dropped**: showcase is its own surface, not a GitHub front-end. Sharing a
review with others is the static-export path under Supporting capabilities.)_

#### Review depth — fancier review visualizations (a track to develop)

Migrated from the original PR-review design doc (now removed — its design is
shipped: R1–R4 plus the opinionated overview, risk treemap, confidence×coverage
quadrant, edge-status change map, live burndown, and keyboard traversal). These
are the next depth investments to make the review _best-in-class_ — worth working
through deliberately, one at a time. They stay opt-in per PR so the overview
never clutters; getting each one to feel right matters more than shipping fast.

**Substrate decision (post-security-audit):** build these on the existing
**Recharts `chart` part** — trusted React → SVG from structured data, the
audited-safe path — and small hand-rolled trusted-SVG parts for the few shapes
Recharts lacks (matrix, arc, minimap). **No sandboxed D3 kit**: Recharts is
already in the app, D3 would add ~250KB + a brand-new sandboxed-iframe attack
surface for zero benefit, and treemap/scatter were already added this way.

- **Opt-in depth visuals** — each extends the trusted chart path:
  - **churn×complexity hotspot bubble** — Recharts scatter + a size (Z) axis.
  - **coupling-delta bar** — Recharts stacked bar (already possible).
  - **file minimap / heat-strip** — small custom-SVG React part.
  - **adjacency / co-change matrix** — custom-SVG rect grid.
  - **layered arc diagram** — custom-SVG `<path>` arcs.
  - **overview blast radius** — mermaid (already have).
  Swap in per PR (a big refactor wants the matrix; a one-file fix wants the
  minimap) — never all at once.
- **Chart-cell → navigate bridge** — make a chart cell/point clickable → jump to
  that file's hunks / finding → comment in place. The chart parts render in the
  trusted viewer, so this is a direct React click handler (no postMessage), not
  the diff-iframe bridge. Without it the review charts are pictures, not the
  review's index. _Effort:_ ~2–3h.
- **In-file moved-code detection** — `@pierre/diffs` detects file-level renames but
  not in-file block moves; label "moved, unchanged" instead of delete+add. Spike
  the renderer first. _Effort:_ unknown (renderer-gated).
- **Tour surface** — an optional `slides` / `animate` walkthrough for a complex
  PR's narrative ("added the column → backfilled → flipped the read path").
  Deferred polish; the overview is the win. _Effort:_ ~2–3h.

_Explicitly **not** doing:_ large-diff row virtualization — the per-file SSR diff
render is adequate; revisit only if one huge file's hunk count bites.

### Workflow 2 ⭐ — Learning & explainers (shipped)

> _Share a screenshot/snippet with your agent; get back an animated, interactive
> explainer you can scrub and question._ Leans on html parts + the kit system.
> **All three pieces shipped — build on them, don't redo them.**

- [x] **L1 — Animation kit (shipped).** The opt-in `animate` kit (`server/kits.ts`)
      reveals `.anim > .step` children cumulatively and injects play/pause + a scrub
      bar + counter (Space toggles, arrows step, `<span class="cue">` highlights a
      phrase); self-contained, reduced-motion aware, themed. Covered by
      `test/kits.test.ts`.
- [x] **L2 — Screenshot → explainer recipe + demo (shipped).** PLAYBOOK's "animated
      explainer" recipe + the DESIGN_GUIDE kit docs teach the screenshot →
      `kits:["animate"]` loop (image part for the source + an `animate` explainer),
      and `bin/demoData.js` seeds a live explainer (the hashmap walk-through).
- [x] **L3 — Reading/learning mode (shipped).** `ReadingView` gives a focused,
      one-explainer-at-a-time view (full-width, distraction-free), gated by
      `readingId` and scoped to explainers.

### Supporting capabilities (pick up when a workflow needs them)

Not flagship work; each is tagged with the workflow it serves. Don't build these
for their own sake.

- [x] **Static export (shipped)** _(sharing)_ — `showcase export <session>` →
      one self-contained read-only `.html` of a review/explainer to send anyone.
      `server/export.ts` inlines the session bundle (surfaces + comments + assets
      as `data:` URIs) and `__SHOWCASE_READONLY__` into a copy of the viewer; the
      viewer's `api()` reads the bundle in place of the network, html parts render
      via `srcdoc` (no `/s/:id`), and the SSE/composing pings are skipped — so it
      renders with zero requests. `--pdf` renders that HTML through headless system
      Chrome (`findChrome` / `$SHOWCASE_CHROME`, no npm dep) to a flat PDF for
      recipients who won't open an HTML file; an `@media print` pass drops the app
      chrome. The `--pdf` path requests a **flattened** export (`?flatten=1`):
      rich parts (markdown/code/diff/mermaid/terminal) render inline in document
      flow instead of in srcdoc iframes, so a tall part now **paginates across
      pages** instead of clipping at the iframe height cap, and a review export
      renders its card stream (the verdict + finding surfaces) since the
      decision-queue data isn't in the static bundle. Remaining limit: raw `html`
      parts stay sandboxed (iframe), so a tall html part can still clip in PDF.
      Verified end-to-end in a browser and as a PDF (offline, no network).

---

## 7. Open decisions (flag to the user before building the affected pillar)

- **~~Editor-agent engine~~ (DECIDED, then feature RETIRED):** the no-SDK stance
  still holds, but the in-browser editor chat it described was removed (see
  "Editor-agent chat" above). The feedback path is the comment/`wait_for_feedback`
  pull in §4 — no hosted SDK, and no in-browser chat either.
- **No GitHub round-trip (DECIDED):** showcase is its own surface, not a GitHub
  front-end. Sharing a review means static export, not posting back to a PR.
- **Sharing is read-only:** the one-board/one-user stance means shared output
  (static export) is a read-only snapshot — no live/comment bits.

---

## 8. Picking up work in a background session

1. Read sections 1–5 of this file and `AGENTS.md`.
2. `git branch --show-current` — if not on a task branch, branch from `main`.
3. Both flagship workflows are shipped — Workflow 1 (visual PR review, R1–R4) and
   Workflow 2 (learning & explainers, L1–L3). Remaining work is two **Supporting
   capabilities** (static export, visual version diff) plus the **review-depth /
   fancier-visualizations** track (start with the charting kit). If an item is an
   "open decision" in §7, confirm it first.
4. Build in small commits; after each, run the §5 verify suite. For UI, screenshot
   and look.
5. Keep the oracle green; if you change behavior it covers, update the oracle in
   the same commit.
6. When the chunk is green + reviewed, fast-forward merge to `main`.
