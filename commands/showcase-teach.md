---
description: Teach a topic on showcase — a lesson with checkpoints, explorables, and spaced review
argument-hint: "<topic, e.g. 'Redis eviction policies' or 'this repo's storage layer'>"
---

Teach the user `$ARGUMENTS` as a showcase lesson.

1. Use the `teach` skill to plan the lesson (concept graph, misconceptions,
   beats); it is showcase-agnostic on purpose.
2. Bootstrap showcase with `showcase playbook` (or fetch
   `${SHOWCASE_URL:-http://localhost:8229}/playbook`), then publish through
   `publish_lesson` — never hand-build checkpoint parts.
3. Check `get_learner_state` first: if the topic has mastery history, resume
   and honor due reviews instead of restarting from scratch.
4. Park on `wait_for_feedback`: checkpoint attempts arrive as `[checkpoint]`
   telemetry and confusion as `[confused]` lines. Adapt — reteach a missed
   misconception with `update_lesson`, advance when attempts are clean, and
   record graded attempts with `record_attempt` so spaced review schedules.
