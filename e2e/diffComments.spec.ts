import { expect, test } from "@playwright/test";

// The plannotator-grade inline diff review loop: click a line's gutter INSIDE
// the sandboxed @pierre/diffs render → the trusted comment popover opens
// anchored to file:line with the line quoted → the comment lands author=user
// with the anchor → the thread renders under the part. Drives the sandbox
// bridge (composedPath through the declarative shadow roots), not a stub.

test("a diff gutter click opens the composer and posts a file:line-anchored comment", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "diff comments" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Diff comment oracle",
        session: session.id,
        parts: [
          {
            kind: "diff",
            files: [
              {
                filename: "server/app.ts",
                before: "const a = 1;\nconst b = 2;\nconst c = 3;\n",
                after: "const a = 1;\nconst b = 9;\nconst c = 3;\n",
              },
            ],
          },
        ],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  // Click the ADDED line's gutter cell inside the sandboxed diff (Playwright's
  // css engine pierces the open shadow roots).
  const frame = card.frameLocator('iframe[title="Diff"]');
  const gutterCell = frame.locator('[data-gutter] [data-line-type="change-addition"]').first();
  await expect(gutterCell).toBeVisible();
  await gutterCell.click();

  // The trusted popover opens, anchored and quoting the clicked line.
  const popover = page.locator("[data-comment-popover]");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("server/app.ts line 2");
  await expect(popover).toContainText("const b = 9;");
  await popover.getByRole("textbox").fill("why 9 and not a constant?");
  await popover.getByRole("textbox").press("Enter");
  await expect(popover).toHaveCount(0);

  // The comment landed author=user with the full anchor.
  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
      const hit = all.comments.find(
        (c: {
          author: string;
          text: string;
          anchor?: { line?: number; file?: string; quote?: string };
        }) => c.author === "user" && c.text === "why 9 and not a constant?",
      );
      if (!hit?.anchor) return null;
      return `${hit.anchor.file}:${hit.anchor.line}:${hit.anchor.quote}`;
    })
    .toBe("server/app.ts:2:const b = 9;");

  // ...and the thread renders in place under the diff part.
  const thread = card.locator("[data-thread]");
  await expect(thread).toBeVisible();
  await expect(thread).toContainText("why 9 and not a constant?");
});
