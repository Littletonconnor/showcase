// Per-(agent, cwd) session resolution and the small JSON state file that
// remembers which session this working directory last published to, so an
// agent's follow-up `publish`/`wait` lands on the same session automatically.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { api, BASE, ensureServerUp, TOKEN } from "./http.ts";

export interface SessionFlags {
  // null = a caller already resolved and found none; treated as absent.
  session?: string | null;
  "session-title"?: string;
  agent?: string;
  "new-session"?: boolean;
}

// Session state is keyed by (agent process pid, cwd). Many agents spawn a
// fresh shell per command, so the immediate parent is unstable — walk up the
// process tree past shells to the agent process itself.
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh"]);

function getParentPosix(pid: number): { ppid: number; isShell: boolean } {
  const out = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const m = out.match(/^\s*(\d+)\s+(.*)$/);
  if (!m) return { ppid: 0, isShell: false };
  const ppid = Number(m[1]);
  const comm = m[2].trim().split("/").pop() ?? "";
  return { ppid, isShell: SHELLS.has(comm.replace(/^-/, "")) };
}

function agentPidWindows(startPid: number): number {
  // wmic is removed in Windows 11. Walk the process tree in a single
  // PowerShell call to avoid repeated startup overhead (~300ms per spawn).
  const script = `
    $procId = ${startPid}
    $shells = @('cmd.exe','powershell.exe','pwsh.exe')
    for ($i = 0; $i -lt 10; $i++) {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
      if (!$p) { break }
      if ($shells -notcontains $p.Name.ToLower()) { break }
      if ($p.ParentProcessId -le 1) { break }
      $procId = $p.ParentProcessId
    }
    $procId
  `;
  const out = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  return Number(out) || startPid;
}

function agentPid(): number {
  try {
    if (process.platform === "win32") return agentPidWindows(process.ppid);
    let pid = process.ppid;
    for (let hops = 0; hops < 10; hops++) {
      const { ppid, isShell } = getParentPosix(pid);
      if (!isShell || !ppid || ppid <= 1) return pid;
      pid = ppid;
    }
    return pid;
  } catch {
    return 0;
  }
}

function stateFile(): string {
  const dir = join(tmpdir(), `showcase-${userInfo().username}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash("sha1")
    .update(`${agentPid()}:${process.cwd()}`)
    .digest("hex")
    .slice(0, 12);
  return join(dir, `${key}.json`);
}

export function readState(): { session?: string; agent?: string } {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

export function writeState(patch: { session?: string; agent?: string }): void {
  writeFileSync(stateFile(), JSON.stringify({ ...readState(), ...patch }));
}

export function agentName(flags: SessionFlags): string {
  return flags.agent ?? process.env.SHOWCASE_AGENT ?? readState().agent ?? "agent";
}

export async function resolveSession(
  flags: SessionFlags,
  { create = false }: { create?: boolean } = {},
): Promise<string | null> {
  if (flags.session) return flags.session;
  if (process.env.SHOWCASE_SESSION) return process.env.SHOWCASE_SESSION;
  const state = readState();
  if (state.session && !flags["new-session"]) {
    const probe = () =>
      fetch(`${BASE}/api/sessions/${state.session}/surfaces`, {
        headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
      }).then(
        (r) => (r.ok ? "live" : "gone"),
        () => "down",
      );
    let status = await probe();
    // "down" means the server is unreachable — NOT that the session is gone.
    // The store is persistent, so autostart and re-check before minting a new
    // session; otherwise every publish after a server stop splinters the
    // conversation into a duplicate session. If the server still isn't up,
    // keep the cached id optimistically and let the actual API call fail
    // with a real network error.
    if (status === "down" && (await ensureServerUp())) status = await probe();
    if (status !== "gone") return state.session;
  }
  if (!create) return null;
  const session = await api("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      agent: agentName(flags),
      title: flags["session-title"],
      cwd: process.cwd(),
    }),
  });
  writeState({ session: session.id, agent: agentName(flags) });
  return session.id;
}

// A monitor process (e.g. the Claude Code plugin) may not share the local
// state file written by the agent's CLI calls — different spawn tree, so
// agentPid() can hash to a different key. Fall back to asking the server for
// the most recently active session whose cwd matches ours.
export async function resolveSessionByCwd(cwd = process.cwd()): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/sessions`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    });
    if (!res.ok) return null;
    const sessions = (await res.json()) as any[];
    return (
      sessions
        .filter((s: { cwd?: string }) => s.cwd === cwd)
        .sort((a: { lastActiveAt?: string }, b: { lastActiveAt?: string }) =>
          String(b.lastActiveAt).localeCompare(String(a.lastActiveAt)),
        )[0]?.id ?? null
    );
  } catch {
    return null;
  }
}
