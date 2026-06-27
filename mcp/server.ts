#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  FEEDBACK_REPLY_NOTE,
  MCP_INSTRUCTIONS,
  MCP_PROMPT_DEFS,
  MCP_SERVER_INFO,
  MCP_TOOL_DESCRIPTIONS,
  promptMessages,
  STDIO_MCP_INPUT_SCHEMAS,
  SURFACE_RESOURCE_TEMPLATE,
  SURFACE_RESOURCE_URI,
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
  async ({ title, parts, badge, theme, blueprint, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/surfaces", {
        method: "POST",
        body: JSON.stringify({ title, parts, badge, theme, blueprint, session }),
      }),
    );
    return text({ ...created, url: `${API}/session/${created.sessionId}/s/${created.id}` });
  },
);

server.registerTool(
  "publish_decisions",
  {
    description: MCP_TOOL_DESCRIPTIONS.publishDecisions,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.publishDecisions,
  },
  async ({ brief, verdict, decisions, manifest, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const result = JSON.parse(
      await api(`/api/sessions/${session}/review`, {
        method: "POST",
        body: JSON.stringify({ brief, verdict, decisions, manifest }),
      }),
    );
    return text({ ...result, url: `${API}/?review=${session}` });
  },
);

server.registerTool(
  "update_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.updateSurface,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.updateSurface,
  },
  async ({ id, parts, title, badge, theme, blueprint }) => {
    const updated = JSON.parse(
      await api(`/api/surfaces/${id}`, {
        method: "PUT",
        body: JSON.stringify({ parts, title, badge, theme, blueprint }),
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
  async ({ title, html, kits, theme, blueprint, sessionTitle }) => {
    const session = await ensureSession(sessionTitle);
    const created = JSON.parse(
      await api("/api/surfaces", {
        method: "POST",
        body: JSON.stringify({
          title,
          parts: [{ kind: "html", html, kits }],
          theme,
          blueprint,
          session,
        }),
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
  async ({ id, html, title, kits, theme }) => {
    const parts = html === undefined ? undefined : [{ kind: "html", html, kits }];
    const updated = JSON.parse(
      await api(`/api/surfaces/${id}`, {
        method: "PUT",
        body: JSON.stringify({ parts, title, theme }),
      }),
    );
    return text({ ...updated, url: `${API}/session/${updated.sessionId}/s/${updated.id}` });
  },
);

server.registerTool(
  "delete_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.deleteSurface,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.deleteSurface,
  },
  async ({ id }) => {
    await api(`/api/surfaces/${id}`, { method: "DELETE" });
    return text({ ok: true, id });
  },
);

server.registerTool(
  "configure_session",
  {
    description: MCP_TOOL_DESCRIPTIONS.configureSession,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.configureSession,
  },
  async ({ blueprint, theme }) => {
    const session = await ensureSession();
    const updated = JSON.parse(
      await api(`/api/sessions/${session}`, {
        method: "PATCH",
        body: JSON.stringify({ blueprint, theme }),
      }),
    );
    return text(updated);
  },
);

// Tailored preset tools — typed payloads rendered server-side into a fixed
// layout (postmortem, dashboard, design doc, status, architecture, product demo).
// Each posts its typed body to /api/presets/<preset>; the server renders + pins.
// inputSchema/handler are loosely typed: the per-call generic inference the SDK
// relies on is lost through a wrapper (it collapses the callback arg to `never`),
// so we hand it a plain shape and read args dynamically — the server validates.
function presetTool(name: string, preset: string, description: string, inputSchema: object) {
  const handler = async (args: Record<string, unknown>) => {
    const session = await ensureSession(args.sessionTitle as string | undefined);
    const created = JSON.parse(
      await api(`/api/presets/${preset}`, {
        method: "POST",
        body: JSON.stringify({ ...args, session }),
      }),
    );
    return text({ ...created, url: `${API}/session/${created.sessionId}/s/${created.id}` });
  };
  // The SDK infers the handler arg from inputSchema per call; that inference is
  // lost through this wrapper, so register dynamically.
  (server.registerTool as (n: string, c: object, h: typeof handler) => void)(
    name,
    { description, inputSchema },
    handler,
  );
}

presetTool(
  "publish_postmortem",
  "postmortem",
  MCP_TOOL_DESCRIPTIONS.publishPostmortem,
  STDIO_MCP_INPUT_SCHEMAS.publishPostmortem,
);
presetTool(
  "publish_dashboard",
  "data-viz",
  MCP_TOOL_DESCRIPTIONS.publishDashboard,
  STDIO_MCP_INPUT_SCHEMAS.publishDashboard,
);
presetTool(
  "publish_design_doc",
  "design-doc",
  MCP_TOOL_DESCRIPTIONS.publishDesignDoc,
  STDIO_MCP_INPUT_SCHEMAS.publishDesignDoc,
);
presetTool(
  "publish_status",
  "status",
  MCP_TOOL_DESCRIPTIONS.publishStatus,
  STDIO_MCP_INPUT_SCHEMAS.publishStatus,
);
presetTool(
  "publish_architecture",
  "architecture",
  MCP_TOOL_DESCRIPTIONS.publishArchitecture,
  STDIO_MCP_INPUT_SCHEMAS.publishArchitecture,
);
presetTool(
  "publish_product_demo",
  "product-demo",
  MCP_TOOL_DESCRIPTIONS.publishProductDemo,
  STDIO_MCP_INPUT_SCHEMAS.publishProductDemo,
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
  "list_surfaces",
  { description: MCP_TOOL_DESCRIPTIONS.listSurfacesStdio, inputSchema: {} },
  async () => {
    if (!sessionId) return text([]);
    return text(JSON.parse(await api(`/api/sessions/${sessionId}/surfaces`)));
  },
);

server.registerTool(
  "get_surface",
  {
    description: MCP_TOOL_DESCRIPTIONS.getSurfaceStdio,
    inputSchema: STDIO_MCP_INPUT_SCHEMAS.getSurface,
  },
  async ({ id }) => {
    const surface = JSON.parse(await api(`/api/surfaces/${id}`));
    return text({ ...surface, url: `${API}/session/${surface.sessionId}/s/${surface.id}` });
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

// Resources: published surfaces, browsable/attachable as showcase://surface/<id>.
// `list` is scoped to this conversation's session (the agent's own board); read
// fetches any id's full current content (same JSON the get_surface tool returns).
server.registerResource(
  "surface",
  new ResourceTemplate(SURFACE_RESOURCE_TEMPLATE, {
    list: async () => {
      if (!sessionId) return { resources: [] };
      const surfaces = JSON.parse(await api(`/api/sessions/${sessionId}/surfaces`));
      return {
        resources: surfaces.map((s: any) => ({
          uri: `${SURFACE_RESOURCE_URI}${s.id}`,
          name: s.title,
          mimeType: "application/json",
        })),
      };
    },
  }),
  { title: "showcase surface", description: "A published surface's full current content, by id" },
  async (uri, { id }) => {
    const surface = JSON.parse(await api(`/api/surfaces/${id}`));
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            { ...surface, url: `${API}/session/${surface.sessionId}/s/${surface.id}` },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// Prompts: the flagship recipes (review a PR, build an explainer) as ready-to-run
// templates. The text is shared with the HTTP transport via promptMessages.
for (const def of MCP_PROMPT_DEFS) {
  server.registerPrompt(
    def.name,
    {
      title: def.title,
      description: def.description,
      argsSchema: Object.fromEntries(
        def.arguments.map((a) => [a.name, z.string().optional().describe(a.description)]),
      ),
    },
    (args: Record<string, unknown>) => {
      const built = promptMessages(def.name, args);
      if (!built) throw new Error(`unknown prompt: ${def.name}`);
      return built;
    },
  );
}

await server.connect(new StdioServerTransport());
