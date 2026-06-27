// The shared HTTP client every command talks through. One place maps an API
// failure (or an unreachable server) to a `showcase: …` message + non-zero
// exit, so error behavior is identical across subcommands. On a local URL it
// will also auto-start the server once and retry.
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { fail, friendlyNetworkError } from "./errors.ts";
import { entrypoint, nodeCanTypeStrip } from "./runtime.ts";
import { contentTypeFor, sleep } from "./util.ts";

export const BASE = (process.env.SHOWCASE_URL ?? "http://localhost:8229").replace(/\/$/, "");
export const TOKEN = process.env.SHOWCASE_TOKEN;

// Shared with `showcase service` so the auto-started server and the OS service
// log to the same file.
export const SERVICE_LOG = join(homedir(), ".showcase", "server.log");

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}), ...extra };
}

export async function api(path: string, init: RequestInit = {}): Promise<any> {
  const send = () =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: authHeaders({ "content-type": "application/json", ...(init.headers as object) }),
    });
  // On a connection failure, try to auto-start a local server, then retry once.
  let res = await send().catch((e) => failNetwork(e));
  if (!res && (await ensureServerUp())) res = await send().catch((e) => failNetwork(e));
  if (!res) fail(`server not reachable at ${BASE} — start it with: showcase serve`);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) fail(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

// A fetch rejected before we could auto-start: surface a friendly network hint
// when the OS code is known, otherwise return null so the caller can retry via
// ensureServerUp() and only then give up with the generic message.
function failNetwork(error: unknown): null {
  const friendly = friendlyNetworkError(error);
  if (friendly && !canAutoStart()) fail(friendly);
  return null;
}

// Upload raw file bytes to /api/assets. Returns { id, url, contentType, ... }.
export async function uploadFile(
  file: string,
  { session, kind }: { session?: string; kind?: string } = {},
): Promise<any> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    fail(`cannot read file: ${file}`);
  }
  const params = new URLSearchParams();
  params.set("filename", file.split(/[\\/]/).pop() ?? "upload");
  if (session) params.set("session", session);
  if (kind) params.set("kind", kind);
  const send = () =>
    fetch(`${BASE}/api/assets?${params}`, {
      method: "POST",
      headers: authHeaders({ "content-type": contentTypeFor(file) }),
      body: bytes,
    });
  let res = await send().catch(() => null);
  if (!res && (await ensureServerUp())) res = await send().catch(() => null);
  if (!res) fail(`server not reachable at ${BASE} — start it with: showcase serve`);
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) fail(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

function canAutoStart(): boolean {
  if (process.env.SHOWCASE_NO_AUTOSTART) return false;
  let url: URL;
  try {
    url = new URL(BASE);
  } catch {
    return false;
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) return false;
  return entrypoint("server", "index.ts").endsWith(".ts") ? nodeCanTypeStrip() : true;
}

// Auto-start a local server on demand. When a CLI call can't reach the surface
// and BASE is local, spawn the server detached and wait for it to answer — so
// an agent's first `publish` "just works" with no babysat tab and no service
// install. No-op for a remote SHOWCASE_URL, when SHOWCASE_NO_AUTOSTART is set,
// or on a node too old to type-strip. Tries at most once per process.
let autoStartAttempted = false;
export async function ensureServerUp(): Promise<boolean> {
  if (autoStartAttempted) return false;
  autoStartAttempted = true;
  if (!canAutoStart()) return false;
  const port = new URL(BASE).port || "8229";
  const entry = entrypoint("server", "index.ts");
  mkdirSync(dirname(SERVICE_LOG), { recursive: true });
  // Detached + unref'd so the server outlives this short-lived CLI process;
  // output goes to the same log the OS service uses.
  const log = openSync(SERVICE_LOG, "a");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PORT: port },
  });
  child.unref();
  closeSync(log);
  // Poll a tiny endpoint until it answers (any HTTP response means it's
  // listening) or give up after ~6s.
  for (let i = 0; i < 60; i++) {
    await sleep(100);
    const up = await fetch(`${BASE}/api/kits`).then(
      () => true,
      () => false,
    );
    if (up) return true;
  }
  return false;
}
