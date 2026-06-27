#!/usr/bin/env node
// Thin launcher. The CLI itself lives in `cli/` as TypeScript modules that run
// directly on Node ≥ 22.18 via type stripping (no build step in a dev
// checkout). Once installed, the prepack build emits `dist/cli/*.js` and we use
// that, since Node refuses to type-strip files under node_modules.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(root, "dist", "cli", "main.js");
const entry = existsSync(built) ? built : join(root, "cli", "main.ts");

if (entry.endsWith(".ts")) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (!(major > 22 || (major === 22 && minor >= 18))) {
    console.error(
      `showcase: running from source needs Node ≥ 22.18 to strip TypeScript ` +
        `(you have ${process.version}). Switch with: nvm use 22`,
    );
    process.exit(1);
  }
}

const { run } = await import(pathToFileURL(entry).href);
await run(process.argv.slice(2));
