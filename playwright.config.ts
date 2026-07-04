import { defineConfig, devices } from "@playwright/test";

// A deliberately small smoke suite — the parity oracle for the Solid→React
// viewer port. It drives a real browser through the publish → render → comment
// loop so "still green" means the port preserved behaviour. Runs on an isolated
// port + temp data file so it never touches a dev instance on 8229.
const PORT = 8231;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    // Allow pointing at a pre-installed browser when the bundled-chromium
    // revision isn't downloaded (e.g. sandboxed CI). Unset on a normal machine
    // → Playwright uses its bundled chromium as usual.
    ...(process.env.PW_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
      : {}),
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Opt-in lane on the user's real Chrome (channel:chrome) running only the
    // render smoke — it catches browser-specific layout bugs that bundled
    // Chromium hides (e.g. the srcdoc-no-reparse that left mermaid empty). Off by
    // default so the suite stays self-contained; run via `npm run test:e2e:chrome`.
    ...(process.env.E2E_CHROME
      ? [
          {
            name: "chrome",
            testMatch: /render-smoke\.spec\.ts/,
            use: { ...devices["Desktop Chrome"], channel: "chrome" },
          },
        ]
      : []),
  ],
  webServer: {
    command: "pnpm start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      SHOWCASE_DATA: "/tmp/showcase-e2e.json",
      SHOWCASE_MASTERY: "/tmp/showcase-e2e-mastery.json",
      SHOWCASE_VERSION: "",
    },
  },
});
