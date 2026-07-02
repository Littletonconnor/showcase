import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
  "list",
  "kits",
  "gc",
  "health",
  "validate",
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

test("gc reclaims orphaned assets and board shows the tally", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_AUTOSTART: "1" };
    // Upload an asset referenced by nothing -> an orphan the sweep should drop.
    await fetch(`${server.url}/api/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64"),
        contentType: "image/png",
      }),
    });

    const board = await runWith({ env }, "board");
    assert.equal(board.code, 0);
    assert.match(board.stdout, /1 asset.*orphaned/);

    const dry = await runWith({ env }, "gc", "--dry-run");
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /Would reclaim 1 orphaned asset/);

    // A real sweep deletes, so it refuses non-interactively without --yes.
    const unconfirmed = await runWith({ env }, "gc");
    assert.equal(unconfirmed.code, 1);
    assert.match(unconfirmed.stderr, /refusing without confirmation/);

    const gc = await runWith({ env }, "gc", "--yes");
    assert.equal(gc.code, 0);
    assert.match(gc.stdout, /Reclaimed 1 orphaned asset/);

    // After the sweep the orphan count is gone; a re-run has nothing to delete,
    // so it needs no confirmation and is a no-op.
    const again = await runWith({ env }, "gc");
    assert.equal(again.code, 0);
    assert.match(again.stdout, /Nothing to reclaim/);
  } finally {
    await server.close();
  }
});

test("gc --json emits the structured sweep result", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_AUTOSTART: "1" };
    const { code, stdout } = await runWith({ env }, "gc", "--json");
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.removed, 0);
    assert.ok(result.stats && typeof result.stats.assets.count === "number");
  } finally {
    await server.close();
  }
});

test("delete --dry-run names the surface and leaves it on the board", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_AUTOSTART: "1" };
    const session = await post(`${server.url}/api/sessions`, { agent: "e2e", title: "Del" });
    const surface = await post(`${server.url}/api/snippets`, {
      html: "<p>x</p>",
      title: "Doomed",
      session: session.id,
    });

    const dry = await runWith({ env }, "delete", surface.id, "--dry-run");
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /Would delete surface .*“Doomed”/);

    // Still there — dry-run did not delete.
    const still = await fetch(`${server.url}/api/surfaces/${surface.id}`);
    assert.equal(still.status, 200);
  } finally {
    await server.close();
  }
});

test("delete refuses without --yes non-interactively, deletes with it", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_AUTOSTART: "1" };
    const session = await post(`${server.url}/api/sessions`, { agent: "e2e", title: "Del" });
    const surface = await post(`${server.url}/api/snippets`, {
      html: "<p>x</p>",
      title: "Doomed",
      session: session.id,
    });

    const refused = await runWith({ env }, "delete", surface.id);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /refusing without confirmation/);
    assert.equal((await fetch(`${server.url}/api/surfaces/${surface.id}`)).status, 200);

    const ok = await runWith({ env }, "delete", surface.id, "--yes");
    assert.equal(ok.code, 0);
    assert.match(ok.stdout, /deleted surface/);
    assert.equal((await fetch(`${server.url}/api/surfaces/${surface.id}`)).status, 404);
  } finally {
    await server.close();
  }
});

test("delete on a missing surface fails cleanly before any prompt", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_AUTOSTART: "1" };
    const { code, stderr } = await runWith({ env }, "delete", "nope");
    assert.equal(code, 1);
    assert.match(stderr, /surface not found/);
  } finally {
    await server.close();
  }
});

test("health reports liveness and the board tally", async () => {
  const server = await serveApp();
  try {
    const env = { SHOWCASE_URL: server.url, SHOWCASE_NO_AUTOSTART: "1" };

    const human = await runWith({ env }, "health");
    assert.equal(human.code, 0);
    assert.match(human.stdout, /ok · up /);
    assert.match(human.stdout, /0 sessions/);

    const json = await runWith({ env }, "health", "--json");
    assert.equal(json.code, 0);
    const h = JSON.parse(json.stdout);
    assert.equal(h.status, "ok");
    assert.equal(typeof h.uptimeMs, "number");
    assert.equal(h.lastError, null);
  } finally {
    await server.close();
  }
});

const fullPalette = {
  bg: "#fff",
  panel: "#eee",
  surface: "#fff",
  text: "#111",
  muted: "#666",
  faint: "#999",
  border: "#ddd",
  border2: "#ccc",
  hover: "#f5f5f5",
  info: { bg: "#eef", text: "#33c", border: "#aac" },
  success: { bg: "#efe", text: "#2a2", border: "#9c9" },
  warning: { bg: "#ffd", text: "#960", border: "#ec6" },
  danger: { bg: "#fee", text: "#c33", border: "#eaa" },
};

test("validate reports per-file errors over the config dir and exits non-zero", async () => {
  const server = await serveApp();
  try {
    const cfg = mkdtempSync(join(tmpdir(), "showcase-validate-"));
    mkdirSync(join(cfg, "themes"), { recursive: true });
    mkdirSync(join(cfg, "kits"), { recursive: true });
    writeFileSync(
      join(cfg, "themes", "good.json"),
      JSON.stringify({ id: "acme", label: "Acme", light: fullPalette, dark: fullPalette }),
    );
    // bad color in the light palette
    writeFileSync(
      join(cfg, "themes", "bad.json"),
      JSON.stringify({
        id: "x",
        label: "X",
        light: { ...fullPalette, bg: "blue-ish" },
        dark: fullPalette,
      }),
    );
    writeFileSync(join(cfg, "kits", "broken.json"), "{ not json");

    const env = {
      SHOWCASE_URL: server.url,
      SHOWCASE_NO_AUTOSTART: "1",
      SHOWCASE_CONFIG: cfg,
      SHOWCASE_REPO_CONFIG: cfg, // single combined dir -> deduped, checked once
    };
    const { code, stdout } = await runWith({ env }, "validate");
    assert.equal(code, 1); // any invalid file -> non-zero exit
    assert.match(stdout, /✓ .*good\.json/);
    assert.match(stdout, /✗ .*bad\.json/);
    assert.match(stdout, /light\.bg: must be a CSS color/);
    assert.match(stdout, /invalid JSON/);
    assert.match(stdout, /3 files checked · 1 valid · 2 invalid/);
  } finally {
    await server.close();
  }
});

test("validate on an empty config dir reports nothing to check and exits 0", async () => {
  const server = await serveApp();
  try {
    const cfg = mkdtempSync(join(tmpdir(), "showcase-validate-empty-"));
    const env = {
      SHOWCASE_URL: server.url,
      SHOWCASE_NO_AUTOSTART: "1",
      SHOWCASE_CONFIG: cfg,
      SHOWCASE_REPO_CONFIG: cfg,
    };
    const { code, stdout } = await runWith({ env }, "validate");
    assert.equal(code, 0);
    assert.match(stdout, /No config files found/);
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
      "--json",
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
      "--json",
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
    const { code, stdout } = await runWith({ env: { SHOWCASE_URL: server.url } }, "kits", "--json");
    assert.equal(code, 0);
    const kits = JSON.parse(stdout);
    assert.ok(kits.some((k: any) => k.id === "issues"));
    assert.ok(kits.some((k: any) => k.id === "slides"));
  } finally {
    await server.close();
  }
});

test("publish prints a human summary by default, raw JSON only under --json", async () => {
  const server = await serveApp();
  try {
    const dir = mkdtempSync(join(tmpdir(), "showcase-out-"));
    const file = join(dir, "x.html");
    writeFileSync(file, "<p>hi</p>");

    // default: a human line carrying the deep link + surface id, not JSON
    const human = await runWith({ env: { SHOWCASE_URL: server.url } }, "publish", file);
    assert.equal(human.code, 0);
    assert.match(human.stdout, /published/);
    assert.match(human.stdout, /\/session\/.+\/s\//);
    assert.throws(() => JSON.parse(human.stdout));

    // --json: a parseable surface object with a url
    const json = await runWith({ env: { SHOWCASE_URL: server.url } }, "publish", file, "--json");
    assert.equal(json.code, 0);
    const surface = JSON.parse(json.stdout);
    assert.ok(surface.id && surface.url);
  } finally {
    await server.close();
  }
});

test("an unknown command suggests the closest match", async () => {
  const { code, stderr } = await run("pubish");
  assert.equal(code, 1);
  assert.match(stderr, /unknown command "pubish" — did you mean "publish"\?/);
});

test("a mistyped flag suggests the closest known flag", async () => {
  const { code, stderr } = await run("publish", "--titel", "x");
  assert.equal(code, 1);
  assert.match(stderr, /Unknown option '--titel'\. Did you mean --title\?/);
});

test("completions bash prints a sourceable script with the command names", async () => {
  const { code, stdout } = await run("completions", "bash");
  assert.equal(code, 0);
  assert.match(stdout, /complete -F _showcase showcase/);
  assert.match(stdout, /publish/);
});

test("top-level help groups the commands", async () => {
  const { code, stdout } = await run("help");
  assert.equal(code, 0);
  assert.match(stdout, /publish:/);
  assert.match(stdout, /feedback:/);
  assert.match(stdout, /usage: showcase <command>/);
});

test("update preserves the surface's part kind (markdown stays markdown)", async () => {
  const server = await serveApp();
  try {
    const session = await post(`${server.url}/api/sessions`, { agent: "e2e", title: "Kinds" });
    const surface = await post(`${server.url}/api/surfaces`, {
      session: session.id,
      title: "Notes",
      parts: [{ kind: "markdown", markdown: "# v1" }],
    });

    const dir = mkdtempSync(join(tmpdir(), "showcase-upd-"));
    const file = join(dir, "next.md");
    writeFileSync(file, "# v2 heading");
    const { code } = await runWith(
      { env: { SHOWCASE_URL: server.url } },
      "update",
      surface.id,
      file,
    );
    assert.equal(code, 0);

    const after = await fetch(`${server.url}/api/surfaces/${surface.id}`).then(
      (r) => r.json() as Promise<any>,
    );
    assert.equal(after.version, 2);
    assert.equal(after.parts.length, 1);
    assert.equal(after.parts[0].kind, "markdown");
    assert.equal(after.parts[0].markdown, "# v2 heading");
  } finally {
    await server.close();
  }
});

test("update refuses an asset-backed part instead of rewriting it", async () => {
  const server = await serveApp();
  try {
    const session = await post(`${server.url}/api/sessions`, { agent: "e2e", title: "Img" });
    const asset = await fetch(`${server.url}/api/assets?filename=a.png&session=${session.id}`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([137, 80, 78, 71]),
    }).then((r) => r.json() as Promise<any>);
    const surface = await post(`${server.url}/api/surfaces`, {
      session: session.id,
      parts: [{ kind: "image", assetId: asset.id }],
    });

    const dir = mkdtempSync(join(tmpdir(), "showcase-upd-"));
    const file = join(dir, "next.txt");
    writeFileSync(file, "not an image");
    const { code, stderr } = await runWith(
      { env: { SHOWCASE_URL: server.url } },
      "update",
      surface.id,
      file,
    );
    assert.equal(code, 1);
    assert.match(stderr, /asset-backed/);
  } finally {
    await server.close();
  }
});

test("themes lists the built-in theme ids", async () => {
  const server = await serveApp();
  try {
    const { code, stdout } = await runWith({ env: { SHOWCASE_URL: server.url } }, "themes");
    assert.equal(code, 0);
    assert.match(stdout, /showcase/);
    assert.match(stdout, /ocean/);
  } finally {
    await server.close();
  }
});

test("doctor reports ok against a healthy server and exits 0", async () => {
  const server = await serveApp();
  try {
    const { code, stdout } = await runWith(
      { env: { SHOWCASE_URL: server.url, SHOWCASE_NO_AUTOSTART: "1" } },
      "doctor",
    );
    assert.equal(code, 0);
    assert.match(stdout, /✓ node/);
    assert.match(stdout, /✓ server/);
  } finally {
    await server.close();
  }
});

test("doctor fails with the fix when the server is down", async () => {
  const { code, stdout } = await runWith(
    { env: { SHOWCASE_URL: "http://localhost:1", SHOWCASE_NO_AUTOSTART: "1" } },
    "doctor",
  );
  assert.equal(code, 1);
  assert.match(stdout, /✗ server/);
  assert.match(stdout, /showcase serve/);
});
