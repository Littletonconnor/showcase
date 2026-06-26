# Best-in-class PR visualization for the age of LLMs

_A design + implementation plan for showcase's flagship "Visual PR review" workflow._

Status: **draft for review.** Built from a full read of the existing review
system (`server/app.ts` `publishReview`, `buildFinding`, `buildChangeMap`,
`buildChurnChart`; `server/kits.ts`; `viewer/src/DiffPart.tsx`; `TODO.md`
Workflow 1) plus PR-review UX prior art. A parallel deep-research run (GitHub's
reengineered diff surface, pair-review's AI-review patterns; adversarially
verified) is folded into §6 — it corroborates the IA, finding-scope, keyboard,
and large-diff mechanics, and the unsupported parts (risk scoring, semantic
diffs) are flagged as design judgment. This doc states the design first so we
can argue about it before writing code.

---

## 0. The thesis (why redo this at all)

When a **human** wrote the code, review was _trust transfer_: the author
understood every line and the reviewer spot-checks for the mistakes humans make.
When an **LLM** wrote the code, two things invert:

1. **The author isn't trusted.** The agent is fast, confident, and sometimes
   wrong in ways that look right. The reviewer can't lean on "they understood
   it." Every line is suspect until the reviewer understands it themselves.
2. **The volume explodes.** Agents open bigger PRs, more often. The reviewer's
   scarce resource stops being _diligence_ and becomes **attention**.

So the job of the visualization is not "show the diff." GitHub already shows the
diff — files alphabetical, every line equal weight, zero signal about what
matters. That's a **diff browser**, not a **review tool**. A diff browser scales
with the size of the change. A review tool scales with the size of the _risk_.

> **The product is attention routing.** Put the reviewer's eyes on the lines
> that carry risk, in an order that builds understanding, with the context to
> judge each one — and let them confidently _skip_ the rest. Everything below
> serves that one sentence.

showcase already has the right _primitives_ (multimodal cards, a diff renderer,
severity badges, a verdict bar, line-anchored comments). What's missing is the
**information architecture** that decides what matters and the **standardized
template** that renders it the same way every time. That's this doc.

---

## 1. What exists today (the baseline we build on)

The flagship workflow is real and mostly shipped (TODO.md R1–R4):

- **`publish_review`** (`server/app.ts:782`) explodes one call into:
  - a **verdict card** — `buildVerdictMarkdown` (summary + severity tally + a
    `| Severity | Finding | Location |` table + coverage note), then an optional
    **change map** (`buildChangeMap` → styled mermaid, nodes tagged
    new/modified/touched/removed), then a **churn chart** (`buildChurnChart` →
    stacked added/removed bars, top-10 files).
  - **one finding card per finding** — `buildFinding` composes
    `[markdown(problem) → diff(fix) → markdown(why) → mermaid(diagram)]` with a
    severity badge. `suggestion:{before,after}` is preferred over `patch` because
    the viewer computes the diff and it always renders.
- **Verdict bar** in the session header, derived live from finding badges, with
  approve/dismiss burn-down.
- **`diff` part** (`viewer/src/DiffPart.tsx`) via `@pierre/diffs`: Shiki
  highlighting, unified/split, per-file shadow roots, **clickable lines →
  line-anchored comments** (R4).
- **`issues` kit** (`server/kits.ts`): `.card/.tree/.badge/.chip/.dot/.bar` for
  PR/CI status trees.

This is a strong base. The gaps are all in the same place: **the review doesn't
have an opinion.** It lists findings the agent chose to write, shows churn, and
draws a diagram — but it never tells the reviewer _where to spend attention_,
never orders files by risk, never says what the agent _didn't_ check, and the
diff is a flat unified view with no manifest, no intra-line precision, and no
keyboard traversal.

---

## 2. Five design principles

Each principle maps to one of the four focus areas (IA, diff, finding cards,
interactivity) and to a concrete change in §4.

### P1 — Lead with a verdict, not a diff _(IA)_

The first screen must answer four questions before the reviewer scrolls into a
single hunk:

1. **What is this PR trying to do?** One or two sentences in the agent's words —
   _intent_, not a file list.
2. **How big and how risky is it?** A single composite **risk signal**, broken
   into legible sub-signals (see P-risk below).
3. **Where do I spend my attention?** A **review budget**: "~8 min · 3 files
   need real eyes · 9 are mechanical."
4. **Is it safe to approve?** The verdict chip + findings tally (already there).

