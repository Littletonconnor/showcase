// The plannotator-parity comment extras: pin anchors on images (percent
// coordinates) and reviewer suggestions (before→after edits). Both are
// bounded, validated data; malformed input degrades to a plain comment
// instead of rejecting the text.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  coerceCommentAnchor,
  coerceCommentSuggestion,
  formatCommentAnchor,
} from "@showcase/core/types";
import { createApp } from "@showcase/server/app";
import { JsonFileStore } from "@showcase/server/storage";

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "showcase-extras-"));
  const store = new JsonFileStore(join(dir, "data.json"));
  return createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    playbookText: "# playbook",
  });
}

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("pin anchors (pos)", () => {
  it("coerces valid percent coordinates and rounds to one decimal", () => {
    const a = coerceCommentAnchor({ partIndex: 0, pos: { x: 33.333, y: 66.666 } });
    assert.deepEqual(a?.pos, { x: 33.3, y: 66.7 });
    assert.equal(formatCommentAnchor(a!), "at 33.3%, 66.7%");
  });

  it("drops out-of-range or malformed pos without losing the anchor", () => {
    for (const pos of [{ x: -1, y: 5 }, { x: 5, y: 101 }, { x: "5", y: 5 }, "nope", null]) {
      const a = coerceCommentAnchor({ partIndex: 2, quote: "q", pos });
      assert.equal(a?.pos, undefined, JSON.stringify(pos));
      assert.equal(a?.quote, "q");
    }
  });
});

describe("reviewer suggestions", () => {
  it("coerces and caps a before→after pair; empty-after means deletion", () => {
    const s = coerceCommentSuggestion({ before: "const a = 2;", after: "const a = 9;" });
    assert.deepEqual(s, { before: "const a = 2;", after: "const a = 9;" });
    const del = coerceCommentSuggestion({ before: "dead line", after: "" });
    assert.deepEqual(del, { before: "dead line", after: "" });
    assert.equal(coerceCommentSuggestion({ before: "", after: "  " }), undefined);
    assert.equal(coerceCommentSuggestion({ after: 42 }), undefined);
    assert.equal(coerceCommentSuggestion("x"), undefined);
  });

  it("rides the comment end to end and reaches feedback delivery", async () => {
    const app = makeApp();
    const snippet = (await (
      await app.request("/api/snippets", json({ html: "<p>x</p>", agent: "t", title: "Doc" }))
    ).json()) as any;

    const posted = await app.request(
      "/api/comments",
      json({
        surface: snippet.id,
        text: "tighter",
        author: "user",
        anchor: { partIndex: 0, quote: "const a = 2;", line: 4, file: "app.ts" },
        suggestion: { before: "const a = 2;", after: "const A = 2;" },
      }),
    );
    assert.equal(posted.status, 201);
    const comment = (await posted.json()) as any;
    assert.deepEqual(comment.suggestion, { before: "const a = 2;", after: "const A = 2;" });

    // Piggyback delivery (the agent's next write) carries the suggestion.
    const update = await app.request(`/api/snippets/${snippet.id}`, {
      ...json({ html: "<p>y</p>" }),
      method: "PUT",
    });
    const updated = (await update.json()) as any;
    const fb = updated.userFeedback?.[0];
    assert.ok(fb, "feedback piggybacked");
    assert.deepEqual(fb.suggestion, { before: "const a = 2;", after: "const A = 2;" });
    assert.match(fb.anchor, /app\.ts line 4/);
  });

  it("a malformed suggestion degrades to a plain comment", async () => {
    const app = makeApp();
    const snippet = (await (
      await app.request("/api/snippets", json({ html: "<p>x</p>", agent: "t", title: "Doc" }))
    ).json()) as any;
    const posted = await app.request(
      "/api/comments",
      json({ surface: snippet.id, text: "note", author: "user", suggestion: { after: 42 } }),
    );
    assert.equal(posted.status, 201);
    const comment = (await posted.json()) as any;
    assert.equal(comment.suggestion, undefined);
    assert.equal(comment.text, "note");
  });
});
