import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds this package into a single self-contained dist/index.html — the server
// reads it as one in-memory document at boot (see server-entry.js), so no
// static-asset routes exist. The package dir is the Vite root (index.html sits
// beside this config).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      // Swap shiki's full bundle (~9 MB of inlined grammars/themes) for a curated
      // subset. Exact-match only so shiki/core, shiki/engine/*, shiki/wasm — the
      // deep imports @pierre/diffs and the shim itself use — still resolve to the
      // real package. See src/shikiBundle.ts.
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL("./src/shikiBundle.ts", import.meta.url)),
      },
    ],
  },
  build: {
    target: "es2022",
    emptyOutDir: true,
  },
});
