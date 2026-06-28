// Runtime entry consumed by @showcase/server (NOT part of the Vite build): it
// resolves this package's built single-file viewer so the server can read it at
// boot without hard-coding the monorepo layout. Build the viewer first
// (`pnpm --filter @showcase/viewer build`) or this path won't exist yet.
import { fileURLToPath } from "node:url";

export const viewerIndexHtmlPath = fileURLToPath(new URL("./dist/index.html", import.meta.url));
