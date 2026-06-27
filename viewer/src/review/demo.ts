// A sample review for the `?review-preview` form-factor mockup. Neutral content
// (showcase's own upload path). Mixes decisions with/without evidence so the
// evidence-gated layout (two-column ↔ full-width) is visible.
import type { Review } from "../../../server/types.ts";

export const DEMO_REVIEW: Review = {
  sessionId: "demo",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  verdict: "block",
  brief:
    "This change makes the app turn away oversized file uploads before it starts downloading them, so one giant upload can't run the server out of memory and crash it. Nothing changes for people using the app — it only affects what happens behind the scenes. One thing still needs a look: uploads that don't say their size up front aren't caught yet, which the author flagged as a follow-up.",
  decisions: [
    {
      id: "d-1",
      call: "block",
      kind: "bug",
      scope: "changed-line",
      assertion: "Token refresh accepts a stale token on a cache hit.",
      impact:
        "A revoked token keeps working until the cache TTL expires — any caller on the cached path is let through.",
      confidence: "high",
      pivot: "flips to ✅ if a test exercises the cache-hit path and it re-validates expiry",
      evidence: [
        {
          kind: "diff",
          files: [
            {
              filename: "server/auth/token.ts",
              before:
                "function refresh(t) {\n  if (cache.has(t)) return cache.get(t);\n  validateExp(t);\n  return store(t);\n}\n",
              after:
                "function refresh(t) {\n  if (cache.has(t)) return cache.get(t); // exp check skipped\n  validateExp(t);\n  return store(t);\n}\n",
            },
          ],
        },
      ],
    },
    {
      id: "d-2",
      call: "decide",
      kind: "migration",
      scope: "codebase",
      assertion: "The size-limit column migration is backwards-compatible.",
      impact:
        "Adds a nullable column with a default; old rows read fine and the old code path ignores it.",
      confidence: "medium",
      pivot: "flips to ⛔ if the down-migration drops the column non-reversibly",
      evidence: [
        {
          kind: "diff",
          files: [
            {
              filename: "migrations/014_add_max_bytes.sql",
              before: "",
              after: "ALTER TABLE uploads\n  ADD COLUMN max_bytes BIGINT NULL DEFAULT 52428800;\n",
            },
          ],
        },
      ],
    },
    {
      id: "d-3",
      call: "ship",
      kind: "fix",
      scope: "changed-line",
      assertion: "The new content-length guard rejects oversized uploads before buffering.",
      impact: "An oversized request gets a 413 before the body is read, so it can't exhaust heap.",
      confidence: "high",
      // No evidence → this row renders full-width.
    },
    {
      id: "d-4",
      call: "ship",
      kind: "refactor",
      scope: "whole-file",
      assertion: "content-type parsing was extracted into one `parseMime` helper.",
      impact:
        "Three handlers shared a copy-pasted split; now the charset/casing rules live in one place.",
      confidence: "high",
      evidence: [
        {
          kind: "diff",
          files: [
            {
              filename: "server/app.ts",
              before: "const mime = ct.split(';')[0].trim().toLowerCase();\n",
              after: "const mime = parseMime(ct);\n",
            },
          ],
        },
      ],
    },
  ],
  // Complete changed-file manifest. Most files account cleanly; `legacy/importer.ts`
  // is a big mechanical-skipped file with no justification note — the cold-set
  // concern the summary surfaces with a flag.
  manifest: [
    {
      path: "server/auth/token.ts",
      disposition: "has-decision",
      added: 1,
      removed: 1,
      decisionId: "d-1",
    },
    {
      path: "migrations/014_add_max_bytes.sql",
      disposition: "has-decision",
      added: 2,
      removed: 0,
      decisionId: "d-2",
    },
    {
      path: "server/upload.ts",
      disposition: "has-decision",
      added: 14,
      removed: 3,
      decisionId: "d-3",
    },
    { path: "server/app.ts", disposition: "has-decision", added: 4, removed: 6, decisionId: "d-4" },
    { path: "server/upload.test.ts", disposition: "reviewed-no-comment", added: 22, removed: 0 },
    {
      path: "package-lock.json",
      disposition: "mechanical-skipped",
      added: 8,
      removed: 8,
      note: "lockfile churn from the size-limit dependency bump",
    },
    {
      path: "server/legacy/importer.ts",
      disposition: "mechanical-skipped",
      added: 71,
      removed: 12,
    },
  ],
};
