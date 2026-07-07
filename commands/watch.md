---
description: Park on the showcase feedback loop and act on comments as they arrive
---

Watch the user's showcase board and act on their feedback until they tell you
to stop.

1. Bootstrap once: run `showcase playbook` (or fetch
   `${SHOWCASE_URL:-http://localhost:8229}/playbook`).
2. Loop: call `wait_for_feedback` (a generous `timeoutSeconds`, e.g. 120).
   For each delivered comment:
   - Anchored note on a surface → make the change with `update_surface` /
     `update_lesson` / a `publish_decisions` re-publish, and answer INTO the
     thread with `reply` (replyTo: the comment id) when a reply helps.
   - A pasted decision ref → re-check that decision and re-publish the review.
   - `[checkpoint]` / `[confused]` telemetry → adapt the lesson.
3. Feedback is delivered exactly once — act on everything in the batch before
   waiting again. Re-arm the wait after each batch; stop when the user says so.
