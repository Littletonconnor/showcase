# The learn form factor

How showcase teaches. Peer of `review-form-factor.md`: that doc makes an
agent's _output_ legible; this one makes the _user's understanding_ legible,
to both the user and the agent. Recon and divergence notes:
`learn-phase0-findings.md`. Implementation report:
`learn-implementation-report.md`.

## The thesis

In review mode, feedback flowing back to the agent is opinions about the
artifact ("change this"). In learn mode, feedback is evidence about the
learner's state ("they predicted X, the answer was Y, they've now missed
eviction-policy questions twice"). The agent's job shifts from _revise the
artifact_ to _adapt the instruction_.

The falsifiable bet: an agent that can (a) render rich interactive
explanations, (b) force the learner through evidence-producing acts
(predictions, retrieval attempts, self-explanations), and (c) observe the
results and adapt in real time, produces durable learning that neither static
explorables nor chat-only tutoring can match. Explorables can't observe or
adapt. Chat can't render or structure. showcase already has the loop that
connects both halves.

## The learning science, compressed

Each principle below is why a mechanism exists. The long-form evidence base
(meta-analyses and citations) lives in the planning doc in TODO.md history;
this is the operating summary.

| #   | Principle                                                              | Mechanism here                                                                                                                       |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Retrieval practice beats re-exposure (the testing effect)              | Checkpoints are the atomic unit; mastery moves ONLY on checkpoint outcomes                                                           |
| P2  | Spacing beats massing                                                  | The mastery store assigns due dates; `showcase review-due` resurfaces them, expanding schedule                                       |
| P3  | People cannot judge their own understanding                            | No self-report mastery, ever. Confidence is collected only to reflect calibration back ("high confidence, incorrect")                |
| P4  | Generation/prediction beats presentation                               | Hook predictions before teaching; explorables locked behind a committed prediction                                                   |
| P5  | Novices need worked examples, experts need problems                    | The learner-level knob sets the fading arc (worked example, completion, generation); mastery auto-fades it                           |
| P6  | Self-explanation deepens learning                                      | The `explain` checkpoint kind, graded substantively by the agent through the feedback pipe                                           |
| P7  | Engagement quality: Interactive > Constructive > Active > Passive      | Explorables are gated (active becomes constructive); telemetry lets the agent open dialogue about what the learner did (interactive) |
| P8  | Passive fluency is the failure mode of explorables AND unstructured AI | The structure itself forbids answer-dumping: reveals are structurally hidden until an attempt                                        |
| P9  | Multimedia principles                                                  | One diagram per beat, prose beside it, segmented cards, no decoration                                                                |
| P10 | Misconceptions must be confronted                                      | Misconception-first authoring; distractors carry tags so a miss is a diagnosis; refutation-style remediation                         |
| P11 | Interleaving aids discrimination                                       | Later beats mix earlier concepts; the review queue interleaves across topics                                                         |
| P12 | Mastery gating                                                         | The concept graph carries prerequisite edges; gating is soft (the agent remediates shaky prerequisites before building)              |

## The loop

```
learner: "teach me Redis eviction on showcase"
  -> agent runs the teach skill: concept graph, misconception list, lesson plan
  -> get_learner_state: start from prior mastery, not zero (P12)
  -> publish_lesson: syllabus card + one card per concept beat
  -> learner interacts: answers checkpoints, unlocks gated explorables,
     types explain-backs
  -> telemetry events ride the comment pipe back (exactly-once)
  -> agent adapts: record_attempt grades free text; update_lesson inserts
     refutation remediations on tagged misses; scaffolding fades on strength
  -> session ends: mastery updated, review due dates scheduled
  -> days later: showcase review-due resurfaces shaky/due concepts, interleaved;
     the agent generates FRESH variants, never replays
```

## Session anatomy

A learn session is a session pinned to the `learn` blueprint:

- **Syllabus card** (first): the concept graph as a mermaid flowchart, each
  node badged by mastery state (`plain` untouched, `~` shaky, `*` solid, `!`
  due), plus a progress legend. The server re-renders it in place as telemetry
  moves mastery, so it is the map and the progress bar in one.
- **Concept beats**, one card each, fixed arc: hook prediction, mental model
  (one diagram + prose, one screenful), worked example (real code/diff parts),
  optional gated explorable, checkpoints, one-line recap.
- **Remediation cards** the agent inserts on a diagnosed misconception
  (`update_lesson` with no surfaceId appends; with one, revises in place).

## Checkpoint kinds

| kind         | learner act                               | graded by                              | principle |
| ------------ | ----------------------------------------- | -------------------------------------- | --------- |
| `predict`    | choose/type an outcome before the reveal  | client (choice) or agent (free text)   | P4        |
| `mcq`        | choose among diagnostic distractors       | client, instant                        | P1, P10   |
| `completion` | fill the missing step of a worked example | agent                                  | P5        |
| `explain`    | free-text explain-back                    | agent                                  | P6        |
| `trace`      | predict output/state of code              | client (exact via `expected`) or agent | P1, P4    |
| `apply`      | novel problem, full generation            | agent                                  | P5, P11   |

