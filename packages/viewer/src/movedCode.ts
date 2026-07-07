// In-file moved-code detection. @pierre/diffs detects file-level renames
// (rename-pure/rename-changed) but renders an in-file block move as an
// unrelated delete+add — the reviewer re-reads code that merely relocated.
// This finds identical runs that appear as both a deletion and an addition in
// the SAME file and labels them "moved, unchanged" above the diff. Detection
// only — the hunks still render (the delete+add is the truth of the patch);
// the label removes the re-read.
import type { FileDiffMetadata } from "@pierre/diffs";

export interface MovedBlock {
  file: string;
  // Line count of the moved run.
  lines: number;
  // 1-based line numbers: where the run sat in the old file / sits in the new.
  fromStart: number;
  toStart: number;
}

interface Run {
  // Right-trimmed lines (a move often lands at a different indent-trailing
  // whitespace state; leading indent must still match — a re-indented block
  // is a real change, not a pure move).
  lines: string[];
  startLine: number;
}

// Quality bar: a "move" of three braces is noise. A block counts when it spans
// MIN_LINES lines of which MIN_MEANINGFUL carry real content.
const MIN_LINES = 3;
const MIN_MEANINGFUL = 2;
const MEANINGFUL_RE = /[\w"'`]{4,}/;
// Bound the O(del×add×len) scan; diffs at review scale sit far below this.
const MAX_RUN = 500;

function collectRuns(fd: FileDiffMetadata, side: "deletion" | "addition"): Run[] {
  const source = side === "deletion" ? fd.deletionLines : fd.additionLines;
  const runs: Run[] = [];
  for (const hunk of fd.hunks ?? []) {
    const hunkStart = side === "deletion" ? hunk.deletionStart : hunk.additionStart;
    const hunkIndex = side === "deletion" ? hunk.deletionLineIndex : hunk.additionLineIndex;
    for (const seg of hunk.hunkContent ?? []) {
      if (seg.type !== "change") continue;
      const count = side === "deletion" ? seg.deletions : seg.additions;
      const index = side === "deletion" ? seg.deletionLineIndex : seg.additionLineIndex;
      if (count <= 0) continue;
      runs.push({
        lines: source.slice(index, index + Math.min(count, MAX_RUN)).map((l) => l.trimEnd()),
        // deletionLines/additionLines hold that side's context+changed lines in
        // file order, so index offsets within a hunk map 1:1 to file lines.
        startLine: hunkStart + (index - hunkIndex),
      });
    }
  }
  return runs;
}

const meaningful = (lines: string[]): boolean =>
  lines.filter((l) => MEANINGFUL_RE.test(l)).length >= MIN_MEANINGFUL;

// Longest common run of consecutive identical lines between two line arrays.
function longestCommonRun(
  a: string[],
  b: string[],
): { ai: number; bi: number; len: number } | null {
  let best: { ai: number; bi: number; len: number } | null = null;
  for (let ai = 0; ai < a.length; ai++) {
    for (let bi = 0; bi < b.length; bi++) {
      if (a[ai] !== b[bi]) continue;
      let len = 0;
      while (ai + len < a.length && bi + len < b.length && a[ai + len] === b[bi + len]) len++;
      if (len >= MIN_LINES && (best === null || len > best.len)) best = { ai, bi, len };
    }
  }
  return best;
}

// Detect in-file moves for one file's diff: identical (whitespace-right-
// trimmed) runs of ≥3 meaningful lines that were deleted in one place and
// added in another. Each deletion/addition run pairs at most once (its best
// match), so a block repeated N times doesn't fan out N² labels.
export function detectMovedBlocks(fd: FileDiffMetadata): MovedBlock[] {
  const deletions = collectRuns(fd, "deletion");
  const additions = collectRuns(fd, "addition");
  if (deletions.length === 0 || additions.length === 0) return [];

  const takenAdds = new Set<number>();
  const moves: MovedBlock[] = [];
  for (const del of deletions) {
    let best: { addIdx: number; ai: number; bi: number; len: number } | null = null;
    for (let addIdx = 0; addIdx < additions.length; addIdx++) {
      if (takenAdds.has(addIdx)) continue;
      const hit = longestCommonRun(del.lines, additions[addIdx].lines);
      if (hit && (best === null || hit.len > best.len)) best = { addIdx, ...hit };
    }
    if (!best) continue;
    const block = del.lines.slice(best.ai, best.ai + best.len);
    if (!meaningful(block)) continue;
    takenAdds.add(best.addIdx);
    moves.push({
      file: fd.name,
      lines: best.len,
      fromStart: del.startLine + best.ai,
      toStart: additions[best.addIdx].startLine + best.bi,
    });
  }
  return moves.sort((m1, m2) => m1.fromStart - m2.fromStart);
}
