import { expect, test } from "@playwright/test";

// Per-part-kind render smoke: seed a surface with one of every renderable part
// kind and assert each actually renders at a real size — no empty collapse.
//
// This is the guard the mermaid-empty bug needed. The sandboxed parts (mermaid,
// markdown, code, diff, terminal) each render in an opaque-origin iframe; a part
// whose iframe stays collapsed at ~28px (the empty strip) fails the height check
// here. Runs on bundled Chromium by default; the opt-in `chrome` project
// (`npm run test:e2e:chrome`) runs this same spec on the real Chrome, which is
// where browser-specific layout bugs actually surface — bundled Chromium laid
// the mermaid out fine and hid it.

test("every part kind renders at a real size (no empty collapse)", async ({ page, request }) => {
  const session = await (
    await request.post("/api/sessions", { data: { agent: "e2e", title: "render smoke" } })
  ).json();
  const surface = await (
    await request.post("/api/surfaces", {
      data: {
        title: "render smoke",
        session: session.id,
        parts: [
          {
            kind: "mermaid",
            mermaid: "flowchart LR\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| A",
          },
          {
            kind: "markdown",
            markdown: "# Heading\n\nProse line one.\n\n- alpha\n- beta\n- gamma",
          },
          {
            kind: "code",
            code: "const x = 1;\nconst y = 2;\nconsole.log(x + y);\n",
            language: "ts",
          },
          { kind: "diff", patch: "@@ -1,3 +1,3 @@\n line one\n-old two\n+new two\n line three" },
          { kind: "terminal", text: "$ echo hi\nhi\n$ ls\nfile.txt\nother.txt" },
          {
            kind: "chart",
            chartType: "bar",
            x: "k",
            y: "v",
            data: [
              { k: "a", v: 3 },
              { k: "b", v: 7 },
              { k: "c", v: 5 },
            ],
          },
          { kind: "json", data: { name: "showcase", nested: { ok: true, items: [1, 2, 3] } } },
        ],
      },
    })
  ).json();

  await page.goto(`/?surface=${surface.id}`);
  const card = page.locator(`.card[data-id="${surface.id}"]`);
  await expect(card).toBeVisible();

  // The five sandboxed parts each render in an iframe — none may collapse to the
  // empty strip the mermaid bug produced.
  const iframes = card.locator("iframe");
  await expect(iframes).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    await expect
      .poll(async () => (await iframes.nth(i).boundingBox())?.height ?? 0, {
        timeout: 10_000,
        message: `sandboxed part #${i} collapsed to an empty strip`,
      })
      .toBeGreaterThan(40);
  }

  // The native parts render in the trusted DOM: a chart SVG and a JSON tree.
  await expect(card.locator("svg.recharts-surface")).toBeVisible();
  await expect(card).toContainText("showcase"); // the json value
});
