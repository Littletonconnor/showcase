import { expect, test } from "@playwright/test";

// The reviewer's half of the blocking plan-review loop: a surface carrying
// the "Plan review" badge grows the footer verdict verbs, and each posts the
// author=user signal comment the parked plan-hook is long-polling for.

test("the Plan review badge unlocks footer verdicts that post the signals", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "plan-review", title: "Plan review" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Plan: add caching",
        session: session.id,
        parts: [{ kind: "markdown", markdown: "# Add caching\n\nStep 1: cache reads." }],
        badge: { tone: "info", label: "Plan review" },
      },
    })
  ).json();
  // A normal surface for the negative case.
  const plain = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Not a plan",
        session: session.id,
        parts: [{ kind: "markdown", markdown: "just notes" }],
      },
    })
  ).json();

  await page.goto(`/session/${session.id}`);
  const planCard = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(planCard).toBeVisible();
  await expect(planCard.locator("[data-plan-verbs]")).toBeVisible();
  await expect(planCard).toContainText("Annotate the plan, then submit a verdict");
  // Only badged plan surfaces get the verbs.
  await expect(page.locator(`.card[data-id="${plain.id}"] [data-plan-verbs]`)).toHaveCount(0);

  await planCard.getByRole("button", { name: "Approve plan" }).click();
  await expect(planCard.locator('[data-plan-verdict="approve"]')).toBeVisible();

  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
      return all.comments.some(
        (c: { author: string; text: string }) => c.author === "user" && c.text === "[plan] approve",
      );
    })
    .toBe(true);
});
