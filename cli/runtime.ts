// Node/runtime facts shared across the CLI: where the repo root is, how to
// resolve a server/MCP entrypoint (source `.ts` in a dev checkout, built
// `dist/*.js` once installed), and whether this Node can type-strip the source.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "./errors.ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Development checkouts run TypeScript directly (Node strips types), but Node
// refuses to type-strip files under node_modules — installed packages ship
// compiled JS in dist/ (built on prepack) and must use it.
export function entrypoint(...parts: string[]): string {
  const built = join(ROOT, "dist", ...parts).replace(/\.ts$/, ".js");
  return existsSync(built) ? built : join(ROOT, ...parts);
}

// Node ≥ 22.18 strips TypeScript at load; older nvm defaults (v20) cannot.
export function nodeCanTypeStrip(): boolean {
  const [major, minor] = process.versions.node.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 18);
}

// `serve`/`mcp`/`service` spawn a `.ts` entrypoint with the current node. On an
// older node the spawn would die with a cryptic ERR_UNKNOWN_FILE_EXTENSION —
// fail fast here with the actual fix instead.
export function ensureNodeCanRun(entry: string): void {
  if (!entry.endsWith(".ts") || nodeCanTypeStrip()) return;
  fail(
    `running from source needs Node ≥ 22.18 to strip TypeScript (you have ${process.version}).\n` +
      `  Switch with nvm: \`nvm use 22\` (or 24), then re-run —\n` +
      `  or run a one-off with a newer binary: PATH="$(dirname "$(nvm which 22)"):$PATH" showcase serve`,
  );
}
