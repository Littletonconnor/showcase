# showcase — project guide & roadmap

The single doc to read before working on showcase — especially in a background
session. Sections 1–5 are "how it works / how to work here" (stable reference);
section 6 is the roadmap (what to build); sections 7–8 are open decisions and
how to pick up work autonomously. Architecture detail lives in `AGENTS.md`.

**👉 The decision-review form factor is built, dogfooded, and complete — the
shipped summary is immediately below.** Sections 1–8 are the stable guide/roadmap
underneath it.

---

## ⭐ Active focus — decision-review form factor

An agent decomposes a PR into a small, risk-ranked queue of **decisions** (a
plain-English Brief + per-decision confidence + evidence + a complete changed-file
manifest), published via `publish_decisions` / `POST /api/sessions/:id/review`,
rendered inline in the board for a `kind === "review"` session. North-star design:
`docs/review-form-factor.md`.

**✅ The two-API fork is resolved.** The old finding-card review model
(`publish_review` / `review_finding` MCP tools, `showcase review` / `showcase
finding` CLI, the verdict card + finding cards + risk treemap + confidence×coverage
quadrant + `changeMap`) has been **removed**. `publish_decisions` is now the single
review path, registered on **both** the HTTP and stdio MCP transports (manifest
included), with `showcase decisions <session> <file>` as the CLI. The static export
inlines the stored review so a shared review renders offline.

This is a **dogfood-driven redesign** — built it, reviewed a real Java PR through
it (`wealthfront-lembas` `cl/ALLM-126`), and the shipped list below is the feedback
that surfaced. Get the human's intent right; this is UX, not just plumbing.

### Shipped — do NOT redo, build on it

The form factor is built and was dogfooded against a real Java PR
(`wealthfront-lembas` `cl/ALLM-126`):

- **Inline board rendering** — a `kind === "review"` session takes over the main
  panel via `ReviewInline` → `ReviewView`; sidebar rows chip their verdict and open
  the review inline.
- **The live loop** — `publish_decisions` MCP tool (HTTP + stdio, manifest on
  both), `review-updated` SSE event, `ReviewView` / `ReviewInline` / `ReviewPage`.
  `coerceReview` does server-side newline normalization + the brief-format warning.
- **Complete changed-file manifest** (Phase 1) — `ReviewView`'s collapsible "All N
  files changed" panel (`Manifest`, fed by `Review.manifest` / `ManifestFile`) tags
  every file `has-decision` / `reviewed · no comment` / `mechanical · skipped` with
  line counts, linking to its decision. Addresses the "trusting the skip set" distrust.
- **Decision IDs + adjudication** (Phase 2) — "Verify" verb dropped; each decision
  carries a stable copy-ref (`CopyRef`) you paste into normal agent chat to scope a
  revision; a lightweight local **Accept** drives the burndown; content-keyed so it
  survives an agent re-publish.
- **Honest ledger** (Phase 3) — the "High confidence / Checked / Not yet" labels are
  gone; one signal, "How sure", in plain words (Confident / Fairly sure / Not sure).
  Unbacked self-reported "what I verified" claims were dropped.
- **Suggested fixes** (Phase 4) — `EvidencePane` renders `Decision.proposal` as a
  labeled before→after "Suggested fix" diff beneath the evidence.
- (Also fixed the `code-review` skill to scope depth per-slice so reviews stop
  fanning out 5 specialists over the whole diff — `~/Sites/ai-config`.)

- **Single in-browser verb: Accept** — the Disagree button (and its composer,
  `D` key, structured `disagreeText` comment, and per-decision comment trail) was
  dropped. Pushback is now the copy-ref + normal-chat flow: copy a decision's
  stable ref and paste it into agent chat to scope a revision; the agent
  re-publishes and the decision updates in place. The burndown is accepted-only.

### Key files

- `server/types.ts` — `Review` / `Decision` / `DecisionProposal` / `ManifestFile`
  (stable decision `id`s and the `manifest` field) + `Store`.
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
   An agent reviews a diff and publishes a **decision queue** (`publish_decisions`):
   a plain-English Brief anyone can read, a risk-ranked list of **decisions** each
   with its evidence (a diff, a control-flow **mermaid**, a suggested-fix diff), and
   a complete changed-file manifest. You Accept each decision, or copy its ref into
   chat to ask for a revision; it revises in place; the review carries a shareable
   verdict. No GitHub thread renders like that.
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

Three parts: **what's shipped** (don't redo), **what's retired/cut** (don't
rebuild), and **what's actually left**. The roadmap is organized by **workflow**,
not by capability — the two flagship workflows (§1) set priority.

**Why workflows, not features:** the rendering primitives for a great review card
were never the hard part — the multimodal card in the product screenshot is just a
`[prose, mermaid, diff]` surface, and the diff renderer already does file
headers, line numbers, syntax highlighting, and unchanged-line folding. The work
was the _workflow_ that makes an agent produce those cards by default, plus the
review-level structure (severity, verdict, share-back) that turns a pile of cards
into a review — that's Workflow 1, now shipped (R1–R4).

### ✅ Shipped foundation — don't redo, build on it

The viewer redesign, the design-polish backlog, and both flagship workflows are
complete. The stable base everything below assumes:

- **Redesign** — viewer ported Solid → React 19 + zustand + Tailwind v4 + shadcn;
  styling fully on Tailwind utilities (no `styles.css` rules); one self-contained
  `index.html`.
