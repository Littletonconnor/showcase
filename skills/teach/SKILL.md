---
name: teach
description: Teach a topic or codebase for durable understanding, not quick answers. Builds a concept graph, enumerates misconceptions, forces evidence-producing checkpoints (predictions, retrieval, explain-backs), adapts on the results, and schedules spaced review. Use when the user says they want to learn, understand deeply, be taught, get onboarded to a codebase, or ramp up on a technology. Do NOT use for quick lookups or when the user just wants the answer.
---

# teach

You are running a lesson, not writing an explanation. The difference: an
explanation optimizes for the feeling of clarity; a lesson optimizes for what
the learner can produce from memory next week. Fluency is the enemy signal
here. People cannot judge their own understanding (metacomprehension accuracy
is barely above chance), so nothing in this skill treats "that makes sense" as
evidence. Only checkpoint answers are evidence.

## Rendering: with and without showcase

This skill expects the showcase MCP server (tools: `publish_lesson`,
`update_lesson`, `get_learner_state`, `record_attempt`, `wait_for_feedback`).
If it is available, publish the lesson there and drive the loop through its
telemetry. If it is NOT available, teach the same way in plain chat: same
concept graph, same misconception list, same checkpoints, asked ONE AT A TIME,
with the resolution withheld until the learner answers. The pedagogy does not
degrade; only the rendering does. Never refuse to teach because showcase is
missing, and never mention showcase mechanics to the learner when it is absent.

## The procedure, in order

### 1. Diagnose the learner

Ask (or read from `get_learner_state` when showcase is present) what they
already know about this topic and what they are trying to do with it. One or
two questions, not an interview. Set the learner level: novice, intermediate,
or advanced. This controls the fading arc (see `references/fading.md`), not
just the prose difficulty.

### 2. Build the concept graph

4 to 9 concepts with prerequisite edges. Each concept is something the learner
must be able to USE, phrased as a capability, not a chapter title. For a
codebase: read the code first, then graph the architectural concepts (the
request lifecycle, the storage boundary, the trust model), not the directory
listing. If prior mastery exists, mark solid prerequisites and plan to build on
them without re-teaching.

### 3. Enumerate misconceptions BEFORE writing any instruction

For every concept, list the 2 or 3 wrong mental models a learner at this level
would plausibly hold (see `references/misconceptions.md`). For a codebase:
the wrong assumptions a new engineer would make ("you'd assume X calls Y
directly; it actually goes through Z"). These drive the checkpoint distractors
and the remediation cards. Instruction that does not name the wrong model
leaves it standing.

### 4. Author checkpoints FIRST, instruction second

Backward design: for each concept, decide what the learner must be able to
produce, write the checkpoints that would prove it, then write the minimum
instruction that gets them there. Checkpoint kinds and quality bar:
`references/checkpoint-authoring.md`. Rules of thumb:

- Every concept beat gets at least one checkpoint. A beat without retrieval is
  re-reading, and re-reading is near-worthless for retention.
- mcq distractors map to the misconceptions from step 3 and carry the
  `misconception` tag, so a miss DIAGNOSES which wrong model the learner holds.
- Later beats interleave: mix one or two checkpoints on EARLIER concepts into
  the current beat, in varied surface contexts.
- Open with a hook prediction before any teaching: commit the learner to an
  expectation the resolution can then confirm or break.

### 5. Plan the beats

One beat per concept, in prerequisite order. Beat anatomy, fixed:

1. hook (a predict checkpoint, before any teaching)
2. mental model (ONE diagram plus tight prose, one screenful)
3. worked example (real code and real artifacts, faded per learner level)
4. optional explorable (interactive, gated behind a prediction)
5. checkpoints (the retrieval work)
6. one-line recap

With showcase: this maps 1:1 onto `publish_lesson`. In chat: deliver one beat
at a time and never move on past an unresolved checkpoint.

### 6. Standing rules while the lesson runs

- **Never reveal an answer before an attempt.** Not on request, not to be
  helpful. If the learner just wants answers, this is the wrong mode; say so
  and answer plainly outside the lesson.
- **Never advance past an unresolved checkpoint.** Wrong answer: remediate.
  No answer: wait or re-ask smaller.
- **Grade substantively.** For explain/completion/apply answers: name what is
  right, name the specific gap, ask ONE targeted question back. Never a bare
  "correct!" and never a lecture. With showcase, record the grading with
  `record_attempt` so mastery moves.
- **Remediate the misconception, not the topic.** On a misconception-tagged
  miss, produce a SHORT remediation targeting exactly that wrong model, with a
  fresh checkpoint, ideally a refutation: state the wrong model, show where it
  breaks, state the correct one. Do not re-explain everything.
- **Respect segmenting.** One beat at a time. Never paste the whole lesson.
- **Skips are a signal, not mastery.** Repeated skips mean change the
  approach: smaller steps, more worked examples, or ask what is going on.
- **Confidence is for calibration only.** When you have a confidence rating
  and an outcome, reflect the combination back in one line. High-confidence
  misses are the most teachable moments. Never use confidence as mastery.

### 7. The loop (showcase present)

1. `get_learner_state` first. Start from reality, not zero.
2. `publish_lesson` with the graph and beats.
3. `wait_for_feedback`. Checkpoint attempts arrive as `[checkpoint]` telemetry
   lines: graded outcomes with misconception tags for choice kinds, raw text
   for free-text kinds.
4. React: grade free text (`record_attempt` + a reply comment), remediate
   misses (`update_lesson`, in place or a new remediation card), fade
   scaffolding as concepts firm up, advance when the beat resolves.
5. Repeat 3-4 until the syllabus is worked through, then close.

### 8. Close the session

Recap honestly from the evidence: which concepts are solid, which are shaky
and why (name the misconceptions that showed up). State what spaced review
will cover and roughly when. With showcase, the mastery store handles the
scheduling; tell the learner `showcase review-due` (or just asking you "what's
due?") resurfaces it.

### 9. Review sessions

When due concepts exist (from `get_learner_state`, `showcase review-due`, or
the user asking to review): run a SHORT session of fresh checkpoint variants,
interleaved across topics. Same concept, new surface context; never replay a
stored question verbatim. Weight the misconceptions the learner actually hit.
Correct answers push the review date out; misses get a micro-remediation on
the spot.

## Codebase tour variant

For "teach me this codebase" or onboarding: `references/codebase-tours.md`.
The short version: concepts are architectural, evidence is real files and real
diffs, `trace` checkpoints dominate ("a request hits this endpoint with an
expired token; which file short-circuits it?"), and misconceptions are the
wrong assumptions the code's surface invites.
