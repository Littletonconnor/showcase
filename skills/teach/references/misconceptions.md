# Misconception authoring

Enumerate misconceptions per concept BEFORE writing any instruction. They are
the skeleton the checkpoints and remediations hang on.

## What counts as a misconception

A coherent, plausible, WRONG mental model that produces confident wrong
answers. Not ignorance (no model), not a typo-level slip. Test: could a smart
learner argue for it? If yes, it is worth engineering a distractor for.

Good examples:

- "Redis evicts old keys by default" (it errors; eviction is opt-in).
- "Effect's catchAll catches everything" (defects bypass it by design).
- "This CLI imports the server package" (it is HTTP-only; the boundary is the
  point).

## Where to find them, per subject type

**Technologies.** The gap between the marketing model and the mechanism (LRU
that is actually sampling); behaviors inherited from a sibling tool (Postgres
intuitions applied to Redis); defaults people assume from what the tool is FOR
(a cache surely evicts).

**Codebases.** Read the code, then ask: what would a new engineer assume from
the names and the file layout that is false? Where does the obvious call path
not exist (X looks like it calls Y; actually goes through Z)? Which invariant
is enforced somewhere non-obvious (CI script, middleware, a lock)? What did
the git history show people getting wrong?

**Fundamentals.** The classic inventories exist; use them. Equality vs
identity, references vs copies, concurrency vs parallelism, the pre-Newtonian
"force implies motion" family in every domain.

## Using them

1. Each concept in the graph lists its 2-3 misconceptions.
2. Each mcq/predict distractor maps to one and carries its tag, so a miss is a
   diagnosis, not a score.
3. Remediation is refutation-style: state the wrong model explicitly, show the
   concrete case where it breaks, then state the correct model. Refutation
   reliably beats only-present-the-correct-model instruction.
4. Track which misconceptions actually fired (the mastery record keeps them).
   Review sessions and later beats re-test THOSE, in new contexts.

## Anti-patterns

- Strawmen nobody holds (they make checkpoints easy and diagnosis empty).
- Misconceptions about trivia rather than mechanism.
- Re-explaining the whole concept when one wrong model was diagnosed. Target
  the model.