This is the inversion of GitHub: the diff is the _last_ thing you reach, not the
first. The overview is a map you read before entering the territory.

**Composite risk, made of four sub-signals** — each a small bar, the composite a
labeled band (Low / Elevated / High), never a bare number:

| Sub-signal       | What it measures                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| **Size**         | Total churn (added + removed), log-scaled.                                                                 |
| **Surface area** | Number of distinct files / modules / public exports touched.                                               |
| **Sensitivity**  | Are touched paths security / auth / data-model / migration / money / deletion / config? Weighted heaviest. |
| **Test delta**   | Did test lines move with the change, or did logic change with tests untouched? (untouched = riskier)       |

The point is not a precise score — it's **directing attention**. A 2000-line PR
that's all generated lockfile churn is _Low_; a 30-line change to auth token
validation with no test delta is _High_. The visualization must say so.

### P2 — Order by importance, not by path _(diff)_

The single highest-leverage change. The **file manifest** replaces the
alphabetical file list with a **priority-ranked** one:

1. **Sensitive** paths first (auth, data model, public API, migrations, money,
   deletes, CI/deploy config).
2. **High-churn logic** next.
3. **Mechanical** changes last — generated files, lockfiles, vendored code,
   snapshots, pure formatting — **collapsed by default** into a "low-attention"
   bucket the reviewer confirms in one glance.

Each manifest row carries: a **priority chip**, a **churn sparkline** (+green
/ −red), a one-line **"why it matters,"** a **"reviewed" checkbox**, and a jump
link to that file's hunks. The reviewer reads the manifest, decides _which three
files are real_, reviews those, and confirms the rest as a batch.

Within a file, the diff itself improves (P4): word-level intra-line precision,
moved-code detection, collapse of unchanged/whitespace/generated regions.

### P3 — Show the change, then its _consequence_ _(finding cards + blast radius)_

A diff shows _what_ changed. Review needs _what it affects_. The finding card
stays the unit of "look here," but gains the context a reviewer would otherwise
reconstruct by hand:

