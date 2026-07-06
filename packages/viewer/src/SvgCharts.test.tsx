// The review-depth trusted-SVG charts: agent strings render as text nodes,
// geometry follows the data, unplottable input degrades to a quiet note.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChartPart as ChartPartData } from "./api.ts";
import { readThemeColors } from "./chartTheme.ts";
import { ArcChart, MatrixChart, MinimapChart } from "./SvgCharts.tsx";

const colors = readThemeColors("default", "light");

const part = (over: Partial<ChartPartData>): ChartPartData => ({
  kind: "chart",
  chartType: "minimap",
  data: [],
  x: "file",
  y: "lines",
  ...over,
});

describe("MinimapChart", () => {
  it("renders one proportional segment per row with labels as text", () => {
    const { container } = render(
      <MinimapChart
        part={part({
          data: [
            { file: "app.ts", lines: 300, tone: "sensitive" },
            { file: "<img src=x>", lines: 100 },
          ],
        })}
        colors={colors}
        mode="light"
      />,
    );
    // Two segments (heat rect + underline rect each), widths proportional.
    const rects = container.querySelectorAll("rect");
    expect(rects.length).toBe(4);
    expect(rects[0].getAttribute("width")).toBe("75%");
    // A hostile label stays a text node — never live DOM.
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("app.ts");
  });

  it("degrades to a note when no row has a positive value", () => {
    const { container } = render(
      <MinimapChart
        part={part({ data: [{ file: "a", lines: 0 }] })}
        colors={colors}
        mode="light"
      />,
    );
    expect(container.textContent).toContain("No plottable minimap data");
  });

  it("caps rendered files and says how many were dropped", () => {
    const data = Array.from({ length: 70 }, (_, i) => ({ file: `f${i}.ts`, lines: 1 }));
    const { container } = render(
      <MinimapChart part={part({ data })} colors={colors} mode="light" />,
    );
    expect(container.textContent).toContain("+10 more files not shown");
  });
});

describe("MatrixChart", () => {
  const matrixPart = part({
    chartType: "matrix",
    x: "a",
    x2: "b",
    y: "n",
    data: [
      { a: "app.ts", b: "storage.ts", n: 4 },
      { a: "app.ts", b: "types.ts", n: 1 },
      { a: "cli.ts", b: "storage.ts", n: 2 },
    ],
  });

  it("renders a row×column grid with intensity from the value", () => {
    const { container } = render(<MatrixChart part={matrixPart} colors={colors} mode="light" />);
    // 2 rows × 2 cols = 4 cells.
    const cells = [...container.querySelectorAll("rect")];
    expect(cells.length).toBe(4);
    expect(container.textContent).toContain("app.ts");
    expect(container.textContent).toContain("storage.ts");
    // The (app.ts, storage.ts) cell carries the max intensity.
    const withTitles = cells.map((r) => r.querySelector("title")?.textContent ?? "");
    expect(withTitles).toContain("app.ts × storage.ts: 4");
  });

  it("degrades to a note when rows are unpairable", () => {
    const { container } = render(
      <MatrixChart
        part={part({ chartType: "matrix", x2: "b", data: [{ a: "only-rows" }] })}
        colors={colors}
        mode="light"
      />,
    );
    expect(container.textContent).toContain("No plottable matrix data");
  });
});

describe("ArcChart", () => {
  const arcPart = part({
    chartType: "arc",
    x: "from",
    x2: "to",
    y: "w",
    data: [
      { from: "core", to: "server", w: 5, tone: "logic" },
      { from: "core", to: "viewer", w: 2 },
      { from: "loop", to: "loop", w: 9 },
    ],
  });

  it("lays nodes on a baseline and draws one arc per cross-node row", () => {
    const { container } = render(<ArcChart part={arcPart} colors={colors} mode="light" />);
    // Self-loops are skipped; two real edges remain.
    const arcs = container.querySelectorAll("path");
    expect(arcs.length).toBe(2);
    expect(arcs[0].querySelector("title")?.textContent).toBe("core → server: 5");
    expect(container.textContent).toContain("viewer");
    // The skipped self-loop is disclosed, never silent.
    expect(container.textContent).toContain("+1 more rows");
  });

  it("degrades to a note when fewer than two nodes exist", () => {
    const { container } = render(
      <ArcChart
        part={part({
          chartType: "arc",
          x: "from",
          x2: "to",
          data: [{ from: "solo", to: "solo", w: 1 }],
        })}
        colors={colors}
        mode="light"
      />,
    );
    expect(container.textContent).toContain("No plottable arc data");
  });
});
