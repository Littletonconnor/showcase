# Codebase tours (use case #1)

A learn session whose subject is a repo you can read. Same skill, same beat
anatomy; these are the differences.

## Before planning: actually read the code

Spend real effort here. Read the entry points, the boundaries (package
manifests, CI checks, lint gates), the storage layer, and the docs the repo
itself trusts (CLAUDE.md / AGENTS.md / ARCHITECTURE.md). The lesson's value is
exactly the value of this reading.

## The concept graph is architectural

Nodes are load-bearing ideas, not directories: "the request lifecycle", "the
trust/sandbox model", "the storage contract", "how feedback reaches the
agent". 4-7 concepts. Edges are real prerequisites ("you cannot understand the
telemetry path without the comment pipe").

## Misconceptions are wrong assumptions the surface invites

For each concept: what would a competent new engineer wrongly assume from
names, layout, or convention?

- "These two packages must import each other" (they talk over HTTP).
- "This validation happens in the handler" (it is middleware / a coerce layer).
- "This file is where X is enforced" (it is enforced in CI).

The git history and code-review comments are a misconception goldmine.

## Evidence is real artifacts

Beat models lean on `code` and `diff` parts: real files, real line numbers,
real call paths. Never paraphrase code you can quote. Keep excerpts tight
(the relevant 10-20 lines with `lineStart` set) so the mental model diagram
plus the code fit one screenful.

## trace checkpoints dominate

The signature move: concrete input, concrete state, "which file/branch
handles it?"

- "A request hits /api/comments with a malformed cursor. Which check rejects
  it, and with what status?"
- "The board file is corrupt at boot. What does the store do before giving up?"

Also strong: `apply` checkpoints framed as design questions ("you need to add
X; which package does it live in and why"), because that is the actual job.

## Worked examples are walkthroughs

A worked example here is a traced path: request in, through middleware, into
the store, back out, with the 3-4 code excerpts that matter. Completion
checkpoints blank ONE hop of the path.

## Explorables

Usually skip them; a codebase tour rarely needs a simulation. When one earns
its place (a scheduling algorithm, an eviction policy, a state machine), gate
it behind a prediction like any other.

## Closing a tour

The recap maps concepts to files ("the sandbox invariant lives in
surfacePage.ts + SandboxedPart.tsx; SECURITY.md is the contract") so the
lesson ends pointing INTO the repo, and review variants can ask about paths
the tour never showed.
