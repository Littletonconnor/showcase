// `showcase doctor` — one command that checks the whole local setup and says
// what's wrong in actionable terms. Every footgun the environment offers
// (node too old to type-strip, server down or unreachable, viewer never
// built, SHOWCASE_DATA pointing at a directory, a stale cached session)
// surfaces here as a labeled ok/warn/fail line instead of a cryptic error
// three commands later. Read-only: doctor never autostarts the server.
import { existsSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "../command.ts";
import { BASE, TOKEN } from "../http.ts";
import { emit } from "../output.ts";
import { entrypoint, nodeCanTypeStrip, ROOT } from "../runtime.ts";
import { readState } from "../session.ts";
import { formatBytes, formatDuration } from "../util.ts";

type Status = "ok" | "warn" | "fail";
interface CheckResult {
  check: string;
  status: Status;
  detail: string;
}

const authHeaders = (): Record<string, string> =>
  TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};

async function fetchJson(path: string, timeoutMs = 3000): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function checkNode(): CheckResult {
  const v = process.version;
  return nodeCanTypeStrip()
    ? { check: "node", status: "ok", detail: `${v} (type-strips TypeScript)` }
    : {
        check: "node",
        status: "fail",
        detail: `${v} is too old to run the .ts entrypoints — need ≥ 22.18 (nvm use 22, or 24)`,
      };
}

async function checkServer(): Promise<CheckResult> {
  const h = await fetchJson("/api/health");
  if (!h) {
    return {
      check: "server",
      status: "fail",
      detail: `not reachable at ${BASE} — start it with \`showcase serve\` (any publish also autostarts it${process.env.SHOWCASE_NO_AUTOSTART ? ", but SHOWCASE_NO_AUTOSTART is set" : ""})`,
    };
  }
  const err = h.lastError ? ` · last error: ${h.lastError.message}` : "";
  return {
    check: "server",
    status: h.lastError ? "warn" : "ok",
    detail: `${h.status} at ${BASE} · up ${formatDuration(h.uptimeMs)}${h.version ? ` · v${h.version}` : ""}${err}`,
  };
}

function checkViewerBuild(): CheckResult | null {
  // Only meaningful in a source checkout (installed builds ship dist/).
  if (!entrypoint("server", "index.ts").endsWith(".ts")) return null;
  const dist = join(ROOT, "viewer", "dist", "index.html");
  return existsSync(dist)
    ? { check: "viewer", status: "ok", detail: "built (packages/viewer/dist/index.html)" }
    : {
        check: "viewer",
        status: "warn",
        detail: "dist/index.html missing — run `pnpm build:viewer` (or `pnpm dev`) before serving",
      };
}

function checkDataFile(): CheckResult {
  const path = process.env.SHOWCASE_DATA ?? join(homedir(), ".showcase", "data", "showcase.json");
  const label = process.env.SHOWCASE_DATA ? "SHOWCASE_DATA" : "data file";
  let st;
  try {
    st = statSync(path);
  } catch {
    return { check: label, status: "ok", detail: `${path} (absent — a fresh board)` };
  }
  if (st.isDirectory()) {
    return {
      check: label,
      status: "fail",
      detail: `${path} is a directory — point SHOWCASE_DATA at a file, e.g. ${join(path, "showcase.json")}`,
    };
  }
  try {
    JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {
      check: label,
      status: "warn",
      detail: `${path} is not valid JSON — the server will recover from ${path}.bak if present`,
    };
  }
  return { check: label, status: "ok", detail: `${path} (${formatBytes(st.size)})` };
}

async function checkCachedSession(serverUp: boolean): Promise<CheckResult | null> {
  const cached = readState().session;
  if (!cached || !serverUp) return null;
  const found = await fetchJson(`/api/sessions/${cached}`);
  return found
    ? { check: "session", status: "ok", detail: `active session ${cached}` }
    : {
        check: "session",
        status: "warn",
        detail: `cached session ${cached} no longer exists — the next publish mints a fresh one`,
      };
}

const doctor: Command = {
  name: "doctor",
  group: "Inspect",
  summary: "diagnose the local setup — node, server, viewer build, data file",
  usage: "showcase doctor",
  help: "Runs read-only checks and prints one ok/warn/fail line per item with the fix. Exits non-zero if anything fails, so it works as a setup gate. Doctor never starts the server.",
  async run() {
    const results: CheckResult[] = [checkNode()];
    const server = await checkServer();
    results.push(server);
    const viewer = checkViewerBuild();
    if (viewer) results.push(viewer);
    results.push(checkDataFile());
    const session = await checkCachedSession(server.status !== "fail");
    if (session) results.push(session);

    if (results.some((r) => r.status === "fail")) process.exitCode = 1;

    const MARK: Record<Status, string> = { ok: "✓", warn: "!", fail: "✗" };
    emit({ checks: results }, () => {
      const width = Math.max(...results.map((r) => r.check.length));
      return results
        .map((r) => `${MARK[r.status]} ${r.check.padEnd(width)}  ${r.detail}`)
        .join("\n");
    });
  },
};

export const doctorCommands: Command[] = [doctor];
