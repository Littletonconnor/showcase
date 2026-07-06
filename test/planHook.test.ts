// The blocking plan-review loop: the ExitPlanMode hook publishes the plan,
// blocks on the board's verdict, and returns it in-band — approve allows the
// tool call, request-changes denies it with the annotation batch. Failure
// posture: anything that can't complete (wrong tool, dead board) exits 0
// with NO output so plan mode falls back to the normal permission flow.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "@showcase/server/app";
import { JsonFileStore } from "@showcase/server/storage";

const CLI = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "cli",
  "bin",
  "showcase.js",
);

function runHook(opts: { env?: Record<string, string>; stdin: string; cwd?: string }) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, "plan-hook"],
      { cwd: opts.cwd, env: { ...process.env, ...opts.env } },
      (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
      },
    );
    child.stdin!.end(opts.stdin);
  });
}

function serveApp() {
  const dir = mkdtempSync(join(tmpdir(), "showcase-plan-"));
  const store = new JsonFileStore(join(dir, "data.json"));
  const app = createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    playbookText: "# playbook",
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      resolve({
        url: `http://localhost:${info.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

const hookPayload = (plan: string) =>
  JSON.stringify({ tool_name: "ExitPlanMode", tool_input: { plan } });

const get = (url: string) => fetch(url).then((r) => r.json() as Promise<any>);
const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<any>);

// Wait for the hook's plan surface to land, then hand it to the reviewer half.
// A generous ceiling: the hook is a freshly spawned type-stripped node process,
// and the full suite runs test files in parallel, so cold-start can take
// several seconds under load.
async function planSurface(base: string): Promise<{ session: any; surface: any }> {
  for (let i = 0; i < 600; i++) {
    const sessions = await get(`${base}/api/sessions`);
    const session = sessions.find((s: any) => s.agent === "plan-review");
    if (session) {
      const surfaces = await get(`${base}/api/sessions/${session.id}/surfaces`);
      if (surfaces.length > 0) return { session, surface: surfaces[0] };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("plan surface never appeared");
}

test("request-changes denies the tool call with the annotation batch", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_OPEN: "1" };
    const running = runHook({ env, stdin: hookPayload("# Add caching\n\nStep 1: cache reads.") });

    const { surface } = await planSurface(server.url);
    // The plan renders as a badged markdown surface.
    assert.equal(surface.badge?.label, "Plan review");
    assert.equal(surface.parts[0].kind, "markdown");

    // An anchored annotation, then the explicit verdict.
    await post(`${server.url}/api/comments`, {
      surface: surface.id,
      text: "what invalidates this cache?",
      author: "user",
      anchor: { partIndex: 0, quote: "cache reads" },
    });
    await post(`${server.url}/api/comments`, {
      surface: surface.id,
      text: "[plan] request-changes",
      author: "user",
    });

    const { code, stdout } = await running;
    assert.equal(code, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, "deny");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /requests changes/);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /"cache reads"/);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /what invalidates this cache\?/);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /ExitPlanMode again/);
  } finally {
    await server.close();
  }
});

test("a second round re-versions the SAME surface, and 'lgtm' approves", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_OPEN: "1" };
    // Round 1: request changes.
    const round1 = runHook({ env, stdin: hookPayload("# Plan v1") });
    const { surface } = await planSurface(server.url);
    await post(`${server.url}/api/comments`, {
      surface: surface.id,
      text: "[plan] request-changes",
      author: "user",
    });
    assert.equal(JSON.parse((await round1).stdout).hookSpecificOutput.permissionDecision, "deny");

    // Round 2: the revised plan updates the same card; a typed "lgtm" approves.
    const round2 = runHook({ env, stdin: hookPayload("# Plan v2 (revised)") });
    let updated: any;
    for (let i = 0; i < 600; i++) {
      updated = await get(`${server.url}/api/surfaces/${surface.id}`);
      if (updated.version === 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(updated.version, 2);
    assert.match(updated.parts[0].markdown, /Plan v2/);

    await post(`${server.url}/api/comments`, { surface: surface.id, text: "lgtm", author: "user" });
    const out = JSON.parse((await round2).stdout);
    assert.equal(out.hookSpecificOutput.permissionDecision, "allow");
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /approved/);
  } finally {
    await server.close();
  }
});

test("a non-ExitPlanMode payload and a dead board both defer silently", async () => {
  const other = await runHook({
    env: { SHOWCASE_URL: "http://localhost:1", SHOWCASE_NO_AUTOSTART: "1" },
    stdin: JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } }),
  });
  assert.equal(other.code, 0);
  assert.equal(other.stdout, "");

  const dead = await runHook({
    env: { SHOWCASE_URL: "http://localhost:1", SHOWCASE_NO_AUTOSTART: "1", SHOWCASE_NO_OPEN: "1" },
    stdin: hookPayload("# A plan"),
  });
  assert.equal(dead.code, 0);
  assert.equal(dead.stdout, "");
});

test("install-plan-hook writes the PreToolUse entry once, idempotently", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "showcase-hookinstall-"));
  const run = () =>
    new Promise<{ code: number; stdout: string }>((resolve) => {
      execFile(
        process.execPath,
        [CLI, "install-plan-hook"],
        { cwd, env: { ...process.env } },
        (err, stdout) => resolve({ code: err ? 1 : 0, stdout }),
      );
    });

  const first = await run();
  assert.equal(first.code, 0);
  const settings = JSON.parse(readFileSync(join(cwd, ".claude", "settings.json"), "utf8"));
  const entry = settings.hooks.PreToolUse.find((e: any) => e.matcher === "ExitPlanMode");
  assert.ok(entry, "PreToolUse entry written");
  assert.match(entry.hooks[0].command, /plan-hook/);
  assert.ok(entry.hooks[0].timeout >= 1800, "hook timeout outlives the review ceiling");

  const second = await run();
  assert.match(second.stdout, /already installed/);
  const again = JSON.parse(readFileSync(join(cwd, ".claude", "settings.json"), "utf8"));
  assert.equal(again.hooks.PreToolUse.filter((e: any) => e.matcher === "ExitPlanMode").length, 1);
});
