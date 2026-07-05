import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Component/unit tests for the part renderers and review views (the Playwright
// oracle at the repo root stays the integration gate). Standalone config — the
// build's tailwind/singlefile plugins add nothing under jsdom.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // Same curated shiki subset the build uses (see vite.config.ts).
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL("./src/shikiBundle.ts", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/testSetup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
