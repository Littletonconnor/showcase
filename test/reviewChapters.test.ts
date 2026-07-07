// The guided-read coverage contract (plannotator-v0.22 "Guided Review",
// showcase-shaped): a chapter can never invent a file outside the manifest
// (reject), and changed files no chapter covers are warned on, never dropped.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coerceReview } from "@showcase/server/app";

const base = () => ({
  brief: "This change makes uploads safer. Nothing changes for users.",
  verdict: "comment",
  decisions: [
    {
      id: "d-1",
      call: "ship",
      kind: "fix",
      scope: "changed-line",
      assertion: "The cap holds.",
      confidence: "high",
    },
  ],
  manifest: [
    { path: "server/app.ts", disposition: "has-decision", decisionId: "d-1", added: 6, removed: 1 },
    { path: "server/limits.ts", disposition: "reviewed-no-comment", added: 2, removed: 0 },
    {
      path: "package-lock.json",
      disposition: "mechanical-skipped",
      added: 90,
      removed: 12,
      note: "lockfile",
    },
  ],
});

const chapter = (over: Record<string, unknown> = {}) => ({
  title: "The heart",
  overview: "Where the cap moves.",
  files: [{ path: "server/app.ts", summary: "the guard moved up" }],
  ...over,
});

describe("guided-read chapters", () => {
  it("accepts chapters, mints stable ch- ids, and keeps summaries", () => {
    const result = coerceReview({ ...base(), chapters: [chapter()] });
    assert.ok("review" in result, JSON.stringify(result));
    if (!("review" in result)) return;
    const ch = result.review.chapters![0];
    assert.match(ch.id!, /^ch-/);
    assert.equal(ch.files[0].summary, "the guard moved up");
  });

  it("honors a supplied id and rejects duplicates", () => {
    const ok = coerceReview({ ...base(), chapters: [chapter({ id: "ch-heart" })] });
    assert.ok("review" in ok && ok.review.chapters![0].id === "ch-heart");
    const dup = coerceReview({
      ...base(),
      chapters: [chapter({ id: "ch-heart" }), chapter({ id: "ch-heart" })],
    });
    assert.ok("error" in dup && /duplicate id/.test(dup.error));
  });

  it("rejects a chapter file that is not in the manifest (no invented files)", () => {
    const result = coerceReview({
      ...base(),
      chapters: [chapter({ files: [{ path: "made/up.ts" }] })],
    });
    assert.ok("error" in result);
    if ("error" in result) assert.match(result.error, /cannot invent files/);
  });

  it("warns about changed files no chapter covers, ignoring mechanical skips", () => {
    // Covers app.ts only; limits.ts is uncovered, the lockfile is exempt.
    const result = coerceReview({ ...base(), chapters: [chapter()] });
    assert.ok("review" in result);
    if (!("review" in result)) return;
    const warning = (result.review.warnings ?? []).find((w) => /unchaptered/.test(w));
    assert.ok(warning, "expected an uncovered-files warning");
    assert.match(warning!, /server\/limits\.ts/);
    assert.doesNotMatch(warning!, /package-lock/);
  });

  it("stays quiet when every non-mechanical file is chaptered", () => {
    const result = coerceReview({
      ...base(),
      chapters: [
        chapter(),
        chapter({
          title: "Glue",
          overview: "Config plumbing.",
          files: [{ path: "server/limits.ts" }],
        }),
      ],
    });
    assert.ok("review" in result);
    if ("review" in result)
      assert.equal(
        (result.review.warnings ?? []).some((w) => /unchaptered/.test(w)),
        false,
      );
  });

  it("validates chapter parts like decision evidence", () => {
    const bad = coerceReview({
      ...base(),
      chapters: [chapter({ parts: [{ kind: "diff" }] })],
    });
    assert.ok("error" in bad && /parts/.test(bad.error));
    const good = coerceReview({
      ...base(),
      chapters: [
        chapter({
          parts: [
            { kind: "diff", files: [{ filename: "server/app.ts", before: "a", after: "b" }] },
          ],
        }),
      ],
    });
    assert.ok("review" in good);
    if ("review" in good) {
      const diff = good.review.chapters![0].parts![0] as { files: { before: string }[] };
      // Newline-normalized like evidence, so no "No newline" marker noise.
      assert.equal(diff.files[0].before.endsWith("\n"), true);
    }
  });

  it("rejects a chapter without title, overview, or files", () => {
    for (const broken of [
      chapter({ title: "" }),
      chapter({ overview: "  " }),
      chapter({ files: [] }),
    ]) {
      const result = coerceReview({ ...base(), chapters: [broken] });
      assert.ok("error" in result, JSON.stringify(broken));
    }
  });
});
