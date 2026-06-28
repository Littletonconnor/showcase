// `showcase validate` — preflight the local config a user/repo authored under
// <dir>/{themes,kits,blueprints}/*.json + <dir>/config.json, so a malformed
// palette color or a misspelled field is a real error here instead of a theme
// silently absent at boot. Reads the SAME dirs the server loads (index.ts) and
// posts each file's content to /api/config/validate, which runs the shared
// schema — the CLI stays zero-dep, the schema stays the single source of truth.
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "../command.ts";
import { api } from "../http.ts";
import { emit } from "../output.ts";

type Kind = "theme" | "kit" | "blueprint" | "config";

// <dir>/<sub> → the schema kind a file there is validated against.
const SUBDIRS: Array<{ sub: string; kind: Kind }> = [
  { sub: "themes", kind: "theme" },
  { sub: "kits", kind: "kit" },
  { sub: "blueprints", kind: "blueprint" },
];

interface FileResult {
  file: string;
  kind: Kind;
  ok: boolean;
  issues: Array<{ path: string; message: string }>;
}

// The config dirs the server reads, in the same precedence (index.ts): a repo
// dir (<cwd>/.showcase) layered over a user dir (~/.showcase), each overridable.
// Deduped so a single combined dir isn't validated twice.
function configDirs(): string[] {
  const userDir = process.env.SHOWCASE_CONFIG ?? join(homedir(), ".showcase");
  const repoDir = process.env.SHOWCASE_REPO_CONFIG ?? join(process.cwd(), ".showcase");
  return repoDir === userDir ? [userDir] : [repoDir, userDir];
}

function jsonFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort();
  } catch {
    return []; // dir absent — the common case
  }
}

// Read + parse a file, then validate via the server. A JSON parse error is its
// own issue (reported without a round-trip); a parsed object goes to the schema.
async function checkFile(path: string, kind: Kind): Promise<FileResult> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return {
      file: path,
      kind,
      ok: false,
      issues: [{ path: "", message: `invalid JSON: ${(err as Error).message}` }],
    };
  }
  const res = await api("/api/config/validate", {
    method: "POST",
    body: JSON.stringify({ kind, value }),
  });
  return { file: path, kind, ok: res.ok, issues: res.ok ? [] : res.issues };
}

function collectTargets(): Array<{ path: string; kind: Kind }> {
  const targets: Array<{ path: string; kind: Kind }> = [];
  for (const dir of configDirs()) {
    for (const { sub, kind } of SUBDIRS) {
      for (const name of jsonFilesIn(join(dir, sub))) {
        targets.push({ path: join(dir, sub, name), kind });
      }
    }
    // config.json (board defaults) lives at the dir root, not in a subdir.
    const cfg = join(dir, "config.json");
    try {
      readFileSync(cfg);
      targets.push({ path: cfg, kind: "config" });
    } catch {
      // absent — fine
    }
  }
  return targets;
}

const validate: Command = {
  name: "validate",
  group: "Manage",
  summary: "check local theme/kit/blueprint config for errors",
  usage: "showcase validate",
  help: "Validates every *.json under the user (~/.showcase) and repo (<cwd>/.showcase)\nconfig dirs against the schema the server loads them with. Exits non-zero if any\nfile is invalid, so it works as a pre-commit / CI gate. Override the dirs with\nSHOWCASE_CONFIG and SHOWCASE_REPO_CONFIG.",
  async run() {
    const targets = collectTargets();
    if (targets.length === 0) {
      emit(
        { checked: 0, valid: 0, invalid: 0, files: [] },
        () => `No config files found under ${configDirs().join(" or ")}.`,
      );
      return;
    }

    const results: FileResult[] = [];
    for (const t of targets) results.push(await checkFile(t.path, t.kind));
    const invalid = results.filter((r) => !r.ok);

    // Non-zero exit when anything fails, so `showcase validate` gates a commit/CI.
    if (invalid.length > 0) process.exitCode = 1;

    emit(
      {
        checked: results.length,
        valid: results.length - invalid.length,
        invalid: invalid.length,
        files: results,
      },
      () => {
        const lines = results.map((r) => {
          const head = `${r.ok ? "✓" : "✗"} ${r.file}`;
          if (r.ok) return head;
          const issues = r.issues.map((i) => `    ${i.path ? `${i.path}: ` : ""}${i.message}`);
          return [head, ...issues].join("\n");
        });
        const summary = `${results.length} file${results.length === 1 ? "" : "s"} checked · ${
          results.length - invalid.length
        } valid · ${invalid.length} invalid`;
        return [...lines, summary].join("\n");
      },
    );
  },
};

export const configCommands: Command[] = [validate];
