# teach

Turn "explain X to me" into a lesson that sticks: concept graph, forced
predictions, retrieval checkpoints, misconception-targeted remediation, and
spaced review.

## What it does

- Diagnoses what you already know, then builds a 4-9 concept map with
  prerequisites instead of a wall of prose.
- Enumerates the wrong mental models for each concept up front and engineers
  checkpoint distractors to catch them, so a wrong answer tells the agent
  WHICH wrong model you hold, not just that you missed.
- Forces evidence-producing acts before every resolution: predictions before
  teaching, retrieval after it, explain-backs the agent grades substantively.
- Adapts as you answer: remediation cards on misses, scaffolding fades as
  concepts firm up.
- Remembers. Concepts get due dates; days later a short review session
  resurfaces the shaky ones with fresh question variants.

## When to use it

- "Teach me Redis eviction / Effect-TS / Java generics properly."
- "Help me actually understand this codebase" / new-hire onboarding.
- "I keep forgetting how X works" (the review loop is the point).
- Ramping up on a technology you will use for months.

## When to skip it

- You just want the answer. Ask plainly; any agent will answer. This skill
  deliberately withholds answers until you attempt, which is exactly wrong for
  a quick lookup.
- One-off tasks: writing a doc, fixing a bug, summarizing a paper.
- Reference questions ("what's the flag for..."), API lookups, debugging.
- You want a document to keep rather than understanding to keep. Ask for a
  design doc or explainer instead.

## What you get

With the showcase MCP server connected: a live lesson session in the browser.
A syllabus card (your concept map, badged untouched/shaky/solid/due), one card
per concept beat (prediction hook, one diagram plus tight prose, a worked
example on real code, an interactive explorable you unlock by committing a
prediction, checkpoints), remediation cards when you miss, and a mastery store
under `~/.showcase/mastery.json` that drives `showcase review-due`.

Without showcase: the same lesson in plain chat. Same concepts, same
checkpoints asked one at a time, same withheld-until-you-answer resolutions.
No rendering, telemetry, or persistent mastery, but the pedagogy is identical.

## Install

Standard skills layout; any of:

```sh
npx skills@latest add Littletonconnor/showcase --skill teach
```

or in Claude Code, add the repo as a plugin marketplace:

```
/plugin marketplace add Littletonconnor/showcase
```

or copy `skills/teach/` into your agent's skills directory.

## Dependencies

Expects (but does not require) the showcase MCP server for rendering,
telemetry, and mastery persistence. See the repo README for connecting it.
Without it, the skill still teaches in chat.
