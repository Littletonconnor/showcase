---
description: Review a diff on showcase — a plain-English brief + a risk-ranked decision queue
argument-hint: "[branch | commit range | blank = uncommitted changes]"
---

Review the changes named by `$ARGUMENTS` on the user's showcase board. If no
argument was given, review the uncommitted working-tree changes (staged +
unstaged); a branch name means `main...<branch>` (or the repo's default base).

1. Bootstrap: run `showcase playbook` (or fetch
   `${SHOWCASE_URL:-http://localhost:8229}/playbook`) and follow its
   **"Recipe: visual PR review (decision queue)"** exactly.
2. Do the actual review with the `code-review` skill if you have it; otherwise
   review by hand at the same bar. Read the real code paths, not just the diff.
3. Render the whole review in ONE `publish_decisions` call (never a markdown
   wall): brief + verdict + risk-ranked decisions + the COMPLETE changed-file
   manifest. Include evidence diffs and a `proposal` wherever a concrete fix
   exists. For a big or multi-concern PR, add `chapters` — the guided read
   (importance-ordered: the heart of the change first, consequences next, glue
   last; every changed file in a chapter, with its live diff). At most one
   review-depth chart (minimap/bubble/matrix/arc), only if the PR's shape
   earns it.
4. Give the user the review URL, then park on `wait_for_feedback` — pushback
   arrives as comments or pasted decision refs. Revise with a re-publish; the
   decision updates in place.
