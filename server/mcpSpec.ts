import { z } from "zod";
import { KIT_IDS } from "./kits.ts";

export const MCP_SERVER_INFO = { name: "showcase", version: "0.1.0" };

export const MCP_INSTRUCTIONS =
  "showcase is a live visual surface the user watches in a browser. Publish surfaces to illustrate " +
  "concepts, sketch UI ideas, visualize data, or show a code review while you work. A surface is an " +
  "ordered list of parts: an `html` part is markup you write (a body fragment), a `markdown` part is " +
  "prose the viewer renders with consistent typography, a `mermaid` part is diagram source the viewer " +
  "renders to an SVG (flowchart, sequence, ERD, …), a `diff` part is a patch the viewer renders as " +
  "a syntax-highlighted split/unified diff. Combine them — e.g. a markdown rationale above a diff part — " +
  "in one card. publish_surface is the general tool; publish_snippet is " +
  "sugar for a single html part. Call get_design_guide once before your first publish. On your first " +
  'publish, also pass sessionTitle to name the session after the task (e.g. "Auth refactor"). The ' +
  "user can comment in their browser; call wait_for_feedback after publishing something you want a " +
  "reaction to. Any publish/update/reply result may carry a userFeedback array — comments the user " +
  "left since your last call, delivered once. " +
  "CHATTING: the user can talk to you in the browser — under a surface, or in the session-level " +
  '"Chat with your agent" panel. When they want a conversation, hold a real back-and-forth: after ' +
  "each reply, call wait_for_feedback again and keep looping (wait → reply → wait), until they say " +
  "they're done. While you are parked in wait_for_feedback the browser shows a live green " +
  '"Listening" badge, so the user can see you are reachable; when you stop looping it goes idle. ' +
  "Reply with reply_to_user — omit surfaceId to answer in the session-level chat, or pass it to " +
  "answer under a specific surface. " +
  "KEEP THE CONVERSATION IN THE TAB: when a message arrives via wait_for_feedback, or you need to " +
  "ask the user anything while a showcase conversation is going, send it with reply_to_user so it " +
  "appears in the browser tab they are watching — never stop to ask a question in your terminal, " +
  "which they are not looking at. Ask in the tab, then wait_for_feedback for their answer.";

// Rides on every wait_for_feedback delivery (both transports) as an in-context
// reminder, right when the agent is deciding how to respond.
export const FEEDBACK_REPLY_NOTE =
  "These are messages from the user in the showcase browser tab — that's where this conversation is " +
  "happening. To answer, or to ask a clarifying question before continuing, call reply_to_user (it " +
  "shows in the tab); do NOT ask in your terminal — the user is watching the tab, not the terminal. " +
  "Then call wait_for_feedback again to hear back.";

const d = {
  title: "Short human-readable title shown above the card",
  html: "HTML body fragment to render",
  session: "Session id from a previous publish (omit on first)",
  sessionTitle:
    'Session name shown in the sidebar — name the task, e.g. "Auth refactor". Honored only when this publish creates the session.',
  stdioSessionTitle: 'Session name (first publish only), e.g. "Auth refactor"',
  agent: "Your agent name for the session label (first publish only)",
  surfaceId: "Surface id returned by publish_surface",
  replacementTitle: "Replacement title",
  replacementParts: "Replacement parts array",
  badge:
    "Optional status chip shown in the card header — ideal for review finding cards. " +
    '{tone, label}: tone is critical (red, "Bug") | warning (amber, "Nit") | info (blue, ' +
    '"Question") | success (green, "Praise") | neutral (gray); label is one short word. ' +
    "On update_surface, pass null to clear it.",
  timeout: "How long to wait, 0-300",
  afterSeq: "explicit cursor override (default: where the agent left off)",
  replyMessage: "Plain-text reply",
  assetData: "base64-encoded file bytes",
  assetContentType: "MIME type, e.g. image/png, application/json",
  assetFilename: "Original filename (used for downloads)",
  assetKind: "Asset kind (inferred from contentType when omitted)",
  assetSession: "Session id to attach the asset to",
  partHtml: "html part: body fragment (no doctype/html/head/body)",
  partKits: `html part: opt into style/behavior bundles by id (${KIT_IDS.join(
    " | ",
  )}). Each injects extra CSS/JS classes (e.g. 'issues' gives .card/.tree/.badge; 'slides' gives a stepped .deck). Omit for plain html. See get_design_guide.`,
  partMarkdown: "markdown part: prose (headings, lists, tables, code, links); raw HTML is escaped",
  partMermaid:
    "mermaid part: diagram source (flowchart, sequence, ERD, gantt, …), rendered to SVG by the viewer",
  partPatch: "diff part: a unified/git diff string — the preferred, compact form",
  partFiles: "diff part: before/after pairs — heavier (full contents); prefer patch",
  partAssetId: "image/trace part: id returned by upload_asset",
  imageAlt: "image part: alt text",
  imageCaption: "image part: caption shown under the image",
  traceTitle: "trace part: heading above the timeline",
  traceSteps: "trace part: ordered steps rendered as a timeline",
  traceLabel: "one-line summary of the step",
  traceKind: "free tag, e.g. tool|thought|shell",
  traceDetail: "expandable body (output, args, reasoning)",
  traceTs: "ISO timestamp",
  terminalText: "terminal part: raw output (ANSI SGR color escapes are rendered)",
  terminalCols: "terminal part: optional render width in columns",
};

