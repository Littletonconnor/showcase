// Anchored-thread rendering: root + replies in place, the delivery receipt
// driven by the session's agentSeq cursor, and resolved threads collapsing to
// one quiet row that re-expands on click.
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { Comment } from "./api.ts";
import { useBoard } from "./state.ts";
import type { Thread } from "./threads.ts";
import { ThreadStrip } from "./ThreadStrip.tsx";

const comment = (over: Partial<Comment>): Comment => ({
  id: "c1",
  seq: 1,
  sessionId: "sess1",
  surfaceId: "s1",
  surfaceTitle: null,
  author: "user",
  text: "is this right?",
  createdAt: "2026-07-05T00:00:00Z",
  anchor: { partIndex: 0, quote: "the quoted bit" },
  ...over,
});

const threadOf = (root: Partial<Comment>, replies: Partial<Comment>[] = []): Thread => ({
  root: comment(root),
  replies: replies.map((r, i) => comment({ id: `r${i}`, seq: 10 + i, replyTo: "c1", ...r })),
});

beforeEach(() => {
  useBoard.setState({ sessions: [] });
});

describe("ThreadStrip", () => {
  it("renders nothing for an empty strip", () => {
    const { container } = render(<ThreadStrip threads={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the root with its quote and the agent reply in the thread", () => {
    const { container } = render(
      <ThreadStrip threads={[threadOf({}, [{ author: "claude-code", text: "yes — fixed" }])]} />,
    );
    expect(container.textContent).toContain("the quoted bit");
    expect(container.textContent).toContain("is this right?");
    expect(container.textContent).toContain("yes — fixed");
    // author labels: the user renders as "you", the agent by name
    expect(container.textContent).toContain("you");
    expect(container.textContent).toContain("claude-code");
    expect(container.querySelectorAll("[data-thread-message]")).toHaveLength(2);
  });

  it("shows sent vs seen from the session's agentSeq cursor", () => {
    useBoard.setState({
      sessions: [{ id: "sess1", agentSeq: 5 }] as unknown as ReturnType<
        typeof useBoard.getState
      >["sessions"],
    });
    const strip = render(
      <ThreadStrip threads={[threadOf({ seq: 3 }), threadOf({ id: "c2", seq: 9 })]} />,
    );
    const states = [...strip.container.querySelectorAll("[data-delivery]")].map((el) =>
      el.getAttribute("data-delivery"),
    );
    expect(states).toEqual(["seen", "sent"]);
  });

  it("collapses a resolved thread to one row and expands it on click", async () => {
    const { container } = render(<ThreadStrip threads={[threadOf({ resolved: true })]} />);
    const row = container.querySelector("[data-thread-resolved]")!;
    expect(row).toBeInTheDocument();
    expect(row.textContent).toContain("resolved");
    expect(container.querySelector("[data-thread]")).toBeNull();

    await userEvent.click(row);
    expect(container.querySelector("[data-thread]")).toBeInTheDocument();
  });

  it("offers resolve only once a reply exists", () => {
    const fresh = render(<ThreadStrip threads={[threadOf({})]} />);
    expect(fresh.container.querySelector("[aria-label='Resolve thread']")).toBeNull();
    fresh.unmount();

    const conversed = render(
      <ThreadStrip threads={[threadOf({}, [{ author: "agent", text: "done" }])]} />,
    );
    expect(conversed.container.querySelector("[aria-label='Resolve thread']")).toBeInTheDocument();
  });

  it("renders a reviewer suggestion as −/+ rows and pins in the anchor label", () => {
    const { container } = render(
      <ThreadStrip
        threads={[
          threadOf({
            text: "(suggested edit)",
            anchor: { partIndex: 0, quote: "const a = 2;", pos: { x: 12.5, y: 40 } },
            suggestion: { before: "const a = 2;", after: "const A = 2;" },
          }),
        ]}
      />,
    );
    const rows = container.querySelector("[data-thread-suggestion]");
    expect(rows?.textContent).toContain("−");
    expect(rows?.textContent).toContain("const a = 2;");
    expect(rows?.textContent).toContain("+");
    expect(rows?.textContent).toContain("const A = 2;");
    expect(container.textContent).toContain("at 12.5%, 40%");
  });
});
