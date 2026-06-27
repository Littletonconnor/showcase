import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds viewer/ into a single self-contained viewer/dist/index.html — the
// server serves the viewer as one in-memory document (Node readFile), so no
// static-asset routes exist.
export default defineConfig({
  root: "viewer",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: [
      { find: "@", replacement: fileURLToPath(new URL("./viewer/src", import.meta.url)) },
      // Swap shiki's full bundle (~9 MB of inlined grammars/themes) for a curated
      // subset. Exact-match only so shiki/core, shiki/engine/*, shiki/wasm — the
      // deep imports @pierre/diffs and the shim itself use — still resolve to the
      // real package. See viewer/src/shikiBundle.ts.
      {
        find: /^shiki$/,
        replacement: fileURLToPath(new URL("./viewer/src/shikiBundle.ts", import.meta.url)),
      },
    ],
  },
  build: {
    target: "es2022",
    emptyOutDir: true,
  },
});
