# The review engine: determinism, depth, and the one-way seam

_How showcase makes an LLM code reviewer reproducible, deep on complex PRs, and
flexible for OSS adopters — without becoming a SaaS. The companion to
[review-form-factor.md](./review-form-factor.md): that doc is the north star for
the **UX** (the Brief + decision queue); this one is the north star for the
**engine behind it**. They are one product across a deliberate one-way seam. Where
this doc names a `file:line`, it was checked against the code at the time of
writing — re-check before acting, since lines drift._

---

## The thesis

**You cannot make the model deterministic, so stop trying. Engineer determinism
_around_ a non-deterministic core.**

This is the single idea the whole design hangs on, and it is not a hedge — it's
the architecture. showcase doesn't even own the model: the LLM is the agent
harness (Claude Code), not something showcase calls, so there is no temperature,
no seed, no sampler knob anywhere in the codebase to turn. And the knob wouldn't
help if it existed — a peer-reviewed study ran four models over 70 Java commits at
temperature 0 with cleared context, five times each, and the verdicts still
varied: short, constrained prompts approached reproducibility while long,
open-ended ones collapsed toward none (arXiv 2502.20747). Hardware concurrency and
silent backend changes break determinism even when sampling can't (arXiv
2506.09501). Chasing a deterministic _core_ is the central misconception to avoid.

So determinism comes from four structural layers around the core:

