#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  FEEDBACK_REPLY_NOTE,
  MCP_INSTRUCTIONS,
  MCP_SERVER_INFO,
  MCP_TOOL_DESCRIPTIONS,
  STDIO_MCP_INPUT_SCHEMAS,
} from "../server/mcpSpec.ts";

// Point at a deployed instance later by setting SHOWCASE_URL.
const API = process.env.SHOWCASE_URL ?? "http://localhost:8229";
const TOKEN = process.env.SHOWCASE_TOKEN;
const AGENT = process.env.SHOWCASE_AGENT ?? "claude-code";

async function api(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers });
  } catch {
    throw new Error(
      `showcase server not reachable at ${API} — ask the user to start it with "showcase serve" or "npm run dev"`,
    );
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${text}`);
  return text;
}

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

// One MCP server process lives as long as one agent conversation, so a
// lazily-created session shared across tool calls maps cleanly onto it.
let sessionId: string | null = process.env.SHOWCASE_SESSION ?? null;

// `title` is used only when this call creates the session — once one exists
// (here or in the viewer, where the user can rename it) it is never retitled.
async function ensureSession(title?: string): Promise<string> {
  if (sessionId) return sessionId;
  const session = JSON.parse(
    await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ agent: AGENT, cwd: process.cwd(), title }),
    }),
  );
  sessionId = session.id as string;
  return sessionId;
}

const server = new McpServer(MCP_SERVER_INFO, { instructions: MCP_INSTRUCTIONS });

server.registerTool(
  "publish_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishSurfaceStdio,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.publishSurface,
  },
  async ({ title, parts, badge, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/surfaces", {
        method: "POST",
        body: JSON.stringify({ title, parts, badge, session }),
      }),
    );
    return text({ ...created, url: `${API}/session/${created.sessionId}/s/${created.id}` });
  },
);

server.registerTool(
  "publish_review",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishReview,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.publishReview,
  },
  async ({
    verdict,
    branch,
    base,
    summary,
    coverage,
    architecture,
    changeMap,
    churn,
    findings,
    sessionTitle,
  }) => {
    const session = await ensureSession(sessionTitle ?? (branch ? `Review: ${branch}` : undefined));
    const result = JSON.parse(
      await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          verdict,
          branch,
          base,
          summary,
          coverage,
          architecture,
          changeMap,
          churn,
          findings,
          session,
        }),
      }),
    );
    return text({ ...result, url: `${API}/session/${result.session}` });
  },
);

server.registerTool(
  "review_finding",
  {
    description: MCP_TOOL_DESCRIPTIONS.reviewFinding,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.reviewFinding,
  },
  async ({
    severity,
    title,
    file,
    line,
    problem,
    fix,
    suggestion,
    patch,
    diagram,
    sessionTitle,
  }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/findings", {
        method: "POST",
        body: JSON.stringify({
          severity,
          title,
          file,
          line,
          problem,
          fix,
          suggestion,
          patch,
          diagram,
          session,
        }),
      }),
    );
    return text({ ...created, url: `${API}/session/${created.sessionId}/s/${created.id}` });
  },
);

server.registerTool(
  "update_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.updateSurface,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.updateSurface,
  },
  async ({ id, parts, title, badge }) => {
    const updated = JSON.parse(
      await api(`/api/surfaces/${id}`, {
        method: "PUT",
        body: JSON.stringify({ parts, title, badge }),
      }),
    );
    return text({ ...updated, url: `${API}/session/${updated.sessionId}/s/${updated.id}` });
  },
);

server.registerTool(
  "publish_snippet",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishSnippet,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.publishSnippet,
  },
  async ({ title, html, kits, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/surfaces", {
        method: "POST",
        body: JSON.stringify({ title, parts: [{ kind: "html", html, kits }], session }),
      }),
    );
    return text({ ...created, url: `${API}/session/${created.sessionId}/s/${created.id}` });
  },
);

server.registerTool(
  "update_snippet",
  {
    description: MCP_TOOL_DESCRIPTIONS.updateSnippet,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.updateSnippet,
  },
  async ({ id, html, title, kits }) => {
    const parts = html === undefined ? undefined : [{ kind: "html", html, kits }];
    const updated = JSON.parse(
      await api(`/api/surfaces/${id}`, { method: "PUT", body: JSON.stringify({ parts, title }) }),
    );
    return text({ ...updated, url: `${API}/session/${updated.sessionId}/s/${updated.id}` });
  },
);

server.registerTool(
  "wait_for_feedback",
  {
    description: MCP_TOOL_DESCRIPTIONS.waitForFeedback,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.waitForFeedback,
  },
  async ({ timeoutSeconds }) => {
    const session = await ensureSession();
    const wait = timeoutSeconds ?? 120;
    // No client-side cursor: the server resumes author=user reads from the
    // session's agent cursor, shared with piggyback delivery.
    const result = JSON.parse(
      await api(`/api/comments?session=${session}&author=user&wait=${wait}`),
    );
    if (result.comments.length === 0) {
      return text({ comments: [], note: "no user feedback yet — continue, or wait again later" });
    }
    return text({
      comments: result.comments.map((c: any) => ({
        surfaceId: c.surfaceId,
        surfaceTitle: c.surfaceTitle,
        text: c.text,
        at: c.createdAt,
      })),
      note: FEEDBACK_REPLY_NOTE,
    });
  },
);

server.registerTool(
  "reply_to_user",
  {
    description: MCP_TOOL_DESCRIPTIONS.replyToUser,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.replyToUser,
  },
  async ({ surfaceId, message }) => {
    // With a surfaceId, reply under that surface's thread; without one, reply in
    // this conversation's session-level chat (where surfaceless messages live).
    const body = surfaceId
      ? { surface: surfaceId, text: message, author: AGENT }
      : { session: await ensureSession(), text: message, author: AGENT };
    const created = JSON.parse(
      await api("/api/comments", { method: "POST", body: JSON.stringify(body) }),
    );
    return text(created);
  },
);

server.registerTool(
  "list_surfaces",
  { description: MCP_TOOL_DESCRIPTIONS.listSurfacesStdio, inputSchema: {} },
  async () => {
    if (!sessionId) return text([]);
    return text(JSON.parse(await api(`/api/sessions/${sessionId}/surfaces`)));
  },
);

server.registerTool(
  "upload_asset",
  {
    description: MCP_TOOL_DESCRIPTIONS.uploadAssetStdio,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.uploadAsset,
  },
  async ({ data, contentType, filename, kind }) => {
    const session = await ensureSession();
    const created = JSON.parse(
      await api("/api/assets", {
        method: "POST",
        body: JSON.stringify({ data, contentType, filename, kind, session }),
      }),
    );
    return text(created);
  },
);

server.registerTool(
  "get_design_guide",
  {
    description: MCP_TOOL_DESCRIPTIONS.getDesignGuide,
    inputSchema: {},
  },
  async () => text(await api("/guide")),
);

await server.connect(new StdioServerTransport());
