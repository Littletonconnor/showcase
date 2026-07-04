# Checkpoint authoring

The checkpoint is the atomic unit of the lesson. Author checkpoints BEFORE
instruction (backward design): decide what the learner must produce, then
write the minimum teaching that gets them there.

## The kinds and when to use each

| kind         | learner act                               | graded by                            | use for                                              |
| ------------ | ----------------------------------------- | ------------------------------------ | ---------------------------------------------------- |
| `predict`    | commit to an outcome before seeing it     | client (choice) or agent (free text) | hooks, gates on explorables, any "what happens next" |
| `mcq`        | choose among diagnostic distractors       | client, instant                      | misconception diagnosis; quick retrieval             |
| `completion` | fill the missing step of a worked example | agent                                | the middle of the fading arc                         |
| `explain`    | explain back in their own words           | agent                                | schema formation; the deepest signal                 |
| `trace`      | predict the output/state of code          | client (exact) or agent              | codebase tours, mechanics                            |
| `apply`      | solve a novel problem, full generation    | agent                                | end of the fading arc; transfer                      |

## Quality bar, per kind

**predict (hook).** Ask before ANY teaching. The question must be answerable
from a plausible-but-wrong model, so being wrong is informative. Bad: "What
will this lesson cover?" Good: "This Redis has maxmemory set and no policy
configured. Memory is full. What does the next SET do?"

**mcq.** 2-4 options, exactly one correct. Every wrong option is a DIAGNOSTIC
distractor: it is what a learner holding a specific misconception would pick,
and it carries that `misconception` tag. Never pad with absurd options; an
option nobody would pick teaches nothing when avoided. Bad distractor: "Redis
emails the admin." Good distractor: "The oldest key is evicted" (tag: "Redis
evicts by default").

**completion.** Show a worked example with ONE step removed, chosen so filling
it requires the concept, not pattern-matching the surrounding lines.

**explain.** Prompt for the mechanism, not the definition: "explain WHY
catchAll cannot see a defect", not "what is a defect". Grade substantively:
name what is right, name the gap, one targeted question back.

**trace.** Give concrete state and concrete code; ask for a concrete output.
If the answer is short and unambiguous, set `expected` for instant client
grading; otherwise leave it agent-graded.

**apply.** A novel context the lesson never showed. Vary the surface (different
domain, different code) while targeting the same underlying principle. This is
what transfer means.

## The reveal

Every checkpoint carries a `reveal`: the correct answer AND why, in 2-4
sentences. When a distractor was misconception-tagged, the reveal names the
wrong model and where it breaks (refutation beats avoidance). The reveal shows
only after a committed attempt; never reference it in the prompt.

## Interleaving

From the second beat on, include one checkpoint targeting an EARLIER concept,
in a fresh surface context. Discrimination ("which idea applies here?") is a
separate skill from recall and only interleaving trains it.

## Confidence

Set `askConfidence: true` on one or two checkpoints per beat, preferably the
ones where miscalibration is likely (early, or where a misconception feels
right). The system uses it only for a calibration line in the reveal.

## Anti-patterns

- A checkpoint answerable by copying words from the model text above it.
- "All of the above" / "none of the above".
- Trick questions that hinge on wording rather than the concept.
- Ten checkpoints per beat. Two or three good ones beat a quiz wall.
- Revealing in the prompt ("Given that the default is noeviction, what is the
  default?").