1. **A deterministic evidence scaffold the LLM reasons _over_** — not facts it
   re-derives. Every fact the model recomputes (which lines changed, who calls
   this, what's tested) is a fact it can get wrong _differently_ each run. Hand it
   ground truth and the variance collapses to interpretation alone.
2. **A fixed rubric and a fixed output schema — "structure is the API."** A small
   enum is more reproducible than a sentence; a one-sentence assertion more than a
   paragraph; a paragraph more than a wall. showcase's decision grammar is already
   this, and the server already rejects off-grammar output (`coerceReview`,
   `server/app.ts:270`).
3. **Ground every finding in evidence, with verification as a named gate.** A
   `grep` hit or a failing test is byte-identical every run; an inference is not.
   The skill already verifies P1s before reporting them — the lever is making that
   the default for _every load-bearing claim_, not an exception for the scary ones.
4. **Honest calibration — the confidence ledger and the complete file manifest as
   the _transparency contract_** for what genuinely cannot be pinned.

Be precise about what stays non-deterministic: the **judgment** — severity, the
final call, the prose. That's irreducibly the model's, and the right response is
radical transparency, not false precision. What becomes reproducible is the
**evidence the judgment is made over** and the **structure it's poured into**.

And do **not** conflate determinism with precision — they are different axes. A
verification gate makes a finding more _precise_ (fewer false positives); it does
not make the review more _reproducible_, because the model still chose which check
to run and how to read its output. The receipts, the scaffold, and the schema each
buy something real — just not the same thing. Claim each honestly; that honesty is
the product, because the alternative is a confident reviewer that is quietly wrong
in a different place every run.

---

## The layered architecture

The seam that makes all of this safe is **one-way**: showcase knows about the
`code-review` skill; the skill knows _nothing_ about showcase. The skill does the
reviewing; showcase renders what it found. Every recommendation below lands on
exactly one side of that line, and the layering makes which side obvious.

```
┌─ LAYER 1 · DETERMINISTIC TOOLING (the skill's own toolchain) ─────────────────┐
│  Pure git + grep + the project's OWN lint/typecheck/test commands. No LLM.      │
│  Emits an evidence pack: diff hunks with exact file:line, churn, hop-1 callers, │
│  change-coupling (co-changed-but-untouched files), a cold-set audit, and        │
│  lint/test results. Reproducible for a frozen diff. BYO toolchain — no bundled  │
│  SAST, no embedding index, no native deps anywhere near showcase.               │
└────────────────────────────────────────────────────────────────────────────────┘
        │ ground truth handed up (the LLM reasons over it; it may not re-derive it)
        ▼
┌─ LAYER 2 · LLM REASONING (the code-review skill) ─────────────────────────────┐
│  Triage → concern slices → reach-gated escalation → scoped specialist agents    │
│  (backend/frontend lenses) → VERIFY every load-bearing claim against real code  │
│  → synthesize into the fixed decision grammar. This is where depth and          │
│  flexibility live. The non-deterministic core — owned by the agent harness.     │
└────────────────────────────────────────────────────────────────────────────────┘
        │ publish_decisions / publish_review (the rendering contract)
        ▼
┌─ LAYER 3 · RENDERING (showcase) ──────────────────────────────────────────────┐
│  coerceReview validates the schema + manifest integrity, mints stable ids,      │
│  renders the Brief + risk-ranked decision queue + sticky evidence pane +        │
│  complete manifest. A pure function of the Review object. Runs read-only in the │
│  static export. Never traverses code, never re-derives a fact, never forms an   │
│  opinion about what the review *means*.                                         │
└────────────────────────────────────────────────────────────────────────────────┘
```

Read the diagram as the rule it encodes: **anything deterministic is Layer 1 (a
tool the skill runs) or Layer 3 (validation showcase already does). Layer 2 is
where the variance lives, and you make it _legible_, not _reproducible_.** The
moment a deterministic tool starts deciding what a fact _means_ — "this line is
reachable, therefore P1" — it has crossed into Layer 2's job, and the scaffold has
acquired an opinion it must not have. Reachability and coverage are not neutral
facts the way a line count is; folding them into a _severity floor_ quietly
reverses the codebase's own deliberate choice that risk and severity are
**agent-authored** ("you have the semantic context a path regex never will — judge
it; showcase just renders the band"). The floor stays in Layer 2. Layer 1 reports;
Layer 2 decides; Layer 3 renders.

---

## 1 · Determinism, made concrete

### The deterministic evidence pack (Layer 1, the highest-leverage win)

Today the skill re-derives by reading: "read the full file, `grep -rn` the
callers, follow the data flow" (`execution.md`). Every one of those is narrated,
manual, and different each run. The fix is to **compute the cheap, reproducible
facts once, before any judgment, and forbid the model from reinventing them.**

This is **net-new analysis-side tooling**, not a finished half — there is no
`git diff --numstat` machinery in the repo today; the playbook's `showcase review
<branch>` scaffold (`guide/PLAYBOOK.md:79`) describes seeding a diffstat card but
is the natural _seam_ to grow, not an existing implementation. The pack lives in
the skill (Layer 1), and its outputs map onto fields showcase already renders, so
the seam holds.

What belongs in the pack, scoped to what one developer can run locally with no
index and no SaaS:

- **Diff hunks with exact `file:line` ranges** (git) — so a finding's location is
  a fact, not a recollection.
- **Per-file churn** — the shape of the change, ranked.
- **Hop-1 callers + the tests that cover them** — the bounded reach (see §2).
- **Change-coupling** — `git log --name-only` over a pinned window, intersected
  pairwise, yields files that historically co-change with each changed file but
  _aren't in this diff_. This catches the most-cited reviewer miss — "touched A and
  B, forgot C, which always changes with them" — that no diff and no AST view shows
  (Kirbas et al. 2017; D'Ambros/Lanza/Robbes). Treat it as a **best-effort ranked
  hint**, not a byte-identical guarantee: it shifts as commits land and depends on
  the window and any squash/rebase. Pin the window and base commit so it's stable
  for a frozen diff; don't over-engineer its reproducibility past that.
- **Lint / typecheck / test results** — by **shelling out to the project's own
  commands**, never a bundled engine. The OSS user brings the toolchain; the
  scaffold runs it and records _what it ran and what came back_ — which is honest
  even when the underlying test is flaky. A passing run is evidence, not a proof
  the world beneath it is deterministic.

This single step advances **both** determinism (facts the LLM no longer invents
are identical every run) and **depth** (coupling + reach turn "I read the diff"
into "this reaches three call sites, one untested, and a parallel handler in
payments was not updated").

**The cost budget is part of the design, not an afterthought.** Time-to-first-card
_is_ the UX — so the pack must complete in seconds or stream, and the cheap
deterministic work must never be gated behind a full lint/test run of a large
repo. Bound it: hunks/churn/coupling are sub-second git ops; lint/test is opt-in
per escalated slice and time-boxed, not a precondition for the first decision
rendering. A pack that makes the live loop wait has defeated its own purpose.

### Structure is the API, and the conflict rule that makes it bite

The strongest determinism lever already shipped is `coerceReview`: it rejects
anything off-grammar — a `call` outside `{block, ship, decide}`, a missing
`confidence`, a manifest that doesn't bidirectionally account for every decision
and every file (`server/app.ts:363` requires a non-empty manifest; the inverse
check rejects a decision no file claims, `~app.ts:399`). The variance in _what the
reviewer says_ collapses because the slots are fixed and the server is the gate.

Two cheap additions finish the lever:

- **A format check on the Brief.** Today the contract ("≤4 sentences, plain
  English, no identifiers") lives only as a comment on the type; `coerceReview`
  passes `brief` straight through (`app.ts:407`). This is **net-new** validation,
  and it must stay **pure format validation** — sentence count, reject
  backtick-fenced code and obvious `CamelCase`/`snake_case`/`file:line`
  identifiers, allow ordinary domain nouns ("the upload", `SHOWCASE_TOKEN`). Frame
  it exactly like the enum and manifest checks: showcase validates _shape_, never
  _quality_. And do it as **warn-and-flag, not hard reject** — a mid-loop rejection
  would break the publish→render→revise loop; a small "this Brief contains jargon"
  chip the skill resolves on the next publish keeps the loop live.
- **A pack-vs-model conflict rule.** "Forbid the model from re-deriving facts" is
  unenforceable unless you say who wins when they disagree. The rule: **a Layer-1
  fact beats a Layer-2 assertion, and the discrepancy is surfaced.** If the pack
  says a path is uncovered and the model claims high confidence it's tested, the
  finding is capped and the conflict is shown — the model cannot narrate around a
  fact it was handed. Without this rule the scaffold is advisory; with it, the
  scaffold is ground truth.

### Verification receipts — the precision lever (not the determinism one)

The competitive teardown's clearest lesson: the tools developers trust attach a
**receipt** to a serious finding (CodeRabbit's "comments come with evidence"; the
measured precision/recall split where a high-recall whole-repo reviewer pays in
noise while a verification-gated one optimizes for F1). Generalize the skill's
existing P1-verification gate into a rule: **a `block`/P1 decision must name a
check it actually ran** (a failing test, a `grep` hit, a reproduced trace), and
that receipt rides into the decision's evidence pane as a `terminal`/`diff`/`code`
data part. A claim without a receipt is auto-downgraded before it reaches
showcase. This attacks the #1 complaint about AI review — false positives — and it
lives entirely in Layer 2 plus an already-built render slot. File it under
**precision and trust**, not reproducibility; that's the honest claim.

> Self-consistency (re-sampling a finding and voting) is a real lever in the
> literature but the wrong shape here: for a local single-user tool, asking the
> human is cheaper and more honest than a stochastic vote-of-two that itself needs
> an LLM "same finding?" matcher. It stays an optional power-user note, not a
> mechanism. (See the non-goals.)

---

## 2 · Depth on complex PRs (backend _and_ frontend)

Depth is Layer 2's job. The render grammar is already lens-agnostic — a `Decision`
is `{call, kind, scope, assertion, impact, details, confidence, pivot, evidence,
proposal}` (`server/types.ts:251`) whether the body is a migration-ordering
argument or a re-render hazard — so **"different lenses, one output grammar" is
already satisfied by the data model.** The work is entirely analysis-side.

### Replicate the traversal discipline, not the index

The best tools (Greptile, CodeRabbit) get depth from a persistent whole-repo graph
an agentic loop traverses multi-hop from the diff. That index is exactly the part
a local, install-anywhere OSS tool **cannot and must not** replicate — it drifts
run-to-run (hurting determinism), needs storage, and adds a stochastic
similarity step. The replicable essence is the **traversal discipline**: read the
diff → find direct callers (hop 1) → the tests that exercise them → compare against
sibling/parallel implementations. The skill already prescribes hop 1; the gap is a
bounded reach estimate handed up in the pack.

Bound it **hard**. Naive `grep` for callers-of-callers across a 5,000-line diff is
slow, matches comments and unrelated same-named symbols, and becomes the heaviest,
noisiest part of the tool — the exact "depth explodes cost" failure it's meant to
prevent. **Hop-1 callers plus their tests is the defensible depth; deeper hops are
opt-in per escalated slice.** And be honest about the backend target: on
Guice-DI/Hibernate Java the highest-value impacted-but-unchanged call sites are
reached through _runtime wiring_ a static grep can't see. A best-effort,
language-gated, **clearly-labeled-as-heuristic** reach estimate is worth shipping;
a graph silently wrong on exactly the DI-heavy PRs that matter most is worse than
no graph. Don't pretend otherwise.

### Frontend depth is real, but its determinism floor is lower — say so

The honest asymmetry the user's "backend AND frontend" goal deserves: backend gets
deterministic Layer-1 signals (coupling, hop-1 reach, migration ordering,
test-impact). Frontend depth is mostly **rule-driven, not graph-driven** —
accessibility (focus, ARIA, contrast), re-render hazards (unstable deps, context
churn), state correctness (stale closures, derived-vs-source), bundle/perf deltas,
design-system conformance, loading/error/hydration states. Those are caught by
_lenses_, not by a call graph, so frontend gets a thinner deterministic scaffold
and leans harder on the flexibility seam (§3). This is not a gap to hand-wave; it's
the reason the lens mechanism matters as much as the evidence pack.

### Lenses wire by risk dimension, not file extension

A sharp correction the depth analysis earns: wire lenses through the
**risk-dimension dispatch** in `reference/deep-review.md`, _not_ the file-extension
table in `reference/languages.md`. That extension table dispatches pre-PR
_hygiene checklists_ (`.java → java-pr-hygiene`), not deep-dive lenses; firing a
heavy migration lens on every `.tsx` touch is wrong. The lens content the user
already owns slots into the risk-dimension dispatch:

- **Backend lens** — migration ordering (expand→migrate→contract), transaction
  atomicity, check-then-act races and idempotency, published-contract back-compat,
  N+1/index gaps, money units/rounding. (`db-migration`,
  `backwards-compatible-check`, `sql-hygiene`.)
- **Frontend lens** — the rule set above. (`accessibility-audit`,
  `react-best-practices`, `santafe-performance`, `composition-patterns`.)

### Reach-gated escalation keeps depth cost-bounded

The skill already triages and escalates by slice, and warns that over-fanning is
"the single biggest way a review burns tokens." Sharpen the trigger: a slice
escalates to the multi-agent panel only when a sensitive trigger fires **AND** the
deterministic reach is high (blast-radius over a threshold, change-coupling
incomplete, an uncovered path). A sensitive-but-isolated one-liner gets one scoped
specialist, not the panel. Reach is deterministic, so the _escalation decision
itself_ becomes more reproducible than a gut feeling about "non-trivial interacting
logic."

### The cold-set audit (the cheapest, highest-value depth guard)

A 5,000-line agent diff is exactly where a real change hides in the
"mechanical-skipped" bucket — and the decision form factor _amplifies_ that bug
instead of catching it (the form-factor doc's open question #2, now **resolved**
by this audit — built as `evidence-pack cold-set`, T7). Close it with a
**deterministic** re-check, not another LLM pass: flag any
`mechanical-skipped`/`reviewed-no-comment` file whose churn exceeds a threshold,
whose path is sensitive, or that change-couples to a `has-decision` file — and
force a decision or an explicit justification. This makes the manifest's
`disposition` field _load-bearing_ instead of self-reported, uses the existing
contract with zero render change, and is the single best value-to-cost item in the
depth dimension. Lean on churn + sensitive-path + coupling, which need no per-repo
config; a "test file / generated path" classifier is an _optional_ refinement, not
a prerequisite — don't make the audit wait on the per-language treadmill the index
non-goal exists to avoid.

---

## 3 · Flexibility for OSS — a thin seam, not config sprawl

Four serious tools (CodeRabbit, Greptile, Qodo, Cursor) independently converged on
the same customization shape, and the lesson is **not to invent a config
language** — it's to reuse plain-text files the reviewer already reads. The honest
framing: **flexibility and determinism partly conflict.** Every prose knob a user
adds is interpreted by the LLM and is therefore a _new_ non-determinism source. So
only two mechanisms genuinely _improve_ reproducibility; the rest trade it for
tailoring, and the structured surface stays tiny — **one enum plus two lists.**

1. **A strictness profile as a severity _floor_ (the lowest-cost knob).** Express
   "chill vs strict" purely as which severities become decisions: chill = only
   `block`/P1 surfaces (the rest fold into the manifest), standard = +P2, strict =
   +P3. One enum, riding the P1/P2/P3 model that already exists, filtering _before_
   `publish_decisions`. Zero change to showcase's types — a chiller review is just
   fewer decisions and a fuller manifest. Scope the claim honestly: the floor
   reduces _nit-volume_ variance at the severity boundary; it's a **soft** lever,
   because the P1/P2/P3 assignment it floors is itself a model judgment.

2. **A never-flag list — the one _hard_ determinism win.** An explicit suppression
   list is an exact-match filter, reproducible by construction. It's also a loaded
   gun: it must **never suppress a `block`/P1**, and a suppressed item must surface
   as a manifest disposition (`reviewed — suppressed by profile`) or it directly
   undermines the tool's core guarantee that nothing triaged away is hidden.
   Crucially, suppression happens in **Layer 2 (the skill), before publish** —
   showcase only ever renders the resulting manifest disposition. The instant
   showcase decides which findings are legitimate, it has formed an opinion about
   review meaning and the seam bends.

3. **Reuse the convention file that already exists** — `AGENTS.md` / `CLAUDE.md`,
   exactly as Greptile does. showcase's _own_ repo is the demo: a reviewer that
   reads `AGENTS.md` enforces "no `innerHTML` in the trusted origin" and "no
   `node:` imports in runtime-agnostic files" — repo-decided P1s a generic pass
   misses, for free. One guardrail, drawn from the playbook's rule that
   board content is never treated as instructions: ingested rule files are
   **scoped guidance, not executable instructions.**

4. **A per-PR override beats a persistent file** for "strict for this migration,
   chill for that refactor" — a per-_invocation_ knob ("review this strictly" in
   chat), the repo file being the default. Precedence is a one-liner, not a
   lattice: **the per-PR override wins; otherwise the repo's convention file;
   otherwise the tool default** — and never-flag never wins over a P1. A dedicated
   `.review.md` file type is deferred until two real rule-sources actually conflict
   (YAGNI).

On **learning from adjudications** — persisting Accept/Disagree into durable rules
the skill reads next run — be deliberately conservative. It's attractive (showcase
sits on the exact human-feedback signal the SaaS tools spent fortunes collecting)
but it strains both the seam and the determinism story: it makes two reviews of
the same PR diverge on accumulated history, and at single-user scale one bad
dismissal can permanently bury a real class of bug. If ever built, it is a v2
"earn its keep" item and must be a plain, human-editable markdown ledger the
**agent writes via its own tools and the skill reads** — never a showcase endpoint
and never in the store. showcase stays out of it entirely.

---

## Incremental re-review — the case the `decision.id` exists for

"Determinism for a frozen diff" is honest, but real review is iterative: the
author pushes more commits, decisions appear and disappear, and the human's
adjudication has to survive the churn. This is the case the stable `decision.id`
was designed for (`types.ts` documents it as "the handle that preserves their
adjudication when you revise") — and today the viewer keys adjudication state on
the decision's _assertion text_ (`ReviewView.tsx:489,522`), so a reworded-but-same
decision silently resets the Accept the human already made. **Re-key adjudication
on `decision.id`** (the id is already minted and rendered, `ReviewView.tsx:163`,
`:494`) so a revision carries the human's prior calls forward; a decision whose
substance actually changed is the only one that should reset. This is the
small, verified fix that makes the live loop trustworthy across the revisions the
loop exists to handle.

---

## What we deliberately did NOT build (and why)

Same discipline as the form-factor doc: an addition earns its place only if it
serves a real reviewer decision at a cost a single OSS developer can carry.

- **A persistent repo embedding / AST index** (the Greptile/CodeRabbit core). It
  breaks local/no-build/install-anywhere, drifts run-to-run (hurting the very
  determinism it would claim to serve), and needs storage one developer can't
  maintain. Replicate the **traversal discipline**, not the index. This is the most
  important non-goal.
- **A bundled SAST engine, tree-sitter grammars, or a multi-language call-graph
  subsystem.** A correct cross-file caller graph is a per-language treadmill (ctags
  misses DI/reflection; ast-grep needs per-language patterns) and drags native deps
  toward the runtime-agnostic server. Shell out to the project's _own_
  lint/typecheck/test; keep graph work best-effort and language-gated.
- **A `.coderabbit.yaml` clone** — a structured config with path globs, validators,
  and a settings schema. The named over-engineering trap. The structured surface is
  one enum plus two lists; everything richer is prose the LLM parses.
- **An LLM-as-judge severity scorer (1–10, filter `<7`).** Reported as "nearly
  random" and latency-heavy. Prefer verification receipts and the never-flag list.
- **An uncalibrated confidence number.** Developers actively resent a "4/5" on a
  wrong comment — it reads as a productivity loss. Tie confidence to a verifiable
  check or to honest coverage; never to a bare model self-report. The codebase
  already made the research-correct call to **delete** the self-reported
  coverage/gaps ledger (commits `d563d92`, `086eb5b`) and surface confidence as the
  one honest signal (`ReviewView.tsx:273`). Do not resurrect it — and note that the
  permissive coverage-gap regex it relied on is gone, so don't reach for it as a
  validation gate either.
- **Whole-review self-consistency / N-of-3 voting.** SaaS-budget thinking for a
  single-user tool, and voting on open-ended prose needs an LLM "same finding?"
  matcher that makes it not a clean vote. Optional power-user lever at most; never
  a default, and never orchestrated by showcase (it can't run a second pass).
- **A SaaS eval cluster.** But its _miniature_ — a few committed golden diffs with
  expected verdicts, run when prompts/rules change to catch quality regressions —
  is the proportionate, in-scope version, and it belongs to the **skill** (which
  owns methodology), not to showcase.
- **Chartjunk** (bubble/area charts, 3D code-city, file minimaps, a sandboxed D3
  kit) — already rejected on Tufte/Cleveland-McGill grounds. New signals (coupling,
  reach) render as a **ranked list** or a `mermaid`/`code`/`markdown` evidence
  part, never a new chart type. A DSM stays opt-in for dense refactors only.
- **A "which specialists ran" process-audit panel.** For a single user who watched
  the review happen in their own terminal, "a security agent ran" is low-signal
  audit theater. The cheap, real half of depth provenance is a per-decision
  `verified`/`scope` chip — the panel is not.

---

## How this maps onto the existing code

The proposals reference primitives that already exist; the work is finishing intent
and adding analysis-side tooling, not rebuilding. Each claim below was checked
against the code.

- **The manifest-integrity gate is the real backbone — keep and lean on it.**
  `coerceReview` (`app.ts:270`) enforces the fixed grammar and a **bidirectional**
  manifest check: forward (every `decisionId` resolves) and inverse (every decision
  is claimed by a `has-decision` file, `~app.ts:399`). This is the one place the
  system _provably_ constrains the agent run-to-run — it cannot silently drop a
  file. That's the honest core of "determinism" here: auditability, enforced.
- **Sync the stale stdio `publish_decisions` schema — a real correctness gap,
  precisely diagnosed.** The stdio _handler_ is correct: it destructures and posts
  `manifest` (`mcp/server.ts:86,91`). The defect is upstream in the stdio _input
  schema_ (`STDIO_MCP_INPUT_SCHEMAS.publishDecisions`, `mcpSpec.ts:817`): it never
  declares `manifest`, `details`, `proposal`, or `id`, and still carries dead
  `coverage`/`gaps` fields whose `.describe()` keys (`d.decisionCoverage`,
  `d.decisionGaps`, `mcpSpec.ts:829-833`) are undefined. So the agent can't supply
  the manifest the server hard-requires (`app.ts:363`) through the advertised
  schema, and a stdio decision review can't be formed. The HTTP tool
  (`mcpSpec.ts:476`, whose `required` list at `:553` is `[brief, decisions,
manifest]`) is the correct shape; the fix is to bring stdio into parity and delete
  the dead fields. Low risk, pure render-side, do it first.
- **Decide the honesty-ledger story; don't re-add the deleted fields.** The
  north-star doc's data-model sketch still lists `coverage`/`gaps`/`proveScope`; the
  dead stdio schema lists `coverage`/`gaps`; the shipped viewer renders neither and
  surfaces confidence alone (`ReviewView.tsx:273`). Formally **retire** them: strike
  them from the doc's sketch, delete the dead schema, and document "confidence is
  the only surfaced honesty signal" — the viewer's shipped, research-correct stance.
  This removes the landmine where a future implementer re-adds the deleted fields off
  the stale sketch.
- **The `code-review` skill seam holds all of Layers 1–2.** The evidence pack, the
  cold-set audit, reach-gated escalation, the risk-dimension lens dispatch
  (`deep-review.md`), the verification-receipt rule, the strictness profile +
  never-flag list, and the convention-file read all land here. None touch showcase.
- **The viewer and the export — the smaller, correctly-scoped item.** The export
  bundle **already inlines the Review** (`export.ts:37,68,88`) and carries
  `reviewVerdict` on the session row (`:82`); the viewer's offline resolver already
  serves `/api/sessions/:id/review` (`viewer/src/api.ts:119`). So the data is wired
  — the earlier "export omits the review" framing is wrong. The real, smaller gap:
  `App.tsx:868` gates the live decision-queue takeover (`ReviewInline`) on
  `!exportBundle()`, so an exported _decision-queue_ review falls through to its
  card stream rather than the read-only decision queue — meaning the shared file
  shows finding/verdict cards, not the Brief + queue. `ReviewView` already supports
  a `readonly` mode, so rendering the decision queue read-only in the export is a
  small routing change, not a data fix — and it's worth doing, because the Brief is
  the one thing a non-engineer is meant to read. Coupling/reach visuals, when
  added, ride the decision's `evidence` pane as `mermaid`/`code`/`markdown` parts
  through the trusted renderers the viewer already reuses (`ReviewView.tsx:146`) —
  not a new chart, and not the `publish_review` `changeMap` (a different form
  factor).

---

## A pragmatic roadmap

Sequenced so the **live loop stays live** — time-to-first-card is the UX, so cheap
deterministic work governs the expensive deep work, never the reverse. Two
buckets: do-now and earn-their-keep. Nothing here is a committed program; it's the
order that pays off fastest.

**Do now (low effort, mostly already-built intent):**

1. **Sync the stdio schema** to the HTTP shape and delete the dead `coverage`/`gaps`
   fields. _Unlocks:_ stdio decision reviews can be formed at all.
2. **Re-key adjudication on `decision.id`** and give Disagree a terminal local
   state. _Unlocks:_ "Review complete" is reachable; a revision stops wiping the
   human's Accepts.
3. **Brief format-check (warn-and-flag)** and a read-only decision-queue render in
   the export. _Unlocks:_ the same review renders the same shareable register; the
   Brief actually shows in the one artifact meant to be shared.

**Then (medium effort, skill-side — the determinism + depth core):**

4. **The evidence pack** — pinned, portable: hunk ranges, churn, hop-1 reach,
   change-coupling, shell-out lint/test, handed up as ground truth, with the
   pack-vs-model conflict rule. _Unlocks:_ the biggest single determinism win
   (facts the LLM no longer invents) _and_ the deepest cheap depth signal
   (forgot-the-coupled-file), in one move — under an explicit time-to-first-card
   budget.
5. **Cold-set audit + reach-gated escalation + verification receipts.** _Unlocks:_
   a real change can't hide in "cold"; the deep-dive budget concentrates where
   complex-PR bugs hide; serious findings arrive with a receipt.
6. **Lenses + the flexibility seam** — backend/frontend lenses on the
   risk-dimension dispatch; strictness profile + never-flag + convention-file read.
   _Unlocks:_ "different lenses, one grammar"; an OSS user tailors strictness and
   conventions with zero proprietary config.

**Earn their keep (high effort, gated on a real review that demands it):** a
language-gated hop-2 reach estimate labeled heuristic; a golden-diff regression
harness in the skill; and — only if it proves out — the agent-owned
adjudication-memory ledger. YAGNI is the gate.

---

## On UX — noise suppression is the product, not a feature

The form-factor doc owns the UX north star; this engine doc only adds where the
engine changes what the reviewer sees. The through-line: **every new signal must
ADD signal, not clutter.** A 30-ship PR shows a wall of green and the coupling
"risk" decision must not nag; a clean refactor shows no pivot and no evidence pane.
Attention routing _is_ noise suppression, and noise is the #1 reason AI review gets
muted — showcase's structural advantage is that it suppresses at the
**unit-of-review** (decisions, not lines), so it must never import the competitors'
post-many-comments-then-filter model.

The small, high-value render fixes that serve this:

- **A call-colored left gutter** so the queue's risk shape is preattentive
  (position + color, the strongest channels) — moving the active-focus accent to a
  background tint so risk and focus stop fighting the same border.
- **Redundant-encode confidence** with a pip or shape, not color alone, so the one
  honest signal survives a black-and-white PDF export and color-vision deficiency —
  matching how the call is already icon + color.
- **A disposition-aware manifest summary** ("N decisions · M reviewed-clean · K
  skipped — and what suppression hid"), the noise answer made visible and the
  honest home for any never-flag suppression.

The interaction stays a tiny keyboard vocabulary — the power is one-key flight
through the queue, not a key for everything. And reconcile the doc with shipped
reality: the live loop is **two verbs (Accept / Disagree)**, not the four-verb
spectrum the form-factor doc imagined; "Prove it" is _unbuilt_, and if
reintroduced it should be a one-tap scoped re-verify over the existing comment
channel that targets a gap the **human** names — never a resurrection of the
deleted self-report ledger.

---

## One-line synthesis

showcase makes a non-deterministic LLM reviewer trustworthy not by pinning the
model — it can't — but by wrapping it in a deterministic evidence scaffold it
reasons over, a fixed grammar it pours into, verification that grounds every
load-bearing claim, and a transparency contract (confidence + the complete,
integrity-checked manifest) for the judgment that stays irreducibly the model's;
depth comes from replicating the _traversal discipline_ of the graph tools without
their index and routing it by risk-dimension lens; flexibility from a thin
strictness-floor-plus-never-flag seam that reuses the convention files a repo
already has — and all of it lands on the analysis side of a one-way seam where
showcase still only ever renders what the review found.

---

## Appendix · Implementation checklist

The design above is the north star; this is the build list. Each task carries a
**target**, the **change**, and a testable **done when**. Tags: `[showcase]` =
directly editable in this repo; `[skill/aic]` = lands in the `code-review` skill,
which is generated — see the wrinkle below. `file:line` was accurate at writing;
re-check before editing.

### ▶ Status for the next agent (updated 2026-06-27)

**Done and merged into this repo** — the entire `[showcase]` bucket:

- **T0 ✅** done this pass — `docs/review-form-factor.md` sketch now matches the
  shipped `Decision` type; `coverage`/`gaps`/`proveScope` struck.
- **T1 ✅** _already shipped_ before this pass (verified) — stdio schema has
  `id`/`details`/`proposal`/`manifest`, no dead `coverage`/`gaps`.
- **T2 ✅** done this pass — adjudication re-keyed on `decision.id` via `keyOf`
  (`ReviewView.tsx`), fallback to assertion text.
- **T3 ✅** done this pass — burndown counts a settled (agent-answered) Disagree;
  an unanswered Disagree shows "waiting"; "Review complete" is reachable.
- **T4 ✅** done this pass — `checkBriefFormat` in `coerceReview` emits a
  non-blocking `briefWarning` (on `Review` + publish result + MCP result), chipped
  in the viewer; round-trip test added.
- **T5 ✅** _already shipped_ before this pass (verified) — `App.tsx` renders
  `ReviewInline` for every review session; `ReviewInline` sets `readonly` from
  `exportBundle()`.

**Built (2026-06-27, in `aic`)** — the keystone of the skill-side bucket:

- **T6 ✅ built** — `evidence-pack` tool in the `aic` repo (`src/tools/evidence-pack.ts`,
  route **b**), to the spec in [`docs/evidence-pack-spec.md`](./evidence-pack-spec.md).
  `evidence-pack pack --base <ref> --head HEAD --json` emits the frozen-diff pack:
  changed files with churn + hunk `file:line` ranges, hop-1 reach (language-gated,
  labeled heuristic), change-coupling with the `missingFromDiff` hint, and opt-in
  shell-out check receipts. Git sections are byte-reproducible for a frozen base.
  The `code-review` skill is wired to compute it before judging and apply the
  pack-vs-model conflict rule (`reference/execution.md`). None of it touches
  showcase — the seam held.

**Built (2026-06-27, in `aic`) — the whole "then" bucket:** **T7, T8, T9, T10**.
- **T7 ✅** cold-set audit — `evidence-pack cold-set` re-flags a skipped file with
  churn/sensitive/coupling risk; wired into `code-review/reference/execution.md`.
- **T8 ✅** reach-gated escalation + lens dispatch — `code-review/reference/lenses.md`
  gates the panel on sensitive-trigger AND high reach and dispatches
  backend/frontend lenses by risk dimension.
- **T9 ✅** verification receipts — a P1/block must name a runnable receipt or it
  auto-downgrades (`deep-review.md`).
- **T10 ✅** flexibility seam — `code-review/reference/profiles.md`: chill/standard/strict
  severity floor + never-flag/always-flag lists from `AGENTS.md`/`CLAUDE.md`.

**Deferred by YAGNI** (do not build until a real review demands it): **T11, T12,
T13**.

> **Cross-repo status.** T6–T10 all landed in the `aic` repo, not here — the
> engine doc's seam is explicit that they "land in the skill. None touch
> showcase." Nothing left in the do-now / then buckets; only the YAGNI-gated
> T11–T13 remain, by design.

### The decision to make first (it gates everything skill-side)

**Resolved (2026-06-27):** route **(b)** for the pack + audit (T6/T7), route **(a)**
for the rule/prose edits (T8–T10) — the doc's own recommendation, confirmed. T6's
spec is written ([`evidence-pack-spec.md`](./evidence-pack-spec.md)); the build is
blocked only on having the skill/aic checkout, not on a remaining decision.

The deterministic engine (evidence pack, cold-set audit, escalation, lenses,
never-flag) lives in `~/.claude/skills/code-review/` — every file there is
`# Generated by aic — do not edit, changes will be overwritten` (`SKILL.md:13`).
You cannot edit the generated skill. Pick one route before starting T6–T10:

- **(a) aic source** — change the source that _generates_ the skill, so the
  methodology edits regenerate cleanly. Right for prose changes (escalation rules,
  lens dispatch, the "cite the pack" step).
- **(b) shell-out tool** — build the deterministic parts as a standalone
  script/binary the skill _invokes_, keeping the generated skill thin. Right for the
  evidence pack (it's a program, not prose) and the cold-set audit.

Recommendation: **(b) for the pack + audit, (a) for the rule/prose edits.** This
choice is now made (see _Resolved_ above); the skill-side tasks are blocked only on
having the skill/aic checkout, which was absent for this pass — so only the
`[showcase]` ones landed.

### Do now — verified, small, render-side (`[showcase]`, low effort)

- [x] **T0 · Retire the dead honesty-ledger fields from the docs.** _Target:_
      `docs/review-form-factor.md` (the `Decision` data-model sketch still lists
      `coverage`/`gaps`/`proveScope`). _Change:_ strike them; add one line — "confidence
      is the only surfaced honesty signal." _Done when:_ the form-factor sketch matches
      the shipped `Decision` type (`server/types.ts:251`) and the viewer
      (`ReviewView.tsx:273`).
- [x] **T1 · Sync the stale stdio `publish_decisions` schema.** _(Already shipped:
      the stdio schema at `mcpSpec.ts` declares `id`/`details`/`proposal`/`manifest`
      and carries no `coverage`/`gaps` fields.)_ _Target:_
      `server/mcpSpec.ts:817` (`STDIO_MCP_INPUT_SCHEMAS.publishDecisions`). _Change:_ add
      `id`, `details`, `proposal` to the per-decision object and `manifest` at top
      level, matching the HTTP tool (`mcpSpec.ts:476`) and `CreateReviewInput`
      (`types.ts:312`); delete the dead `coverage`/`gaps` fields and their undefined
      `d.decisionCoverage`/`d.decisionGaps` refs (`:829-833`). The handler
      (`mcp/server.ts:86`) is already correct. _Why it's broken:_ the MCP SDK parses
      args through the Zod schema, which strips undeclared keys — so a manifest never
      reaches the handler and `coerceReview` 400s on the required manifest
      (`app.ts:363`). _Done when:_ a stdio `publish_decisions` carrying a manifest
      round-trips and renders at `/?review=<id>`; stdio and HTTP decision schemas have
      field parity; no `d.decisionCoverage`/`d.decisionGaps` refs remain;
      `npm run typecheck` + `npm test` green.
- [x] **T2 · Re-key adjudication on `decision.id`.** _Target:_
      `viewer/src/review/ReviewView.tsx` — state keyed on `assertion` at `:489`, `:522`,
      `:535`, `:544`, `:592`, `:679`. _Change:_ key on `decision.id` (already minted +
      rendered, `:163`, `:494`), with a fallback to `assertion` when `id` is absent.
      _Done when:_ re-publishing a review that rewords an `assertion` but keeps its `id`
      preserves the human's Accept; only a substantively-changed decision resets.

### Do now — small but with a judgment call (`[showcase]`, low–medium effort)

- [x] **T3 · Reachable terminal state.** _Target:_ `ReviewView.tsx:592` (`decided`
      counts only `accepted`), `:633` (the complete/accepted copy). _Change:_ count an
      adjudicated-and-resolved Disagree toward completion so "Review complete" is
      reachable; an open Disagree shows "waiting," not a stuck burndown. _Done when:_
      accept-all + one-resolved-disagree reaches "Review complete."
- [x] **T4 · Brief format-check (warn-and-flag).** _Target:_ `coerceReview`
      (`server/app.ts:270`, brief passthrough at `:407`); surface a non-blocking
      `briefWarning` on the publish result; chip it in the viewer. _Change:_ pure
      **format** validation only — ≤4 sentences; reject backtick-fenced code and obvious
      `CamelCase`/`snake_case`/`file:line` identifiers; allow domain nouns + SHOUTY*ENV
      vars. Warn, never reject (a hard reject breaks the publish→render→revise loop).
      \_Done when:* a Brief with `someFn()` or a code fence still publishes but shows a
      warning chip; a clean Brief shows none; tests cover both.
- [x] **T5 · Read-only decision queue in the static export.** _(Already shipped:
      `App.tsx` renders `ReviewInline` for every review session and `ReviewInline`
      sets `readonly` from `exportBundle()`, so an exported decision queue renders
      the Brief + queue read-only.)_ _Target:_
      `viewer/src/App.tsx:868` (gate `… && !exportBundle()`). _Change:_ render
      `ReviewInline`/`ReviewView` in `readonly` mode for an exported decision-queue
      review instead of falling through to the card stream. The bundle already carries
      the review (`server/export.ts:88`) and the resolver serves it
      (`viewer/src/api.ts:119`) — this is purely the routing gate. _Done when:_ opening
      an exported `publish_decisions` session shows the Brief + queue (read-only); the
      PDF/flatten path still paginates.

### Then — the determinism + depth core (`[skill/aic]`, medium effort)

> **Bucket status:** none of T6–T10 are built — they land in the skill, which was
> not present in the environment for this pass. T6 has a written spec
> ([`evidence-pack-spec.md`](./evidence-pack-spec.md)); the rest await the
> skill/aic checkout. Start at T6, then T7/T9 (consume the pack), then T8/T10.

- [x] **T6 · The deterministic evidence pack.** ✅ _Built in `aic`:
      `src/tools/evidence-pack.ts` (route b), to [`docs/evidence-pack-spec.md`](./evidence-pack-spec.md)._
      Emits, for a
      frozen diff: hunk `file:line` ranges, per-file churn, hop-1 callers + their tests,
      change-coupling (pinned window), opt-in shell-out lint/test results — as JSON the
      skill cites and may not re-derive. The **conflict rule** (a Layer-1 fact beats a
      Layer-2 assertion; surface the discrepancy) and the **time-to-first-card budget**
      (git-only sub-second sections first; `--checks` opt-in, never a precondition for
      card 1) live in the skill wiring (`code-review/reference/execution.md`). _Done:_
      same range → byte-identical git sections (verified); reach resolves hop-1 callers
      with `inDiff` flags; coupling surfaces real co-changed-but-untouched files. The
      pack-vs-model conflict rule is enforced skill-side at review time.
- [x] **T7 · Cold-set audit.** ✅ _Built in `aic`: `evidence-pack cold-set`._ Re-flags
      any skipped file with churn over threshold, a sensitive path, or change-coupling
      to another file in this diff → forces a decision or an explicit justification. No
      per-repo config. Wired into `code-review/reference/execution.md`. _Done:_ a
      high-churn or sensitive skipped file is surfaced in `mustDecide` and must carry a
      justification.
- [x] **T8 · Reach-gated escalation + lens dispatch.** ✅ _Built in `aic`:
      `code-review/reference/lenses.md`._ The panel is gated on sensitive-trigger
      **AND** high deterministic reach; a sensitive-but-isolated change gets one scoped
      specialist. Backend/frontend lenses dispatch by risk dimension, not the extension
      table. SKILL.md "Pick depth" and `deep-review.md` updated. _Done:_ isolated
      sensitive one-liner → one specialist; high-reach slice → panel; lenses load by
      risk dimension.
- [x] **T9 · Verification receipts for block/P1.** ✅ _Built in `aic`:
      `code-review/reference/deep-review.md` P1 gate + a SKILL.md red flag._ A `block`/P1
      must name a check it ran (failing test, reach/grep hit, reproduced trace) that
      rides into the finding's `evidence`; a receiptless claim auto-downgrades to P2 or
      is dropped. _Done:_ every shipped block carries a runnable receipt.
- [x] **T10 · Flexibility seam.** ✅ _Built in `aic`:
      `code-review/reference/profiles.md`._ One enum (chill/standard/strict severity
      floor) + two lists (always/never-flag), read from `AGENTS.md`/`CLAUDE.md`; per-PR
      override > repo file > default; never-flag never suppresses a P1 and a suppressed
      item shows as a manifest disposition. _Done:_ `strict`/`chill` changes which
      severities surface (no type change); never-flag suppresses a matching nit and
      records it; a P1 is never suppressed.

### Earn their keep — gated on a real review that demands it

- [ ] **T11 ·** language-gated hop-2 reach estimate (labeled heuristic) `[skill/aic]`.
- [ ] **T12 ·** golden-diff regression harness in the skill `[skill/aic]`.
- [ ] **T13 ·** agent-owned, human-editable adjudication-memory ledger — only if it
      proves out `[skill/aic]`.

**Sequencing:** T0–T5 are **done** (in this repo); **T6–T10 are built** (in `aic`
— the evidence pack, cold-set audit, lenses + reach-gating, verification
receipts, and the strictness/never-flag seam). Nothing remains in the do-now or
then buckets; only the YAGNI-gated **T11–T13** are open, by design. See **▶ Status
for the next agent** at the top of this appendix for the authoritative per-task
state.
