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

  // The session row is decorated exactly like GET /api/sessions, so the exported
  // viewer shows the same counts it had live.
  const row = bundle.sessions[0] as {
    surfaceCount: number;
    openFindings: number;
    listening: boolean;
  };
  assert.equal(row.surfaceCount, 1);
  assert.equal(row.openFindings, 1); // an unresolved Bug finding
  assert.equal(row.listening, false);

  // The referenced asset is inlined as a base64 data URI of its bytes.
  assert.match(bundle.assets[asset!.id], /^data:image\/png;base64,/);
});

test("openFindings drops to 0 once the finding is resolved", async () => {
  const store = freshStore();
  const session = await store.createSession({ agent: "claude" });
  const surface = await store.createSurface({
    sessionId: session.id,
    title: "f",
    parts: [{ kind: "markdown", markdown: "x" }],
    badge: { tone: "critical", label: "Bug" },
  });
  await store.createComment({
    sessionId: session.id,
    surfaceId: surface!.id,
    author: "user",
    text: "✓ Approved — fixed",
  });
  const bundle = await buildExportBundle(store, session.id);
  assert.equal((bundle!.sessions[0] as { openFindings: number }).openFindings, 0);
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
