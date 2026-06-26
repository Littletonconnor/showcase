# The agent-era PR review form factor

_A standardized structure for reviewing code in the age of agents. Design — not
yet built. This is the north star: if an implementation drifts, come back here._

---

## The problem

Every review tool — GitHub, Graphite, all of them — treats the **diff** as the
unit of review: files alphabetical, every line equal weight, linear scroll. That
makes review scale with the **size of the change**. It worked when a human wrote
the code and the reviewer spot-checked for human mistakes.

Two things invert when an **agent** writes (or reviews) the code:

1. **The author isn't a trust signal.** The agent is fast, confident, and
   sometimes wrong in ways that look right — "AI code that's wrong looks as
   polished as AI code that's right." Every line is suspect until understood.
2. **Volume explodes.** Agents open big diffs, often. The reviewer's scarce
   resource stops being _diligence_ and becomes **attention**.

The research says the same thing from three directions:

- Reviewers reliably catch surface/style issues and reliably **miss design and
  security defects**; in one study no single reviewer found all known vulns, and
  experience didn't predict accuracy (Edmundson et al., ESSoS 2013).
- The **#1 reviewer challenge is understanding the change and its rationale**, and
  it's the least tool-supported (Bacchelli & Bird, ICSE 2013).
- **Smaller changes are reviewed far better**; large diffs become a formality
  (McIntosh et al., EMSE 2016; Sadowski et al., ICSE 2018 — median change ≈ 24
  lines).

So a review tool's job is not "show the diff." It is: **route the reviewer's
limited attention to what carries risk, and make the change legible fast.**

---

## The core inversion: review _decisions_, not _diffs_

A diff scales with lines; an agent emits thousands. But a _change_ only ever
makes a handful of **decisions** — "this adds rate-limiting correctly," "this
migration is backwards-compatible," "this refactor preserves behavior." A 50-file
agent PR is maybe six decisions.

> **The agent decomposes its own change into a small, risk-ranked queue of
> decisions, and the human adjudicates the decisions — not the files.**

The diff becomes _evidence you drill into per decision_, never something you
browse linearly. **Review time scales with the change's conceptual risk, not its
line count.** That is the thing that makes a 5,000-line agent diff reviewable —
the agent, which has the full context, does the sifting _as the artifact_ and
hands the human a structured argument to judge.

---

## The form factor (always the same — "structure is the API")

The agent fills fixed slots; showcase renders them identically every time, so the
reviewer never re-learns the layout. Top to bottom:

### 1. The Brief — for anyone

The review opens with a plain-English **brief**: 3–4 sentences, zero jargon,
readable by a PM, a designer, a manager — anyone, regardless of programming
experience. The reproducible standard is _"explain this PR to a smart person who
doesn't code."_

> _This change makes the app turn away oversized file uploads before it starts
> downloading them, so one giant upload can't run the server out of memory and
> crash it. Nothing changes for people using the app — it only affects what
> happens behind the scenes. One thing still needs a look: uploads that don't say
> their size up front aren't caught yet, which the author flagged as a follow-up._

The Brief **folds the risk into prose** ("one thing still needs a look"), so the
old metrics masthead — risk band, time budget, gauges — _goes away_. The only
metric is a small derived **verdict chip** beside it (`Block · 1 issue`), and it's
a _consequence of the decisions_, not a separate dial.

This is also what makes the [static export](../README.md) worth sending: a
stakeholder reads the Brief and understands the change without reading a line of
code.

### 2. Two registers, by design

- **The Brief** is the one place that is _strictly_ jargon-free — no file names,
  no function names, no `code`. (showcase can enforce it: reject a brief stuffed
  with identifiers or over four sentences.)
- **The Decisions** below are fully technical — symbols, `file:line`, diffs.

You read the Brief to understand _what's happening_, then drop into the technical
decisions to _judge_ it. The register-switch is the overview→detail zoom, in
language.

### 3. The decision queue

A risk-ranked list of decisions. The masthead's "if you read nothing else" lede is
**automatically decision #1** — the queue is already sorted by risk, so the top
decision _is_ the most important by construction. No separate headline to author
or let drift.

### 4. The anatomy of a decision (the fixed grammar)

Every decision reads top-to-bottom in the same slots, so they all read the same:

