import { expect, test } from "@playwright/test";

// The codebase-explainer oracle: a walkthrough part renders as a native step
// player in the trusted origin — step navigation moves the annotation and the
// highlighted lines, arrow keys work, and the "I'm lost here" affordance posts
// a [confused] telemetry line naming the exact step to the agent's channel.

const WALKTHROUGH_SURFACE = {
  title: "How a comment reaches the agent",
  parts: [
    { kind: "markdown", markdown: "Step through the real path." },
    {
      kind: "walkthrough",
      title: "The comment pipe",
      steps: [
        {
          title: "The route accepts it",
          body: "The composer posts here.",
          file: "packages/server/app.ts",
          code: "line one\nline two\nline three\nline four",
          lineStart: 100,
          highlight: [[101, 102]],
        },
        {
          title: "The cursor lock serializes readers",
          body: "One cursor, one lock.",
          file: "packages/server/app.ts",
          code: "alpha\nbeta\ngamma",
          lineStart: 700,
          highlight: [[702, 702]],
        },
      ],
    },
  ],
};

async function seed(request: import("@playwright/test").APIRequestContext) {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "walkthrough oracle" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: { ...WALKTHROUGH_SURFACE, session: session.id },
    })
  ).json();
  expect(surface.id).toBeTruthy();
  return { sessionId: session.id as string, surfaceId: surface.id as string };
}

test("the step player navigates by button and keyboard, moving the highlight", async ({
  page,
  request,
}) => {
  const { surfaceId } = await seed(request);
  await page.goto(`/?surface=${surfaceId}`);

  const player = page.locator("[data-walkthrough]");
  await expect(player).toBeVisible();
  await expect(player).toHaveAttribute("data-wt-step", "0");
  await expect(player.locator("[data-wt-annotation]")).toContainText("The route accepts it");
  // Step 1's numbering starts at the file's real line, and its ranges are hot.
  await expect(player.locator('[data-line="101"]')).toHaveAttribute("data-highlighted", "true");
  await expect(player.locator('[data-line="103"]')).not.toHaveAttribute("data-highlighted", "true");

  // Next button -> step 2: annotation, numbering, and highlight all move.
  await player.getByRole("button", { name: "Next step" }).click();
  await expect(player).toHaveAttribute("data-wt-step", "1");
  await expect(player.locator("[data-wt-annotation]")).toContainText("cursor lock");
  await expect(player.locator('[data-line="702"]')).toHaveAttribute("data-highlighted", "true");

  // Arrow keys drive it too.
  await player.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(player).toHaveAttribute("data-wt-step", "0");
  await page.keyboard.press("ArrowRight");
  await expect(player).toHaveAttribute("data-wt-step", "1");

  // Clickable step dots jump directly.
  await player.getByRole("button", { name: /Go to step 1/ }).click();
  await expect(player).toHaveAttribute("data-wt-step", "0");
});

test("'I'm lost here' posts a [confused] line naming the exact step", async ({ page, request }) => {
  const { sessionId, surfaceId } = await seed(request);
  await page.goto(`/?surface=${surfaceId}`);
  const player = page.locator("[data-walkthrough]");
  await expect(player).toBeVisible();
  await player.getByRole("button", { name: "Next step" }).click();
  await player.getByRole("button", { name: /lost here/i }).click();

  const wait = await (
    await request.get(`/api/comments?session=${sessionId}&author=user&wait=5`)
  ).json();
  const texts = (wait.comments as { text: string }[]).map((c) => c.text);
  const line = texts.find((t) => t.startsWith("[confused]"));
  expect(line).toBeTruthy();
  expect(line).toContain("The comment pipe step 2: The cursor lock serializes readers");
});
