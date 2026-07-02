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

  await expect(
    card.getByRole("button", { name: `Copy a reference to surface ${surfaceId}` }),
  ).toBeVisible();
});

test("a user comment reaches the agent's long-poll exactly once", async ({ request }) => {
  // The feedback half of the loop: a comment posted on a surface is delivered
  // to the agent's author=user session wait, and a second wait does NOT
  // re-deliver it (the server-side cursor advanced — exactly-once).
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "feedback" } })
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

  await request.post("/api/comments", {
    data: { surface: surface.id, text: "please pick a clearer name" },
  });

  const first = await (
    await request.get(`/api/comments?session=${session.id}&author=user&wait=5`)
  ).json();
  expect(first.comments.map((c: { text: string }) => c.text)).toEqual([
    "please pick a clearer name",
  ]);

  const second = await (
    await request.get(`/api/comments?session=${session.id}&author=user&wait=0`)
  ).json();
  expect(second.comments).toEqual([]);
});

test("a badged card renders its severity badge in the trusted header", async ({
  page,
  request,
}) => {
  // A multimodal card: a badge + prose + a control-flow diagram + a diff, all in
  // one surface. The badge is trusted-origin chrome (not agent markup), so its
  // text is a real light-DOM node we can assert on.
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

test("a decision review renders its brief and burns down on Accept", async ({ page, request }) => {
  // The live-loop guard for the one review form factor: publish a decision-queue
  // review, open it at ?review=<id>, and Accept the lead decision — the burndown
  // reflects it. (The finding-card review was retired; decisions are the path.)
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "decisions" } })
  ).json();
  await request.post(`/api/sessions/${session.id}/review`, {
    data: {
      brief: "Adds a per-request guard so one client can't overwhelm the server.",
      verdict: "block",
      decisions: [
        {
          id: "d-per-process",
          call: "block",
          kind: "bug",
          scope: "whole-file",
          assertion: "The limiter counts per-process.",
          impact: "The real cap is N times the worker count.",
          confidence: "high",
          evidence: [
            { kind: "diff", files: [{ filename: "limit.ts", before: "a\n", after: "b\n" }] },
          ],
        },
        {
          id: "d-clean-429",
          call: "ship",
          kind: "fix",
          scope: "changed-line",
          assertion: "Returns a clean 429.",
          confidence: "high",
        },
      ],
      manifest: [
        {
          path: "limit.ts",
          disposition: "has-decision",
          decisionId: "d-per-process",
          added: 20,
          removed: 2,
        },
        {
          path: "handler.ts",
          disposition: "has-decision",
          decisionId: "d-clean-429",
          added: 5,
          removed: 1,
        },
      ],
    },
  });

  await page.goto(`/?review=${session.id}`);
  // The plain-English brief and the lead decision render.
  await expect(page.getByText(/per-request guard/)).toBeVisible();
  await expect(page.getByText("The limiter counts per-process.")).toBeVisible();
  await expect(page.getByText("0 / 2 accepted")).toBeVisible();

  // Accept the active (lead) decision with the keyboard; the burndown advances.
  await page.keyboard.press("a");
  await expect(page.getByText("1 / 2 accepted")).toBeVisible();
});
