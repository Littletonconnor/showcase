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
  // Approve / Dismiss are review-verdict actions: they render only on a finding
  // card (one carrying a severity badge), where they resolve the finding. Seed
  // such a card so the quick-action is present.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "approve" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "Nit: rename for clarity",
        session: session.id,
        badge: { tone: "warning", label: "Nit" },
        parts: [{ kind: "markdown", markdown: "consider a clearer name here" }],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  // One tap on the card's Approve action posts a recognizable author=user signal.
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card.locator(".thread .cmt.user")).toContainText("Approved");
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

test("reading mode focuses one surface with prev/next paging", async ({ page, request }) => {
  // W2 L3: a distraction-free reader showing one surface at a time, paging
  // through the stream.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "read" } })
  ).json();
  const mk = (t: string) =>
    request.post("/api/surfaces", {
      data: { session: session.id, title: t, parts: [{ kind: "markdown", markdown: t }] },
    });
  await mk("First explainer");
  const second = await (await mk("Second explainer")).json();
  await page.goto(`/?surface=${second.id}`);

  const card = page.locator(`.card[data-id="${second.id}"]`);
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Read — focused, one at a time" }).click();

  const reader = page.getByRole("dialog", { name: "Reader" });
  await expect(reader).toBeVisible();
  await expect(reader.getByText("2 / 2")).toBeVisible();
  // Page back to the first; Escape closes.
  await reader.getByRole("button", { name: "Previous" }).click();
  await expect(reader.getByText("1 / 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(reader).toBeHidden();
});

test("the animate kit plays a stepped explainer", async ({ page, request }) => {
  // W2 L1: an html part with kits:["animate"] reveals steps one at a time and
  // gets play/scrub controls injected — the explainer building block.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "explainer" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: "Explainer",
        parts: [
          {
            kind: "html",
            kits: ["animate"],
            html: '<div class="anim"><div class="step" id="s0"><p>one</p></div><div class="step" id="s1"><p>two</p></div><div class="step" id="s2"><p>three</p></div></div>',
          },
        ],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  const frame = card.frameLocator("iframe").first();
  // The kit injected its controls, and only the first step shows.
  await expect(frame.locator(".anim-play")).toBeVisible();
  await expect(frame.locator(".anim-range")).toBeVisible();
  await expect(frame.locator("#s0")).toBeVisible();
  await expect(frame.locator("#s2")).toBeHidden();

  // Press play — it builds up to the last step.
  await frame.locator(".anim-play").click();
  await expect(frame.locator("#s2")).toBeVisible({ timeout: 10_000 });
});

test("clicking a diff line opens a line-anchored comment", async ({ page, request }) => {
  // R4: a click on a diff line (inside the sandboxed iframe + its shadow root)
  // rides the bridge out to the trusted card, which opens a line composer; the
  // comment carries the exact line so the agent knows what to fix.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "line review" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: "Diff",
        parts: [
          {
            kind: "diff",
            patch:
              "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1,8 +1,9 @@\n line one\n line two\n line three\n-old four\n+new four a\n+new four b\n line six\n line seven\n line eight",
          },
        ],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  // Dispatch a real composed click on an actual diff line inside the iframe's
  // shadow root — this exercises the production bridge (the in-frame listener
  // resolves the line via composedPath), without guessing a pixel.
  const iframe = card.locator("iframe").first();
  await expect(iframe).toBeVisible();
  const frame = await (await iframe.elementHandle())!.contentFrame();
  const col = await frame!.evaluate(async () => {
    for (let i = 0; i < 40; i++) {
      for (const c of document.querySelectorAll("diffs-container")) {
        const row = c.shadowRoot?.querySelector("[data-line-type][data-column-number]");
        if (row) {
          row.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
          return row.getAttribute("data-column-number");
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return null;
  });
  expect(Number(col), "found a diff line to click").toBeGreaterThan(0);

  // The trusted card opens a line composer; type a note and send.
  await expect(card.getByText(/Comment on line/)).toBeVisible({ timeout: 10_000 });
  const note = card.getByRole("textbox", { name: "Line comment" });
  await note.fill("off-by-one here");
  await note.press("Enter");

  await expect(card.locator(".thread .cmt.user")).toContainText("off-by-one here");
  // The comment carries a diff line server-side (so it reaches the agent).
  const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
  const c = all.comments.find((x: { text: string }) => x.text.includes("off-by-one"));
  expect(c?.anchor?.line, "the comment carries the diff line").toBeGreaterThan(0);
});

test("a finding's before/after suggestion renders real changed lines, not an empty diff", async ({
  page,
  request,
}) => {
  // Guards the reported "−0 +0" bug: a finding's fix as a {before, after} pair
  // must render an actual deletion + addition (the viewer computes the diff from
  // the two contents), so the suggested change is always visible.
  const finding = await (
    await request.post("/api/findings", {
      data: {
        title: "Use the shared constant",
        problem: "magic number",
        file: "config.ts",
        suggestion: { before: "const timeout = 5000;", after: "const timeout = DEFAULT_MS;" },
        fix: "names the intent and avoids drift",
        sessionTitle: "suggestion render",
      },
    })
  ).json();
  await page.goto(`/?surface=${finding.id}`);
  const card = page.locator(`.card[data-id="${finding.id}"]`);
  await expect(card).toBeVisible();

  // The card is markdown(problem) → diff(suggestion) → markdown(why), each its
  // own sandbox iframe. Scan every frame's shadow roots for the diff's line
  // rows: a deletion AND an addition prove the change rendered (not "−0 +0").
  const seenAdditionAndDeletion = async () => {
    for (const f of page.frames()) {
      const ok = await f
        .evaluate(() => {
          const types: string[] = [];
          for (const c of document.querySelectorAll("diffs-container")) {
            for (const row of c.shadowRoot?.querySelectorAll("[data-line-type]") ?? []) {
              types.push(row.getAttribute("data-line-type") ?? "");
            }
          }
          // The bridge matches by substring (e.g. "addition"), so do the same.
          return (
            types.some((t) => t.includes("addition")) && types.some((t) => t.includes("deletion"))
          );
        })
        .catch(() => false);
      if (ok) return true;
    }
    return false;
  };
  await expect
    .poll(seenAdditionAndDeletion, {
      message: "the suggestion diff shows a deletion and an addition",
    })
    .toBe(true);
});

test("a review session rolls its finding badges into a header summary", async ({
  page,
  request,
}) => {
  // The session-header verdict bar derives live from the finding cards' badges,
  // so a review reads as one artifact. Each chip jumps to that finding.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "review rollup" } })
  ).json();
  const finding = async (label: string, tone: string) =>
    request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: `${label} finding`,
        badge: { tone, label },
        parts: [{ kind: "markdown", markdown: `a ${label}` }],
      },
    });
  await finding("Bug", "critical");
  await finding("Nit", "warning");
  const second = await (await finding("Bug", "critical")).json();

  await page.goto(`/?surface=${second.id}`);
  const header = page.locator("#sessionView > div").first();
  // Worst-severity first: "2 Bug" then "1 Nit", as trusted-origin button chips.
  await expect(header.getByRole("button", { name: "2 Bug" })).toBeVisible();
  await expect(header.getByRole("button", { name: "1 Nit" })).toBeVisible();
});

test("approving a finding strikes it through in the header verdict bar", async ({
  page,
  request,
}) => {
  // The verdict bar burns down: a finding the user Approves resolves and its
  // chip strikes through, so you watch the review close out.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "burndown" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: "Bug finding",
        badge: { tone: "critical", label: "Bug" },
        parts: [{ kind: "markdown", markdown: "a bug" }],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);

  const header = page.locator("#sessionView > div").first();
  const chip = header.getByRole("button", { name: "1 Bug" });
  await expect(chip).toBeVisible();
  await expect(chip).not.toHaveAttribute("title", "Bug — resolved");
  // The cockpit shows the open tally and the pager while findings are open.
  await expect(header.getByText("1 open · 0 resolved")).toBeVisible();
  await expect(header.getByRole("button", { name: /Next open finding/ })).toBeVisible();

  // Approve the finding from its card footer.
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await card.getByRole("button", { name: "Approve" }).click();

  // The chip flips to resolved (title changes; line-through is applied)…
  await expect(chip).toHaveAttribute("title", "Bug — resolved", { timeout: 10_000 });
  // …and with no findings left open, the review reaches its terminal state.
  await expect(header.getByText("Review complete")).toBeVisible({ timeout: 10_000 });
});
