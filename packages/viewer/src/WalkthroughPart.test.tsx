// The diagram↔step sync, reverse direction: clicking a node in the shared
// mermaid jumps the walkthrough to that node's step, cycling forward through
// steps that share it. MermaidPart is stubbed — the sandbox iframe plumbing is
// exercised in e2e; this covers the jump wiring.
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WalkthroughPart as WalkthroughPartData } from "@showcase/core/types";

vi.mock("./MermaidPart.tsx", () => ({
  MermaidPart: (props: { clickableNodes?: string[]; onNodeClick?: (node: string) => void }) => (
    <button data-testid="diagram-node" onClick={() => props.onNodeClick?.("B")}>
      {(props.clickableNodes ?? []).join(",")}
    </button>
  ),
}));

const { WalkthroughPart } = await import("./WalkthroughPart.tsx");

const part: WalkthroughPartData = {
  kind: "walkthrough",
  title: "How it flows",
  mermaid: "graph TD; A-->B",
  steps: [
    { title: "first hop", body: "start here", node: "A" },
    { title: "second hop", body: "then here", node: "B" },
    { title: "third hop", body: "same node again", node: "B" },
  ],
};

describe("WalkthroughPart diagram-node jump", () => {
  it("passes the steps' node ids as the clickable set", () => {
    const { getByTestId } = render(<WalkthroughPart surfaceId="s1" part={part} />);
    expect(getByTestId("diagram-node").textContent).toBe("A,B,B");
  });

  it("jumps to the clicked node's step and cycles through repeats", async () => {
    const { container, getByTestId } = render(<WalkthroughPart surfaceId="s1" part={part} />);
    const annotation = () => container.querySelector("[data-wt-annotation]")?.textContent ?? "";
    expect(annotation()).toContain("first hop");

    await userEvent.click(getByTestId("diagram-node"));
    expect(annotation()).toContain("second hop");

    // Same node again: advance to the NEXT step carrying it…
    await userEvent.click(getByTestId("diagram-node"));
    expect(annotation()).toContain("third hop");

    // …and wrap around once the repeats run out.
    await userEvent.click(getByTestId("diagram-node"));
    expect(annotation()).toContain("second hop");
  });
});