const MCP_PARTS_DESCRIPTION =
  "Ordered parts. html: {kind:'html', html:'<body fragment>', kits?:['issues']} — kits opt the " +
  "part into extra CSS/JS bundles (issues: .card/.tree/.badge/.bar; slides: a stepped .deck with " +
  "controls); omit for plain html. markdown: {kind:'markdown', " +
  "markdown:'## prose'} — for explanations, plans, tradeoff write-ups (styled text, not sandboxed; " +
  "embedded raw HTML is escaped — use an html part for live markup). mermaid: {kind:'mermaid', " +
  "mermaid:'graph TD; A-->B'} — diagram source rendered to SVG (flowchart, sequence, ERD, gantt, …). " +
  "diff: {kind:'diff', " +
  "patch:'<unified/git diff>'} (preferred, compact) or {kind:'diff', files:[{filename, before, " +
  "after}]} (heavier). image: {kind:'image', assetId:'<from upload_asset>', alt?, caption?} — " +
  "renders an uploaded image; you can also embed the asset URL in an html part instead. trace: " +
  "{kind:'trace', steps:[{label, kind?, detail?, ts?}]} renders a step timeline, and/or " +
  "{kind:'trace', assetId} for an uploaded trace file (downloadable). terminal: {kind:'terminal', " +
  "text:'<output>', cols?, title?} renders monospace terminal output (ANSI SGR colors supported; " +
  "cursor-addressing TUIs are not resolved). Optional diff layout " +
  "'unified'|'split'. Combine freely, e.g. [{kind:'html',...},{kind:'image',assetId},{kind:'trace',steps}].";

const MCP_PART_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["html", "markdown", "mermaid", "diff", "image", "trace", "terminal"],
    },
    html: { type: "string", description: d.partHtml },
    kits: { type: "array", items: { type: "string" }, description: d.partKits },
    markdown: { type: "string", description: d.partMarkdown },
    mermaid: { type: "string", description: d.partMermaid },
    patch: { type: "string", description: d.partPatch },
    files: {
      type: "array",
      description: d.partFiles,
      items: {
        type: "object",
        properties: {
          filename: { type: "string" },
          before: { type: "string" },
          after: { type: "string" },
          language: { type: "string" },
        },
        required: ["filename", "before", "after"],
      },
    },
    layout: { type: "string", enum: ["unified", "split"] },
    assetId: { type: "string", description: d.partAssetId },
    alt: { type: "string", description: d.imageAlt },
    caption: { type: "string", description: d.imageCaption },
    title: { type: "string", description: d.traceTitle },
    text: { type: "string", description: d.terminalText },
    cols: { type: "number", description: d.terminalCols },
    steps: {
      type: "array",
      description: d.traceSteps,
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: d.traceLabel },
          kind: { type: "string", description: d.traceKind },
          detail: { type: "string", description: d.traceDetail },
          ts: { type: "string", description: d.traceTs },
        },
        required: ["label"],
      },
    },
  },
  required: ["kind"],
} as const;

const MCP_PARTS_JSON_SCHEMA = {
  type: "array",
  description: MCP_PARTS_DESCRIPTION,
  items: MCP_PART_JSON_SCHEMA,
} as const;

