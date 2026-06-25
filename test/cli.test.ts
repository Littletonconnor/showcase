import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "../server/app.ts";
import { JsonFileStore } from "../server/storage.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "showcase.js");

function run(...args: string[]) {
  return runWith({}, ...args);
}

// Richer runner: optional cwd (install-hook writes ./.claude), env (point the
// CLI at the test server), and stdin (the hook reads its payload from stdin).
function runWith(
  opts: { cwd?: string; env?: Record<string, string>; stdin?: string },
  ...args: string[]
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: opts.cwd, env: opts.env ? { ...process.env, ...opts.env } : process.env },
      (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
      },
    );
    if (opts.stdin != null) child.stdin!.end(opts.stdin);
  });
}

// A real listening server for the commands that hit the network (the CLI talks
// over fetch, not in-process). Stub viewer so no build is needed.
function serveApp() {
  const dir = mkdtempSync(join(tmpdir(), "showcase-cli-"));
  const store = new JsonFileStore(join(dir, "data.json"));
  const app = createApp({
    store,
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    agentHowtoText: "# agent how-to",
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

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<any>);

// None of these reach the network: --help and option errors resolve in
// parsing, before any request (no server needs to be running).

for (const cmd of [
  "serve",
  "publish",
  "diff",
  "update",
  "wait",
  "watch",
  "comment",
  "list",
  "kits",
]) {
  test(`${cmd} --help prints usage and exits 0`, async () => {
    const { code, stdout, stderr } = await run(cmd, "--help");
    assert.equal(code, 0);
    assert.match(stdout, /usage:/);
    assert.equal(stderr, "");
  });
}

test("-h is a short alias for --help", async () => {
  const { code, stdout } = await run("publish", "-h");
  assert.equal(code, 0);
  assert.match(stdout, /usage:/);
});

test("--help on a flag-less subcommand prints usage instead of running it", async () => {
  // would otherwise seed demo data (or fail reaching the server)
  const { code, stdout } = await run("demo", "--help");
  assert.equal(code, 0);
  assert.match(stdout, /usage:/);
});

test("unknown option fails with a one-line error, not a stack trace", async () => {
  const { code, stdout, stderr } = await run("publish", "--bogus");
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /^showcase: Unknown option '--bogus' — run "showcase help"\n$/);
});

test("missing option value fails with a one-line error, not a stack trace", async () => {
  const { code, stderr } = await run("update", "id123", "--title");
  assert.equal(code, 1);
  assert.match(
    stderr,
    /^showcase: Option '--title <value>' argument missing — run "showcase help"\n$/,
  );
});

test("a non-numeric --after fails fast instead of being silently dropped", async () => {
  const { code, stderr } = await run("watch", "--after", "abc");
  assert.equal(code, 1);
  assert.match(stderr, /--after must be a number/);
});

test("watch streams each new user comment as one line and re-arms", async () => {
  const server = await serveApp();
  try {
    const session = await post(`${server.url}/api/sessions`, { agent: "e2e", title: "Watch" });
    const snippet = await post(`${server.url}/api/snippets`, {
      html: "<p>x</p>",
      title: "Doc",
      session: session.id,
    });

    const child = spawn(process.execPath, [CLI, "watch"], {
      env: { ...process.env, SHOWCASE_URL: server.url, SHOWCASE_SESSION: session.id },
    });
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d));

    // first comment, on a surface — should surface with its title and id
    await post(`${server.url}/api/comments`, {
      surface: snippet.id,
      text: "tighten\nthe spacing",
      author: "user",
    });
    await waitFor(() => stdout.includes("tighten the spacing"));
    assert.match(stdout, /showcase comment on “Doc” \(surface .+\): “tighten the spacing”/);

    // a second comment proves the loop re-armed (not a one-shot)
    await post(`${server.url}/api/comments`, {
      surface: snippet.id,
      text: "and ship it",
      author: "user",
    });
    await waitFor(() => stdout.includes("and ship it"));
    assert.match(stdout, /showcase comment on “Doc” \(surface .+\): “and ship it”/);

    // exactly-once: neither comment is repeated across the re-arming polls
    assert.equal(stdout.match(/tighten the spacing/g)?.length, 1);

    child.kill();
  } finally {
    await server.close();
  }
});