- **Blast radius** — a tiny call-graph: what calls this, what this calls, which
  tests cover it. Even three mermaid nodes ("`validateToken` is called by
  `authMiddleware`, `wsUpgrade`; now also calls `revocationList`") beats reading
  the raw hunk cold.
- **Scope tier** — each finding declares the scope it was found at, borrowing
  the verified three-tier model from pair-review (§6): **changed-lines** (a bug
  in the diff itself), **whole-file** (an inconsistency with the rest of the
  file), or **codebase** (an architectural conflict with code outside the diff).
  The tier tells the reviewer how far they have to look to judge it, and a
  codebase-tier finding _is_ the blast-radius signal made explicit.
- **Verification honesty (the LLM-age signal).** Each finding declares the
  agent's **confidence** and **what it did _not_ check**. "High confidence,
  reproduced with a test" vs "Plausible — I did not run the migration" is itself
  a review aid. The most dangerous LLM output is a confident-looking change in an
  unchecked area; making that gap _visible_ is the whole game.
- The existing `problem → fix diff → why` spine stays — it's good. We enrich the
  head (severity + confidence + verified state) and optionally the tail (blast
  radius).

### P4 — Progressive disclosure at three zoom levels _(cognitive load)_

Always three levels, each collapsible into the one above:

1. **Review** — verdict + risk + manifest + tally. _Approve/skip decisions live
   here._
2. **File / concern** — a group of related hunks under one intent line.
3. **Hunk / line** — the actual diff, word-level intra-line highlighting,
   line-anchored comments.

Collapse by default: unchanged regions, whitespace-only changes, **moved code**
(detect and label "moved, unchanged" instead of showing it as delete+add),
generated/vendored files. The reviewer expands on demand. Large diffs degrade
gracefully — a 4000-line file shows its manifest row and hunk count, and only
materializes the diff when opened.

### P5 — Keyboard-driven, comment-in-place traversal _(interactivity)_

Review is a _traversal_, not a scroll. The reviewer should fly through what
matters without touching the mouse:

- `j` / `k` — next / previous significant hunk or finding.
- `n` — jump to next **unreviewed** file (skips the mechanical bucket).
- `c` — comment on the current line/finding in place (extends the R4
  line-anchor → composer flow already in the bridge).
- `x` — mark current file reviewed (drives manifest burn-down).
- `a` / `d` — approve / dismiss the current finding (extends the existing
  verdict-bar burn-down).
- The **drill-down loop** (`sendPrompt`) gives each finding a "go deeper" button
  that proposes a specific follow-up question the user can relay in one tap.

The reviewer watches the manifest and verdict bar **burn down** as they go — the
review has a visible terminal state, which is exactly what high-volume LLM review
needs.

This is also a genuine **differentiator**: the research found AI-review tooling's
keyboard support is still immature (pair-review ships a single chord), while
GitHub treats keyboard nav + screen-reader landmarks as first-class (§6). A
keyboard-complete review traversal is table stakes for "best in class" and
nobody in the AI-review space has it yet. Align the bindings with the
established convention where one exists — `j`/`k` for next/previous is what
GitHub trained reviewers on.

---

## 3. The standardized template

A review **session** is an ordered stack of surfaces. Every review looks the
same so a reviewer never re-learns the layout:

```
┌─ Overview surface ──────────────────────────────────────────┐
│  title · branch → base · verdict chip                        │
│  Intent: one–two sentences, the agent's words               │
│  ┌ Risk ─────────────┐  Review budget: ~8 min · 3 hot · 9 cold │
│  │ band: Elevated    │                                       │
│  │ size ▇▇ · area ▇ · sens ▇▇▇ · tests ▇                  │
│  └───────────────────┘                                       │
│  Change map (mermaid — the system view)                     │
│  File manifest (priority-ordered):                          │
│    ● auth/token.ts      +18 −4   sensitivity · token check  [ ]│
│    ● api/routes.ts      +40 −12  public API                 [ ]│
│    ○ pkg-lock.json    +900 −200  generated (collapsed)      [✓]│
│  Findings: 1 Bug · 2 Nits · 1 Question                      │
└─────────────────────────────────────────────────────────────┘
┌─ Finding surface (one per finding, priority-ordered) ───────┐
│  [Bug] · high confidence · verified                          │
│  Problem — …                                                 │
│  Fix diff (before → after, word-level)                       │
│  Why it's better — …                                         │
│  Blast radius (mini call-graph)        [ Explain edge case ▸ ]│
└─────────────────────────────────────────────────────────────┘
┌─ (optional) Tour surface — a slides/animate walkthrough ────┐
│  For complex PRs: the 4-step story of the change            │
└─────────────────────────────────────────────────────────────┘
```

- **Overview** is the new IA centerpiece (P1 + P2).
- **Finding** cards are the enriched existing cards (P3).
- **Tour** is optional, reusing the `slides`/`animate` kits for PRs that have a
  narrative ("first I added the column, then backfilled, then flipped the read
  path").

---

## 4. Implementation plan

Sequenced so each step ships standalone and green. The philosophy stays theirs:
**structure is the API** — the agent submits structured fields, showcase composes
the visual, so the output physically cannot regress to a wall of prose.

### Step A — A `review` kit (server/kits.ts) `~3h`

A new opt-in kit so the overview renders consistently and re-themes with the
board. New vocabulary (all driven by existing `--color-*` tokens):

- `.risk` band + `.signal` sub-bars (size / area / sensitivity / tests).
- `.budget` line.
- `.manifest` / `.manifest-row` — priority `.dot`, churn sparkline (`.spark`
  with green/red segments), reviewed checkbox.
- `.finding-head` — severity + confidence + verified chips.

Pure CSS (plus the existing kit token system); a small JS behavior for the
reviewed-checkbox burn-down can ride the kit's optional `js` slot. Acceptance: an
html part with `kits:["review"]` renders the overview mock above in light + dark.

### Step B — Structured overview composition (server/app.ts) `~4h`

Extend `publishReview` to accept and compose the richer overview instead of the
flat markdown table. **Risk and priority are agent-authored** (decided): the
reviewing agent has the semantic context a path regex never will — it knows a
30-line auth-token change is riskier than a 900-line lockfile bump — so it
declares them directly. The server's job is to render them _consistently_, not to
second-guess them.

- New `ReviewInput` fields: `intent`, `risk:{size,surfaceArea,sensitivity,
testDelta,band}` (each a 0–3 agent-supplied weight + an overall band label),
  `budget` (the review-time / hot-vs-cold line), and `manifest:[{file, added,
removed, priority, note}]` where the agent supplies `priority`
  ("sensitive"|"logic"|"mechanical") and the one-line `note`.
- A `buildOverview()` that emits the `review`-kit html part (manifest + risk +
  budget) above the existing change map. Manifest rows render in the agent's
  declared priority order; `mechanical` rows collapse by default.
- `buildVerdictMarkdown` stays as the **fallback** for callers that pass no
  structure (back-compat — old `publish_review` calls still render).
- Light, optional **churn-based default ordering** only as a tiebreak when the
  agent omits `priority` on a row — never as an override of an authored value.

Acceptance: `publish_review` with the new fields renders the overview in the
agent's priority order; old callers still work (additive).

### Step C — Enriched finding cards (server/app.ts) `~2h`

Add **required** `confidence:"high"|"medium"|"low"`, **required** `coverage`
(a short string: what the agent _did_ and _did not_ check for this finding —
e.g. "reproduced with a unit test" / "did not run the migration"), plus optional
`verified:boolean` and `blastRadius:{nodes,edges}` to `FindingInput`.

Required is the decision: the most dangerous LLM output is a confident-looking
change in an unchecked area, so every finding must declare its confidence and its
coverage gap. `validateFinding` rejects a finding missing either field (400), the
same way `title`/`problem` are required today — **structure is the API**, and the
honesty signal is now part of the structure.

`buildFinding` renders a confidence chip + a coverage line in the head and an
optional blast-radius mermaid in the tail (reusing `buildChangeMap`'s styling).

Acceptance: a finding without `confidence`+`coverage` is rejected; a complete one
shows the chips + coverage line; the `problem → fix → why` spine is unchanged.

### Step D — Diff experience upgrades (viewer/src/DiffPart.tsx) `~4–6h`

- **Word-level intra-line** highlighting — confirm `@pierre/diffs` support; if
  present it's a render option, if not, a post-process pass over hunks.
- **File manifest header** for multi-file diffs — a sticky strip listing files
  with churn + jump, collapsing generated/vendored files by default.
- **Moved-code** labeling and **collapse of large unchanged regions** with
  expand-on-demand.
- **Large-diff handling** — the research's most strongly-verified mechanical
  lesson (§6): GitHub made massive PRs reviewable via window virtualization
  (render only the visible rows) and event delegation (one top-level handler
  reading data-attributes, not per-line listeners), cutting JS heap and DOM
  nodes ~10×. showcase's diff already SSR-renders per file and the bridge
  already uses a single delegated click handler (`composedPath`) — so we're
  aligned on delegation. The open risk is a single _huge_ file's hunk count
  inside one iframe; if it bites, virtualize rows or paginate hunks. Budget a
  spike here rather than pre-optimizing.

Keep the trusted-origin DOM hooks the oracle asserts on (`.card[data-id]`,
per-part iframes, `.thread .cmt.user`) intact.

### Step E — `showcase review <pr>` ingestion (TODO R3) `~3h`

The on-ramp so the agent doesn't hand-build any of this. One command reads
`gh pr diff <n>` / `git diff <range>`, computes churn + manifest + risk
heuristics, creates a session titled after the PR, and seeds the overview
placeholder. The agent fills in intent + findings. Acceptance: `showcase review
123` opens a ready review session.

### Step F — Keyboard traversal (viewer) `~3h`

A review-mode keyboard layer: `j/k/n/c/x/a/d` over the session's surfaces,
driving the manifest + verdict burn-down. Builds on the existing bridge
line-click and verdict-bar resolve. Acceptance: a reviewer can traverse and
resolve a whole review without the mouse; oracle covers the key paths.

### Updated agent guidance `~1h`

`guide/DESIGN_GUIDE.md` + `guide/AGENT_HOWTO.md`: document the `review` kit, the
new `publish_review` fields (intent / risk / manifest / confidence / verified /
blast radius), and the standardized template, with a copy-paste example. Reseed
`bin/demoData.js` so the demo review reproduces the new overview.

---

## 5. Sequencing & scope

- **Phase 1 (the visible win):** A → B → C. The standardized, opinionated
  overview + enriched findings. This alone is the "best-in-class template" and is
  demo-able end to end with the existing diff renderer.
- **Phase 2 (the diff depth):** D. Word-level, manifest header, collapsing.
- **Phase 3 (the flow):** E → F. Ingestion on-ramp + keyboard traversal.

Each phase is independently shippable and independently valuable. Phase 1 is what
makes a reviewer say "this is the one I'm proud of."

> **Shipped status (update).** Phases 1 & 3 are complete (Steps A–C, E–F). Of
> Phase 2 (Step D): word-level intra-line highlighting, the multi-file **manifest
> header** (with added/modified/deleted/moved/renamed labels + churn), and
> **collapse of generated/vendored files** are shipped; **large-diff
> virtualization is intentionally skipped** (the existing per-file SSR render is
> adequate), and **intra-file moved-code block detection** is deferred —
> `@pierre/diffs` detects file-level renames/moves but not in-file block moves.
> From §8: the edge-status interaction map, the **review burn-down** (a live
> header sparkline), the **risk-weighted treemap**, and the **confidence ×
> coverage quadrant** are shipped on the existing Recharts `chart` path (new
> `treemap`/`scatter` types) — the sandboxed D3 charting kit (§8.5 #1) was **not**
> needed for these and the chart-cell→navigate bridge (§8.5 #3) remains future
> work. The `x` keyboard binding (mark file reviewed) is wired. The **Tour
> surface** (§3) remains deferred by design.

### Validation gate (every step)

`npm run typecheck` · `npm run lint` · `npm run build:viewer` ·
`npx playwright test` · screenshot the surface and look at it. Keep the oracle
DOM hooks intact; update the oracle in the same commit when behavior it covers
changes.

---

## 6. Evidence base (deep-research corroboration)

A parallel deep-research run (5 angles → 21 sources → adversarial 3-vote
verification, 13/14 claims confirmed) backs the design. Honest summary: the
_mechanics_ and _IA_ are well-evidenced; the _risk-scoring / semantic-diff / blast
-radius_ ideas are my design judgment, **not** corroborated — the run explicitly
couldn't confirm them. Both are called out below.

**Confirmed — what the design leans on:**

- **Verdict-first IA / file-tree triage.** GitHub's reengineered "Files changed"
  ships a resizable file-tree with **per-file status indicators** (comments,
  errors, warnings) so reviewers triage which files need attention — direct
  support for P2's manifest. ([GitHub changelog, 2025-06-26](https://github.blog/changelog/2025-06-26-improved-pull-request-files-changed-experience-now-in-public-preview/))
- **Keyboard-driven review is first-class, and an AI-tooling gap.** GitHub built
  consistent keyboard nav + screen-reader landmarks with `j`/`k` file nav;
  AI-review tools haven't (pair-review documents one chord). P5 fills a real gap.
  ([GitHub changelog](https://github.blog/changelog/2025-06-26-improved-pull-request-files-changed-experience-now-in-public-preview/) · [pair-review](https://github.com/in-the-loop-labs/pair-review))
- **Tiered AI analysis by scope.** pair-review runs three levels in parallel —
  **L1 changed-lines bugs · L2 whole-file consistency · L3 codebase-wide
  architecture** — deduped and merged. This is the verified basis for the new
  finding **scope tier** (P3). ([pair-review](https://github.com/in-the-loop-labs/pair-review))
- **Source-attributed, human-in-the-loop suggestions.** pair-review color-codes
  by source (AI=orange, your drafts=purple, external=blue) under "AI suggests,
  you decide" — the human adopts/edits/discards. showcase already separates
  agent vs user comments by alignment/color; keep that discipline and make the
  agent-authored verdict clearly _the agent's_, arbitrated by the user. ([pair-review](https://github.com/in-the-loop-labs/pair-review))
- **Large-diff mechanics.** Window virtualization + event delegation (~10× heap/
  DOM reduction); split view costs ~1.5× the DOM of unified per line. Folded into
  Step D. ([GitHub Engineering](https://github.blog/engineering/architecture-optimization/the-uphill-climb-of-making-diff-lines-performant/))

**Not corroborated — flagged as design judgment, not evidence:**

- **Risk / blast-radius _scoring_.** No surviving claim supports a composite risk
  meter or quantified blast radius. It's a reasoned bet (and the decision to make
  it _agent-authored_ rather than computed sidesteps the "is the formula right"
  problem). Treat the risk panel as a hypothesis to validate in use, not a proven
  pattern.
- **Semantic/AST diffs, moved-code detection, word-level intra-line, split-vs-
  unified merits.** None confirmed (several strong sources — matklad's unified-vs-
  split essay, difftastic — were rated unreliable by the verifier and dropped).
  Directionally, the unified-vs-split essay argues the right answer is
  context-dependent, which supports keeping showcase's existing `layout` toggle
  rather than hard-coding one. Step D's word-level/moved-code work stays gated
  behind the `@pierre/diffs` capability spike (open question 4).
- **Source concentration caveat.** Confirmed evidence comes from two vendors
  (GitHub, pair-review), both primary but self-reported. Good enough to anchor a
  design, not a benchmark. Full report + open questions:
  `/tmp/.../tasks/wgupv54lq.output` (run `wgupv54lq`).

**Net effect on the plan:** no structural change. The research _strengthens_
Phases 1 and 3 (IA, finding scope, keyboard, attribution) and _tempers_ Phase 2
(diff depth is less evidence-backed and more renderer-constrained than the rest —
so it rightly sits last and behind a spike).

## 7. Decisions & open questions

**Decided:**

1. **Risk & priority are agent-authored** (not server-computed). The agent has
   the semantic context to judge risk; the server renders it consistently. A
   churn-based default only breaks ties when the agent omits a row's priority.
2. **Confidence + coverage are required on every finding.** A finding must
   declare how confident the agent is and what it did/didn't check; the server
   rejects findings missing either. This makes the dangerous case — a confident
   change in an unchecked area — impossible to hide.

**Still open:**

3. **Tour surface** — build now, or defer until Phase 1 proves the overview? I'd
   defer (it's optional polish; the overview is the win).
4. **Diff renderer ceiling** — if `@pierre/diffs` can't do word-level or
   moved-code, how far do we go? Options: post-process the hunks, fork the lib,
   or accept line-level and reinvest the saved time in the manifest/IA. I'd
   timebox a spike on `@pierre/diffs` capabilities before committing.

```

---

## 8. The visualization system — charts as the review's _index_

_Enriches P1/P2 (the overview) and P3 (blast radius). This is the design for the
charts at the **top** of the review and the primitive we need to build them._

Two principles govern everything in this section:

1. **Encode the reviewer's _decisions_, not the code's _statistics_.** Every PR
   tool charts line counts. A 2000-line lockfile bump and a 30-line auth change
   are the same bar. That describes the diff; it doesn't help the review. A
   review tool charts the three decisions a reviewer actually makes — _where to
   look, what to trust, when I'm done_ — so the picture itself routes attention.
2. **The chart is the _navigation_, not decoration.** In this product the loop is
   publish → render → **comment**. So a chart cell is not a data point — it's a
   click target into a diff hunk or finding. Design every visual as the review's
   table of contents, not a picture of it (see §8.5 for the bridge this needs).

The whole system is **agent-authored** (§7 decision 1): the agent supplies the
risk / coupling / coverage / complexity values, the server renders them the same
way every time. The open question is never "is our formula right" — it's "did the
agent judge well," which is the right place to put the uncertainty.

The visuals below are organized by the three reviewer questions. **Discipline
(P1 applies to the overview itself):** ship _one_ canonical visual per question —
not a gallery. The recommended default set is marked `⭐`.

### 8.1 "Where do I spend my attention?" — the risk family

**Risk-weighted treemap** `⭐` — _the flagship._ Today's churn bar ranks files but
wastes its second dimension. A treemap carries the review's two variables at once:

- **area = churn** (how much changed)
- **color = sensitivity** (auth / money / migration → hot red; generated /
  lockfile / snapshot → cold gray)
- **nesting = directory** (structure comes for free)

The eye is _pulled_ to the big red rectangle — attention routing as a visual
reflex. The lockfile is one big gray block you skip; the auth change is a small
blazing-red one you can't miss. This single object **replaces the alphabetical
file list _and_ the churn bar**, and doubles as the clickable file manifest (P2).
If we build one new visual, it's this. _Needs the charting kit (§8.5)._

**File minimap / heat-strip** — a thin vertical strip beside each diff: position =
line number, intensity = change density, with finding markers pinned at their
lines (the VS Code minimap idea, applied to review). It says _within_ a 600-line
file where the three dangerous clusters are without scrolling — the best
single-file attention router there is. _Needs the charting kit + per-line risk
data from the diff._

**Hotspot bubble — churn × complexity** — the classic code-quality plot,
repurposed: x = churn, y = complexity (or sensitivity), **bubble size = blast
radius**. The top-right quadrant is where bugs statistically concentrate; one
glance says "these two files do too much, too riskily, with too much reach."
_Needs scatter/bubble support (charting kit)._

### 8.2 "How is this wired?" — the structure family

The existing change map (`buildChangeMap`, `server/app.ts:523`) is the base. A
good structure view switches representation by **graph density** — node-link for
sparse, matrices for dense — rather than forcing one shape on every PR.

**Interaction map (edge-status)** `⭐` _(extends `buildChangeMap`, cheapest win)._
The map already colors **nodes** by status (new / modified / touched / removed).
The missing half — the actual "how code interacts" signal — is **edge status**:

- **new edge** (green) — a dependency the PR _introduces_ (`wsUpgrade` now calls
  `revocationList`). New coupling is the thing to scrutinize.
- **removed edge** (red, dashed) — a call the PR _severs_. A dropped edge can
  quietly delete an auth / validation hop — the most dangerous _invisible_ change.
- **existing edge** (gray) — context, unchanged.

Fully inside the current primitive: `buildChangeMap` already emits a mermaid
flowchart; add an optional `status` to each edge and emit one `linkStyle <i> …`
line per edge (mermaid styles edges by index), reusing the `CHANGE_STATUS`
palette so nodes and edges share one legend:

```

flowchart LR
n0(["authMiddleware"]):::touched
n1["validateToken"]:::modified
n2[("revocationList")]:::new
n0 -->|calls| n1
n1 -->|"now checks"| n2
linkStyle 0 stroke:#9aa0a6;
linkStyle 1 stroke:#2f9e44,stroke-width:1.5px;
classDef touched stroke:#9aa0a6,color:#9aa0a6;
classDef modified stroke:#d9870a,color:#d9870a,stroke-width:1.5px;
classDef new stroke:#2f9e44,color:#2f9e44,stroke-width:1.5px;

```

Agent supplies `edges:[{from,to,label,status}]`; the server renders. Highest-value
structure visual, cheapest to ship. _Buildable today (mermaid)._

**Coupling-delta bar** — the map shows _where_ coupling changed; this shows _how
much_, per module. Plot edges **added** vs **removed** as a stacked bar — the
exact shape `buildChurnChart` (`server/app.ts:574`) already produces, with edge
counts instead of line counts. A module that gains four inbound edges in one PR is
a coupling hotspot even when its own churn is tiny.

```

data: [
{ module: "auth/token.ts", added: 3, removed: 1 },
{ module: "billing/charge.ts", added: 2, removed: 0 },
{ module: "api/routes.ts", added: 1, removed: 0 },
]
chartType: "bar", x: "module", y: ["added","removed"], stacked: true,
colors: ["#2f9e44","#e03131"], yLabel: "edges"

```

Zero new primitives; rides on the same edge data the interaction map collects.
_Buildable today._

**Layered arc diagram** — nodes on a horizontal axis _ordered by architectural
layer_ (ui → service → data), call edges as arcs above. The payoff: an arc that
**jumps two layers visually pops** — that's a layering violation, the exact "this
PR coupled things that shouldn't be coupled" smell that a flowchart hides.
New/severed edges in the same green/red. Far more legible than node-link for
spotting _bad_ structure. _Needs the charting kit._

**Adjacency / co-change matrix** — when the graph gets dense, node-link turns to
spaghetti; a matrix never does (zero edge crossings). Rows/cols = modules, cell =
call or co-change strength, new coupling highlighted. The right tool for a big
refactor where the flowchart is unreadable. _Needs the charting kit (or an
html-kit grid)._

**Overview-scale blast radius** _(promotes the per-finding graph, P3)._ Draw
**one** impact graph centered on the single most sensitive changed symbol: one hop
of **callers** (who breaks if this is wrong) plus the **tests** that cover it — or,
loudly, that don't. The codebase-tier signal made the first thing the reviewer
sees. Same mermaid primitive as the interaction map; bound it to ≤ ~7 nodes or the
map becomes the territory. _Buildable today._

### 8.3 "Can I trust it, and am I done?" — the confidence + closure family

**Confidence × coverage quadrant** `⭐` — _the most LLM-native chart we can build._
Plot every finding (or file): x = agent confidence, y = verification coverage. The
**bottom-right quadrant — high confidence, low coverage — is the danger zone**:
the agent was _sure_ about code it _didn't verify_, which is the single most
dangerous LLM output there is (§ P3, §7 decision 2). A quadrant makes it a place
the eye lands, not a sentence skimmed. Nothing in the PR-review market visualizes
this — it's a genuine differentiator, and the data (`confidence` + `coverage`) is
already required on every finding. _Needs scatter support (charting kit)._

**Review burndown** `⭐` — _buildable today, ship it first as proof._ A cumulative
`line`/`area` of open findings falling toward zero as the reviewer resolves them.
It gives the review a visible **terminal state** — the "done" payoff the current
strike-through lacks (corroborated independently by the UX redesign's review-
cockpit move). No new primitive: it's a `line` chart over the existing
resolve/dismiss events, and it makes the point that **charts are review _state_,
not just PR statistics.** _Buildable today._

### 8.4 The default set (what we actually ship)

Per the discipline rule, the overview carries **four** visuals, one per job — not
the whole catalog:

| Question            | Canonical visual                    | Primitive          |
| ------------------- | ----------------------------------- | ------------------ |
| Where do I look?    | Risk-weighted treemap (= manifest)  | charting kit       |
| How is it wired?    | Interaction map (edge-status)       | mermaid (today)    |
| Can I trust it?     | Confidence × coverage quadrant      | charting kit       |
| Am I done?          | Review burndown                     | `chart` line (today) |

The rest (minimap, hotspot bubble, arc diagram, matrix, coupling-delta,
overview blast radius) are **opt-in depth** — earned per PR, not always on. A big
refactor swaps the interaction map for the matrix; a single-file fix drops
everything but the minimap.

### 8.5 What we need to get there (the enabling work)

Four gaps stand between this design and shipping it:

1. **The primitive ceiling → a sandboxed charting kit (the real unlock).** The
   `chart` part supports only `bar | line | area | pie` (`server/types.ts:163`).
   Treemap, scatter/bubble, heatmap, arc, matrix fit none of them. Two paths:
   (a) extend `chartType` case-by-case — safe (stays in the React text-node render
   path) but slow; or (b) **a charting kit rendered in the sandbox** — the server
   composes a self-contained HTML doc (data inlined + a vetted D3 / Observable-Plot
   bundle) and serves it through the existing opaque-origin iframe
   (`renderHtmlPage` at `/s/:id`). This respects the invariant (agent-authored
   HTML _must_ be sandboxed — CLAUDE.md) and buys us _any chart D3 can draw_
   instead of four. **This is the highest-leverage investment in the section** —
   it unlocks the treemap, quadrant, minimap, arc, and matrix in one move. The
   data still flows as structured fields the server inlines, never as
   agent-authored script.
2. **The data (agent-authored).** Per-file `sensitivity` + `complexity`, coupling
   `edges:[{from,to,status}]`, and per-finding `confidence` + `coverage` (already
   required). Small additive schema work on `ReviewInput` / `FindingInput` — no
   new analysis, the agent declares and the server renders (§7 decision 1).
3. **The interaction bridge (what makes them best-in-class).** A chart cell must be
   clickable → jump to that file's hunks / finding → comment in place. The viewer
   already runs a delegated bridge for diff-line-click → composer; extend the same
   `postMessage` channel to carry `chart-cell → navigate`. Without this they're
   pretty pictures; with it they're the review's index. Keep the trusted-origin
   DOM hooks the oracle asserts on intact.
4. **Discipline (a non-code requirement).** Resist shipping all of §8. The default
   set (§8.4) is four visuals; everything else is opt-in. The overview is itself
   subject to attention-routing — a cluttered overview fails the same way an
   alphabetical diff does.

### 8.6 Sequencing

- **Now, no new primitive (proves the thesis):** edge-status **interaction map**
  (§8.2) and the **review burndown** (§8.3). Both fold into **Step B** /
  **Step C** of §4 — additive fields on existing emitters. The burndown ships the
  idea that charts encode review state; the interaction map ships "how it's wired."
- **The unlock (one focused build):** the **sandboxed charting kit** (§8.5 #1) +
  the **navigation bridge** (#3). This is a new sub-step in Phase 2, beside the
  diff work (Step D), since both touch the renderer.
- **On the kit:** **risk-weighted treemap** (replaces the manifest + churn bar)
  and **confidence × coverage quadrant**. These are the two that make a reviewer
  say "best in class." Then minimap / arc / matrix as opt-in depth.

### 8.7 Validation & honesty

Per §6, the risk / blast-radius / coupling family is **design judgment, not
deep-research-corroborated** — the same caveat that gates the risk band gates
these visuals. Two mitigations, both already baked in: the data is
**agent-authored** (so the question is "did the agent judge well," not "is our
graph/scoring algorithm correct"), and the **buildable-today** pair (interaction
map + burndown) lets us validate the whole "charts route attention" thesis in real
reviews _before_ investing in the charting kit. Treat the treemap and quadrant as
the bets to confirm once the cheap pair has proven the direction.
```
