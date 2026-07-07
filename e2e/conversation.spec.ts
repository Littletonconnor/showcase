import { expect, test } from "@playwright/test";

// The live back-and-forth layer: pin-anywhere over a sandboxed design mockup
// (with the bridge's locate round-trip enriching the pin), and the
// conversation rail — send, receive, and delivery receipts on the session pipe.

test("pin-anywhere: a pin on an html mockup carries position + what sits under it", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "design review" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Pricing mockup",
        session: session.id,
        parts: [
          {
            kind: "html",
            html: '<div data-section="hero" style="padding:40px;text-align:center"><h1>Start free trial</h1><p>No credit card needed.</p></div>',
          },
        ],
      },
    })
  ).json();

  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();
  // Let the iframe report its real height before pinning.
  await page.waitForTimeout(800);

  await card.getByRole("button", { name: "Pin a note anywhere" }).click();
  const overlay = card.locator("[data-pin-overlay]");
  await expect(overlay).toBeVisible();
  await overlay.click({ position: { x: 200, y: 40 } });

  const popover = page.locator("[data-comment-popover]");
  await expect(popover).toBeVisible();
  // The locate round-trip names the section under the pin.
  await expect(popover).toContainText("§hero");
  await popover.getByRole("textbox").fill("make this headline bolder");
  await popover.getByRole("textbox").press("Enter");

  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
      const hit = all.comments.find(
        (c: { anchor?: { pos?: object; quote?: string } }) => c.anchor?.pos,
      );
      return hit ? `${hit.anchor.quote ?? ""}` : null;
    })
    .toMatch(/§hero/);

  // The pin dot renders over the mockup.
  await expect(card.locator("[data-part-pin]")).toBeVisible();
});

test("conversation rail: send, receive, and the receipt flips when the agent reads", async ({
  page,
  request,
}) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "chatty" } })
  ).json();
  await request.post("/api/surfaces", {
    data: {
      title: "Something to talk about",
      session: session.id,
      parts: [{ kind: "markdown", markdown: "# hello" }],
    },
  });

  await page.goto(`/session/${session.id}`);
  await page.getByRole("button", { name: /Chat/ }).click();
  const rail = page.locator("[data-conversation-rail]");
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("agent idle");

  // Send a message → it lands on the session pipe author=user, receipt "sent".
  await rail.getByRole("textbox", { name: "Message the agent" }).fill("can you tighten the copy?");
  await rail.getByRole("textbox", { name: "Message the agent" }).press("Enter");
  const sentMsg = rail.locator("[data-conversation-message]", {
    hasText: "can you tighten the copy?",
  });
  await expect(sentMsg).toBeVisible();
  await expect(sentMsg.locator('[data-delivery="sent"]')).toBeVisible();

  // The agent answers (any agent-authored session comment) → renders live —
  // and an agent write piggybacks pending feedback, advancing the cursor, so
  // the receipt flips to "seen" from the reply alone: answering IS reading.
  await request.post("/api/comments", {
    data: { session: session.id, text: "tightened — take a look", author: "claude-code" },
  });
  await expect(rail).toContainText("tightened — take a look");
  await expect(sentMsg.locator('[data-delivery="seen"]')).toBeVisible();
});
