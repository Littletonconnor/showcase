// Local user config loader — the "customizable & extendable" layer
// (docs/themable-explainers.md, Phase 1). At boot the server reads brand
// palettes, custom kits, and explainer blueprints a user authored as JSON under
// a config dir, and hands them to createApp, which layers them over the
// built-in registries (user id wins on collision).
//
// Node-only wiring (like storage.ts / index.ts): this is the ONE place `node:fs`
// touches the registries, keeping themes.ts / kits.ts / blueprints.ts / app.ts
// runtime-agnostic. The definitions load from a LOCAL dir the user controls —
// never from agent-published surface content — so the user CSS/JS they carry
// crosses no new trust boundary (it renders in the same sandboxed iframe every
// kit already does).
//
// Layout (each file is one object; the filename is ignored):
//   <dir>/themes/*.json       → a Theme      (brand palette)
//   <dir>/kits/*.json         → a Kit        (custom CSS/JS vocabulary)
//   <dir>/blueprints/*.json   → a Blueprint  (theme + kits + structure + brand)

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Blueprint } from "./blueprints.ts";
import type { Kit } from "./kits.ts";
import type { Theme } from "./themes.ts";

export interface UserExtensions {
  themes: Theme[];
  kits: Kit[];
  blueprints: Blueprint[];
}

// Board-level defaults, read from <dir>/config.json. A repo (or user) sets these
// so every NEW session starts in one format without the agent naming it — "this
// whole repo's sessions are design-doc sessions" (docs/themable-explainers.md).
export interface BoardDefaults {
  defaultBlueprint?: string;
  defaultTheme?: string;
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Read every *.json under <dir>/<sub>, parse each, and keep the ones a validator
// accepts. A missing dir yields []; a malformed or rejected file is warned and
// skipped — one bad file never sinks the rest or the boot.
async function loadDir<T>(
  dir: string,
  sub: string,
  validate: (raw: unknown, file: string) => T | null,
): Promise<T[]> {
  let names: string[];
  try {
    names = await readdir(join(dir, sub));
  } catch {
    return []; // dir absent — the common case; not an error
  }
  const out: T[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = join(dir, sub, name);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, "utf8"));
    } catch (err) {
      console.warn(`showcase: skipping ${path} — invalid JSON (${(err as Error).message})`);
      continue;
    }
    const parsed = validate(raw, path);
    if (parsed) out.push(parsed);
  }
  return out;
}

// A theme needs an id/label and a light + dark palette object; shiki defaults to
// the github themes when omitted. The palette fields are passed through as-is —
// a missing color just yields an empty CSS var, never a crash.
function validateTheme(raw: unknown, file: string): Theme | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.label)) {
    console.warn(`showcase: skipping ${file} — theme needs string id + label`);
    return null;
  }
  if (!isObj(raw.light) || !isObj(raw.dark)) {
    console.warn(`showcase: skipping ${file} — theme needs light + dark palette objects`);
    return null;
  }
  const shiki = isObj(raw.shiki) ? raw.shiki : {};
  return {
    ...raw,
    shiki: {
      light: isStr(shiki.light) ? shiki.light : "github-light",
      dark: isStr(shiki.dark) ? shiki.dark : "github-dark",
    },
  } as Theme;
}

function validateKit(raw: unknown, file: string): Kit | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.label) || !isStr(raw.css)) {
    console.warn(`showcase: skipping ${file} — kit needs string id, label, css`);
    return null;
  }
  return {
    id: raw.id,
    label: raw.label,
    summary: isStr(raw.summary) ? raw.summary : raw.label,
    classes: isStr(raw.classes) ? raw.classes : "",
    css: raw.css,
    ...(isStr(raw.js) ? { js: raw.js } : {}),
  };
}

function validateBlueprint(raw: unknown, file: string): Blueprint | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.label) || !isStr(raw.summary)) {
    console.warn(`showcase: skipping ${file} — blueprint needs string id, label, summary`);
    return null;
  }
  // Pass structure/brand/defaults/kits/theme/extends through verbatim; the
  // registry validates kit/theme ids against the merged set at resolution.
  return raw as unknown as Blueprint;
}

// Load all three kinds from a config dir. Returns empty arrays when the dir is
// absent, so a board with no user config behaves exactly as before.
export async function loadUserExtensions(dir: string): Promise<UserExtensions> {
  const [themes, kits, blueprints] = await Promise.all([
    loadDir(dir, "themes", validateTheme),
    loadDir(dir, "kits", validateKit),
    loadDir(dir, "blueprints", validateBlueprint),
  ]);
  const note = [
    themes.length && `${themes.length} theme(s)`,
    kits.length && `${kits.length} kit(s)`,
    blueprints.length && `${blueprints.length} blueprint(s)`,
  ].filter(Boolean);
  if (note.length > 0) console.log(`showcase: loaded ${note.join(", ")} from ${dir}`);
  return { themes, kits, blueprints };
}

// Read <dir>/config.json for the board's default preset. Missing/invalid → {}.
export async function loadBoardDefaults(dir: string): Promise<BoardDefaults> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(dir, "config.json"), "utf8"));
  } catch {
    return {};
  }
  if (!isObj(raw)) return {};
  return {
    defaultBlueprint: isStr(raw.defaultBlueprint) ? raw.defaultBlueprint : undefined,
    defaultTheme: isStr(raw.defaultTheme) ? raw.defaultTheme : undefined,
  };
}

// Merge config layers, EARLIER layers winning on id collision (pass them most-
// specific first, e.g. [repo, user]). Deduping by id means the list handed to
// the registries never contains a collision, so each register*'s own ordering
// can't change the winner.
export function mergeExtensions(layers: UserExtensions[]): UserExtensions {
  const dedupe = <T extends { id: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const it of items) {
      if (it && typeof it.id === "string" && !seen.has(it.id)) {
        seen.add(it.id);
        out.push(it);
      }
    }
    return out;
  };
  return {
    themes: dedupe(layers.flatMap((l) => l.themes)),
    kits: dedupe(layers.flatMap((l) => l.kits)),
    blueprints: dedupe(layers.flatMap((l) => l.blueprints)),
  };
}

// Persist a runtime-authored brand theme to <dir>/themes/<id>.json so it survives
// a restart (wired to POST /api/themes ... persist:true via app's persistTheme).
export async function saveUserTheme(dir: string, theme: Theme): Promise<void> {
  const themesDir = join(dir, "themes");
  await mkdir(themesDir, { recursive: true });
  const safeId = theme.id.replace(/[^a-zA-Z0-9_-]/g, "_") || "theme";
  await writeFile(join(themesDir, `${safeId}.json`), JSON.stringify(theme, null, 2), "utf8");
}
