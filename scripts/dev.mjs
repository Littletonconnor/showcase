#!/usr/bin/env node
// Dev runner for showcase. One command to build the viewer, watch both halves,
// and restart the server on change — with a clean shutdown so no vite/node
// watchers are ever orphaned. (The old `(vite build --watch & node --watch …)`
// shell form leaked the background build on Ctrl-C, which is how stray watcher
// processes pile up and re-bind the port.)
//
//   node scripts/dev.mjs          build once, then watch + auto-restart
//   node scripts/dev.mjs --stop   just free the port (kill a running server) and exit
//
// Plain .mjs (no type stripping) so it runs on any Node; the children it spawns
// are the type-stripped server and the Vite build. PORT honors the env (default
// 8229), matching server/index.ts.
import { spawn, execSync } from "node:child_process";

const PORT = process.env.PORT ?? "8229";

// Kill whatever is listening on PORT — a server left behind by a hard exit, so a
// fresh `dev`/`start` never hits "address already in use". Returns the PIDs it
// signaled; a no-op (empty list) when the port is already free. macOS/Linux via
// lsof, which exits non-zero when nothing is listening.
function freePort() {
  let pids = [];
  try {
    pids = execSync(`lsof -ti tcp:${PORT}`, { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // already gone between lsof and kill — fine
    }
  }
  return pids;
}

if (process.argv.includes("--stop")) {
  const killed = freePort();
  console.log(
    killed.length
      ? `stopped showcase on :${PORT} (pid ${killed.join(", ")})`
      : `nothing listening on :${PORT}`,
  );
  process.exit(0);
}

const swept = freePort();
if (swept.length) console.log(`freed :${PORT} — killed stale pid ${swept.join(", ")}`);

// Initial build so the server has a dist to serve the instant it boots. Vite
// runs inside the viewer package (its config + index.html live there).
const VIEWER = "packages/viewer";
console.log("building viewer…");
execSync("vite build", { stdio: "inherit", cwd: VIEWER });

const children = [];
function run(cmd, args, env, cwd) {
  const child = spawn(cmd, args, { stdio: "inherit", cwd, env: { ...process.env, ...env } });
  children.push(child);
  return child;
}

// Watcher 1 — rebuild the viewer's dist whenever its source changes.
run("vite", ["build", "--watch"], {}, VIEWER);
// Watcher 2 — restart the server when server code OR the freshly-built dist
// changes (so a viewer edit reloads the page content too).
run(
  "node",
  [
    "--watch-path=./packages/server",
    "--watch-path=./packages/viewer/dist",
    "packages/server/index.ts",
  ],
  { SHOWCASE_DEV: "1" },
);

console.log(`\nshowcase dev → http://localhost:${PORT}  (Ctrl-C to stop everything cleanly)\n`);

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill("SIGTERM");
    } catch {
      // child already exited
    }
  }
  // The server may not release the socket the instant it's signaled, so sweep
  // the port once more before exiting — the next `dev` starts on a clean slate.
  setTimeout(() => {
    freePort();
    process.exit(0);
  }, 250);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// If either watcher dies on its own, tear the whole thing down rather than
// limping along with half the loop running.
for (const c of children) c.on("exit", shutdown);