- **Slimmed** — stream-only (no Stream/Timeline toggle), no server-side trace
  pipeline, no Cloudflare SqlStore, no multi-theme engine — one fixed GitHub
  light/dark theme with `server/themes.ts` as the single color source.
- **claude.ai-grade chrome (Pillar F1–F17)** — shadcn `Sidebar`, per-session
  overflow menu (rename / delete / copy-link), live search, app header, surface-card
  chrome, skeletons + empty states, lucide icon set, motion pass, Sonner toasts,
  one type/spacing scale, dark mode.
- **Primitives** — `chart` part (Recharts, themed SVG, `showcase chart`, in the MCP
  schema); markdown **math** (`$…$`/`$$…$$` via KaTeX → MathML); the **kit gallery**
  (`issues` / `slides` copy-paste markup); **structured feedback** (one-tap Approve
  👍 / Dismiss ⊘ posting an `author:"user"` signal); a **hardened oracle**
  (`render-smoke.spec.ts` + an opt-in real-Chrome Playwright lane).
- **Workflow 1 — Visual PR review (R1–R4)** — finding-card `badge` (tone+label) +
  the recipe + demo; a live verdict bar derived from badges (burns down on
  Approve/Dismiss); `showcase review <branch>` ingestion (churn-seeded manifest +
  risk scaffold, delegates analysis to the `code-review` skill).
- **Workflow 2 — Learning & explainers (L1–L3)** — the opt-in `animate` kit
  (`server/kits.ts`: cumulative `.step` reveal + scrub bar, reduced-motion aware),
  the screenshot→explainer recipe + demo, and `ReadingView` (one-explainer focus
  mode).
- **Static export** — `showcase export <session>` → one self-contained read-only
  `.html` (surfaces + comments + assets inlined as `data:` URIs); `--pdf` renders it
  through headless system Chrome with a flattened, paginating layout.

### Retired / cut — don't rebuild (commit `03c2693` unless noted)

- **Chat thread** — the per-surface comment thread + composer (`Thread.tsx`). Surface
  feedback is now Approve/Dismiss + decision threads + "copy the card id, mention it
  in your terminal."
- **Anchored annotations + line-anchored diff comments (R4)** — point-pin, line-click
  composer, and the whole `CommentAnchor` / `parseAnchor` / `onLineClick` machinery;
  all removed from the tree.
- **Drill-down chip** — the "Suggested by this surface" chip + "Send to agent" button.
  (The `sendPrompt()` html-part bridge survives and works — it posts an
  `author:"surface"` comment — but has no dedicated viewer affordance.)
- **Editor-agent chat (was Pillar B)** — never shipped; no in-browser chat, no
  `showcase chat`, no presence dots. Only the `listening` green dot survives. The
  real loop is the comment / `wait_for_feedback` pull (§4).
- **Pinned Library** — cut by the daily-use razor; pin/Library wiring removed
  end-to-end.
- **GitHub round-trip** (`gh pr review` line comments) — dropped on purpose;
  showcase is its own surface, not a GitHub front-end. Sharing = static export.

---

### 🔨 What's actually left

Everything in §1's two flagship workflows is shipped. Two things remain, neither
load-bearing:

1. **Review-depth visuals** — the opt-in per-PR chart track below.
2. **In-file moved-code detection** + an optional **Tour surface** — both below.

#### Review depth — fancier review visualizations (a track to develop)

The base review (R1–R4) ships with the opinionated overview, risk treemap,
confidence×coverage quadrant, edge-status change map, live burndown, and keyboard
traversal. These are the next depth investments to make the review _best-in-class_
— worth working through deliberately, one at a time, opt-in per PR so the overview
never clutters. Getting each one to feel right matters more than shipping fast.

**Substrate decision (post-security-audit):** build these on the existing
**Recharts `chart` part** — trusted React → SVG from structured data, the
audited-safe path — plus small hand-rolled trusted-SVG parts for the few shapes
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
- **In-file moved-code detection** — `@pierre/diffs` detects file-level renames but
  not in-file block moves; label "moved, unchanged" instead of delete+add. Spike
  the renderer first. _Effort:_ unknown (renderer-gated).
- **Tour surface** — an optional `slides` / `animate` walkthrough for a complex
  PR's narrative ("added the column → backfilled → flipped the read path").
  Deferred polish; the overview is the win. _Effort:_ ~2–3h.

_Explicitly **not** doing:_ large-diff row virtualization — the per-file SSR diff
render is adequate; revisit only if one huge file's hunk count bites. Also dropped:
a GitHub round-trip (`gh pr review` line comments) — showcase is its own surface,
not a GitHub front-end; sharing is the static export.

_(Workflow 2 — learning & explainers — and static export are both shipped; see the
shipped-foundation list above.)_

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
   Workflow 2 (learning & explainers, L1–L3); the supporting **static export** is
   shipped too. Remaining work is the **review-depth / fancier-visualizations**
   track (opt-in per-PR chart types). If an item is an "open decision" in §7,
   confirm it first.
4. Build in small commits; after each, run the §5 verify suite. For UI, screenshot
   and look.
5. Keep the oracle green; if you change behavior it covers, update the oracle in
   the same commit.
6. When the chunk is green + reviewed, fast-forward merge to `main`.
