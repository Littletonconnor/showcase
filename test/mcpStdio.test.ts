// The stdio MCP transport, exercised as a real child process speaking
// newline-delimited JSON-RPC against a live test server — the per-tool matrix
// the HTTP transport already has in api.test.ts. Covers the handshake, the
// tool registry, publish→read-back round-trip, SDK-level input validation,
// resources (list/read/templates), prompts, and the feedback loop.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "@showcase/server/app";
import { JsonFileStore } from "@showcase/server/storage";

const MCP_SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "packages",
  "mcp",
  "server.ts",
);

function serveApp() {
  const dir = mkdtempSync(join(tmpdir(), "showcase-mcp-"));
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

// Minimal MCP stdio client: one JSON-RPC message per line, requests matched to
// responses by id. Enough protocol to drive the SDK server; deliberately not
// the SDK client, so the wire shape itself is under test.
class StdioClient {
  private child: ChildProcess;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, (msg: any) => void>();
  stderr = "";

  constructor(env: Record<string, string>) {
    this.child = spawn(process.execPath, [MCP_SERVER], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr!.on("data", (d) => (this.stderr += d));
    this.child.stdout!.on("data", (d) => {
      this.buffer += d;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl);
        this.buffer = this.buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = this.nextId++;
    const timer = setTimeout(() => {
      const resolve = this.pending.get(id);
      if (resolve) {
        this.pending.delete(id);
        resolve({ error: { message: `timeout waiting for ${method}; stderr: ${this.stderr}` } });
      }
    }, 15_000);
    return new Promise((resolve) => {
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown> = {}): void {
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  kill(): void {
    this.child.kill();
  }
}

let server: Awaited<ReturnType<typeof serveApp>>;
let client: StdioClient;

const post = (path: string, body: unknown) =>
  fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json() as Promise<any>);

before(async () => {
  server = await serveApp();
  client = new StdioClient({ SHOWCASE_URL: server.url, SHOWCASE_AGENT: "mcp-test" });
  const init = await client.request("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "0.0.0" },
  });
  assert.equal(init.error, undefined, JSON.stringify(init.error));
  assert.ok(init.result.serverInfo.name.length > 0);
  assert.ok(init.result.capabilities.tools, "advertises tools");
  assert.ok(init.result.capabilities.resources, "advertises resources");
  assert.ok(init.result.capabilities.prompts, "advertises prompts");
  client.notify("notifications/initialized");
});

after(async () => {
  client.kill();
  await server.close();
});

test("tools/list carries the full registry on stdio", async () => {
  const res = await client.request("tools/list");
  const names = res.result.tools.map((t: any) => t.name);
  for (const expected of [
    "publish_surface",
    "publish_decisions",
    "update_surface",
    "publish_snippet",
    "update_snippet",
    "delete_surface",
    "configure_session",
    "publish_postmortem",
    "publish_dashboard",
    "publish_design_doc",
    "publish_status",
    "publish_architecture",
    "publish_product_demo",
    "publish_lesson",
    "update_lesson",
    "get_learner_state",
    "record_attempt",
    "wait_for_feedback",
    "reply",
    "list_surfaces",
    "get_surface",
    "upload_asset",
    "get_design_guide",
  ]) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
});

test("publish_surface → get_surface round-trips parts through the session", async () => {
  const published = await client.request("tools/call", {
    name: "publish_surface",
    arguments: {
      title: "MCP matrix",
      sessionTitle: "stdio matrix",
      parts: [
        { kind: "markdown", markdown: "## from stdio" },
        {
          kind: "chart",
          chartType: "bubble",
          data: [{ label: "app.ts", churn: 10, complexity: 4, loc: 100 }],
          x: "churn",
          y: "complexity",
          z: "loc",
        },
      ],
    },
  });
  assert.equal(published.error, undefined, JSON.stringify(published.error));
  const created = JSON.parse(published.result.content[0].text);
  assert.ok(created.id, "returns the surface id");

  const read = await client.request("tools/call", {
    name: "get_surface",
    arguments: { id: created.id },
  });
  const full = JSON.parse(read.result.content[0].text);
  assert.equal(full.parts.length, 2);
  assert.equal(full.parts[1].chartType, "bubble");
  assert.equal(full.parts[1].z, "loc");
});

test("SDK input validation rejects malformed tool args with -32602", async () => {
  const res = await client.request("tools/call", {
    name: "update_surface",
    // `id` missing entirely — fails the zod schema before any HTTP call.
    arguments: { parts: "not-an-array" },
  });
  // The SDK reports schema failures as an in-band tool error (isError), so a
  // model can read and repair them; the -32602 code rides in the text.
  assert.equal(res.error, undefined);
  assert.ok(res.result.isError, "malformed args must be flagged as a tool error");
  assert.match(res.result.content[0].text, /-32602/);
  assert.match(res.result.content[0].text, /Invalid arguments for tool update_surface/);
});

test("resources: templates advertised, published surface listed and readable", async () => {
  const templates = await client.request("resources/templates/list");
  const uris = templates.result.resourceTemplates.map((t: any) => t.uriTemplate);
  assert.ok(uris.some((u: string) => u.startsWith("showcase://surface/")));
  assert.ok(uris.some((u: string) => u.startsWith("showcase://session/")));
  assert.ok(uris.some((u: string) => u.startsWith("showcase://asset/")));

  const list = await client.request("resources/list");
  const surfaceUri = list.result.resources.find((r: any) =>
    String(r.uri).startsWith("showcase://surface/"),
  )?.uri;
  assert.ok(surfaceUri, "the published surface appears as a resource");

  const read = await client.request("resources/read", { uri: surfaceUri });
  const body = JSON.parse(read.result.contents[0].text);
  assert.equal(body.title, "MCP matrix");
});

test("prompts: flagship recipes are listed and render messages", async () => {
  const list = await client.request("prompts/list");
  const names = list.result.prompts.map((p: any) => p.name);
  assert.ok(names.includes("review_pr"));
  assert.ok(names.includes("explainer"));

  const got = await client.request("prompts/get", { name: "explainer", arguments: {} });
  assert.ok(got.result.messages.length > 0);
  assert.ok(got.result.messages[0].content.text.length > 0);
});

test("wait_for_feedback delivers a user comment exactly once", async () => {
  // The session was created by the publish test; find it over HTTP.
  const sessions = await fetch(`${server.url}/api/sessions`).then((r) => r.json() as Promise<any>);
  const session = sessions.find((s: any) => s.agent === "mcp-test");
  assert.ok(session, "the stdio server created its session");
  const surfaces = await fetch(`${server.url}/api/sessions/${session.id}/surfaces`).then(
    (r) => r.json() as Promise<any>,
  );
  await post("/api/comments", {
    surface: surfaces[0].id,
    text: "make the bubble bigger",
    author: "user",
  });

  const waited = await client.request("tools/call", {
    name: "wait_for_feedback",
    arguments: { timeoutSeconds: 5 },
  });
  assert.match(waited.result.content[0].text, /make the bubble bigger/);

  // Exactly-once: the cursor advanced, a re-wait must not replay it.
  const again = await client.request("tools/call", {
    name: "wait_for_feedback",
    arguments: { timeoutSeconds: 0 },
  });
  assert.doesNotMatch(String(again.result.content[0].text), /make the bubble bigger/);
});