```
LEFT (the decision)                              RIGHT (snaps in, only if evidence)
┌─────────────────────────────────────────┐
│ Decision 2 / 6              [bug·whole-file]│  server/auth/token.ts
│ ⛔ BLOCK                                    │  ┌───────────────────────────┐
│ Token refresh accepts a stale token on a   │  │ 39 - validateExp(cached)  │
│ cache hit.                                 │  │ 40 + // exp check dropped  │
│ → A revoked token keeps working until the  │  └───────────────────────────┘
│   cache TTL; any caller hits it.           │  + a control-flow mermaid of
│ ─────────────────────────────────────────  │    the stale path
│ sure · ✗ no test covers the cache path     │
│ flips to ✅ if a test exercises that path   │
│ [ Accept ]  [ Prove it ]  [ Challenge ]     │
└─────────────────────────────────────────┘
```

The slots, in order:

1. **rank + scope** — `2/6 · [bug · whole-file]`. Where it sits in the queue, and
   how far the reviewer must look (changed-line / whole-file / codebase — the
   scope tiers from Graphite's tiered analysis).
2. **the call** — `⛔ BLOCK` / `✅ SHIP` / `⚠️ DECIDE`, as a verb, in the strongest
   preattentive channel (color + icon).
3. **the assertion** — one bold sentence: the conclusion.
4. **why it matters** — the impact: who hits it, how bad, under what input.
5. **the ledger** — confidence + what was and wasn't verified. The author isn't a
   trust signal, so every decision declares this. The gaps ("✗ no test covers the
   cache path") are the **Prove-it targets**.
6. **the pivot** _(conditional)_ — "flips to ✅ if X." Renders **only** when there's
   a real fork: an unverified gap that could change the call, or a load-bearing
   assumption. Hidden on a clean `✅ SHIP` so it never becomes noise.
7. **the verbs** — Accept / Prove it / Challenge.

A clean refactor is the _same seven slots_, just `✅ SHIP · "behavior-preserving" ·
sure · covered · [Accept]`, no pivot, no right pane. A scary migration is the same
seven slots with a loud pivot and a Prove-it. **One grammar, every decision, every
PR.**

### 5. The layout: two columns, scroll-snapped, evidence-gated

Borrowed from Linear's narrative pages (prose left, a synced visual that snaps as
you pass each section):

- **Left** — the decision narrative.
- **Right** — the evidence for the _current_ decision: the diff hunk, plus
  whatever grounds it (a control-flow mermaid, the schema, the change map). As you
  scroll / `j`-`k` the left, the right **snaps** to that decision's evidence. The
  diff is never browsed linearly — it's the synced evidence for the decision
  you're on.
- **Evidence-gated** — a decision with no artifact (pure prose, or the Brief)
  renders **full-width**; the right pane only appears when there's something to
  show. So the layout _breathes_: **overview (full-width) → deep-dive (two-column)
  → verdict (full-width)**. The zoom is physical.

A subtle **burndown** (decisions adjudicated / total) and the verdict chip stay in
view, so the review has a visible **terminal state** ("Review complete — blocked
on #2"). Review has a finish line.

---

## The interaction model

In the agent age, the human's leverage isn't re-verifying the code — it's
**directing the agent's verification.** A decision has a spectrum of responses:

- **Accept** — ratify the recommendation (low-risk, or you spot-checked the
  evidence on the right). One key; burns down; snaps to the next.
- **Prove it** ⭐ — the power move. Tap a _declared gap_ in the ledger ("did not run
  the down-migration"). It dispatches a **scoped** task to the agent (only that
  gap — predictable, no wandering, with an "…or tell it what to check" escape
  hatch). The right pane shows it verifying; the decision **updates in place** —
  the ledger fills and the call may _flip_ in front of you. You spent one tap; the
  agent spent the effort. This turns the honesty ledger from passive disclosure
  into the _primary interaction surface_.
- **Challenge** — the _dialogue_ verb, for when the agent is confident and you
  think it's **wrong** (its conclusion, not a declared gap). The loop:
  1. You write the objection — free text, optionally **anchored to a line** in the
     right pane. _e.g. "This `✅ behavior-preserving` is wrong — it drops the catch
     on line 88."_
  2. It dispatches as a scoped task: _"The reviewer challenges decision #N with
     `<objection>`. Defend your conclusion against this specific point, or concede
     and revise."_ — a **forced binary**, no hand-waving.
  3. The agent answers, threaded under the decision: **defends** (a rebuttal with
     evidence; the decision stands, objection + rebuttal recorded) or **concedes**
     (the decision **revises in place** — the call flips, assertion + evidence
     update, burndown reflects it).
  4. You then Accept / Override the possibly-updated decision.

  It's showcase's existing comment→agent→revise loop, framed as an adversarial
  exchange scoped to one decision with a forced defend-or-concede outcome — and the
  back-and-forth is recorded, which makes the shared export show not just the
  verdict but the _argument_ behind it.

- **Override** — decide against the recommendation; your call wins. No dialogue.

The clean spectrum: **Accept** (agree) · **Prove it** (close a gap) · **Challenge**
(argue) · **Override** (overrule). Challenge is the only verb that engages the
agent in a defense.

The reviewer flies the queue: accept the clear ones, _prove-it_ the
scary-but-unverified ones (and watch them resolve), challenge the wrong ones,
override where they disagree.

---

## What we deliberately did NOT build (and why)

Grounded in a visualization rubric (Tufte data-ink / chartjunk; Cleveland & McGill
encoding-effectiveness ranking; Munzner "a viz must serve a task"; Bertin /
preattentive). A visual earns its place only if it maps to a named reviewer
decision, puts the key variable in the **strongest channel (position/length, not
area/color)**, routes attention, and **beats a sorted table or a sentence.**

- **Hotspot _bubble_ chart** — encodes magnitude as _area_, a named anti-pattern.
  The churn×complexity _signal_ is the best-evidenced risk lens (CodeScene: ~2–3%
  of code → 25–70% of defects), but if built it must be encoded by **position**,
  not bubble area.
- **File minimap / heat-strip, layered arc diagram, 3D code-city** — weak channels
  (color intensity / area / occlusion), niche decisions, "pretty pictures." Cut.
- A **sandboxed D3 charting kit** — rejected outright: Recharts is already in the
  app (trusted React → SVG, the audited-safe path); D3 would add ~250KB and a
  brand-new sandboxed-iframe attack surface for zero benefit.

Genuinely meaningful _structural_ additions, held for later and only if a real
review needs them:

- **Temporal change-coupling** — "files that historically change together, but the
  PR only touched some" → catches the #1 reviewer miss (forgot to update X);
  something no diff shows. Best as a ranked list, not a chart.
- **Dependency matrix (DSM)** — for dense refactors where the node-link change map
  turns to spaghetti; a cycle reads as a square, layering as a triangle. Opt-in.

---

## Reproducible data model (sketch — the "structure is the API")

```jsonc
Review = {
  brief: string,         // ≤4 sentences, plain English, no identifiers (enforced)
  verdict: derived,      // block | approve | comment — computed from the decisions
  decisions: Decision[], // risk-ranked; decisions[0] is the lede
}

Decision = {
  call: "block" | "ship" | "decide",
  kind: "bug" | "fix" | "capability" | "refactor" | "migration" | "risk",
  scope: "changed-line" | "whole-file" | "codebase",
  assertion: string,     // one sentence — the conclusion
  impact: string,        // who hits it, how bad, under what input
  confidence: "high" | "medium" | "low",
  coverage: string,      // what was / wasn't verified
  gaps: [{ what: string, proveScope: string }], // each → a scoped [Prove it]
  pivot?: string,        // conditional — "flips to ✅ if …"
  evidence: Part[],      // right-pane artifacts (diff / mermaid / code / chart)
}
```

This is additive over the shipped review primitives (`publish_review`, the typed
parts, the `review` kit) — a reorganization of them into the decision grammar, not
a rewrite.

---

## Open questions (revisit before / during build)

1. **Decision granularity** — what rises to a "decision" vs. folds into the cold/
   skip set? The whole thing hinges on the agent's triage being honest.
2. **Trusting the skip set** — if the agent buries a real change in "cold," the
   form factor _helps_ the bug. Deferred until real use shows whether it happens;
   may need a cheap independent check on what's marked cold.
3. **Brief enforcement** — how strict is "no identifiers"? Reject outright, or warn?

_(Resolved during design: the unit is a **decision**; the masthead is replaced by
the plain-English **Brief**; the lede is automatically decision #1; **Prove it** is
scoped to a declared gap; **Challenge** is the defend-or-concede dialogue loop
above.)_

---

## One-line synthesis

A multimodal PR review converts a flat, author-trusted, arbitrarily-large diff
into a **plain-English Brief anyone can read** plus a **small, risk-ranked queue of
decisions** — each in one fixed grammar, each with an honesty ledger whose gaps are
one tap from being proven — laid out two-column with the evidence snapping to the
decision you're on. Review scales with risk, not size; the agent argues, the human
judges.
