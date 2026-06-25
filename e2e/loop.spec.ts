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

test("a markdown part renders LaTeX math as MathML, not KaTeX errors", async ({
  page,
  request,
}) => {
  // Guards the KaTeX integration, which is browser-bundle-sensitive: the plugin's
  // internally-bundled katex mis-tokenizes control sequences under Vite's interop
  // (\lambda → \l + ambda, rendered as a red error node), so only a real-browser
  // check catches a regression. Inline + display math should each emit one <math>.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "math session" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Math surface",
        session: session.id,
        parts: [
          {
            kind: "markdown",
            markdown: "Euler: $e^{i\\pi} + 1 = 0$\n\n$$W = \\frac{1}{\\mu - \\lambda}$$",
          },
        ],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  // The markdown renders inside its sandboxed iframe; reach in to confirm the
  // math became browser-native MathML and KaTeX hit no parse errors (a failure
  // would emit a red mathcolor="#cc0000" node).
  const frame = card.frameLocator("iframe").first();
  await expect(frame.locator("math")).toHaveCount(2);
  await expect(frame.locator("[mathcolor='#cc0000']")).toHaveCount(0);
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

test("the Approve quick-action posts a user feedback signal", async ({ page, request }) => {
  const { surfaceId } = await seedSurface(request);
  await page.goto(`/?surface=${surfaceId}`);
  const card = page.locator(`.card[data-id="${surfaceId}"]`);
  await expect(card).toBeVisible();

  // One tap on the card's Approve action posts a recognizable author=user signal.
  await card.getByRole("button", { name: "Approve — looks good" }).click();
  await expect(card.locator(".thread .cmt.user")).toContainText("Approved");
});

test("an annotation pins a note to a spot and stores the anchor", async ({ page, request }) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "annotate" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "annotate",
        session: session.id,
        parts: [{ kind: "markdown", markdown: "# A\n\nline one\n\nline two\n\nline three" }],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  // Arm annotate mode, click a spot, type a note.
  await card.getByRole("button", { name: "Pin a note to a spot" }).click();
  await card.locator(".cursor-crosshair").click({ position: { x: 200, y: 60 } });
  const note = card.getByRole("textbox", { name: "Annotation note" });
  await note.fill("anchor here");
  await note.press("Enter");

  // The note posts as a user comment and a pin renders at the spot.
  await expect(card.locator(".thread .cmt.user")).toContainText("anchor here");
  await expect(card.locator('span[title="anchor here"]')).toBeVisible();

  // The comment carries the anchor server-side (so it reaches the agent).
  const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
  const anchored = all.comments.find((c: { text: string }) => c.text.includes("anchor here"));
  expect(anchored?.anchor?.xPct, "the comment carries the anchor").toBeGreaterThanOrEqual(0);
});

test("a review finding card renders its severity badge in the trusted header", async ({
  page,
  request,
}) => {
  // The flagship PR-review composition: a badge + prose + a control-flow diagram
  // + the fix diff, all in one surface. The badge is trusted-origin chrome (not
  // agent markup), so its text is a real light-DOM node we can assert on.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "review" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Bug: unbounded asset upload",
        session: session.id,
        badge: { tone: "critical", label: "Bug" },
        parts: [
          { kind: "markdown", markdown: "buffers the whole body before the size check" },
          { kind: "mermaid", mermaid: "flowchart LR\n  A-->B{>5MB?}\n  B--no-->C[store]" },
          { kind: "diff", patch: "@@ -1 +1 @@\n-a\n+b" },
        ],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);

  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();
  // The severity chip leads the header, with its label as a plain light-DOM node.
  await expect(card.getByText("Bug", { exact: true })).toBeVisible();
  // All three parts render in their own sandboxed iframes.
  await expect(card.locator("iframe")).toHaveCount(3);
});

test("pinning a surface collects it in the Library across sessions", async ({ page, request }) => {
  const { surfaceId } = await seedSurface(request);
  await page.goto(`/?surface=${surfaceId}`);
  const card = page.locator(`.card[data-id="${surfaceId}"]`);
  await expect(card).toBeVisible();

  // Pin it from the card footer.
  await card.getByRole("button", { name: "Pin to your Library" }).click();
  // The action flips to the unpin label once it's pinned.
  await expect(card.getByRole("button", { name: "Remove from Library" })).toBeVisible();

  // Open the Library from the sidebar; the pinned surface is there.
  await page.getByRole("button", { name: "Library" }).first().click();
  const libCard = page.locator(`.card[data-id="${surfaceId}"]`);
  await expect(libCard).toBeVisible({ timeout: 10_000 });
  await expect(libCard.locator(".card-title")).toHaveText("Oracle surface");

  // Unpinning from within the Library drops it out of the collection.
  await libCard.getByRole("button", { name: "Remove from Library" }).click();
  await expect(libCard).toHaveCount(0, { timeout: 10_000 });
});
