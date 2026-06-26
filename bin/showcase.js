#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const BASE = (process.env.SHOWCASE_URL ?? "http://localhost:8229").replace(/\/$/, "");
const TOKEN = process.env.SHOWCASE_TOKEN;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `showcase — a live visual surface for terminal coding agents

usage:
  showcase serve [--port N] [--open]      start the surface (API + viewer)
  showcase review <branch> [options]      scaffold a review session from a diff
      --base <branch>   base to diff against (default: origin/HEAD or main)
      --title <t>       session title (default: "Review: <branch>")
      prints the session id + URL + a churn-seeded manifest + risk + a
      ready-to-paste prompt that delegates the analysis to your code-review
      skill, then renders its findings to showcase.
      Reads a review profile (your standing conventions + extra skills) from
      $SHOWCASE_REVIEW_PROFILE or ~/.showcase/review.md and folds it in.
  showcase finding [options]              publish one structured review finding
      --title <t>       the finding (required)    --problem <text>  what's wrong (required)
      --confidence <c>  high|medium|low (required) --coverage <text> what you did/didn't check (required)
      --verified        you ran/reproduced it     --scope changed-lines|whole-file|codebase
      --severity <s>    bug|nit|question|praise|note   --file <f> --line <n>
      --before <file|-> --after <file|->  suggested fix as a before→after diff (preferred)
      --fix <text>      why the change is better   --patch <file|->  raw diff (fallback)
      --diagram <file|-> mermaid of the flow   (also: --session, --session-title)
  showcase publish <file|-> [options]     publish an HTML surface (one html part)
      --title <t>       surface title
      --md <file|->     add a markdown part (prose) — combine with html
      --mermaid <file|-> add a mermaid part (diagram source → SVG) — combine with html
      --diff <file|->   add a diff part from a unified/git patch (combine with html)
      --terminal <file|->  add a terminal part from monospace/ANSI output
      --json <file|->    add a json part from a JSON file (collapsible tree)
      --code <file|->    add a code part from a file (shiki-highlighted)
      --kit <id>        opt the html part into a kit (repeatable; see "showcase kits")
      --image <file>    upload an image and append it as an image part
      --session <id>    target session (default: auto per agent session)
      --session-title <t>  name for a newly created session — name the task,
                        e.g. "Auth refactor" (ignored if the session exists)
      --agent <name>    agent name for new sessions (default: $SHOWCASE_AGENT or "agent")
      --new-session     force a fresh session
  showcase upload <file> [options]        upload an asset, print its id and URL
      --kind <k>        image|trace|file (default: inferred from the file type)
      --session <id>    session to attach to (default: auto)
  showcase asset-url <file>               print the URL a file will have (content hash; no upload)
  showcase image <file> [options]         upload an image and publish it as a surface
      --title <t>       surface title
      --caption <c>     caption shown under the image
      (also: --session, --session-title, --agent, --new-session)
  showcase trace <file> [options]         upload a trace file and publish it as a surface
      --title <t>       surface title
      (also: --session, --session-title, --agent, --new-session)
  showcase diff <file|-> [options]        publish a diff surface from a patch
      --title <t>       surface title
      --layout <mode>   "unified" (default) or "split"
      (also: --session, --session-title, --agent, --new-session)
  showcase markdown <file|-> [options]    publish a markdown surface (prose)
      --title <t>       surface title
  showcase terminal <file|-> [options]    publish terminal output (monospace + ANSI)
      --title <t>       surface title
      --term-title <t>  label shown in the terminal window chrome
      --cols <n>        render width hint, in columns
      (also: --session, --session-title, --agent, --new-session)
  showcase mermaid <file|-> [options]     publish a mermaid surface (diagram → SVG)
      --title <t>       surface title
      (also: --session, --session-title, --agent, --new-session)
  showcase json <file|-> [options]        publish a JSON surface (collapsible tree)
      --title <t>       surface title
      (also: --session, --session-title, --agent, --new-session)
  showcase chart <file|-> [options]       publish a chart surface (native SVG chart)
      --title <t>       surface title
      file holds the chart spec: {chartType,x,y,data[,stacked,xLabel,yLabel,caption]}
      (also: --session, --session-title, --agent, --new-session)
  showcase code <file|-> [options]        publish a code surface (shiki-highlighted)
      --title <t>       surface (card) title
      --filename <f>    filename shown in the code header bar (defaults to the
                        file argument's basename)
      --language <lang>  shiki language id (ts, js, python, ...); inferred from
                        filename if omitted, "text" if uninferrable
      --line-start <n>  1-based line number the excerpt starts at (shows
                        original line numbers instead of 1-based)
      (also: --session, --session-title, --agent, --new-session)
  showcase kits                           list the opt-in html kits this board offers
  showcase update <id> <file|->           revise a surface (new version, same card)
      --title <t>       replace title
      --kit <id>        opt the html part into a kit (repeatable)
  showcase delete <id>                    delete a surface (the card + all its
                                          versions) — for cleaning up while
                                          iterating; prefer update to revise
  showcase wait [options]                 block until the user comments (long-poll)
      --session <id>    session to watch (default: auto)
      --timeout <sec>   max seconds to wait (default 120)
      --after <seq>     re-read comments after this cursor (default: where the
                        agent left off, tracked server-side across CLI/MCP)
  showcase watch [options]                stream user comments forever, one per
                                          line (re-arms the long-poll; for a
                                          background monitor)
      --session <id>    session to watch (default: auto, waits for the first
                        publish to create one)
      --after <seq>     re-read comments after this cursor on the first poll
                        (default: resume where the agent left off, server-side)
  showcase comment <text> [options]       reply to the user (surface or session-level)
      --surface <id>    reply under a surface's thread
      --session <id>    reply in the session-level "Chat with your agent" (default: active session)
      --author <name>   defaults to agent name
  showcase list [--session <id>|--all]    list surfaces
  showcase sessions                       list sessions
  showcase chat [--print]                 launch Claude Code already armed to chat in the browser
      --print           print the arming prompt instead of launching (paste into any agent)
  showcase demo                           seed two example sessions to explore the viewer
  showcase guide                          print the design contract for surfaces
  showcase setup                          print the AGENTS.md integration block
  showcase export <session> [--out f]     write a self-contained, shareable .html of a session
      --pdf             render that HTML to a flat PDF via headless Chrome (set SHOWCASE_CHROME to override)
  showcase decisions <session> <file|->   publish a decision-queue review (JSON) for a session
                                          view it at <url>/?review=<session>
  showcase playbook                       print the agent publishing playbook
  showcase mcp                            run the stdio MCP server (for agent configs)

environment:
  SHOWCASE_URL      server base URL (default http://localhost:8229; set to a
                    deployed instance, e.g. https://showcase.example.com)
  SHOWCASE_TOKEN    bearer token for a deployed instance
  SHOWCASE_SESSION  fixed session id (overrides auto-detection)
  SHOWCASE_AGENT    agent name used when creating sessions
`;