async function waitFor(pred: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("publish --kit puts the (deduped) kit ids on the html part", async () => {
  const server = await serveApp();
  try {
    const dir = mkdtempSync(join(tmpdir(), "showcase-kit-"));
    const file = join(dir, "x.html");
    writeFileSync(file, "<div class=tree></div>");
    const { code, stdout } = await runWith(
      { env: { SHOWCASE_URL: server.url } },
      "publish",
      file,
      "--kit",
      "issues",
      "--kit",
      "slides,issues",
    );
    assert.equal(code, 0);
    const out = JSON.parse(stdout);
    const full = await fetch(`${server.url}/api/surfaces/${out.id}`).then((r) => r.json() as any);
    assert.deepEqual(full.parts[0].kits, ["issues", "slides"]);
  } finally {
    await server.close();
  }
});

test("chart command wraps the spec file as a chart part", async () => {
  const server = await serveApp();
  try {
    const dir = mkdtempSync(join(tmpdir(), "showcase-chart-"));
    const file = join(dir, "spec.json");
    const spec = {
      chartType: "bar",
      x: "pctl",
      y: ["before", "after"],
      data: [{ pctl: "p50", before: 41, after: 12 }],
      yLabel: "ms",
    };
    writeFileSync(file, JSON.stringify(spec));
    const { code, stdout } = await runWith(
      { env: { SHOWCASE_URL: server.url } },
      "chart",
      file,
      "--title",
      "Latency",
    );
    assert.equal(code, 0);
    const out = JSON.parse(stdout);
    const full = await fetch(`${server.url}/api/surfaces/${out.id}`).then((r) => r.json() as any);
    assert.deepEqual(full.parts[0], { kind: "chart", ...spec });
  } finally {
    await server.close();
  }
});

test("chart command rejects a non-object spec with a clear error", async () => {
  const server = await serveApp();
  try {
    const dir = mkdtempSync(join(tmpdir(), "showcase-chart-"));
    const file = join(dir, "spec.json");
    writeFileSync(file, "[1, 2, 3]");
    const { code, stderr } = await runWith({ env: { SHOWCASE_URL: server.url } }, "chart", file);
    assert.notEqual(code, 0);
    assert.match(stderr, /chart spec must be a JSON object/);
  } finally {
    await server.close();
  }
});

test("publish --kit with an unknown id fails with a clear error", async () => {
  const server = await serveApp();
  try {
    const dir = mkdtempSync(join(tmpdir(), "showcase-kit-"));
    const file = join(dir, "x.html");
    writeFileSync(file, "<p>x</p>");
    const { code, stderr } = await runWith(
      { env: { SHOWCASE_URL: server.url } },
      "publish",
      file,
      "--kit",
      "bogus",
    );
    assert.notEqual(code, 0);
    assert.match(stderr, /unknown kit "bogus"/);
  } finally {
    await server.close();
  }
});

test("kits lists the board's available kits", async () => {
  const server = await serveApp();
  try {
    const { code, stdout } = await runWith({ env: { SHOWCASE_URL: server.url } }, "kits");
    assert.equal(code, 0);
    const kits = JSON.parse(stdout);
    assert.ok(kits.some((k: any) => k.id === "issues"));
    assert.ok(kits.some((k: any) => k.id === "slides"));
  } finally {
    await server.close();
  }
});

test("chat --print emits the arming prompt without launching", async () => {
  const { code, stdout, stderr } = await run("chat", "--print");
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /wait_for_feedback/);
  assert.match(stdout, /reply_to_user/);
});

test("comment --session posts a session-level (surfaceless) reply", async () => {
  const server = await serveApp();
  try {
    const session = await post(`${server.url}/api/sessions`, { agent: "claude-code" });
    const { code, stdout } = await runWith(
      { env: { SHOWCASE_URL: server.url } },
      "comment",
      "Here's the session-level plan",
      "--session",
      session.id,
      "--author",
      "claude-code",
    );
    assert.equal(code, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.surfaceId, null);
    assert.equal(out.sessionId, session.id);
    assert.equal(out.author, "claude-code");
  } finally {
    await server.close();
  }
});