export const MCP_TOOL_DESCRIPTIONS = {
  publishSurfaceHttp:
    "Publish a surface to the user's showcase board. A surface is an ordered list of parts (html, markdown, mermaid, diff, image, trace). Returns the surface id, view URL, and sessionId — pass sessionId as `session` on later calls. On your first publish, pass sessionTitle naming the task. If the result includes userFeedback, those are new comments from the user. Call get_design_guide first if you have not this session.",
  publishSurfaceStdio:
    "Publish a surface to the user's showcase board. A surface is an ordered list of parts (html, markdown, mermaid, diff, image, trace). Returns the surface id and view URL. On your first publish, pass sessionTitle naming the task. If the result includes userFeedback, those are new comments from the user. Call get_design_guide first if you have not this session.",
  updateSurface:
    "Revise a surface in place (same card, new version). Prefer this over publishing a near-duplicate. Pass the full replacement parts array. If the result includes userFeedback, read it.",
  publishSnippet:
    "Publish an HTML snippet — sugar for a surface with one html part. Send a body fragment only. Returns the id, view URL, and sessionId. Pass sessionTitle on first publish. Prefer publish_surface when you want a diff or multiple parts.",
  updateSnippet: "Revise an html snippet in place — sugar for update_surface with one html part.",
  waitForFeedback:
    "Block until the user comments on this session in their browser (or the timeout passes). Returns new comments since the agent last received feedback on any channel (delivered as one batch — the wait coalesces messages the user queues). Use timeoutSeconds 0 for a non-blocking check. The returned comments are the user talking to you in the tab: answer them — and ask any follow-up questions — with reply_to_user, never in the terminal, then wait again.",
  replyToUser:
    "Reply to the user in their browser tab — your voice in showcase. Pass surfaceId to reply under a specific surface's thread; omit it to reply in the session-level chat. Use it to acknowledge feedback, explain a revision, and — crucially — to ask any clarifying question while a showcase conversation is going. Whenever the conversation is happening in showcase, use this instead of pausing for a terminal prompt the user is not watching.",
  listSurfacesHttp: "List surfaces — pass a session id to scope, or omit for all sessions.",
  listSurfacesStdio: "List surfaces in this conversation's session.",
  uploadAsset:
    "Upload a binary asset (image, trace file, any file) and get back its id and URL. base64-encode the bytes in `data` (MCP carries no binary). Then reference it: put {kind:'image', assetId} or {kind:'trace', assetId} in a surface's parts, or embed the returned url in an html part (<img src=\"...\">). Pass the same session id you publish with so the asset is grouped and cleaned up with it.",
  uploadAssetStdio:
    "Upload a binary asset (image, trace file, any file) and get back its id and URL. base64-encode the bytes in `data`. Then reference it: put {kind:'image', assetId} or {kind:'trace', assetId} in a surface's parts, or embed the returned url in an html part (<img src=\"...\">). Attached to this conversation's session.",
  getDesignGuide:
    "Fetch the design contract: surface parts, html fragment rules, theme CSS variables, CDN allowlist, and the interactivity bridge. Call once per session before publishing.",
} as const;

const MCP_BADGE_JSON_SCHEMA = {
  type: "object",
  description: d.badge,
  properties: {
    tone: { type: "string", enum: ["critical", "warning", "info", "success", "neutral"] },
    label: { type: "string" },
  },
  required: ["tone", "label"],
} as const;

export const HTTP_MCP_TOOLS = [
  {
    name: "publish_surface",
    description: MCP_TOOL_DESCRIPTIONS.publishSurfaceHttp,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: d.title },
        parts: MCP_PARTS_JSON_SCHEMA,
        badge: MCP_BADGE_JSON_SCHEMA,
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "parts"],
    },
  },
  {
    name: "update_surface",
    description: MCP_TOOL_DESCRIPTIONS.updateSurface,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: d.surfaceId },
        parts: MCP_PARTS_JSON_SCHEMA,
        title: { type: "string", description: d.replacementTitle },
        badge: MCP_BADGE_JSON_SCHEMA,
      },
      required: ["id"],
    },
  },
  {
    name: "publish_snippet",
    description: MCP_TOOL_DESCRIPTIONS.publishSnippet,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short human-readable title" },
        html: { type: "string", description: d.html },
        kits: { type: "array", items: { type: "string" }, description: d.partKits },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: "Session name (first publish only)" },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "html"],
    },
  },
  {
    name: "update_snippet",
    description: MCP_TOOL_DESCRIPTIONS.updateSnippet,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Surface id" },
        html: { type: "string", description: "Replacement HTML body fragment" },
        kits: { type: "array", items: { type: "string" }, description: d.partKits },
        title: { type: "string", description: d.replacementTitle },
      },
      required: ["id"],
    },
  },
  {
    name: "wait_for_feedback",
    description: MCP_TOOL_DESCRIPTIONS.waitForFeedback,
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
    name: "reply_to_user",
    description: MCP_TOOL_DESCRIPTIONS.replyToUser,
    inputSchema: {
      type: "object",
      properties: {
        surfaceId: {
          type: "string",
          description: "Surface whose thread to reply in (omit to reply session-level)",
        },
        sessionId: {
          type: "string",
          description: "Session to reply in when no surfaceId — the session-level chat",
        },
        message: { type: "string", description: d.replyMessage },
        author: {
          type: "string",
          description:
            'Your agent name (default "agent"; "user" is reserved and coerced to "agent")',
        },
      },
      required: ["message"],
    },
  },
  {
    name: "list_surfaces",
    description: MCP_TOOL_DESCRIPTIONS.listSurfacesHttp,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "Optional session id to scope the list" },
      },
    },
  },
  {
    name: "upload_asset",
    description: MCP_TOOL_DESCRIPTIONS.uploadAsset,
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
    name: "get_design_guide",
    description: MCP_TOOL_DESCRIPTIONS.getDesignGuide,
    inputSchema: { type: "object", properties: {} },
  },
] as const;

