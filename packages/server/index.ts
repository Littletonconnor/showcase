import { serve } from "@hono/node-server";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { viewerIndexHtmlPath } from "@showcase/viewer";
import { createApp } from "./app.ts";
import { JsonFileStore } from "./storage.ts";
import {
  type BoardDefaults,
  loadBoardDefaults,
  loadUserExtensions,
  mergeExtensions,
  saveUserTheme,
  type UserExtensions,
} from "./userConfig.ts";

// This file lives at packages/server/index.ts; the repo root (two up) holds the
// guide/ tree. The built viewer is resolved through @showcase/viewer's package
// entry, not a hard-coded sibling path, so the server stays ignorant of the
// workspace layout.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// One-time lift of a pre-existing repo-local board into the new home-dir
// location, so upgrading doesn't present an empty board. Only runs when the
// destination doesn't exist yet and a legacy file is actually there.
async function migrateLegacyData(from: string, to: string) {
  if (from === to) return;
  try {
    await stat(to);
    return; // destination already populated — leave it
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  try {
    await stat(from);
  } catch (err: any) {
    if (err?.code === "ENOENT") return; // no legacy board to migrate
    throw err;
  }
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  console.log(`showcase: migrated board from ${from} to ${to}`);
}

const [viewerHtml, guideMarkdown, setupText, playbookText] = await Promise.all([
  readFile(viewerIndexHtmlPath, "utf8").catch(() => {
    console.error("viewer build missing — run `pnpm build:viewer` first");
    return process.exit(1);
  }),
  readFile(join(repoRoot, "guide", "DESIGN_GUIDE.md"), "utf8"),
  readFile(join(repoRoot, "guide", "AGENT_SETUP.md"), "utf8"),
  readFile(join(repoRoot, "guide", "PLAYBOOK.md"), "utf8"),
]);

const pr = process.env.SHOWCASE_PUBLIC_READ;
const publicRead = pr === "session" || pr === "full" ? pr : undefined;

// Presets (brand palettes, custom kits, explainer blueprints) come in two config
// layers over the built-ins (docs/themable-explainers.md):
//   • USER  — ~/.showcase (override with SHOWCASE_CONFIG): personal presets.
//   • REPO  — <cwd>/.showcase (override with SHOWCASE_REPO_CONFIG): committed
//             with the project, so a team's sessions share one format.
// Repo wins over user on id collision; both win over built-ins. A `config.json`
// in either sets the board's default preset for new sessions (repo over user).
// Both dirs are optional — absent → behaves exactly as before.
const userDir = process.env.SHOWCASE_CONFIG ?? join(homedir(), ".showcase");
const repoDir = process.env.SHOWCASE_REPO_CONFIG ?? join(process.cwd(), ".showcase");
const sameDir = repoDir === userDir;
const emptyExt: UserExtensions = { themes: [], kits: [], blueprints: [] };
const [userExt, repoExt, userCfg, repoCfg] = await Promise.all([
  loadUserExtensions(userDir),
  sameDir ? Promise.resolve(emptyExt) : loadUserExtensions(repoDir),
  loadBoardDefaults(userDir),
  sameDir ? Promise.resolve({} as BoardDefaults) : loadBoardDefaults(repoDir),
]);
const { themes, kits, blueprints } = mergeExtensions([repoExt, userExt]); // repo wins
const defaultBlueprint = repoCfg.defaultBlueprint ?? userCfg.defaultBlueprint;
const defaultTheme = repoCfg.defaultTheme ?? userCfg.defaultTheme;

// The board lives in the user's home, not the install tree — a repo-local
// data/ dir got wiped on every reinstall, re-clone, or ephemeral checkout,
// silently taking published surfaces with it. SHOWCASE_DATA still overrides.
const dataPath = process.env.SHOWCASE_DATA ?? join(homedir(), ".showcase", "data", "showcase.json");
if (!process.env.SHOWCASE_DATA) {
  await migrateLegacyData(join(repoRoot, "data", "showcase.json"), dataPath);
} else {
  // Fail at boot, not per-request: a directory here would let the server say
  // "listening" and then 500 every route with an opaque internal error.
  const existing = await stat(dataPath).catch(() => null);
  if (existing?.isDirectory()) {
    console.error(
      `showcase: SHOWCASE_DATA must be a JSON file path, not a directory — try SHOWCASE_DATA=${join(dataPath, "showcase.json")}`,
    );
    process.exit(1);
  }
}

const app = createApp({
  store: new JsonFileStore(dataPath),
  viewerHtml,
  guideMarkdown,
  setupText,
  playbookText,
  extraThemes: themes,
  extraKits: kits,
  extraBlueprints: blueprints,
  defaultBlueprint,
  defaultTheme,
  // Brand themes authored at runtime (POST /api/themes) persist to the USER dir.
  persistTheme: (theme) => saveUserTheme(userDir, theme),
  authToken: process.env.SHOWCASE_TOKEN,
  publicRead,
  // `npm run dev` sets this; it adds the live-reload endpoint + snippet.
  dev: process.env.SHOWCASE_DEV === "1",
  // Opt-in structured request log (one JSON line per API request) for a service
  // install — off by default so the local board stays quiet.
  requestLog: process.env.SHOWCASE_LOG === "1",
  // Update check is off for this personal fork — there is no published
  // "showcase" package to compare against (the public npm package of that
  // name is unrelated). Set SHOWCASE_VERSION to re-enable for manual testing.
  version: process.env.SHOWCASE_VERSION ?? "",
});

const port = Number(process.env.PORT ?? 8229);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`showcase listening on http://localhost:${info.port}`);
});
