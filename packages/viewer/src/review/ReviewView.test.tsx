// The decision-queue contract: brief + verdict chip + burndown, Accept
// drives the count (undo reverses it), readonly hides the verbs, and the
// manifest accounts for every changed file including the high-churn-skip flag.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Review } from "@showcase/core/types";
import { ReviewView } from "./ReviewView.tsx";

const review = (over: Partial<Review> = {}): Review => ({
  sessionId: "sess1",
  brief: "Adds a guard so one client cannot overwhelm the server.",
  verdict: "comment",
  decisions: [
    {
      id: "d-guard",
      call: "block",
      kind: "bug",
      scope: "changed-line",
      assertion: "The guard drops the second request instead of queueing it.",
      impact: "Any client retrying immediately loses data.",
      confidence: "high",
    },
    {
      id: "d-naming",
      call: "ship",
      kind: "refactor",
      scope: "whole-file",
      assertion: "The helper rename is consistent.",
      confidence: "medium",
    },
  ],
  createdAt: "2026-07-05T00:00:00Z",
  updatedAt: "2026-07-05T00:00:00Z",
  ...over,
});

describe("ReviewView", () => {
  it("renders the brief, verdict chip, and burndown", () => {
    const { container } = render(<ReviewView review={review()} sessionId="sess1" />);
    expect(container.textContent).toContain("Adds a guard so one client cannot overwhelm");
    expect(container.textContent).toContain("Comments");
    expect(container.textContent).toContain("0 / 2 accepted");
    expect(container.textContent).toContain("Decision 1 / 2");
    // The honest ledger: plain words, not a confidence scale.
    expect(container.textContent).toContain("Confident");
    expect(container.textContent).toContain("Fairly sure");
  });

  it("Accept burns a decision down; undo restores it", async () => {
    const { container } = render(<ReviewView review={review()} sessionId="sess1" />);
    await userEvent.click(screen.getAllByRole("button", { name: /Accept/ })[0]);
    expect(container.textContent).toContain("1 / 2 accepted");
    expect(container.textContent).toContain("✓ Accepted");

    await userEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(container.textContent).toContain("0 / 2 accepted");
  });

  it("accepting every decision completes the review", async () => {
    const { container } = render(<ReviewView review={review()} sessionId="sess1" />);
    for (const btn of screen.getAllByRole("button", { name: /Accept/ })) {
      await userEvent.click(btn);
    }
    expect(container.textContent).toContain("Review complete · 2 decisions");
  });

  it("readonly renders no verbs and a plain decision count", () => {
    const { container } = render(<ReviewView review={review()} readonly />);
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(container.textContent).toContain("2 decisions");
    expect(container.textContent).not.toContain("accepted");
  });

  it("renders the complete manifest with dispositions and the unexplained-skip flag", () => {
    const { container } = render(
      <ReviewView
        review={review({
          manifest: [
            {
              path: "src/guard.ts",
              disposition: "has-decision",
              added: 40,
              removed: 5,
              decisionId: "d-guard",
            },
            { path: "src/util.ts", disposition: "reviewed-no-comment", added: 3, removed: 1 },
            {
              path: "gen/schema.json",
              disposition: "mechanical-skipped",
              added: 400,
              removed: 380,
            },
          ],
        })}
        sessionId="sess1"
      />,
    );
    expect(container.textContent).toContain("All 3 files changed");
    expect(container.textContent).toContain("1 decision");
    expect(container.textContent).toContain("1 reviewed-clean");
    // 400+380 churn skipped with no note — the trust flag must surface.
    expect(container.textContent).toContain("1 high-churn skip");
    expect(container.textContent).toContain("gen/schema.json");
  });

  it("shows the empty evidence placeholder for a codeless decision", () => {
    const { container } = render(<ReviewView review={review()} sessionId="sess1" />);
    expect(container.textContent).toContain("No code to show");
  });

  it("surfaces brief and evidence warnings as non-blocking nudges", () => {
    const { container } = render(
      <ReviewView
        review={review({
          briefWarning: "The brief reads like code.",
          warnings: ["decision d-guard has no evidence"],
        })}
        readonly
      />,
    );
    expect(container.textContent).toContain("The brief reads like code.");
    expect(container.textContent).toContain("decision d-guard has no evidence");
  });
});
