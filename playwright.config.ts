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
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run start",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      SHOWCASE_DATA: "/tmp/showcase-e2e.json",
      SHOWCASE_VERSION: "",
    },
  },
});
