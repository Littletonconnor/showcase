# Best-in-class PR visualization for the age of LLMs

_A design + implementation plan for showcase's flagship "Visual PR review" workflow._

Status: **draft for review.** Built from a full read of the existing review
system (`server/app.ts` `publishReview`, `buildFinding`, `buildChangeMap`,
`buildChurnChart`; `server/kits.ts`; `viewer/src/DiffPart.tsx`; `TODO.md`
Workflow 1) plus PR-review UX prior art. Research citations are being folded in
from a parallel deep-research run; this doc states the design first so we can
argue about it before writing code.

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

| Sub-signal      | What it measures                                              |
| --------------- | ------------------------------------------------------------ |
| **Size**        | Total churn (added + removed), log-scaled.                   |
| **Surface area**| Number of distinct files / modules / public exports touched. |
| **Sensitivity** | Are touched paths security / auth / data-model / migration / money / deletion / config? Weighted heaviest. |
| **Test delta**  | Did test lines move with the change, or did logic change with tests untouched? (untouched = riskier) |

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

### Validation gate (every step)

`npm run typecheck` · `npm run lint` · `npm run build:viewer` ·
`npx playwright test` · screenshot the surface and look at it. Keep the oracle
DOM hooks intact; update the oracle in the same commit when behavior it covers
changes.

---

## 6. Decisions & open questions

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
