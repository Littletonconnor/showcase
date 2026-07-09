---
description: Explain code or a concept on showcase — a walkthrough or animated explainer
argument-hint: "<file | subsystem | concept | pasted snippet/screenshot>"
---

Explain `$ARGUMENTS` on the user's showcase board.

1. Bootstrap: run `showcase playbook` (or fetch
   `${SHOWCASE_URL:-http://localhost:8229}/playbook`).
2. Pick the form by the subject:
   - **Code in this repo** → a `walkthrough` part: READ the code first, then
     walk the call path hop by hop with real excerpts, line highlights, and a
     shared mermaid diagram (step `node`s keep the map and code in sync; the
     user can click a diagram node to jump).
   - **A concept / screenshot / snippet** → the animated-explainer recipe
     (`blueprint:"concept"`, `.step` beats, an `image` part for the source).
3. Publish ONE surface, give the user its URL, then park on
   `wait_for_feedback`. "I'm lost here" flags arrive naming the exact step —
   clarify with `update_surface`, and answer anchored comments with `reply`.
