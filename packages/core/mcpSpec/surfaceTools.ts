import { z } from "zod";
import { THEME_IDS } from "../themes.ts";
import { d, MCP_PARTS_DESCRIPTION } from "./fieldDocs.ts";
import {
  badgeStdioSchemas,
  MCP_BADGE_JSON_SCHEMA,
  MCP_PARTS_JSON_SCHEMA,
  mcpPartSchema,
} from "./partSchemas.ts";

export const SURFACE_TOOL_DESCRIPTIONS = {
  publishSurfaceHttp:
    "Publish a surface to the user's showcase board. A surface is an ordered list of parts (html, markdown, mermaid, diff, image, trace, chart). Returns the surface id, view URL, and sessionId — pass sessionId as `session` on later calls. On your first publish, pass sessionTitle naming the task. If the result includes userFeedback, those are new comments from the user. Call get_design_guide first if you have not this session.",
  publishSurfaceStdio:
    "Publish a surface to the user's showcase board. A surface is an ordered list of parts (html, markdown, mermaid, diff, image, trace, chart). Returns the surface id and view URL. On your first publish, pass sessionTitle naming the task. If the result includes userFeedback, those are new comments from the user. Call get_design_guide first if you have not this session.",
  updateSurface:
    "Revise a surface in place (same card, new version). Prefer this over publishing a near-duplicate. Pass the full replacement parts array. If the result includes userFeedback, read it.",
  publishSnippet:
    "Publish an HTML snippet — sugar for a surface with one html part. Send a body fragment only. Returns the id, view URL, and sessionId. Pass sessionTitle on first publish. Prefer publish_surface when you want a diff or multiple parts.",
  updateSnippet: "Revise an html snippet in place — sugar for update_surface with one html part.",
  deleteSurface:
    "Delete a surface you published — removes the card and ALL its versions from the board permanently. Use it to clean up while iterating: a stale, duplicate, or superseded card. Prefer update_surface to revise a card in place; reach for this only when the card should disappear entirely. Irreversible. Returns the deleted id and its sessionId.",
  waitForFeedback:
    "Block until the user comments on a surface in this session in their browser (or the timeout passes), coalesced into one batch (delivered once, resuming from where the agent last left off). Comments may carry an `anchor` (a quoted selection, file:line, or step the user attached it to) and an `id` — answer those with the `reply` tool (replyTo: id) so your answer lands in the thread at that spot. Learn-mode telemetry ([checkpoint]/[confused] lines) arrives here too. Use timeoutSeconds 0 for a non-blocking check.",
  reply:
    "Reply to a user's comment ON the board — your text renders in the thread at the comment's anchor (the exact selection/line they pointed at), attributed to you. Pass replyTo (the comment id from wait_for_feedback / userFeedback). Use it for the conversational half of feedback: answering an anchored question, explaining a line, noting that a fix landed. Substantive changes still go through update_surface / update_lesson / publish_decisions; a reply never replaces a revision. Keep replies short — the card is the artifact, the thread is margin notes.",
  listSurfacesHttp:
    "List surfaces (the title index: id, title, part kinds, version) — pass a session id to scope, or omit for all sessions. Use get_surface to read one's full content.",
  listSurfacesStdio:
    "List surfaces in this conversation's session (id, title, part kinds, version). Use get_surface to read one's full content.",
  getSurfaceHttp:
    "Fetch a surface's CURRENT full content by id — every part (html, markdown, diff, chart, …) plus its title, version, badge, theme, and blueprint. THIS is how you read back a surface the user referenced: when they paste a surface ref (e.g. 'showcase surface 7Kq2 \"Auth flow\"') into your terminal, call get_surface with that id to see what's actually on it before you revise it with update_surface. list_surfaces is the index; get_surface is the content.",
  getSurfaceStdio:
    "Fetch a surface's CURRENT full content by id — every part plus title, version, badge, theme, blueprint. When the user pastes a surface ref into your terminal, call this with its id to read what's on it before revising with update_surface.",
  uploadAsset:
    "Upload a binary asset (image, trace file, any file) and get back its id and URL. base64-encode the bytes in `data` (MCP carries no binary). Then reference it: put {kind:'image', assetId} or {kind:'trace', assetId} in a surface's parts, or embed the returned url in an html part (<img src=\"...\">). Pass the same session id you publish with so the asset is grouped and cleaned up with it.",
  uploadAssetStdio:
    "Upload a binary asset (image, trace file, any file) and get back its id and URL. base64-encode the bytes in `data`. Then reference it: put {kind:'image', assetId} or {kind:'trace', assetId} in a surface's parts, or embed the returned url in an html part (<img src=\"...\">). Attached to this conversation's session.",
  getDesignGuide:
    "Fetch the design contract: surface parts, html fragment rules, theme CSS variables, the external-resource policy, and the interactivity bridge. Call once per session before publishing.",
  configureSession:
    "Pin a PRESET (an explainer blueprint + optional theme) to a whole session, so EVERY surface you publish to it comes out in the same structure + look no matter what is asked — a 'design-doc session', a 'product-demo session'. Pass session + blueprint (and/or theme); pass null to clear a field. Returns the pinned preset and its section structure — author each later surface against that structure (tag steps data-section=\"<id>\") for a consistent series. You can also just pass `blueprint` on your first publish_surface to pin it; use this tool to set it up FRONT, before publishing, or to switch a running session's preset. List available presets via GET /api/blueprints or `showcase blueprints`.",
} as const;

