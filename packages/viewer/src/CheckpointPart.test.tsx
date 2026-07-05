// The reveal-gating contract, unit-level: the resolution is structurally
// absent until an attempt, client grading colors the options, skips never
// reveal, and a server-hydrated attempt (telemetry line -> hydrateAttempts)
// restores the same post-attempt rendering a live click produces.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { Checkpoint } from "@showcase/core/types";
import { CheckpointPart, ExplorableLock } from "./CheckpointPart.tsx";
import { hydrateAttempts, useLearn } from "./learn.ts";

const mcq = (over: Partial<Checkpoint> = {}): Checkpoint => ({
  id: "cp-1",
  conceptId: "c1",
  kind: "mcq",
  prompt: "Which answer is right?",
  options: [
    { id: "a", label: "The wrong one", misconception: "the wrong model" },
    { id: "b", label: "The right one", correct: true },
  ],
  reveal: "SECRET-REVEAL-TEXT",
  ...over,
});

beforeEach(() => {
  useLearn.setState({ attempts: {} });
});

describe("CheckpointPart", () => {
  it("keeps the reveal structurally absent until an attempt", () => {
    const { container } = render(<CheckpointPart surfaceId="s1" checkpoint={mcq()} />);
    expect(container.querySelector("[data-reveal]")).toBeNull();
    expect(container.textContent).not.toContain("SECRET-REVEAL-TEXT");
    expect(container.querySelector("[data-checkpoint='cp-1']")).toHaveAttribute(
      "data-attempted",
      "false",
    );
  });

  it("grades a wrong mcq click: reveal, misconception, 'not quite'", async () => {
    const { container } = render(<CheckpointPart surfaceId="s1" checkpoint={mcq()} />);
    await userEvent.click(screen.getByRole("button", { name: "The wrong one" }));
    expect(container.querySelector("[data-reveal]")).toHaveTextContent("SECRET-REVEAL-TEXT");
    expect(container.textContent).toContain("The wrong model behind this pick: the wrong model");
    expect(container.textContent).toContain("not quite");
    expect(useLearn.getState().attempts["cp-1"]).toMatchObject({ answer: ["a"], correct: false });
  });

  it("grades a correct mcq click and records the attempt", async () => {
    const { container } = render(<CheckpointPart surfaceId="s1" checkpoint={mcq()} />);
    await userEvent.click(screen.getByRole("button", { name: "The right one" }));
    expect(container.textContent).toContain("correct");
    expect(useLearn.getState().attempts["cp-1"]).toMatchObject({ answer: ["b"], correct: true });
  });

  it("skip records an attempt but never shows the reveal", async () => {
    const { container } = render(<CheckpointPart surfaceId="s1" checkpoint={mcq()} />);
    await userEvent.click(screen.getByRole("button", { name: /^skip/ }));
    expect(container.textContent).toContain("skipped");
    expect(container.querySelector("[data-reveal]")).toBeNull();
    expect(container.textContent).not.toContain("SECRET-REVEAL-TEXT");
  });

  it("free-text explain commits ungraded and shows the agent-graded note", async () => {
    const cp = mcq({ kind: "explain", options: undefined, id: "cp-x" });
    const { container } = render(<CheckpointPart surfaceId="s1" checkpoint={cp} />);
    const commit = screen.getByRole("button", { name: "Commit answer" });
    expect(commit).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox"), "my own words");
    await userEvent.click(commit);
    expect(container.textContent).toContain("answered");
    expect(container.querySelector("[data-reveal]")).toHaveTextContent("SECRET-REVEAL-TEXT");
    expect(useLearn.getState().attempts["cp-x"]).toMatchObject({ answer: "my own words" });
    expect(useLearn.getState().attempts["cp-x"].correct).toBeUndefined();
  });

  it("renders a server-hydrated attempt like a live one (chosen option highlighted)", () => {
    // The exact line the server writes for a wrong "a" pick on this checkpoint.
    hydrateAttempts([
      {
        id: "cm1",
        seq: 1,
        sessionId: "sess",
        surfaceId: "s1",
        surfaceTitle: null,
        author: "user",
        text: '[checkpoint] cp-1 (mcq, concept c1): INCORRECT answer="a" misconception="the wrong model" latency=1.2s',
        createdAt: "2026-07-05T00:00:00Z",
      },
    ]);
    const { container } = render(<CheckpointPart surfaceId="s1" checkpoint={mcq()} />);
    expect(container.querySelector("[data-checkpoint='cp-1']")).toHaveAttribute(
      "data-attempted",
      "true",
    );
    expect(container.querySelector("[data-reveal]")).toHaveTextContent("SECRET-REVEAL-TEXT");
    // The hydrated string answer still maps back to the chosen option.
    expect(container.textContent).toContain("The wrong model behind this pick: the wrong model");
  });

  it("an in-memory attempt is not clobbered by hydration", () => {
    useLearn.setState({ attempts: { "cp-1": { answer: ["b"], correct: true } } });
    hydrateAttempts([
      {
        id: "cm1",
        seq: 1,
        sessionId: "sess",
        surfaceId: "s1",
        surfaceTitle: null,
        author: "user",
        text: '[checkpoint] cp-1 (mcq, concept c1): INCORRECT answer="a" latency=1.2s',
        createdAt: "2026-07-05T00:00:00Z",
      },
    ]);
    expect(useLearn.getState().attempts["cp-1"]).toMatchObject({ answer: ["b"], correct: true });
  });
});

describe("ExplorableLock", () => {
  it("names its gate so the e2e hook and unlock logic can find it", () => {
    const { container } = render(<ExplorableLock gateId="g1" />);
    expect(container.querySelector("[data-explorable-locked='g1']")).toBeInTheDocument();
  });
});