Every checkpoint carries `conceptId`, optional per-option `misconception`
tags, an optional confidence slider (calibration only, P3), and a `reveal`
shown only after a committed attempt.

## Learner experience rules (enforced, not requested)

- No resolution content exists in the DOM before an attempt commits. The
  viewer enforces this structurally; the e2e suite asserts it.
- Skipping records telemetry and shows NO reveal. Skip is not an answer
  shortcut; repeated skips tell the agent to change approach.
- Wrong answers are never punished in tone; a tagged miss names the wrong
  model in the reveal, and the agent follows up on it specifically.
- Free-form questions are ordinary comments on any card; that path is
  untouched showcase behavior and is the "interactive" top of the ICAP
  hierarchy.
- Confidence + correctness produce one calibration line in the reveal.

## The wire model

Types live in `packages/core/lesson.ts` (Lesson, LessonBeat, the checkpoint
part) and `packages/core/telemetry.ts` (the closed TelemetryEvent union);
mastery types + the SM-2-style scheduler in `packages/core/mastery.ts`. The
renderer (`renderLessonSurfaces`) is the layout owner: typed slots in, a
deterministic surface sequence out, byte-for-byte identical for the same
input, exactly like `publish_decisions`.

## Telemetry (how the loop closes)

Every learner interaction becomes a fixed-format comment
(`[checkpoint] cp-1 (mcq, concept lru): INCORRECT answer="a"
misconception="true LRU" confidence=0.8 latency=5.0s`) persisted through the
ordinary comment flow, so it inherits the exactly-once delivery guarantee
(the per-session agentSeq cursor shared by piggyback, `wait_for_feedback`,
and `showcase watch`). There is no second delivery channel to keep honest.

Two provenance tiers:

- **Trusted components** (checkpoint UI, skips, confusion flags) post directly
  from the viewer origin; these are genuine user acts, author `user`.
- **Sandboxed explorables** emit via `showcase.emit(event)` (a helper injected
  by the trusted bridge script, never authored by the agent). The viewer
  bridge validates against the closed union and forwards ONLY
  `explorable_interaction` (name `[\w.-]{1,64}`, value capped at 200 chars,
  single line); the server re-validates with the same allowlist. The formatted
  line says "emitted by sandboxed card script, not typed by the user", so
  agent-authored script can never forge free text that reads as the human.

Grading split: `mcq` / choice `predict` / exact `trace` grade client-side for
an instant reveal (the graded outcome still flows to the agent). `explain` /
`completion` / `apply` / free-text `predict` flow ungraded; the agent grades,
replies substantively, and records the outcome with `record_attempt`.

## Mastery and spaced review

`MasteryStore` (`packages/server/masteryStore.ts`) persists per-topic concept
records to `~/.showcase/mastery.json` (override `SHOWCASE_MASTERY`): state,
attempts with misconception tags, an SM-2-style ease factor, interval, and
due date. Deliberately simple: correct grows the interval by ease (1d, 3d,
then multiplicative), a miss resets short and dips ease. "Solid" requires two
SPACED correct attempts on GENERATIVE kinds; recognition alone never reaches
solid. The file is plain JSON: inspect with `showcase mastery`, wipe a topic
with `showcase mastery reset <topic>`.

`GET /api/review-due` (CLI: `showcase review-due`) returns due concepts
interleaved across topics with the misconceptions the learner actually hit.
Review sessions generate fresh checkpoint variants targeting the same concept
in a new surface context.

## Surface area

- HTTP: `POST /api/lessons`, `POST /api/lessons/beats`, `POST /api/telemetry`,
  `GET/DELETE /api/mastery`, `POST /api/mastery/attempt`, `GET /api/review-due`
- MCP (both transports): `publish_lesson`, `update_lesson`,
  `get_learner_state`, `record_attempt`
- CLI: `showcase lesson <file|->`, `showcase review-due`, `showcase mastery`
- Skill: `skills/teach/` (showcase-agnostic; degrades to structured chat)
- Demo: `showcase demo` seeds three lessons (Redis eviction, Effect-TS errors,
  a tour of this codebase)

## Anti-goals

Not a course platform (no enrollment, certificates, or authored-course
marketplace). Not an Anki replacement (the scheduler is deliberately simple;
review targets concepts-in-context, not atomic facts). Not gamified (no
streaks, points, or engagement badges; the only status is evidence-based
mastery). No self-report mastery, ever. No answer-dumping fast path (plain
chat already exists for that). No new rendering engine, transport, or storage
system.
