// In-file moved-code detection: an unchanged block that relocated is labeled a
// move; edited blocks and trivial brace runs are not.
import { parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it } from "vitest";
import { detectMovedBlocks } from "./movedCode.ts";

const fd = (before: string, after: string) =>
  parseDiffFromFile(
    { name: "app.ts", contents: before, lang: "typescript" },
    { name: "app.ts", contents: after, lang: "typescript" },
  );

const helper = [
  "function readCapped(req: Request, max: number) {",
  "  const reader = req.body.getReader();",
  "  let total = 0;",
  "  return pump(reader, max, total);",
  "}",
].join("\n");

const filler = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `const ${tag}${i} = ${i}; // keep ${tag}`).join("\n");

describe("detectMovedBlocks", () => {
  it("labels an unchanged block that relocated, with both line positions", () => {
    const before = `${helper}\n${filler(8, "a")}\n`;
    const after = `${filler(8, "a")}\n${helper}\n`;
    const moves = detectMovedBlocks(fd(before, after));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ file: "app.ts", lines: 5, fromStart: 1, toStart: 9 });
  });

  it("does not label a block that changed while relocating", () => {
    const edited = helper.replace("let total = 0;", "let total = 1;");
    const before = `${helper}\n${filler(8, "a")}\n`;
    const after = `${filler(8, "a")}\n${edited}\n`;
    // The common prefix/suffix around the edit is under the meaningful-lines
    // bar, so nothing is labeled a move.
    expect(detectMovedBlocks(fd(before, after))).toHaveLength(0);
  });

  it("ignores trivial runs (braces and blanks)", () => {
    const braces = "}\n}\n}\n";
    const before = `${braces}${filler(6, "b")}\n`;
    const after = `${filler(6, "b")}\n${braces}`;
    expect(detectMovedBlocks(fd(before, after))).toHaveLength(0);
  });

  it("returns nothing when the file has no additions or no deletions", () => {
    const before = filler(4, "c");
    const after = `${before}\n${helper}\n`;
    expect(detectMovedBlocks(fd(before, after))).toHaveLength(0);
  });
});
