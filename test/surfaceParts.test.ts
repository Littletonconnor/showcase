// The chart-part contract for the review-depth types (bubble/minimap/matrix/
// arc): strict mode rejects an unplottable relational chart with a pointed
// message; loose mode drops it instead of publishing a broken card.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coerceSurfaceParts, validateSurfaceParts } from "@showcase/core/surfaceParts";

const chart = (over: Record<string, unknown>) => ({
  kind: "chart",
  chartType: "bar",
  data: [{ file: "app.ts", lines: 3, coupled: "storage.ts" }],
  x: "file",
  y: "lines",
  ...over,
});

describe("review-depth chart validation", () => {
  it("accepts every new chartType strictly", () => {
    for (const chartType of ["bubble", "minimap", "matrix", "arc"]) {
      const result = validateSurfaceParts([chart({ chartType, x2: "coupled", z: "size" })]);
      assert.equal(result.ok, true, chartType);
    }
  });

  it("keeps x2/z on the parsed part", () => {
    const result = validateSurfaceParts([chart({ chartType: "bubble", z: "size" })]);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal((result.parts[0] as { z?: string }).z, "size");
  });

  it("strictly rejects matrix/arc without x2", () => {
    for (const chartType of ["matrix", "arc"]) {
      const result = validateSurfaceParts([chart({ chartType })]);
      assert.equal(result.ok, false, chartType);
      if (!result.ok) assert.match(result.error, /x2/);
    }
  });

  it("allows bubble without z (uniform dots)", () => {
    assert.equal(validateSurfaceParts([chart({ chartType: "bubble" })]).ok, true);
  });

  it("loosely drops an unplottable matrix instead of coercing it", () => {
    const parts = coerceSurfaceParts([chart({ chartType: "matrix" })]);
    assert.equal(parts.length, 0);
  });

  it("loosely keeps a plottable arc and drops a junk x2", () => {
    const parts = coerceSurfaceParts([chart({ chartType: "arc", x2: "coupled", z: 42 })]) as Array<{
      x2?: string;
      z?: string;
    }>;
    assert.equal(parts.length, 1);
    assert.equal(parts[0].x2, "coupled");
    assert.equal(parts[0].z, undefined);
  });

  it("still coerces an unknown chartType to bar in loose mode", () => {
    const parts = coerceSurfaceParts([chart({ chartType: "sunburst" })]) as Array<{
      chartType: string;
    }>;
    assert.equal(parts[0]?.chartType, "bar");
  });
});