export const HTTP_SURFACE_TOOLS = [
  {
    name: "publish_surface",
    description: SURFACE_TOOL_DESCRIPTIONS.publishSurfaceHttp,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: d.title },
        parts: MCP_PARTS_JSON_SCHEMA,
        badge: MCP_BADGE_JSON_SCHEMA,
        theme: { type: "string", enum: THEME_IDS, description: d.theme },
        blueprint: { type: "string", description: d.blueprint },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "parts"],
    },
  },
  {
    name: "update_surface",
    description: SURFACE_TOOL_DESCRIPTIONS.updateSurface,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: d.surfaceId },
        parts: MCP_PARTS_JSON_SCHEMA,
        title: { type: "string", description: d.replacementTitle },
        badge: MCP_BADGE_JSON_SCHEMA,
        theme: { description: d.theme },
        blueprint: { description: d.blueprint },
      },
      required: ["id"],
    },
  },
  {
    name: "publish_snippet",
    description: SURFACE_TOOL_DESCRIPTIONS.publishSnippet,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short human-readable title" },
        html: { type: "string", description: d.html },
        kits: { type: "array", items: { type: "string" }, description: d.partKits },
        theme: { type: "string", enum: THEME_IDS, description: d.theme },
        blueprint: { type: "string", description: d.blueprint },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: "Session name (first publish only)" },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "html"],
    },
  },
  {
    name: "update_snippet",
    description: SURFACE_TOOL_DESCRIPTIONS.updateSnippet,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Surface id" },
        html: { type: "string", description: "Replacement HTML body fragment" },
        kits: { type: "array", items: { type: "string" }, description: d.partKits },
        title: { type: "string", description: d.replacementTitle },
        theme: { description: d.theme },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_surface",
    description: SURFACE_TOOL_DESCRIPTIONS.deleteSurface,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: d.surfaceId },
      },
      required: ["id"],
    },
  },
  {
    name: "wait_for_feedback",
    description: SURFACE_TOOL_DESCRIPTIONS.waitForFeedback,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session id to watch" },
        afterSeq: { type: "number", description: d.afterSeq },
        timeoutSeconds: { type: "number", description: `${d.timeout} (default 60)` },
      },
      required: ["session"],
    },
  },
  {
    name: "reply",
    description: SURFACE_TOOL_DESCRIPTIONS.reply,
    inputSchema: {
      type: "object",
      properties: {
        replyTo: {
          type: "string",
          description: "The comment id being answered (from wait_for_feedback / userFeedback)",
        },
        text: { type: "string", description: "Your reply — short; the card is the artifact" },
        surface: {
          type: "string",
          description: "Surface to comment on when not replying to a specific comment",
        },
        session: { type: "string", description: d.session },
        agent: { type: "string", description: "Author label (default: agent)" },
      },
      required: ["text"],
    },
  },
  {
    name: "list_surfaces",
    description: SURFACE_TOOL_DESCRIPTIONS.listSurfacesHttp,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Optional session id to scope the list" },
      },
    },
  },
  {
    name: "get_surface",
    description: SURFACE_TOOL_DESCRIPTIONS.getSurfaceHttp,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: d.surfaceId },
      },
      required: ["id"],
    },
  },
  {
    name: "upload_asset",
    description: SURFACE_TOOL_DESCRIPTIONS.uploadAsset,
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "string", description: d.assetData },
        contentType: { type: "string", description: d.assetContentType },
        filename: { type: "string", description: d.assetFilename },
        kind: { type: "string", enum: ["image", "trace", "file"], description: d.assetKind },
        session: { type: "string", description: d.assetSession },
      },
      required: ["data", "contentType"],
    },
  },
  {
    name: "configure_session",
    description: SURFACE_TOOL_DESCRIPTIONS.configureSession,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Session id to configure" },
        blueprint: { type: "string", description: d.blueprint },
        theme: { type: "string", description: d.theme },
      },
      required: ["session"],
    },
  },
  {
    name: "get_design_guide",
    description: SURFACE_TOOL_DESCRIPTIONS.getDesignGuide,
    inputSchema: { type: "object", properties: {} },
  },
] as const;

