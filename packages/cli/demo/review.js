const REVIEW_BUG_FLOW = `flowchart LR
  Client([Client]) --> read[read body]
  read --> size{>5MB?}
  size -- yes --> late[413 late]
  size -- no --> store[store]
  read -. OOM .-> heap[heap exhausted]`;

// A nit's suggested fix as a before→after pair — the viewer computes the diff.
const REVIEW_NIT_BEFORE = `const mime = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();`;
const REVIEW_NIT_AFTER = `const mime = parseMime(c);`;

const REVIEW_BUG_DIFF = `diff --git a/server/app.ts b/server/app.ts
--- a/server/app.ts
+++ b/server/app.ts
@@ -747,6 +747,11 @@ app.post('/api/assets', async (c) => {
   const mime = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
+  // Reject oversize uploads before buffering the body into memory.
+  const len = Number(c.req.header('content-length') ?? 0);
+  if (len > MAX_ASSET_BYTES) {
+    return c.json({ error: \`asset exceeds \${MAX_ASSET_BYTES} bytes\` }, 413);
+  }
   const buf = new Uint8Array(await c.req.arrayBuffer());
   let envelope: any = null;`;

// Architecture sketch for the recommended option — a mermaid sequence diagram

export const reviewSession = {
  agent: "claude-code",
  title: "Review: streaming asset uploads",
  review: {
    brief:
      "This change makes the app turn away oversized file uploads before it starts reading them, so one giant upload can't run the server out of memory and crash it. Nothing changes for people using the app — it only affects what happens behind the scenes. One uncovered case is flagged as a follow-up: uploads that don't declare their size up front still slip past.",
    verdict: "block",
    decisions: [
      {
        id: "d-upload-buffer",
        call: "block",
        kind: "bug",
        scope: "changed-line",
        assertion: "The upload handler buffers the whole request body before the size check.",
        impact:
          "A 2 GB upload allocates ~2 GB of heap and can OOM the server before the 413 returns. Local boards ship without an auth token, so any client on the network can trigger it.",
        details:
          "`uploadAsset` reads the entire body into memory via `c.req.arrayBuffer()`, then checks `MAX_ASSET_BYTES` — so the guard never runs for an oversized request. Reject on the `content-length` header before reading the body; a streaming cap can follow for chunked uploads that omit it.",
        confidence: "high",
        pivot: "flips to ship once the content-length guard lands",
        evidence: [
          { kind: "mermaid", mermaid: REVIEW_BUG_FLOW },
          { kind: "diff", patch: REVIEW_BUG_DIFF },
        ],
        proposal: {
          filename: "server/app.ts",
          before: "const buf = new Uint8Array(await c.req.arrayBuffer());",
          after:
            "const len = Number(c.req.header('content-length') ?? 0);\nif (len > MAX_ASSET_BYTES) return c.json({ error: 'too large' }, 413);\nconst buf = new Uint8Array(await c.req.arrayBuffer());",
          note: "reject before buffering the body",
        },
      },
      {
        id: "d-mime-dupe",
        call: "decide",
        kind: "refactor",
        scope: "whole-file",
        assertion: "The content-type to mime parse is copy-pasted across three handlers.",
        impact:
          "A future tweak (charset stripping, casing) has to be made in three places or they diverge.",
        details:
          "The split lives in `uploadAsset`, `publishSurface`, and the snippet handler. Extracting one `parseMime(c)` helper keeps the rules in a single place.",
        confidence: "medium",
        evidence: [
          {
            kind: "diff",
            files: [
              { filename: "server/app.ts", before: REVIEW_NIT_BEFORE, after: REVIEW_NIT_AFTER },
            ],
          },
        ],
        proposal: {
          filename: "server/mime.ts",
          before: REVIEW_NIT_BEFORE,
          after: REVIEW_NIT_AFTER,
          note: "extract a single parseMime helper",
        },
      },
    ],
    manifest: [
      {
        path: "server/app.ts",
        disposition: "has-decision",
        decisionId: "d-upload-buffer",
        added: 24,
        removed: 6,
        note: "upload path — unbounded buffer",
      },
      {
        path: "server/mime.ts",
        disposition: "has-decision",
        decisionId: "d-mime-dupe",
        added: 12,
        removed: 0,
        note: "new shared content-type parser",
      },
      {
        path: "test/assets.test.ts",
        disposition: "reviewed-no-comment",
        added: 18,
        removed: 0,
        note: "covers the new size guard",
      },
      {
        path: "package-lock.json",
        disposition: "mechanical-skipped",
        added: 210,
        removed: 90,
        note: "generated / vendored — glance only",
      },
    ],
    // The guided read — importance-ordered chapters over the same diff: the
    // heart first, consequences next. Read-state and per-line pushback render
    // in the viewer beneath the decision queue.
    chapters: [
      {
        id: "ch-heart",
        title: "The heart: reject before you read",
        overview:
          "Everything else in this PR hangs off one move — the size guard now runs on the `content-length` header **before** the body is buffered. Read this hunk first; if you agree with the ordering, the rest is consequences.",
        files: [{ path: "server/app.ts", summary: "the guard moves above the arrayBuffer read" }],
        parts: [{ kind: "diff", patch: REVIEW_BUG_DIFF }],
      },
      {
        id: "ch-consequences",
        title: "Consequences: one mime parser, one covering test",
        overview:
          "With the guard in place the content-type split gets extracted into a shared helper, and the new test pins the 413 path. Mechanical churn (the lockfile) is accounted for in the manifest.",
        files: [
          { path: "server/mime.ts", summary: "the extracted parseMime helper" },
          { path: "test/assets.test.ts", summary: "covers the new size guard" },
        ],
        parts: [
          {
            kind: "diff",
            files: [
              { filename: "server/mime.ts", before: REVIEW_NIT_BEFORE, after: REVIEW_NIT_AFTER },
            ],
          },
        ],
      },
    ],
  },
};
