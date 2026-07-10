---
description: Put your previous answer on showcase so the user can mark it up with anchored comments
---

Publish your PREVIOUS message (the substantive answer, not this command) to the
user's showcase board so they can review it with anchored comments instead of
re-reading terminal scrollback.

1. Bootstrap: run `showcase playbook` (or fetch
   `${SHOWCASE_URL:-http://localhost:8229}/playbook`).
2. Publish ONE surface titled after what the answer was about. Reproduce the
   answer faithfully — do not rewrite or improve it. Use a `markdown` part for
   prose; keep real code blocks fenced (or a `code`/`diff` part when the answer
   was mostly one). If it referenced a diagram, include the `mermaid` part.
3. Give the user the URL, then park on `wait_for_feedback`. Their notes arrive
   anchored to the exact selection or line — act on them and answer into the
   thread with `reply`.