export const STDIO_SURFACE_INPUT_SCHEMAS = {
  publishSurface: {
    title: z.string().describe(d.title),
    parts: z.array(mcpPartSchema).describe(MCP_PARTS_DESCRIPTION),
    badge: badgeStdioSchemas.badge,
    theme: z.string().optional().describe(d.theme),
    blueprint: z.string().optional().describe(d.blueprint),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  updateSurface: {
    id: z.string().describe(d.surfaceId),
    parts: z.array(mcpPartSchema).optional().describe(d.replacementParts),
    title: z.string().optional().describe(d.replacementTitle),
    badge: badgeStdioSchemas.updateBadge,
    theme: z.string().nullable().optional().describe(d.theme),
    blueprint: z.string().nullable().optional().describe(d.blueprint),
  },
  publishSnippet: {
    title: z.string().describe("Short human-readable title shown above the snippet"),
    html: z.string().describe(d.html),
    kits: z.array(z.string()).optional().describe(d.partKits),
    theme: z.string().optional().describe(d.theme),
    blueprint: z.string().optional().describe(d.blueprint),
    sessionTitle: z.string().optional().describe("Session name (first publish only)"),
  },
  updateSnippet: {
    id: z.string().describe("Surface id"),
    html: z.string().optional().describe("Replacement HTML body fragment"),
    kits: z.array(z.string()).optional().describe(d.partKits),
    title: z.string().optional().describe(d.replacementTitle),
    theme: z.string().nullable().optional().describe(d.theme),
  },
  deleteSurface: {
    id: z.string().describe(d.surfaceId),
  },
  configureSession: {
    blueprint: z.string().nullable().optional().describe(d.blueprint),
    theme: z.string().nullable().optional().describe(d.theme),
  },
  waitForFeedback: {
    timeoutSeconds: z
      .number()
      .min(0)
      .max(300)
      .optional()
      .describe(`${d.timeout} (default 120, 0 = check only)`),
  },
  uploadAsset: {
    data: z.string().describe(d.assetData),
    contentType: z.string().describe(d.assetContentType),
    filename: z.string().optional().describe(d.assetFilename),
    kind: z
      .enum(["image", "trace", "file"])
      .optional()
      .describe("Inferred from contentType if omitted"),
  },
  getSurface: {
    id: z.string().describe(d.surfaceId),
  },
  reply: {
    replyTo: z
      .string()
      .optional()
      .describe("The comment id being answered (from wait_for_feedback / userFeedback)"),
    text: z.string().describe("Your reply — short; the card is the artifact"),
    surface: z
      .string()
      .optional()
      .describe("Surface to comment on when not replying to a specific comment"),
  },
} as const;
