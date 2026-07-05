// The dispatch contract: every part renders inside its data-part-anchor
// wrapper, unknown kinds fall back to a neutral refresh hint (never a broken
// diff), html parts stay sandboxed iframes, and a gated explorable's iframe
// does not mount until its gate checkpoint records an attempt.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Surface, SurfacePart } from "./api.ts";
import { useLearn } from "./learn.ts";
import { PartRenderer } from "./PartRenderer.tsx";

const surfaceOf = (parts: SurfacePart[]): Surface => ({
  id: "s1",
  sessionId: "sess1",
  title: "Card title",
  parts,
  createdAt: "2026-07-05T00:00:00Z",
  updatedAt: "2026-07-05T00:00:00Z",
  version: 3,
  history: [],
});

const renderPart = (parts: SurfacePart[], index = 0) =>
  render(
    <PartRenderer
      surface={surfaceOf(parts)}
      index={index}
      threads={[]}
      frameRef={() => {}}
      exportDoc={undefined}
      theme="github"
      mode="light"
    />,
  );

beforeEach(() => {
  useLearn.setState({ attempts: {} });
});

describe("PartRenderer", () => {
  it("wraps every part in the anchor div the selection bridge resolves", () => {
    const { container } = renderPart([{ kind: "json", data: { a: 1 } }]);
    const anchor = container.querySelector("[data-part-anchor]");
    expect(anchor).toBeInTheDocument();
    expect(anchor).toHaveAttribute("data-part-index", "0");
  });

  it("renders an unknown kind as a neutral refresh hint, not a broken part", () => {
    const { container } = renderPart([{ kind: "hologram" } as unknown as SurfacePart]);
    expect(container.textContent).toContain("refresh showcase to update the viewer");
  });

  it("renders an html part as a sandboxed iframe with a title and versioned src", () => {
    const { container } = renderPart([{ kind: "html", html: "<p>x</p>" }]);
    const frame = container.querySelector("iframe")!;
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("title", "Card title");
    expect(frame.getAttribute("src")).toContain("/s/s1?part=0&ver=3");
  });

  it("numbers iframe titles on a multi-part surface", () => {
    const parts: SurfacePart[] = [
      { kind: "html", html: "<p>a</p>" },
      { kind: "html", html: "<p>b</p>" },
    ];
    const { container } = renderPart(parts, 1);
    expect(container.querySelector("iframe")).toHaveAttribute("title", "Card title (part 2)");
  });

  it("uses srcdoc instead of src when an export doc is supplied", () => {
    const { container } = render(
      <PartRenderer
        surface={surfaceOf([{ kind: "html", html: "<p>x</p>" }])}
        index={0}
        threads={[]}
        frameRef={() => {}}
        exportDoc="<!doctype html><p>exported</p>"
        theme="github"
        mode="light"
      />,
    );
    const frame = container.querySelector("iframe")!;
    expect(frame).not.toHaveAttribute("src");
    expect(frame.getAttribute("srcdoc")).toContain("exported");
  });

  it("keeps a gated explorable locked until its gate checkpoint is attempted", () => {
    const parts: SurfacePart[] = [
      {
        kind: "checkpoint",
        checkpoint: {
          id: "gate-1",
          conceptId: "c1",
          kind: "predict",
          prompt: "Predict first",
          reveal: "now play",
          gate: true,
        },
      },
      { kind: "html", html: "<p>explorable</p>" },
    ];
    const locked = renderPart(parts, 1);
    expect(locked.container.querySelector("[data-explorable-locked='gate-1']")).toBeInTheDocument();
    expect(locked.container.querySelector("iframe")).toBeNull();
    locked.unmount();

    useLearn.setState({ attempts: { "gate-1": { answer: "guess" } } });
    const unlocked = renderPart(parts, 1);
    expect(unlocked.container.querySelector("[data-explorable-locked='gate-1']")).toBeNull();
    expect(unlocked.container.querySelector("iframe")).toBeInTheDocument();
  });

  it("dispatches a checkpoint part to the interactive checkpoint component", () => {
    const { container } = renderPart([
      {
        kind: "checkpoint",
        checkpoint: {
          id: "cp-9",
          conceptId: "c1",
          kind: "mcq",
          prompt: "Q?",
          options: [
            { id: "a", label: "A" },
            { id: "b", label: "B", correct: true },
          ],
          reveal: "R",
        },
      },
    ]);
    expect(container.querySelector("[data-checkpoint='cp-9']")).toBeInTheDocument();
  });
});
