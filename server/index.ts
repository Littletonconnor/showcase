import { serve } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { JsonFileStore } from "./storage.ts";
import { loadUserExtensions } from "./userConfig.ts";

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

// User-authored brand palettes, kits, and explainer blueprints layered over the
// built-ins (docs/themable-explainers.md). Defaults to ~/.showcase; override
// with SHOWCASE_CONFIG. Absent dir → no extensions, identical to before.
const configDir = process.env.SHOWCASE_CONFIG ?? join(homedir(), ".showcase");
const { themes, kits, blueprints } = await loadUserExtensions(configDir);

const app = createApp({
  store: new JsonFileStore(process.env.SHOWCASE_DATA ?? join(root, "data", "showcase.json")),
  viewerHtml,
  guideMarkdown,
  setupText,
  playbookText,
  extraThemes: themes,
  extraKits: kits,
  extraBlueprints: blueprints,
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
