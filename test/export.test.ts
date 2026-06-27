import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildExportBundle, exportFilename, renderExportHtml } from "../server/export.ts";
import { JsonFileStore } from "../server/storage.ts";

const freshStore = () =>
  new JsonFileStore(join(mkdtempSync(join(tmpdir(), "showcase-export-")), "data.json"));

test("buildExportBundle returns null for an unknown session", async () => {
  assert.equal(await buildExportBundle(freshStore(), "nope"), null);
});

test("buildExportBundle inlines surfaces, comments, and assets as data URIs", async () => {
  const store = freshStore();
  const session = await store.createSession({ agent: "claude", title: "My review" });
  const asset = await store.putAsset({
    sessionId: session.id,
    kind: "image",
    contentType: "image/png",
    data: new Uint8Array([1, 2, 3, 4]),
  });
  const surface = await store.createSurface({
    sessionId: session.id,
    title: "Card",
    parts: [
      { kind: "html", html: `<img src="/a/${asset!.id}">` },
      { kind: "image", assetId: asset!.id },
    ],
    badge: { tone: "critical", label: "Bug" },
  });
  await store.createComment({
    sessionId: session.id,
    surfaceId: surface!.id,
    author: "user",
    text: "looks good",
  });

  const bundle = await buildExportBundle(store, session.id);
  assert.ok(bundle);
  assert.equal(bundle.sessionId, session.id);
  assert.equal(bundle.surfaces.length, 1);
  assert.equal(bundle.comments.length, 1);

  // The session row is decorated exactly like GET /api/sessions. With no stored
  // decision review, it's a visualization.
  const row = bundle.sessions[0] as {
    surfaceCount: number;
    kind: string;
    listening: boolean;
  };
  assert.equal(row.surfaceCount, 1);
  assert.equal(row.kind, "visual");
  assert.equal(row.listening, false);
  assert.equal(bundle.review, null);

  // The referenced asset is inlined as a base64 data URI of its bytes.
  assert.match(bundle.assets[asset!.id], /^data:image\/png;base64,/);
});

test("a decision-queue review is inlined and marks the session a review", async () => {
  const store = freshStore();
  const session = await store.createSession({ agent: "claude" });
  await store.putReview(session.id, {
    brief: "Caps oversized uploads before buffering them into memory.",
    verdict: "block",
    decisions: [
      {
        id: "d1",
        call: "block",
        kind: "bug",
        scope: "changed-line",
        assertion: "Buffers the body before the size check.",
        confidence: "high",
      },
    ],
    manifest: [
      {
        path: "server/app.ts",
        disposition: "has-decision",
        decisionId: "d1",
        added: 10,
        removed: 2,
      },
    ],
  });

  const bundle = await buildExportBundle(store, session.id);
  // The stored review rides in the bundle, so the exported page renders offline.
  assert.ok(bundle!.review);
  assert.equal(bundle!.review!.decisions.length, 1);
  const row = bundle!.sessions[0] as { kind: string; reviewVerdict: string };
  assert.equal(row.kind, "review");
  assert.equal(row.reviewVerdict, "block");
});

test("renderExportHtml injects the read-only bundle before </head> and neutralizes </script>", async () => {
  const store = freshStore();
  const session = await store.createSession({ agent: "claude" });
  await store.createSurface({
    sessionId: session.id,
    title: "x",
    // A part whose content contains a </script> close tag — it must not break out
    // of the injected <script>.
    parts: [{ kind: "html", html: "<p></script><!--break--></p>" }],
  });
  const bundle = await buildExportBundle(store, session.id);
  const html = renderExportHtml("<html><head><title>t</title></head><body></body></html>", bundle!);

  assert.match(html, /window\.__SHOWCASE_READONLY__=true/);
  assert.match(html, /window\.__SHOWCASE_EXPORT__=/);
  // Injected before </head> so it runs before the app script.
  assert.ok(html.indexOf("__SHOWCASE_EXPORT__") < html.indexOf("</head>"));
  // The data's `<` was escaped, so the only literal </script> is the real close.
  assert.equal(html.match(/<\/script>/g)?.length, 1);
  assert.ok(html.includes("\\u003c/script>"));
});

test("exportFilename slugifies the title, falling back to the id", () => {
  assert.equal(exportFilename("My Review: Auth!", "abc"), "showcase-my-review-auth.html");
  assert.equal(exportFilename("", "abc123"), "showcase-abc123.html");
  assert.equal(exportFilename(null, "xyz"), "showcase-xyz.html");
});

test("export redacts the agent/model identity from the session and its comments", async () => {
  const store = freshStore();
  const session = await store.createSession({ agent: "claude-code", title: "Review" });
  const surface = await store.createSurface({
    sessionId: session.id,
    title: "f",
    parts: [{ kind: "markdown", markdown: "x" }],
  });
  await store.createComment({
    sessionId: session.id,
    surfaceId: surface!.id,
    author: "claude-code",
    text: "agent reply",
  });
  await store.createComment({
    sessionId: session.id,
    surfaceId: surface!.id,
    author: "user",
    text: "user note",
  });

  const bundle = await buildExportBundle(store, session.id);
  // The model/tool name is gone from the session header…
  assert.equal((bundle!.sessions[0] as { agent: string }).agent, "agent");
  // …and from the agent's own comments, while the user's stay "user".
  assert.deepEqual(bundle!.comments.map((c) => c.author).sort(), ["agent", "user"]);
  // …and nowhere in the serialized bundle a recipient could inspect.
  assert.ok(!JSON.stringify(bundle).includes("claude-code"));
});
