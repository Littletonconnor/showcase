import { expect, test } from "@playwright/test";

// The core product loop, captured as the parity oracle for the React port:
//   publish a multi-part surface → it renders in the viewer → the user adjudicates
//   it (a review verdict action posts a user-feedback signal the agent reads).
// The inline comment thread was retired: to talk about a surface you copy its
// card id from the header and mention it to your agent in the terminal.
//
// Agent-authored content (markdown parts, html parts) renders inside sandboxed
// opaque-origin iframes, so its text is NOT reachable from the trusted page DOM
// by design. The oracle therefore asserts only on light-DOM signals — the card
// chrome, the per-part iframes, and the trusted-origin verdict actions — which
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

test("every card header shows a click-to-copy card id handle", async ({ page, request }) => {
  // The card id is the surface's handle: with the inline thread gone, the user
  // copies it from the header and mentions it to the agent in the terminal. It's
  // trusted-origin chrome, so its label is a plain light-DOM node we can assert on.
  const { surfaceId } = await seedSurface(request);
  await page.goto(`/?surface=${surfaceId}`);
  const card = page.locator(`.card[data-id="${surfaceId}"]`);
  await expect(card).toBeVisible();

  await expect(card.getByRole("button", { name: `Copy card ID ${surfaceId}` })).toBeVisible();
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

  // It lands server-side as a user comment carrying the approval marker, so the
  // agent reads it as "yes, this is right" (the verdict bar also strikes it).
  await expect
    .poll(async () => {
      const all = await (await request.get(`/api/comments?surface=${surface.id}`)).json();
      return all.comments.some(
        (c: { author: string; text: string }) => c.author === "user" && c.text.includes("Approved"),
      );
    })
    .toBe(true);
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

test("a multi-file diff shows a manifest header and collapses generated files", async ({
  page,
  request,
}) => {
  // Step D: a multi-file diff leads with a manifest (file list + churn) and
  // collapses generated/vendored files (a lockfile) out of the rendered diff
  // until the reviewer asks for them.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "multi" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: "Multi-file",
        parts: [
          {
            kind: "diff",
            patch:
              'diff --git a/auth/token.ts b/auth/token.ts\n--- a/auth/token.ts\n+++ b/auth/token.ts\n@@ -1,3 +1,4 @@\n function v(t) {\n-  return d(t);\n+  if (!t) throw new Error(\'x\');\n+  return d(t);\n }\ndiff --git a/package-lock.json b/package-lock.json\n--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1,3 +1,4 @@\n {\n-  "a": 1\n+  "a": 1,\n+  "b": 2\n }',
          },
        ],
      },
    })
  ).json();
  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  // The manifest header lists both files (trusted origin — assertable text) and
  // flags the lockfile generated.
  await expect(card.getByText("auth/token.ts")).toBeVisible();
  await expect(card.getByText(/package-lock\.json/)).toBeVisible();
  // Only the hot file renders to start (one diff iframe); the lockfile is behind
  // the collapse toggle.
  const toggle = card.getByText(/Show 1 generated file/);
  await expect(toggle).toBeVisible();
  const framesBefore = await card.locator("iframe").count();
  await toggle.click();
  await expect(card.getByText(/Hide 1 generated file/)).toBeVisible();
  const framesAfter = await card.locator("iframe").count();
  expect(framesAfter).toBeGreaterThan(framesBefore);
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
        confidence: "medium",
        coverage: "grepped for other call sites",
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

test("publish_review renders the opinionated overview in a sandboxed review-kit frame", async ({
  page,
  request,
}) => {
  // The overview (intent + risk band + budget + priority manifest) ships as a
  // `review`-kit html part — sandboxed like any agent html. This drives it
  // through the real iframe so the kit CSS + burn-down JS are exercised end to
  // end: the manifest ranks sensitive→logic, the mechanical row hides behind a
  // toggle, and checking a row updates the live reviewed counter.
  const review = await (
    await request.post("/api/reviews", {
      data: {
        branch: "feature/auth",
        verdict: "request_changes",
        intent: "Tighten token validation and add a revocation check.",
        risk: { size: 1, surfaceArea: 1, sensitivity: 3, testDelta: 1, band: "high" },
        budget: "~8 min · 2 files need real eyes · 1 mechanical",
        manifest: [
          {
            file: "pkg-lock.json",
            added: 900,
            removed: 200,
            priority: "mechanical",
            note: "generated",
          },
          {
            file: "auth/token.ts",
            added: 18,
            removed: 4,
            priority: "sensitive",
            note: "token check",
          },
          { file: "api/routes.ts", added: 40, removed: 12, priority: "logic", note: "public API" },
        ],
        findings: [
          {
            severity: "bug",
            title: "Revocation list not consulted on refresh",
            problem: "the refresh path skips the new revocation check",
            confidence: "high",
            coverage: "reproduced with a unit test; did not run against prod tokens",
          },
        ],
      },
    })
  ).json();

  await page.goto(`/?surface=${review.verdict}`);
  const card = page.locator(`.card[data-id="${review.verdict}"]`);
  await expect(card).toBeVisible();

  const overview = card.frameLocator("iframe").first();
  // Intent, risk band, and budget all render.
  await expect(
    overview.getByText("Tighten token validation and add a revocation check."),
  ).toBeVisible();
  await expect(overview.locator(".risk-band.high")).toContainText("Risk: High");
  await expect(overview.getByText("~8 min · 2 files need real eyes · 1 mechanical")).toBeVisible();

  // Hot manifest shows the sensitive + logic rows; the mechanical row is hidden
  // until its bucket is expanded.
  await expect(overview.locator(".manifest-row.sensitive .file")).toHaveText("auth/token.ts");
  await expect(overview.getByText("pkg-lock.json")).toBeHidden();
  await overview.locator(".cold-toggle").click();
  await expect(overview.getByText("pkg-lock.json")).toBeVisible();

  // The reviewed-checkbox burn-down counter is live.
  await expect(overview.locator(".review-progress")).toContainText("0 / 3 reviewed");
  await overview.locator(".manifest-row.sensitive .rev").check();
  await expect(overview.locator(".review-progress")).toContainText("1 / 3 reviewed");
});

