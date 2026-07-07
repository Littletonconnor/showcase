import { expect, test } from "@playwright/test";

// The guided read (plannotator-v0.22 "Guided Review", showcase-shaped):
// importance-ordered chapters render beneath the decision queue with their
// live diffs; Mark read drives the chapter burndown; clicking a line in a
// chapter diff scopes pushback to file:line and posts it as a session comment
// carrying the chapter's ref; uncovered changed files surface in the
// automatic "Everything else" section.

const PATCH = `diff --git a/server/app.ts b/server/app.ts
--- a/server/app.ts
+++ b/server/app.ts
@@ -1,3 +1,4 @@
 const mime = parse(c);
+if (tooLarge(c)) return r413();
 const buf = await read(c);
 store(buf);`;

test("chapters render, burn down, and turn a diff line click into scoped pushback", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "guided review" } })
  ).json();
  const publish = await request.post(`/api/sessions/${session.id}/review`, {
    data: {
      brief:
        "This change refuses oversized uploads before reading them. Nothing changes for users.",
      verdict: "comment",
      decisions: [
        {
          id: "d-guard",
          call: "ship",
          kind: "fix",
          scope: "changed-line",
          assertion: "The guard runs before the read.",
          confidence: "high",
        },
      ],
      manifest: [
        {
          path: "server/app.ts",
          disposition: "has-decision",
          decisionId: "d-guard",
          added: 1,
          removed: 0,
        },
        { path: "server/limits.ts", disposition: "reviewed-no-comment", added: 2, removed: 0 },
      ],
      chapters: [
        {
          id: "ch-heart",
          title: "The heart: reject before you read",
          overview: "One move — the guard runs before the body is buffered.",
          files: [{ path: "server/app.ts", summary: "the guard moves up" }],
          parts: [{ kind: "diff", patch: PATCH }],
        },
      ],
    },
  });
  expect(publish.status()).toBe(201);
  // Coverage warning: limits.ts is unchaptered.
  const stored = await publish.json();
  expect(JSON.stringify(stored.warnings ?? [])).toContain("unchaptered");

  await page.goto(`/?review=${session.id}`);
  const guide = page.getByRole("region", { name: "Guided read" });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText("The heart: reject before you read");
  await expect(guide).toContainText("0 / 1 read");
  // The uncovered changed file is disclosed, never dropped.
  await expect(guide.locator('[data-chapter="everything-else"]')).toContainText("server/limits.ts");

  // Mark read → the chapter burndown completes.
  await guide.getByRole("button", { name: "Mark chapter 1 read" }).click();
  await expect(guide).toContainText("all 1 chapters read");

  // Click the ADDED line in the chapter's live diff → the pushback input opens
  // pre-scoped to file:line; sending posts a "revise ch-heart: …" comment.
  const frame = guide.frameLocator('iframe[title="Diff"]');
  await frame.locator('[data-gutter] [data-line-type="change-addition"]').first().click();
  const input = guide.getByRole("textbox", { name: "Push back on this chapter" });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(/server\/app\.ts:2/);
  await input.fill(`${await input.inputValue()}use the shared cap constant`);
  await input.press("Enter");

  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?session=${session.id}`)).json();
      return (
        all.comments.find((c: { text: string }) => c.text.startsWith("revise ch-heart:"))?.text ??
        null
      );
    })
    .toMatch(/revise ch-heart: server\/app\.ts:2 .*use the shared cap constant/);
});