function fail(msg) {
  console.error(`showcase: ${msg}`);
  process.exit(1);
}

// Locate a Chrome/Chromium binary for `export --pdf` (it renders the export HTML
// headlessly and prints to PDF). $SHOWCASE_CHROME wins; otherwise probe the usual
// install paths per platform, then PATH for a bare command name. Returns null if
// none is found — the caller turns that into a clear, actionable error.
function findChrome() {
  if (process.env.SHOWCASE_CHROME) return process.env.SHOWCASE_CHROME;
  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : process.platform === "win32"
        ? [
            join(
              process.env.PROGRAMFILES ?? "C:/Program Files",
              "Google/Chrome/Application/chrome.exe",
            ),
            join(
              process.env["PROGRAMFILES(X86)"] ?? "C:/Program Files (x86)",
              "Google/Chrome/Application/chrome.exe",
            ),
          ]
        : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  for (const c of candidates) {
    if (c.includes("/") || c.includes("\\")) {
      if (existsSync(c)) return c;
    } else {
      try {
        const found = execFileSync(process.platform === "win32" ? "where" : "which", [c], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        })
          .trim()
          .split("\n")[0];
        if (found) return found;
      } catch {}
    }
  }
  return null;
}

async function api(path, init = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    fail(`server not reachable at ${BASE} — start it with: showcase serve`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

// Session state is keyed by (agent process pid, cwd). Many agents spawn a
// fresh shell per command, so the immediate parent is unstable — walk up the
// process tree past shells to the agent process itself. Falls back to
// cwd-only keying where `ps` is unavailable.
const SHELLS = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh"]);

function getParentPosix(pid) {
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

function agentPidWindows(startPid) {
  // wmic is removed in Windows 11. Walk the process tree in a single
  // PowerShell call to avoid repeated startup overhead (~300ms per spawn).
  // $procId, not $pid: $PID is a PowerShell automatic variable holding the
  // host process's own id, and reassigning it is confusing at best.
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

function agentPid() {
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

function stateFile() {
  const dir = join(tmpdir(), `showcase-${userInfo().username}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash("sha1")
    .update(`${agentPid()}:${process.cwd()}`)
    .digest("hex")
    .slice(0, 12);
  return join(dir, `${key}.json`);
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(patch) {
  const next = { ...readState(), ...patch };
  writeFileSync(stateFile(), JSON.stringify(next));
  return next;
}

function agentName(flags) {
  return flags.agent ?? process.env.SHOWCASE_AGENT ?? readState().agent ?? "agent";
}

async function resolveSession(flags, { create = false } = {}) {
  if (flags.session) return flags.session;
  if (process.env.SHOWCASE_SESSION) return process.env.SHOWCASE_SESSION;
  const state = readState();
  if (state.session && !flags["new-session"]) {
    const ok = await fetch(`${BASE}/api/sessions/${state.session}/surfaces`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    }).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return state.session;
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
// `agentPid()` can hash to a different key. Fall back to asking the server for
// the most recently active session whose cwd matches ours. Uses raw fetch (not
// `api()`) so a transient failure returns null instead of exiting the process.
async function resolveSessionByCwd(cwd = process.cwd()) {
  try {
    const res = await fetch(`${BASE}/api/sessions`, {
      headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
    });
    if (!res.ok) return null;
    const sessions = await res.json();
    return (
      sessions
        .filter((s) => s.cwd === cwd)
        .sort((a, b) => String(b.lastActiveAt).localeCompare(String(a.lastActiveAt)))[0]?.id ?? null
    );
  } catch {
    return null;
  }
}

function readContent(arg) {
  if (!arg || arg === "-") {
    try {
      return readFileSync(0, "utf8");
    } catch {
      fail("no input — pass a file path or pipe HTML on stdin");
    }
  }
  try {
    return readFileSync(arg, "utf8");
  } catch {
    fail(`cannot read file: ${arg}`);
  }
}

function out(value) {
  console.log(JSON.stringify(value, null, 2));
}

function outSurface(surface) {
  out({ ...surface, url: `${BASE}/session/${surface.sessionId}/s/${surface.id}` });
}

// Options shared by every publish-family command: card title plus the session
// controls publishSurface/resolveSession read. Individual commands spread this
// and add their own part-specific flags.
const PUBLISH_OPTS = {
  title: { type: "string" },
  session: { type: "string" },
  "session-title": { type: "string" },
  agent: { type: "string" },
  "new-session": { type: "boolean" },
};

const CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  json: "application/json",
  jsonl: "application/x-ndjson",
  ndjson: "application/x-ndjson",
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
};

function contentTypeFor(file) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// Map a filename extension to a shiki language id. Only common languages —
// shiki knows many more, but this covers the files an agent is likely to
// `showcase code`. Unmapped extensions return undefined (shiki "text").
const LANG_BY_EXT = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  json: "json",
  jsonl: "json",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  dockerfile: "docker",
  makefile: "make",
  lua: "lua",
  r: "r",
  scala: "scala",
  clj: "clojure",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  nim: "nim",
  dart: "dart",
  groovy: "groovy",
  gradle: "groovy",
  vue: "vue",
  svelte: "svelte",
  xml: "xml",
  graphql: "graphql",
  gql: "graphql",
};

function inferLang(file) {
  const base = file.split("/").pop() ?? file;
  if (/^Dockerfile/i.test(base)) return "docker";
  if (/^Makefile/i.test(base)) return "make";
  const ext = base.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext];
}

// Upload raw file bytes to /api/assets. Returns { id, url, contentType, ... }.
async function uploadFile(file, { session, kind } = {}) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch {
    fail(`cannot read file: ${file}`);
  }
  const params = new URLSearchParams();
  params.set("filename", file.split(/[\\/]/).pop() ?? "upload");
  if (session) params.set("session", session);
  if (kind) params.set("kind", kind);
  let res;
  try {
    res = await fetch(`${BASE}/api/assets?${params}`, {
      method: "POST",
      headers: {
        "content-type": contentTypeFor(file),
        ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}),
      },
      body: bytes,
    });
  } catch {
    fail(`server not reachable at ${BASE} — start it with: showcase serve`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) fail(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

// Normalize repeated/comma-joined --kit flags into a deduped id list (or
// undefined). The server allowlists the ids; an unknown one is a clean 400.
function normalizeKits(flag) {
  if (!flag) return undefined;
  const ids = (Array.isArray(flag) ? flag : [flag])
    .flatMap((s) => String(s).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}

async function publishSurface(parts, flags) {
  const session = await resolveSession(flags, { create: true });
  return api("/api/surfaces", {
    method: "POST",
    body: JSON.stringify({
      parts,
      title: flags.title,
      session,
      sessionTitle: flags["session-title"],
    }),
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One comment → one line (one monitor notification). Newlines are collapsed so
// a multi-line comment stays a single notification.
function watchLine(c) {
  const text = String(c.text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const where = c.surfaceId
    ? `on “${c.surfaceTitle ?? "a surface"}” (surface ${c.surfaceId})`
    : "on the session";
  return `showcase comment ${where}: “${text}”`;
}

const [cmd, ...rest] = process.argv.slice(2);

// Subcommand flag parsing. parseArgs is strict, so without this --help (or
// any typo) throws a raw stack trace; instead --help/-h prints usage and
// exits 0, and an unknown option fails with a one-line hint.
function parse(config = {}) {
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      ...config,
      options: { ...config.options, help: { type: "boolean", short: "h" } },
    });
  } catch (err) {
    if (!String(err?.code).startsWith("ERR_PARSE_ARGS")) throw err;
    fail(`${err.message.split(". ")[0]} — run "showcase help"`);
  }
  if (parsed.values.help) {
    console.log(HELP);
    process.exit(0);
  }
  return parsed;
}

// Development checkouts run TypeScript directly (Node strips types), but Node
// refuses to type-strip files under node_modules — installed packages ship
// compiled JS in dist/ (built on prepack) and must use it.
function entrypoint(...parts) {
  const built = join(ROOT, "dist", ...parts).replace(/\.ts$/, ".js");
  return existsSync(built) ? built : join(ROOT, ...parts);
}

// `serve`/`mcp` run the server with the current node binary. When running from
// source (a `.ts` entrypoint, not a built `dist/*.js`), Node strips types only
// on ≥ 22.18 — on an older node (the common nvm v20 default) the spawn dies with
// a cryptic ERR_UNKNOWN_FILE_EXTENSION. Fail fast here with the actual fix.
function ensureNodeCanRun(entry) {
  if (!entry.endsWith(".ts")) return;
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 22 || (major === 22 && minor >= 18)) return;
  fail(
    `running from source needs Node ≥ 22.18 to strip TypeScript (you have ${process.version}).\n` +
      `  Switch with nvm: \`nvm use 22\` (or 24), then re-run —\n` +
      `  or run a one-off with a newer binary: PATH="$(dirname "$(nvm which 22)"):$PATH" showcase serve`,
  );
}

// --- git helpers, for `showcase review` ---

// Run git, returning stdout. `soft` swallows failures (returns "") so callers
// can probe for refs; otherwise a failure exits with a one-line hint.
function git(args, { soft = false } = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    if (soft) return "";
    fail(`git ${args.join(" ")} failed — run inside a git repo with valid refs`);
  }
}

function gitCurrentBranch() {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], { soft: true }).trim();
}

// The base branch to diff a review against: the target of origin/HEAD if set,
// else whichever of main/master exists, else "main".
function gitDefaultBase() {
  const head = git(["symbolic-ref", "refs/remotes/origin/HEAD"], { soft: true }).trim();
  if (head) return head.split("/").pop();
  for (const b of ["main", "master"]) {
    if (git(["rev-parse", "--verify", "--quiet", b], { soft: true }).trim()) return b;
  }
  return "main";
}

const FILE_STATUS = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied" };

// Path heuristics for the review manifest's default priority. The agent owns the
// real call (§7 decision 1) — these only seed a starting point printed in the
// prompt so the agent refines rather than invents. SENSITIVE: paths where a bug
// is expensive (auth, data model, money, migrations, deploy/CI config).
// MECHANICAL: generated/vendored noise that needs a glance, not real eyes.
const SENSITIVE_RE =
  /(^|\/)(auth|login|session|token|secret|password|credential|crypto|cipher|jwt|oauth|permission|acl|payment|billing|charge|money|invoice|migrat|schema)|\.(sql)$|(^|\/)(\.github|Dockerfile|docker-compose|Makefile)|\.(ya?ml|tf)$/i;
const MECHANICAL_RE =
  /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|go\.sum)$|(^|\/)(dist|build|vendor|node_modules|__snapshots__|generated)\/|\.(min\.(js|css)|map|snap|lock)$|\.(svg|png|jpe?g|gif|ico|woff2?)$/i;
const TEST_RE = /(^|\/)(test|tests|spec|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;

function classifyPriority(file) {
  if (MECHANICAL_RE.test(file)) return "mechanical";
  if (SENSITIVE_RE.test(file)) return "sensitive";
  return "logic";
}

// A 0–3 weight from a count, log-scaled so churn doesn't peg everything at 3.
const weight = (n, scale) => Math.max(0, Math.min(3, Math.round(Math.log2(n / scale + 1))));

// Seed a priority-ranked manifest from the diff's churn — one row per file, with
// a default priority (path heuristic) and a one-line "why it matters" note.
function manifestFromChurn(churn) {
  return churn.map((c) => {
    const priority = classifyPriority(c.file);
    const note =
      priority === "sensitive"
        ? "sensitive path — read carefully"
        : priority === "mechanical"
          ? "generated / vendored — glance only"
          : `${c.added + c.removed} lines changed`;
    return { file: c.file, added: c.added, removed: c.removed, priority, note };
  });
}

// Seed a composite risk from the diff (§ P1). size = total churn; surfaceArea =
// files touched; sensitivity = how much sensitive code moved; testDelta = did
// tests move with the logic (untouched logic = riskier, so a HIGH weight means
// "logic changed, tests didn't"). Each 0–3; the band is the rounded average.
function riskFromChurn(churn, manifest) {
  const totalChurn = churn.reduce((s, c) => s + c.added + c.removed, 0);
  const nonMechanical = manifest.filter((m) => m.priority !== "mechanical");
  const sensitiveChurn = manifest
    .filter((m) => m.priority === "sensitive")
    .reduce((s, m) => s + m.added + m.removed, 0);
  const logicFiles = manifest.filter((m) => m.priority === "logic");
  const testFiles = churn.filter((c) => TEST_RE.test(c.file));
  const size = weight(totalChurn, 40);
  const surfaceArea = weight(nonMechanical.length, 2);
  const sensitivity = sensitiveChurn > 0 ? weight(sensitiveChurn, 10) || 1 : 0;
  // Logic changed but no tests moved → the dangerous gap → weight up.
  const testDelta =
    logicFiles.length > 0 && testFiles.length === 0 ? 3 : testFiles.length > 0 ? 1 : 0;
  const avg = (size + surfaceArea + sensitivity * 1.5 + testDelta) / 4.5;
  const band = avg >= 2 ? "high" : avg >= 1 ? "elevated" : "low";
  return { size, surfaceArea, sensitivity, testDelta, band };
}

const commands = {
  async serve() {
    const { values: flags } = parse({
      options: { port: { type: "string" }, open: { type: "boolean" } },
    });
    const port = flags.port ?? process.env.PORT ?? "8229";
    const entry = entrypoint("server", "index.ts");
    ensureNodeCanRun(entry);
    const child = spawn(process.execPath, [entry], {
      stdio: "inherit",
      env: { ...process.env, PORT: port },
    });
    if (flags.open) {
      const url = `http://localhost:${port}`;
      const { opener, openerArgs } =
        process.platform === "darwin"
          ? { opener: "open", openerArgs: [url] }
          : process.platform === "win32"
            ? { opener: "cmd", openerArgs: ["/c", "start", url] }
            : { opener: "xdg-open", openerArgs: [url] };
      setTimeout(() => spawn(opener, openerArgs, { stdio: "ignore" }), 700);
    }
    child.on("exit", (code) => process.exit(code ?? 0));
  },

  async mcp() {
    parse();
    const entry = entrypoint("mcp", "server.ts");
    ensureNodeCanRun(entry);
    const child = spawn(process.execPath, [entry], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
  },

  // Spin up Claude Code already armed for a browser chat: it's launched with a
  // first prompt that enters the wait_for_feedback → reply → wait loop, so you
  // can go straight to the showcase browser tab and start talking. No SDK — this
  // just launches your own Claude Code with an opening instruction.
  async chat() {
    const { values: flags } = parse({ options: { print: { type: "boolean" } } });
    const ARM =
      "You're connected to showcase, a live visual surface I'm watching in my browser. " +
      "Let's chat there: call wait_for_feedback to receive my messages, reply with reply_to_user " +
      "(omit surfaceId to answer in the session-level chat, or pass it to answer under a surface), " +
      "and keep looping — wait → reply → wait — so we have a real back-and-forth until I say we're " +
      "done. Call wait_for_feedback now to start.";
    if (flags.print) {
      console.log(ARM);
      return;
    }
    // stdio inherit → you land in the live Claude Code session. If `claude` isn't
    // on PATH (e.g. you use Cursor), print the prompt to paste instead.
    const child = spawn("claude", [ARM], { stdio: "inherit" });
    child.on("error", (err) => {
      if (err && err.code === "ENOENT") {
        console.error(
          "`claude` is not on your PATH. Start your agent (Claude Code or Cursor) and paste this " +
            "to begin chatting, or run `showcase chat --print` to copy it:\n\n" +
            ARM +
            "\n",
        );
        process.exit(1);
      }
      throw err;
    });
    child.on("exit", (code) => process.exit(code ?? 0));
  },

  async publish() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        ...PUBLISH_OPTS,
        md: { type: "string" },
        mermaid: { type: "string" },
        diff: { type: "string" },
        image: { type: "string" },
        terminal: { type: "string" },
        json: { type: "string" },
        code: { type: "string" },
        kit: { type: "string", multiple: true },
        layout: { type: "string" },
      },
    });
    const htmlPart = { kind: "html", html: readContent(positionals[0]) };
    const kits = normalizeKits(flags.kit);
    if (kits) htmlPart.kits = kits;
    const parts = [htmlPart];
    if (flags.md !== undefined) {
      parts.push({ kind: "markdown", markdown: readContent(flags.md || "-") });
    }
    if (flags.mermaid !== undefined) {
      parts.push({ kind: "mermaid", mermaid: readContent(flags.mermaid || "-") });
    }
    if (flags.diff !== undefined) {
      parts.push({
        kind: "diff",
        patch: readContent(flags.diff || "-"),
        ...(flags.layout === "split" && { layout: "split" }),
      });
    }
    if (flags.terminal !== undefined) {
      parts.push({ kind: "terminal", text: readContent(flags.terminal || "-") });
    }
    if (flags.json !== undefined) {
      const text = readContent(flags.json || "-");
      try {
        parts.push({ kind: "json", data: JSON.parse(text) });
      } catch {
        fail(`--json: invalid JSON${flags.json ? ` in ${flags.json}` : ""}`);
      }
    }
    if (flags.code !== undefined) {
      const codeFile = flags.code || "-";
      const part = { kind: "code", code: readContent(codeFile) };
      const codeLang = codeFile !== "-" ? inferLang(codeFile) : undefined;
      if (codeLang) part.language = codeLang;
      if (codeFile !== "-") part.title = codeFile.split("/").pop() || codeFile;
      parts.push(part);
    }
    // Resolve the session first so the image upload and the surface share it.
    const session = await resolveSession(flags, { create: true });
    if (flags.image !== undefined) {
      const asset = await uploadFile(flags.image, { session, kind: "image" });
      parts.push({ kind: "image", assetId: asset.id });
    }
    outSurface(await publishSurface(parts, { ...flags, session }));
  },

  async upload() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { session: { type: "string" }, kind: { type: "string" } },
    });
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase upload <file> [--kind k] [--session id]");
    const session = flags.session ?? (await resolveSession(flags, { create: true }));
    const asset = await uploadFile(file, { session, kind: flags.kind });
    out(asset);
  },

  // Print the URL a file WILL have once uploaded, derived from its content hash
  // alone — no server call. Lets you write an <img src> (or reference the id)
  // before, or in parallel with, the upload. Matches the server's hashAssetId.
  async "asset-url"() {
    const { positionals } = parse({ allowPositionals: true, options: {} });
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase asset-url <file>");
    const id = createHash("sha256").update(readFileSync(file)).digest("hex");
    out({ id, url: `${BASE}/a/${id}` });
  },

  async image() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS, caption: { type: "string" } },
    });
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase image <file> [--title t]");
    const session = await resolveSession(flags, { create: true });
    const asset = await uploadFile(file, { session, kind: "image" });
    const part = {
      kind: "image",
      assetId: asset.id,
      ...(flags.caption && { caption: flags.caption }),
    };
    outSurface(await publishSurface([part], { ...flags, session }));
  },

  async trace() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS },
    });
    const file = positionals[0];
    if (!file || file === "-") fail("usage: showcase trace <file> [--title t]");
    const session = await resolveSession(flags, { create: true });
    const asset = await uploadFile(file, { session, kind: "trace" });
    outSurface(
      await publishSurface([{ kind: "trace", assetId: asset.id }], {
        ...flags,
        session,
      }),
    );
  },

  async diff() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS, layout: { type: "string" } },
    });
    const parts = [
      {
        kind: "diff",
        patch: readContent(positionals[0]),
        ...(flags.layout === "split" && { layout: "split" }),
      },
    ];
    outSurface(await publishSurface(parts, flags));
  },

  async markdown() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS },
    });
    const parts = [{ kind: "markdown", markdown: readContent(positionals[0]) }];
    outSurface(await publishSurface(parts, flags));
  },

  async terminal() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS, "term-title": { type: "string" }, cols: { type: "string" } },
    });
    const cols = Number(flags.cols);
    const parts = [
      {
        kind: "terminal",
        text: readContent(positionals[0]),
        ...(Number.isFinite(cols) && cols > 0 && { cols: Math.floor(cols) }),
        ...(flags["term-title"] && { title: flags["term-title"] }),
      },
    ];
    outSurface(await publishSurface(parts, flags));
  },

  async mermaid() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS },
    });
    const parts = [{ kind: "mermaid", mermaid: readContent(positionals[0]) }];
    outSurface(await publishSurface(parts, flags));
  },

  async json() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS },
    });
    if (!positionals[0]) fail("usage: showcase json <file|-> [--title t]");
    const text = readContent(positionals[0]);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      fail(`invalid JSON${positionals[0] !== "-" ? ` in ${positionals[0]}` : ""}`);
    }
    const parts = [{ kind: "json", data }];
    outSurface(await publishSurface(parts, flags));
  },
  async chart() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { ...PUBLISH_OPTS },
    });
    if (!positionals[0]) fail("usage: showcase chart <file|-> [--title t]");
    // The file holds the chart spec object ({chartType, x, y, data, ...}); wrap
    // it as a chart part. The server validates the shape (chartType/x/y/data).
    let spec;
    try {
      spec = JSON.parse(readContent(positionals[0]));
    } catch {
      fail(`invalid JSON${positionals[0] !== "-" ? ` in ${positionals[0]}` : ""}`);
    }
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      fail("chart spec must be a JSON object with chartType, x, y, and data");
    }
    const parts = [{ kind: "chart", ...spec }];
    outSurface(await publishSurface(parts, flags));
  },
  async code() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        ...PUBLISH_OPTS,
        filename: { type: "string" },
        language: { type: "string" },
        "line-start": { type: "string" },
      },
    });
    if (!positionals[0])
      fail(
        "usage: showcase code <file|-> [--title t] [--filename f] [--language lang] [--line-start n]",
      );
    const code = readContent(positionals[0]);
    const lang = flags.language ?? (positionals[0] !== "-" ? inferLang(positionals[0]) : undefined);
    const part = { kind: "code", code };
    if (lang) part.language = lang;
    const ls = Number(flags["line-start"]);
    if (Number.isFinite(ls) && ls >= 1) part.lineStart = Math.floor(ls);
    // The part's title (filename) shows inside the code surface's header bar.
    // Default to the basename of the file argument; --filename overrides; use
    // --title for the surface (card) title instead.
    const filename =
      flags.filename ??
      (positionals[0] !== "-" ? positionals[0].split("/").pop() || positionals[0] : undefined);
    if (filename) part.title = filename;
    outSurface(await publishSurface([part], flags));
  },
  async update() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { title: { type: "string" }, kit: { type: "string", multiple: true } },
    });
    const id = positionals[0];
    if (!id) fail("usage: showcase update <id> <file|->");
    const part = { kind: "html", html: readContent(positionals[1]) };
    const kits = normalizeKits(flags.kit);
    if (kits) part.kits = kits;
    outSurface(
      await api(`/api/surfaces/${id}`, {
        method: "PUT",
        body: JSON.stringify({ parts: [part], title: flags.title }),
      }),
    );
  },

  async delete() {
    const { positionals } = parse({ allowPositionals: true });
    const id = positionals[0];
    if (!id) fail("usage: showcase delete <id>");
    out(await api(`/api/surfaces/${id}`, { method: "DELETE" }));
  },

  async wait() {
    const { values: flags } = parse({
      options: {
        session: { type: "string" },
        timeout: { type: "string" },
        after: { type: "string" },
      },
    });
    const session = await resolveSession(flags);
    if (!session) fail("no active session — publish something first, or pass --session");
    if (flags.after !== undefined && !/^\d+$/.test(flags.after)) {
      fail(`--after must be a number (got "${flags.after}")`);
    }
    const timeout = Math.max(1, Number(flags.timeout ?? 120));
    const deadline = Date.now() + timeout * 1000;
    // No client-side cursor: without --after, the server resumes from the
    // session's agent cursor, shared with piggyback and MCP delivery.
    let cursor = flags.after;
    let result = { comments: [] };
    while (Date.now() < deadline && result.comments.length === 0) {
      const chunk = Math.min(60, Math.ceil((deadline - Date.now()) / 1000));
      const afterParam = cursor === undefined ? "" : `&after=${cursor}`;
      result = await api(`/api/comments?session=${session}&author=user${afterParam}&wait=${chunk}`);
      cursor = result.lastSeq;
    }
    out(
      result.comments.length > 0
        ? { comments: result.comments }
        : {
            comments: [],
            timedOut: true,
            hint: "no user feedback yet — run wait again or continue",
          },
    );
  },

  async watch() {
    const { values: flags } = parse({
      options: {
        session: { type: "string" },
        after: { type: "string" },
      },
    });
    if (flags.after !== undefined && !/^\d+$/.test(flags.after)) {
      fail(`--after must be a number (got "${flags.after}")`);
    }
    // A continuous long-poll that streams each new user comment as one line —
    // one line is one Claude Code monitor notification. It re-arms forever and
    // never exits on its own; a transient network error backs off and retries
    // rather than failing (unlike `api()`, which would exit the process).
    //
    // After the first poll it carries no client cursor: reading with
    // author=user resumes from the session's server-side agent cursor and
    // advances it, so a comment is delivered exactly once across watch, wait,
    // and piggyback. Honoring a local cursor here would re-deliver anything a
    // piggybacked write had already consumed.
    let firstAfter = flags.after;
    for (;;) {
      const session = (await resolveSession(flags)) ?? (await resolveSessionByCwd());
      if (!session) {
        // No session yet — the agent hasn't published. Wait and retry.
        await sleep(2000);
        continue;
      }
      let result;
      try {
        const afterParam = firstAfter === undefined ? "" : `&after=${firstAfter}`;
        const res = await fetch(
          `${BASE}/api/comments?session=${session}&author=user${afterParam}&wait=60`,
          { headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {} },
        );
        if (!res.ok) {
          await sleep(2000);
          continue;
        }
        result = await res.json();
      } catch {
        await sleep(2000);
        continue;
      }
      firstAfter = undefined;
      for (const c of result.comments ?? []) {
        console.log(watchLine(c));
      }
    }
  },

  async comment() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        surface: { type: "string" },
        snippet: { type: "string" }, // legacy alias
        session: { type: "string" },
        author: { type: "string" },
        agent: { type: "string" },
      },
    });
    const text = positionals.join(" ").trim();
    if (!text) fail("usage: showcase comment <text> --surface <id> | --session <id>");
    // Reply under a surface, or session-level (the "Chat with your agent" panel)
    // when only --session is given. Falls back to the active session.
    const surface = flags.surface ?? flags.snippet;
    const session = surface ? undefined : (flags.session ?? (await resolveSession(flags)));
    if (!surface && !session) {
      fail("a comment must target a surface (--surface) or a session (--session)");
    }
    out(
      await api("/api/comments", {
        method: "POST",
        body: JSON.stringify({
          text,
          ...(surface ? { surface } : { session }),
          author: flags.author ?? agentName(flags),
        }),
      }),
    );
  },

  async list() {
    const { values: flags } = parse({
      options: { session: { type: "string" }, all: { type: "boolean" } },
    });
    if (flags.all) {
      const sessions = await api("/api/sessions");
      const result = [];
      for (const s of sessions) {
        result.push({ ...s, surfaces: await api(`/api/sessions/${s.id}/surfaces`) });
      }
      return out(result);
    }
    const session = flags.session ?? (await resolveSession(flags));
    if (!session) fail("no active session — pass --session or --all");
    out(await api(`/api/sessions/${session}/surfaces`));
  },

  async sessions() {
    parse();
    out(await api("/api/sessions"));
  },

  // List the opt-in html kits this board offers (id, label, summary, classes).
  // Pair with `publish --kit <id>` to inject a kit's CSS/JS into an html part.
  async kits() {
    parse();
    out(await api("/api/kits"));
  },

  // Scaffold a review session from a branch's diff: create a "Review: <branch>"
  // session with a verdict-placeholder card (diffstat + file list), so an agent
  // starts from a ready review instead of hand-building it. The ANALYSIS is
  // delegated to the agent's `code-review` skill (which dispatches to any
  // language-specific hygiene skills); showcase only RENDERS the findings. This
  // just sets the stage and prints a ready-to-paste prompt wiring that handoff.
  async review() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: {
        base: { type: "string" },
        title: { type: "string" },
        agent: { type: "string" },
      },
    });
    const branch = positionals[0] || gitCurrentBranch();
    if (!branch) fail("usage: showcase review <branch> [--base <base>] [--title <t>]");
    const base = flags.base || gitDefaultBase();
    const range = `${base}...${branch}`;
    const names = git(["diff", "--name-status", range]).trim();
    if (!names) fail(`no changes for ${range} — check the branch and base`);
    const stat = git(["diff", "--shortstat", range]).trim();

    // Per-file line churn, ready to hand to publish_review's `churn` (it renders
    // a churn-by-file chart). numstat prints "added\tremoved\tfile"; binary files
    // show "-" counts, which become 0 and get dropped by the chart builder.
    const numstat = git(["diff", "--numstat", range], { soft: true }).trim();
    const churn = numstat
      ? numstat
          .split("\n")
          .map((line) => {
            const [added, removed, ...rest] = line.split("\t");
            return {
              file: rest.join(" "),
              added: Number(added) || 0,
              removed: Number(removed) || 0,
            };
          })
          .filter((c) => c.file)
      : [];

    // Seed the overview heuristics from the diff — a priority-ranked manifest +
    // composite risk the agent refines (it owns the real call, §7 decision 1).
    const manifest = manifestFromChurn(churn);
    const risk = riskFromChurn(churn, manifest);

    const rows = names.split("\n").map((line) => {
      const [status, ...pathParts] = line.split("\t");
      const label = FILE_STATUS[status[0]] ?? status;
      return `| ${label} | \`${pathParts.join(" → ")}\` |`;
    });
    const title = flags.title || `Review: ${branch}`;
    const markdown = [
      `## ${title}`,
      "",
      `Reviewing **\`${branch}\`** against **\`${base}\`**.`,
      stat ? `\n\`${stat}\`` : "",
      "",
      "| Change | File |",
      "| --- | --- |",
      ...rows,
      "",
      "_One **finding card per critical piece** appears below as the agent reviews — each with its diff inline. Approve (👍) or dismiss (⊘) a card once it's addressed._",
    ].join("\n");

    const surface = await api("/api/surfaces", {
      method: "POST",
      body: JSON.stringify({
        title,
        sessionTitle: title,
        agent: flags.agent ?? process.env.SHOWCASE_AGENT ?? "agent",
        // "In review" is the sentinel publish_review looks for to reuse this card
        // as the verdict (see REVIEW_PLACEHOLDER_LABEL in server/app.ts).
        badge: { tone: "neutral", label: "In review" },
        parts: [{ kind: "markdown", markdown }],
      }),
    });

    // Review profile (optional): the user's standing review conventions + which
    // skills to load. Injected verbatim into the prompt so every review applies
    // their standards and loads their tools. See `showcase review --help`.
    const profilePath =
      process.env.SHOWCASE_REVIEW_PROFILE || join(userInfo().homedir, ".showcase", "review.md");
    let profile = "";
    try {
      if (existsSync(profilePath)) profile = readFileSync(profilePath, "utf8").trim();
    } catch {}

    const prompt = [
      `Do the ANALYSIS by running your \`code-review\` skill on branch ${branch} against ${base}. That skill owns the methodology — depth, criteria, and dispatch to any language-specific hygiene skills for the diff. showcase does NOT define how to review; it only RENDERS what code-review finds. If you have no \`code-review\` skill, fall back to a careful manual review against the same criteria.`,
      profile && `Then apply your review profile (load any skills it names):\n${profile}`,
      `Now take code-review's findings and publish them to showcase with ONE call to the publish_review tool (session ${surface.sessionId}). Call get_design_guide first. This step is FORMATTING, not re-reviewing: map each finding onto the publish_review fields below.`,
      `Group the findings into the PR's CRITICAL PIECES — the entity, the wiring, the test coverage — not file-by-file.`,
      `Call publish_review ONCE. LEAD the overview with: \`intent\` (1–2 sentences on what the PR is trying to do), \`risk\` ({size, surfaceArea, sensitivity, testDelta} each 0–3 + a \`band\` low|elevated|high), a \`budget\` line ("~N min · H files need real eyes · C mechanical"), and a \`manifest\` ([{file, added, removed, priority, note}] — priority sensitive|logic|mechanical). A churn-seeded manifest + risk are in this command's JSON output as a STARTING POINT — refine them from your actual read; you have the semantic context a path regex doesn't.`,
      `Also pass a \`changeMap\` ({nodes, edges}) — the headline visual of the changed pieces and how they interact: one node per changed file/symbol tagged status (new|modified|touched|removed) + kind, and an edge for every interaction ({from, to, label, status?}). Mark each edge's \`status\`: new coupling the PR introduces (green), a call it severs (removed, red), or unchanged context (existing, gray).`,
      `Then a findings[] array. EACH finding REQUIRES \`confidence\` (high|medium|low) and \`coverage\` (what you DID and did NOT check) — the honesty signal; a finding missing either is rejected. Optionally \`verified\` (you ran/reproduced it), \`scope\` (changed-lines|whole-file|codebase), and a \`blastRadius\` ({nodes, edges}) call-graph. For any fix pass \`suggestion:{before,after}\` (the CURRENT and PROPOSED code — rendered as a diff that always shows the change) and put WHY in \`fix\`; use \`patch\` only to show the PR's actual change in context.`,
      `Do NOT write the review as a single markdown surface — that wall of text is the failure mode publish_review replaces. (publish_review automatically turns this session's "In review" placeholder card into the verdict — just call it with session ${surface.sessionId}.)`,
    ]
      .filter(Boolean)
      .join("\n\n");

    out({
      session: surface.sessionId,
      surface: surface.id,
      url: `${BASE}/session/${surface.sessionId}/s/${surface.id}`,
      range,
      files: names.split("\n").length,
      churn,
      manifest,
      risk,
      profile: profile ? profilePath : null,
      prompt,
    });
  },

  // Static export: download a whole session as one self-contained, read-only
  // file (surfaces + comments + assets inlined) you can send anyone — the
  // sanctioned "share a review/explainer" path. Default is a standalone HTML
  // (interactive, no server needed); `--pdf` renders that HTML through headless
  // Chrome to a flat PDF for recipients who'd rather not open an HTML file.
  async export() {
    const { values: flags, positionals } = parse({
      allowPositionals: true,
      options: { out: { type: "string" }, pdf: { type: "boolean" } },
    });
    const session = positionals[0];
    if (!session) fail("usage: showcase export <session> [--out <file>] [--pdf]");
    let res;
    try {
      res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(session)}/export`, {
        headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {},
      });
    } catch {
      fail(`server not reachable at ${BASE} — start it with: showcase serve`);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      fail(body.error ?? `${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const suggested =
      res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ??
      `showcase-${session}.html`;

    if (!flags.pdf) {
      const file = flags.out ?? suggested;
      writeFileSync(file, html);
      return out({ session, file, bytes: html.length, format: "html" });
    }

    // --pdf: print the self-contained HTML with headless Chrome.
    const chrome = findChrome();
    if (!chrome) {
      fail(
        "no Chrome/Chromium found for --pdf — install Chrome or set SHOWCASE_CHROME=/path/to/chrome",
      );
    }
    const file = flags.out ?? suggested.replace(/\.html$/i, ".pdf");
    const dir = mkdtempSync(join(tmpdir(), "showcase-pdf-"));
    const tmpHtml = join(dir, "page.html");
    writeFileSync(tmpHtml, html);
    try {
      execFileSync(
        chrome,
        [
          "--headless",
          "--disable-gpu",
          "--no-pdf-header-footer",
          // Let async rendering (mermaid, the iframe resize bridge) settle before
          // the page is printed, so nothing prints half-laid-out.
          "--virtual-time-budget=8000",
          `--print-to-pdf=${file}`,
          `file://${tmpHtml}`,
        ],
        { stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch (e) {
      fail(`Chrome failed to render the PDF: ${e.message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (!existsSync(file)) fail("Chrome ran but produced no PDF");
    out({ session, file, format: "pdf" });
  },

  // Publish a decision-queue review (the agent-era form factor) for a session
  // from a JSON file (or stdin). The agent normally builds this from its
  // code-review analysis; this command is the plumbing to publish it.
  async decisions() {
    const { positionals } = parse({ allowPositionals: true });
    const session = positionals[0];
    const file = positionals[1];
    if (!session || !file) fail("usage: showcase decisions <session> <file.json|->");
    let body;
    try {
      body = readFileSync(file === "-" ? 0 : file, "utf8");
    } catch (e) {
      fail(`can't read ${file}: ${e.message}`);
    }
    const review = await api(`/api/sessions/${encodeURIComponent(session)}/review`, {
      method: "POST",
      body,
    });
    out({
      session,
      decisions: review.decisions.length,
      url: `${BASE}/?review=${encodeURIComponent(session)}`,
    });
  },

  // Publish ONE structured review finding — showcase composes the multimodal
  // card (severity badge + explanation + inline diff + optional diagram) from
  // the fields. The shell tier's review_finding: call it per finding, not one
  // markdown wall. --patch/--diagram read a file (or - for stdin).
  async finding() {
    const { values: flags } = parse({
      options: {
        severity: { type: "string" },
        title: { type: "string" },
        file: { type: "string" },
        line: { type: "string" },
        problem: { type: "string" },
        confidence: { type: "string" },
        coverage: { type: "string" },
        verified: { type: "boolean" },
        scope: { type: "string" },
        fix: { type: "string" },
        before: { type: "string" },
        after: { type: "string" },
        patch: { type: "string" },
        diagram: { type: "string" },
        session: { type: "string" },
        "session-title": { type: "string" },
        agent: { type: "string" },
      },
    });
    if (!flags.title || !flags.problem || !flags.confidence || !flags.coverage) {
      fail(
        "usage: showcase finding --title <t> --problem <text> --confidence high|medium|low --coverage <what you did/didn't check> [--verified] [--scope changed-lines|whole-file|codebase] [--severity bug|nit|question|praise|note] [--file f] [--line n] [--fix <text>] [--before <file|->] [--after <file|->] [--patch <file|->] [--diagram <file|->]",
      );
    }
    // A before→after suggestion renders as a diff that always shows the change;
    // prefer it over --patch. Each side reads a file (or - for stdin).
    const suggestion =
      flags.before !== undefined || flags.after !== undefined
        ? {
            before: flags.before !== undefined ? readContent(flags.before) : "",
            after: flags.after !== undefined ? readContent(flags.after) : "",
          }
        : undefined;
    const session = flags.session ?? (await resolveSession(flags, { create: true }));
    outSurface(
      await api("/api/findings", {
        method: "POST",
        body: JSON.stringify({
          severity: flags.severity,
          title: flags.title,
          file: flags.file,
          line: flags.line ? Number(flags.line) : undefined,
          problem: flags.problem,
          confidence: flags.confidence,
          coverage: flags.coverage,
          verified: flags.verified || undefined,
          scope: flags.scope,
          fix: flags.fix,
          suggestion,
          patch: flags.patch ? readContent(flags.patch) : undefined,
          diagram: flags.diagram ? readContent(flags.diagram) : undefined,
          session,
          sessionTitle: flags["session-title"],
          agent: flags.agent,
        }),
      }),
    );
  },

  async demo() {
    parse();
    const { DEMO_SESSIONS } = await import("./demoData.js");
    for (const demo of DEMO_SESSIONS) {
      const session = await api("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ agent: demo.agent, title: demo.title }),
      });
      for (const snip of demo.snippets) {
        // A snippet is html sugar (POST /api/snippets); a snippet carrying
        // `parts` is a full multi-part surface (POST /api/surfaces).
        const snippet = snip.parts
          ? await api("/api/surfaces", {
              method: "POST",
              body: JSON.stringify({
                session: session.id,
                title: snip.title,
                parts: snip.parts,
                badge: snip.badge,
              }),
            })
          : await api("/api/snippets", {
              method: "POST",
              body: JSON.stringify({ session: session.id, title: snip.title, html: snip.html }),
            });
        for (const step of snip.followups ?? []) {
          if (step.update) {
            await api(`/api/snippets/${snippet.id}`, {
              method: "PUT",
              body: JSON.stringify(step.update),
            });
          }
          if (step.comment) {
            await api("/api/comments", {
              method: "POST",
              body: JSON.stringify({ snippet: snippet.id, ...step.comment }),
            });
          }
        }
      }
    }
    console.log(`Seeded ${DEMO_SESSIONS.length} demo sessions — open ${BASE} to look around.`);
  },

  async guide() {
    parse();
    console.log(await fetchTextWithFallback("/guide", join(ROOT, "guide", "DESIGN_GUIDE.md")));
  },

  async setup() {
    parse();
    console.log(await fetchTextWithFallback("/setup", join(ROOT, "guide", "AGENT_SETUP.md")));
  },

  async playbook() {
    parse();
    console.log(await fetchTextWithFallback("/playbook", join(ROOT, "guide", "PLAYBOOK.md")));
  },

  // Back-compat alias for the old command name.
  async "agent-howto"() {
    return this.playbook();
  },
};

async function fetchTextWithFallback(path, localFile) {
  try {
    const res = await fetch(`${BASE}${path}`);
    if (res.ok) return await res.text();
  } catch {}
  return readFileSync(localFile, "utf8");
}

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(HELP);
} else if (commands[cmd]) {
  await commands[cmd]();
} else {
  fail(`unknown command "${cmd}" — run "showcase help"`);
}