const diffFileSchema = z.object({
  filename: z.string(),
  before: z.string(),
  after: z.string(),
  language: z.string().optional(),
});

const traceStepSchema = z.object({
  label: z.string().describe(d.traceLabel),
  kind: z.string().optional().describe(d.traceKind),
  detail: z.string().optional().describe(d.traceDetail),
  ts: z.string().optional().describe(d.traceTs),
});

const mcpPartSchema = z
  .object({
    kind: z.enum(["html", "markdown", "mermaid", "diff", "image", "trace", "terminal"]),
    html: z.string().optional().describe(d.partHtml),
    kits: z.array(z.string()).optional().describe(d.partKits),
    markdown: z.string().optional().describe(d.partMarkdown),
    mermaid: z.string().optional().describe(d.partMermaid),
    patch: z.string().optional().describe(d.partPatch),
    files: z.array(diffFileSchema).optional().describe(d.partFiles),
    layout: z.enum(["unified", "split"]).optional(),
    assetId: z.string().optional().describe(d.partAssetId),
    alt: z.string().optional().describe(d.imageAlt),
    caption: z.string().optional().describe(d.imageCaption),
    title: z.string().optional().describe(d.traceTitle),
    steps: z.array(traceStepSchema).optional().describe(d.traceSteps),
    text: z.string().optional().describe(d.terminalText),
    cols: z.number().optional().describe(d.terminalCols),
  })
  .describe(
    "A surface part: html {kind:'html',html}; markdown {kind:'markdown',markdown} (prose); mermaid " +
      "{kind:'mermaid',mermaid} (diagram source → SVG); diff {kind:'diff',patch}; image " +
      "{kind:'image',assetId} (from upload_asset); trace {kind:'trace',steps} and/or {kind:'trace',assetId}; " +
      "terminal {kind:'terminal',text} (monospace output; ANSI SGR colors rendered)",
  );

const badgeStdioSchemas = {
  badge: z
    .object({
      tone: z.enum(["critical", "warning", "info", "success", "neutral"]),
      label: z.string(),
    })
    .optional()
    .describe(d.badge),
  updateBadge: z
    .object({
      tone: z.enum(["critical", "warning", "info", "success", "neutral"]),
      label: z.string(),
    })
    .nullable()
    .optional()
    .describe(d.badge),
};

export const STDIO_MCP_INPUT_SCHEMAS = {
  publishSurface: {
    title: z.string().describe(d.title),
    parts: z.array(mcpPartSchema).describe(MCP_PARTS_DESCRIPTION),
    badge: badgeStdioSchemas.badge,
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  updateSurface: {
    id: z.string().describe(d.surfaceId),
    parts: z.array(mcpPartSchema).optional().describe(d.replacementParts),
    title: z.string().optional().describe(d.replacementTitle),
    badge: badgeStdioSchemas.updateBadge,
  },
  publishSnippet: {
    title: z.string().describe("Short human-readable title shown above the snippet"),
    html: z.string().describe(d.html),
    kits: z.array(z.string()).optional().describe(d.partKits),
    sessionTitle: z.string().optional().describe("Session name (first publish only)"),
  },
  updateSnippet: {
    id: z.string().describe("Surface id"),
    html: z.string().optional().describe("Replacement HTML body fragment"),
    kits: z.array(z.string()).optional().describe(d.partKits),
    title: z.string().optional().describe(d.replacementTitle),
  },
  waitForFeedback: {
    timeoutSeconds: z
      .number()
      .min(0)
      .max(300)
      .optional()
      .describe(`${d.timeout} (default 120, 0 = check only)`),
  },
  replyToUser: {
    surfaceId: z
      .string()
      .optional()
      .describe("Surface whose thread to reply in (omit to reply session-level)"),
    message: z.string().describe(d.replyMessage),
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
} as const;
