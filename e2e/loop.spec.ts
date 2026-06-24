import { expect, test } from "@playwright/test";

// The core product loop, captured as the parity oracle for the React port:
//   publish a multi-part surface → it renders in the viewer → a user comment
//   appears live in the thread.
//
// Agent-authored content (markdown parts, html parts, comment text) renders
// inside sandboxed opaque-origin iframes, so its text is NOT reachable from the
// trusted page DOM by design. The oracle therefore asserts only on light-DOM
// signals — the card chrome, the per-part iframes, and the comment row — which
// is exactly the boundary the port must preserve.

async function seedSurface(request: import("@playwright/test").APIRequestContext) {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "oracle session" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Oracle surface",
        session: session.id,
        parts: [
          { kind: "markdown", markdown: "# hello oracle\n\nrendered markdown body" },
          { kind: "html", html: "<p id='sandboxed'>interactive part</p>" },
        ],
      },
    })
  ).json();
  return { sessionId: session.id as string, surfaceId: surface.id as string };
}

test("a published surface renders its parts as sandboxed frames", async ({ page, request }) => {
  const { surfaceId } = await seedSurface(request);
  await page.goto(`/?surface=${surfaceId}`);

  const card = page.locator(`.card[data-id="${surfaceId}"]`);
  await expect(card).toBeVisible();
  await expect(card.locator(".card-title")).toHaveText("Oracle surface");
  // Both parts (markdown + html) render in their own sandboxed iframes — never
  // inline in the trusted viewer origin.
  await expect(card.locator("iframe")).toHaveCount(2);
});

test("a user comment appears live in the surface thread", async ({ page, request }) => {
  const { surfaceId } = await seedSurface(request);
  await page.goto(`/?surface=${surfaceId}`);
  const card = page.locator(`.card[data-id="${surfaceId}"]`);
  await expect(card).toBeVisible();

  // The user types a comment in the viewer (posted as author=user).
  await request.post("/api/comments", {
    data: { surface: surfaceId, text: "why two axes here?", author: "user" },
  });

  // It streams into the card's thread via SSE without a reload: a user comment
  // bubble (`.cmt.user`, its text a plain light-DOM node) appears with the text.
  await expect(card.locator(".thread .cmt.user")).toBeVisible({ timeout: 10_000 });
  await expect(card.locator(".thread .cmt.user")).toContainText("why two axes here?");
});
