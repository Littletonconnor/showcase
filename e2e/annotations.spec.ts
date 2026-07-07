import { expect, test } from "@playwright/test";

// The plannotator-parity annotation layer, driven end to end in a real
// browser: reviewer code suggestions from the diff composer, pin annotations
// on images, and selection-anchored pushback over a review's own prose.

test("suggest edit: the diff composer posts a before→after that renders in the thread", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "suggestions" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Suggestion oracle",
        session: session.id,
        parts: [
          {
            kind: "diff",
            files: [
              {
                filename: "app.ts",
                before: "const a = 1;\nconst b = 2;\n",
                after: "const a = 1;\nconst b = 9;\n",
              },
            ],
          },
        ],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);

  // Gutter click → composer → toggle Suggest edit → change the replacement.
  await card
    .frameLocator('iframe[title="Diff"]')
    .locator('[data-gutter] [data-line-type="change-addition"]')
    .first()
    .click();
  const popover = page.locator("[data-comment-popover]");
  await expect(popover).toBeVisible();
  await popover.locator("[data-suggest-toggle]").click();
  const after = popover.locator("[data-suggest-after]");
  await expect(after).toHaveValue("const b = 9;");
  await after.fill("const b = MAX_B;");
  await popover.getByPlaceholder("Why this edit? (optional)").fill("name the constant");
  await popover.getByRole("button", { name: "Suggest", exact: true }).click();
  await expect(popover).toHaveCount(0);

  // The comment carries the suggestion…
  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
      const hit = all.comments.find((c: { suggestion?: unknown }) => c.suggestion);
      return hit?.suggestion ?? null;
    })
    .toEqual({ before: "const b = 9;", after: "const b = MAX_B;" });

  // …and the thread renders it as −/+ rows.
  const rows = card.locator("[data-thread-suggestion]");
  await expect(rows).toBeVisible();
  await expect(rows).toContainText("const b = MAX_B;");
});

test("image pins: a click on the image opens the composer and the pin renders at the spot", async ({
  page,
  request,
}) => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"></svg>';
  const asset = await (
    await request.post("/api/assets", {
      data: { data: Buffer.from(svg).toString("base64"), contentType: "image/svg+xml" },
    })
  ).json();
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "pins" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Pin oracle",
        session: session.id,
        parts: [{ kind: "image", assetId: asset.id, alt: "mock" }],
      },
    })
  ).json();

  await page.goto(`/?surface=${surface.id}`);
  const img = page.locator(`.card[data-id="${surface.id}"] [data-image-part]`);
  await expect(img).toBeVisible();
  await img.click({ position: { x: 150, y: 25 } });

  const popover = page.locator("[data-comment-popover]");
  await expect(popover).toBeVisible();
  // ~75%, 25% — the image border shaves a fraction of a percent off the click.
  await expect(popover).toContainText(/at 7[45](\.\d)?%, 2[45](\.\d)?%/);
  await popover.getByRole("textbox").fill("what is this region?");
  await popover.getByRole("textbox").press("Enter");

  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
      const hit = all.comments.find(
        (c: { anchor?: { pos?: { x: number; y: number } } }) => c.anchor?.pos,
      );
      if (!hit?.anchor?.pos) return null;
      const { x, y } = hit.anchor.pos;
      return Math.abs(x - 75) < 1.5 && Math.abs(y - 25) < 1.5 ? "on target" : `${x},${y}`;
    })
    .toBe("on target");

  const pin = page.locator("[data-image-pin]");
  await expect(pin).toBeVisible();
  await expect(pin).toHaveText("1");
});

test("review prose: selecting brief text offers pushback scoped to the review", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "prose pushback" } })
  ).json();
  await request.post(`/api/sessions/${session.id}/review`, {
    data: {
      brief: "This change makes uploads safer for everyone involved.",
      verdict: "comment",
      decisions: [
        {
          id: "d-1",
          call: "ship",
          kind: "fix",
          scope: "changed-line",
          assertion: "The guard holds.",
          confidence: "high",
        },
      ],
      manifest: [
        { path: "app.ts", disposition: "has-decision", decisionId: "d-1", added: 1, removed: 0 },
      ],
    },
  });

  await page.goto(`/?review=${session.id}`);
  const brief = page.locator("[data-review-brief]");
  await expect(brief).toBeVisible();
  // Double-click selects a word → the floating chip appears.
  await brief.dblclick();
  const chip = page.getByRole("button", { name: "Push back on this" });
  await expect(chip).toBeVisible();
  await chip.click();

  const box = page.locator("[data-prose-pushback]");
  await expect(box).toContainText("the brief");
  await box.getByRole("textbox").fill("say who is affected");
  await box.getByRole("textbox").press("Enter");

  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?session=${session.id}`)).json();
      return (
        all.comments.find((c: { text: string }) => c.text.startsWith("revise the brief:"))?.text ??
        null
      );
    })
    .toMatch(/revise the brief: ".+" — say who is affected/);
});
