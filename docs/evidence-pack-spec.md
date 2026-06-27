# The deterministic evidence pack — spec (T6)

_The spec the review engine's Layer-1 scaffold is built against. The pack is the
ground truth the `code-review` skill reasons **over** and may not re-derive. This
doc is the contract; the implementation lives in the skill (Layer 1) — see
[review-engine.md](./review-engine.md) §1 and the appendix (T6). It is **not** built
in this repo: per the engine doc's one-way seam, the pack "lands in the skill. None
touch showcase." This file is the in-repo deliverable that unblocks that build._

---

## Purpose

Every fact the model recomputes by reading — which lines changed, who calls this,
what's tested — is a fact it can get wrong _differently_ each run. The pack
computes the cheap, reproducible facts **once, before any judgment**, and hands
them up as ground truth. This is the single highest-leverage determinism win in
the engine: it collapses the variance of "what's true about the diff" to zero, and
it carries the deepest cheap depth signal (the forgot-the-coupled-file miss) in the
same move.

What stays the model's: severity, the call, the prose — the **judgment**. The pack
never assigns severity or decides what a fact _means_ (that would cross into Layer
2; see the engine doc's "Layer 1 reports; Layer 2 decides; Layer 3 renders").

---

## Scope (what one developer can run locally)

In scope — cheap, portable, no index, no SaaS, no native deps:

- Diff hunks with exact `file:line` ranges (git).
- Per-file churn (added/removed), ranked.
- Hop-1 callers + the tests that cover them (best-effort, language-gated).
- Change-coupling over a pinned `git log` window.
- Lint / typecheck / test results, by **shelling out to the project's own
  commands** — never a bundled engine.

Out of scope (these are the engine doc's non-goals — do not build them here):

- A persistent repo embedding / AST index (drifts run-to-run; needs storage).
- A bundled SAST engine, tree-sitter grammars, or a multi-language call-graph
  subsystem (a per-language treadmill that drags native deps toward the runtime).
- Deeper-than-hop-1 reach as a default (opt-in per escalated slice only; hop-2 is
  the YAGNI-gated T11).

---

## Invocation

A standalone tool the skill invokes (route **b**), pure function of a **frozen
diff**:

```
evidence-pack --base <ref> --head <ref> [--config <path>] [--no-lint] [--coupling-window <N>]
```

- `--base` / `--head` — the commit range. The pack pins the **base commit sha**
  into its output so a re-run on the same range is byte-stable for the git-derived
  sections.
- `--config` — optional; supplies the project's lint/typecheck/test commands,
  sensitive-path globs, and language hints (see [Config](#config)). Absent → the
  pack auto-detects from `package.json` scripts and ships git-only sections.
- `--no-lint` — skip the shell-out section entirely (git-only, sub-second).
- `--coupling-window` — number of commits for the change-coupling window
  (default 200); pinned so the result is stable for a frozen base.

The tool reads the repo through `git` only; it never writes to the working tree.

---

## Output

A single JSON object on stdout. The skill cites `file:line` from it and **must not
re-derive** any field it contains.

```jsonc
{
  "schema": "evidence-pack/1",
  "base": "<full sha of --base>", // pinned: makes git sections reproducible
  "head": "<full sha of --head>",
  "generatedFrom": { "couplingWindow": 200, "lang": ["ts", "tsx"] },
  "files": [
    {
      "path": "server/app.ts",
      "added": 47,
      "removed": 6, // churn (display + escalation input)
      "hunks": [{ "newStart": 270, "newLines": 24, "oldStart": 270, "oldLines": 3 }],
      "sensitive": false, // matched a sensitive-path glob (config)
    },
  ],
  "reach": [
    {
      "symbol": "coerceReview", // exported symbol changed in this diff
      "definedIn": "server/app.ts:270",
      "callers": [
        // HOP 1 ONLY — best-effort, labeled
        { "at": "server/app.ts:560", "inDiff": true },
        { "at": "server/mcpHttp.ts:112", "inDiff": false },
      ],
      "tests": ["test/api.test.ts"], // test files that exercise a caller
      "confidence": "grep", // see Reach honesty below
      "heuristic": true, // ALWAYS true for now (static grep)
    },
  ],
  "coupling": [
    {
      "changed": "server/app.ts",
      "couples": [{ "path": "server/mcpSpec.ts", "score": 0.62, "coChanges": 31 }],
      "missingFromDiff": ["server/mcpSpec.ts"], // co-changes historically, NOT in this diff
    },
  ],
  "checks": [
    {
      "name": "typecheck",
      "command": "npm run typecheck",
      "ran": true,
      "exitCode": 0,
      "durationMs": 4200,
      "summary": "0 errors",
      "output": "…tail, truncated…", // the receipt; rides into a decision's evidence
    },
  ],
  "notes": ["lint skipped (--no-lint)", "reach: Java DI not resolved (see honesty)"],
}
```

### Field rules

- **`files[].hunks`** use git's _new-file_ line numbers (`newStart`/`newLines`) as
  the canonical `file:line` a finding cites; old-side numbers are carried for
  rename/delete context only.
- **`reach`** is keyed on **exported/changed symbols**, hop-1 callers only. Every
  entry carries `heuristic: true` and a `confidence` of `grep` (a textual match,
  may catch comments/same-named symbols) — never presented as a proof.
- **`coupling[].missingFromDiff`** is the load-bearing field: files that
  historically co-change with a changed file but are **absent** from this diff —
  the forgot-the-coupled-file hint. Ranked by `score`; treated as a best-effort
  hint, not a guarantee.
- **`checks`** records _what ran and what came back_, including failures and flakes
  — a passing run is evidence, not a proof the world beneath it is deterministic.

---

## The pack-vs-model conflict rule

"Forbid the model from re-deriving facts" is unenforceable unless you say who wins.
The rule the skill applies:

> **A Layer-1 fact beats a Layer-2 assertion, and the discrepancy is surfaced.**

Concretely, before publish the skill checks each load-bearing claim against the
pack:

- A finding claims "this path is covered" but the pack's `reach[].tests` is empty
  for that symbol → the finding's confidence is **capped** (high → medium at most)
  and the conflict is shown ("model: tested; pack: no covering test found").
- A finding cites a `file:line` outside any `files[].hunks` range → flag as
  possibly-stale location.
- A finding asserts "no other caller" but `reach[].callers` lists one not in the
  diff → cap + surface.

Without this rule the pack is advisory; with it, the pack is ground truth.

---

## The time-to-first-card budget

Time-to-first-card **is** the UX. The pack must never make the live loop wait.

- **Git-only sections** (hunks, churn, coupling) are sub-second `git` ops and run
  first; they are always available before the first decision renders.
- **`checks` (lint/typecheck/test)** are **opt-in per escalated slice** and
  time-boxed — never a precondition for card 1. The pack may **stream**: emit the
  git sections immediately, then patch in `checks` as they finish.
- A pack that gates the first card behind a full lint/test run of a large repo has
  defeated its own purpose. Each check carries a wall-clock budget; on timeout it
  records `ran: false, note: "timed out at <ms>"` rather than blocking.

---

## Determinism & honesty

Claim each layer honestly (determinism and precision are different axes — see the
engine doc's thesis):

- **Reproducible for a frozen base:** hunks, churn — byte-identical every run.
- **Reproducible-with-a-pin:** coupling — pin the window + base sha; it still
  shifts as commits land, so don't over-engineer its reproducibility past the pin.
- **Best-effort, labeled heuristic:** reach — static grep can't see runtime wiring
  (Guice-DI/Hibernate, reflection). A reach estimate silently wrong on exactly the
  DI-heavy PRs that matter most is worse than none, so it is **always** flagged
  `heuristic: true` and language-gated; unsupported languages emit no reach and a
  `notes` entry saying so.
- **Honest even when flaky:** checks record the command, exit code, and output —
  a flake is recorded as what happened, not smoothed over.

---

## Acceptance (done when)

- Same `--base`/`--head` → a reproducible pack: git sections byte-identical;
  coupling stable for the pinned window; flaky checks recorded honestly rather than
  hidden.
- The skill's findings cite pack `file:line` rather than recollected locations.
- A high-confidence claim the pack contradicts (e.g. "tested" vs empty
  `reach[].tests`) is **capped and flagged** before it reaches showcase.
- The first decision renders before any lint/test runs (git-only path), and a
  large-repo lint run never blocks card 1.

---

## Downstream consumers (already specified elsewhere)

- **Cold-set audit (T7)** consumes `files[].added/removed`, `files[].sensitive`,
  and `coupling[].missingFromDiff` to re-flag a `mechanical-skipped` /
  `reviewed-no-comment` file that should carry a decision.
- **Reach-gated escalation (T8)** consumes `reach` blast-radius + coupling
  completeness to decide a slice escalates to the panel only on
  sensitive-trigger **AND** high deterministic reach.
- **Verification receipts (T9)** ride `checks[].output` into a decision's
  `evidence` as a `terminal`/`diff`/`code` part.
