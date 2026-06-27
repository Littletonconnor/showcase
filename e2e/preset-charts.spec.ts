import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Capture the data-viz dashboard from the REAL viewer — its breakdown + trend are
// native `chart` parts (Recharts), so they only render in the app, not via the
// static renderHtmlPage path the rest of the gallery uses. Run with:
//   PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
//     npx playwright test preset-charts
// Writes docs/images/presets/data-viz-{light,dark}.png.

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "images", "presets");

const DASHBOARD = {
  title: "API latency — last 24 hours",
  headline: { value: "86 ms", label: "p95 · ▼ 71% vs yesterday" },
  stats: [
    { label: "p50", value: "12 ms" },
    { label: "error rate", value: "0.04%" },
    { label: "req/s", value: "9.4k" },
  ],
  bars: {
    caption: "p95 latency by endpoint (ms)",
    data: [
      { label: "/search", value: 132 },
      { label: "/feed", value: 96 },
      { label: "/user", value: 61 },
      { label: "/auth", value: 48 },
      { label: "/health", value: 9 },
    ],
  },
  trend: {
    caption: "p95 over 24h — deploy at 14:00",
    values: [180, 172, 168, 175, 160, 120, 70, 66, 72, 64, 60, 58],
  },
  detail: [
    { label: "slowest · /search", value: "132 ms" },
    { label: "fastest · /health", value: "9 ms" },
  ],
  takeaway:
    "The 14:00 batched-dequeue deploy cut p95 from ~170ms to ~62ms with no error-rate regression. Next: investigate /search, still 2× the median.",
};

test.use({ deviceScaleFactor: 2, viewport: { width: 980, height: 1200 } });

test("data-viz dashboard renders native charts (and capture the gallery shot)", async ({
  page,
  request,
}) => {
  mkdirSync(OUT, { recursive: true });
  const surface = (await (
    await request.post("/api/presets/data-viz", { data: DASHBOARD })
  ).json()) as { id: string };

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`/?surface=${surface.id}`);
    const card = page.locator(`.card[data-id="${surface.id}"]`);
    await expect(card).toBeVisible();
    // Two native Recharts surfaces (bar breakdown + area trend) must render.
    await expect(card.locator("svg.recharts-surface")).toHaveCount(2);
    await page.waitForTimeout(500); // let the chart animation settle
    await card.screenshot({ path: join(OUT, `data-viz-${scheme}.png`) });
  }
});