test("a reviewer can traverse and resolve a whole review from the keyboard", async ({
  page,
  request,
}) => {
  // Step F: review is a traversal — j/k move through open findings, a/d resolve
  // the one under the cursor, and the verdict bar burns down to a terminal
  // state, all without the mouse.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "keyboard review" } })
  ).json();
  const finding = (label: string, tone: string) =>
    request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: `${label} finding`,
        badge: { tone, label },
        parts: [{ kind: "markdown", markdown: `a ${label.toLowerCase()}` }],
      },
    });
  await finding("Bug", "critical");
  const nit = await (await finding("Nit", "warning")).json();

  await page.goto(`/?surface=${nit.id}`);
  const header = page.locator("#sessionView > div").first();
  await expect(header.getByText("2 open · 0 resolved")).toBeVisible();

  // Focus the page chrome (not a composer) so the review keys are live.
  await page.locator("body").click({ position: { x: 4, y: 4 } });

  // `a` approves the top open finding (worst-severity first → the Bug).
  await page.keyboard.press("a");
  await expect(header.getByText("1 open · 1 resolved")).toBeVisible({ timeout: 10_000 });

  // `d` dismisses the next open finding (the Nit) → the review is complete.
  await page.keyboard.press("d");
  await expect(header.getByText("Review complete")).toBeVisible({ timeout: 10_000 });
});

test("an edge-status changeMap renders as a real mermaid SVG, not a parse error", async ({
  page,
  request,
}) => {
  // Guards a browser-only regression: §8.2 emits `linkStyle` lines for edge
  // status, and mermaid's flowchart grammar rejects a lone `stroke:#color` —
  // so an `existing` edge must carry a stroke-width too. A string assertion
  // can't see this; only rendering the diagram in a real browser does.
  const review = await (
    await request.post("/api/reviews", {
      data: {
        verdict: "comment",
        changeMap: {
          nodes: [
            { id: "a", label: "authMiddleware", status: "touched" },
            { id: "b", label: "validateToken", status: "modified" },
            { id: "c", label: "revocationList", status: "new" },
          ],
          edges: [
            { from: "a", to: "b", label: "calls", status: "existing" },
            { from: "b", to: "c", label: "now checks", status: "new" },
            { from: "a", to: "c", label: "dropped", status: "removed" },
          ],
        },
        findings: [],
      },
    })
  ).json();

  await page.goto(`/?surface=${review.verdict}`);
  const card = page.locator(`.card[data-id="${review.verdict}"]`);
  await expect(card).toBeVisible();

  // The change map is the verdict card's mermaid part. It must produce an SVG
  // with edge paths and show no mermaid parse error.
  const map = card.frameLocator("iframe").last();
  await expect(map.locator("svg .edgePaths path, svg path.flowchart-link").first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(map.getByText(/Parse error|Couldn't render/)).toHaveCount(0);
});

test("a surface landing live on the open session shows the 'Working…' indicator + ticker", async ({
  page,
  request,
}) => {
  // The agent-activity signal: while output lands on the open session, the header
  // shows a pulsing "Working…" pill and a one-line ticker of the latest action,
  // driven by the live surface-created SSE event. After a few seconds of silence
  // the pill decays but the ticker keeps the last action visible.
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "activity" } })
  ).json();
  const first = await (
    await request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: "First surface",
        parts: [{ kind: "markdown", markdown: "hello" }],
      },
    })
  ).json();
  // Open the session; the first surface predates the page's SSE connection, so
  // the board starts quiet — no working indicator.
  await page.goto(`/?surface=${first.id}`);
  await expect(page.locator(`.card[data-id="${first.id}"]`)).toBeVisible();
  const header = page.locator("#sessionView > div").first();
  await expect(header.getByText(/Working/)).toBeHidden();

  // A new surface lands live on the open session → working pill + ticker appear.
  const second = await (
    await request.post("/api/surfaces", {
      data: {
        session: session.id,
        title: "Second surface",
        parts: [{ kind: "markdown", markdown: "more" }],
      },
    })
  ).json();
  expect(second.id).toBeTruthy();

  await expect(header.getByText(/Working/)).toBeVisible({ timeout: 10_000 });
  await expect(header.getByText(/published .*Second surface/)).toBeVisible({ timeout: 10_000 });

  // The pill decays after the silence window; the ticker retains the last action.
  await expect(header.getByText(/Working/)).toBeHidden({ timeout: 15_000 });
  await expect(header.getByText(/published .*Second surface/)).toBeVisible();
});
