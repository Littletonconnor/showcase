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
    alias: { "@": fileURLToPath(new URL("./viewer/src", import.meta.url)) },
  },
  build: {
    target: "es2022",
    emptyOutDir: true,
  },
});
