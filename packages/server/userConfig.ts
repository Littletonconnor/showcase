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
import type { Blueprint } from "@showcase/core/blueprints";
import { type ConfigIssue, type ConfigKind, validateConfig } from "@showcase/core/configSchema";
import type { Kit } from "@showcase/core/kits";
import type { Theme } from "@showcase/core/themes";

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

// One-line, schema-validate-or-warn. Returns true when `raw` passes the kind's
// schema; otherwise warns each issue (path: message) against `file` and skips.
function passesSchema(kind: ConfigKind, raw: unknown, file: string): boolean {
  const result = validateConfig(kind, raw);
  if (result.ok) return true;
  console.warn(`showcase: skipping ${file} — invalid ${kind}:`);
  for (const issue of result.issues) console.warn(`  ${formatIssue(issue)}`);
  return false;
}

const formatIssue = (issue: ConfigIssue): string =>
  issue.path ? `${issue.path}: ${issue.message}` : issue.message;

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

// Each validator gates on the shared schema (configSchema.ts), then applies the
// same field defaulting it always has. The schema is the single source of truth
// for what `showcase validate` reports too, so boot and the preflight agree.
function validateTheme(raw: unknown, file: string): Theme | null {
  if (!passesSchema("theme", raw, file)) return null;
  const theme = raw as Theme & { shiki?: { light?: string; dark?: string } };
  return {
    ...theme,
    // shiki is optional in the schema; default to the github themes.
    shiki: {
      light: theme.shiki?.light ?? "github-light",
      dark: theme.shiki?.dark ?? "github-dark",
    },
  };
}

function validateKit(raw: unknown, file: string): Kit | null {
  if (!passesSchema("kit", raw, file)) return null;
  const kit = raw as Kit;
  return {
    id: kit.id,
    label: kit.label,
    summary: isStr(kit.summary) ? kit.summary : kit.label,
    classes: isStr(kit.classes) ? kit.classes : "",
    css: kit.css,
    ...(isStr(kit.js) ? { js: kit.js } : {}),
  };
}

function validateBlueprint(raw: unknown, file: string): Blueprint | null {
  if (!passesSchema("blueprint", raw, file)) return null;
  // Pass structure/brand/defaults/kits/theme/extends through verbatim; the
  // registry validates kit/theme ids against the merged set at resolution.
  return raw as Blueprint;
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
