import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

// Source layout puts this file at server/index.ts; the published package runs
// the compiled copy at dist/server/index.js. viewer/ and guide/ live at the
// package root either way.
let root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (basename(root) === "dist") root = join(root, "..");

const [viewerHtml, guideMarkdown, setupText, playbookText] = await Promise.all([
  readFile(join(root, "viewer", "dist", "index.html"), "utf8").catch(() => {
    console.error("viewer build missing — run `npm run build:viewer` first");
    return process.exit(1);
  }),
  readFile(join(root, "guide", "DESIGN_GUIDE.md"), "utf8"),
  readFile(join(root, "guide", "AGENT_SETUP.md"), "utf8"),
  readFile(join(root, "guide", "PLAYBOOK.md"), "utf8"),
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

const app = createApp({
  store: new JsonFileStore(process.env.SHOWCASE_DATA ?? join(root, "data", "showcase.json")),
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
  // Update check is off for this personal fork — there is no published
  // "showcase" package to compare against (the public npm package of that
  // name is unrelated). Set SHOWCASE_VERSION to re-enable for manual testing.
  version: process.env.SHOWCASE_VERSION ?? "",
});

const port = Number(process.env.PORT ?? 8229);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`showcase listening on http://localhost:${info.port}`);
});
