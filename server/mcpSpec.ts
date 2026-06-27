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
  "sugar for a single html part. FOR A CODE REVIEW: call publish_decisions ONCE. Do the analysis " +
  "with your `code-review` skill first, then hand over a plain-English `brief` (≤4 sentences, no code " +
  "identifiers — for anyone), a `verdict`, a risk-ranked `decisions[]` array (ONE decision per thing " +
  "that needs a human call — a 5,000-line diff is usually a handful, hardest first), and the REQUIRED " +
  "`manifest` (EVERY changed file, each tagged has-decision/reviewed-no-comment/mechanical-skipped, so " +
  "nothing is hidden). Each decision is fixed structure: call (block|ship|decide), kind, scope, a " +
  "one-sentence assertion, optional impact/details, REQUIRED confidence, an optional pivot, optional " +
  "evidence (surface parts — usually a diff — shown in the synced right pane), and an optional " +
  "`proposal:{before,after}` suggested fix. showcase renders it as a Brief + a scroll-snapped decision " +
  "queue the human adjudicates at /?review=<session>. NEVER write a review as one big markdown surface " +
  "— that wall of text is the failure mode publish_decisions exists to prevent. " +
  "Call get_design_guide once before your first publish. On your first " +
  'publish, also pass sessionTitle to name the session after the task (e.g. "Auth refactor"). ' +
  "REFERENCING A SURFACE: every card shows a copy-to-clipboard card id in its header. The user copies " +
  "that id and mentions it to you in YOUR TERMINAL — that's where the conversation happens. Refer to " +
  "surfaces back to the user by id; list_surfaces fetches one if you need its current content. " +
  "FEEDBACK FROM THE BROWSER: on a review the user adjudicates in the tab — Accept or Disagree on each " +
  "decision (a Disagree threads under it as a comment the agent must defend or concede) — and those " +
  "arrive as user comments. Call wait_for_feedback after publishing a review (or anything you want a " +
  "reaction to) to receive them; any publish/update result may also carry a userFeedback array — " +
  "comments the user left since your last call, delivered once. Act on that feedback in your normal " +
  "terminal loop: make the change, then republish the review with publish_decisions so the board updates.";

// Rides on every wait_for_feedback delivery (both transports) as an in-context
// reminder, right when the agent is deciding how to respond.
export const FEEDBACK_REPLY_NOTE =
  "These are the user's responses from the showcase browser — review adjudications (Accept/Disagree on " +
  "decisions) and comments on the surfaces they're watching. A Disagree threads under a decision and " +
  "must be answered: defend it with evidence or concede and revise. Act on them in your terminal: make " +
  "the change and republish the review with publish_decisions so the board updates, then call " +
  "wait_for_feedback again if you expect more.";

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
  partChartType: "chart part: bar | line | area | pie | treemap | scatter",
  partChartData: "chart part: row-oriented data — an array of objects, one per row/category",
  partChartX: "chart part: the field naming the category (x axis / pie slice label)",
  partChartY: "chart part: the numeric series field, or an array of fields for multiple series",
  partChartStacked: "chart part: stack bars/areas instead of grouping (ignored for line/pie)",
  partChartColors: "chart part: explicit series/slice colors (safe CSS color tokens only)",
  partChartXLabel: "chart part: optional x-axis label",
  partChartYLabel: "chart part: optional y-axis label",

  // publish_decisions — the agent-era review form factor (docs/review-form-factor.md)
  brief:
    "≤4 plain-English sentences, NO code identifiers — explain the PR so a PM/designer/anyone understands what it does, why, whether anything changes for users, and the one catch (if any). This is the one strictly-jargon-free register; the decisions below are technical.",
  decisionVerdict:
    "block | approve | comment — the bottom line (a consequence of the decisions; render it as a chip).",
  decisions:
    "The risk-ranked queue the human adjudicates — ONE decision per thing that needs a human call, hardest/riskiest first (decisions[0] is the lede). Triage the diff into a handful of decisions; the cold/mechanical stuff doesn't get one.",
  decisionId:
    "Optional short, stable ref for this decision (e.g. 'd-auth-refresh'). KEEP IT STABLE across re-publishes — it's the human's copy-paste handle for the decision in chat, the manifest's link target, and what preserves their adjudication when you revise. The server mints one when you omit it; supply your own so it survives revisions.",
  decisionManifest:
    "REQUIRED — the COMPLETE changed-file manifest: EVERY file in the diff, nothing omitted. Each {path, disposition, added, removed, decisionId?, note?}. disposition is has-decision (surfaced as a Decision — set decisionId to that decision's id) | reviewed-no-comment (you read it, nothing to flag) | mechanical-skipped (lockfile/generated/formatting — note why). This is the trust backbone: a file the human can't see they're not seeing destroys trust in the whole review. Every decision must be claimed by at least one has-decision file.",
  decisionCall: "block | ship | decide — your recommendation for this decision.",
  decisionKind:
    "bug | fix | capability | refactor | migration | risk — what kind of decision this is.",
  decisionScope:
    "changed-line | whole-file | codebase — how far the reviewer must look to judge it (a bug in the diff vs. a file inconsistency vs. an architecture conflict).",
  decisionAssertion:
    "One sentence — the conclusion (e.g. 'Token refresh accepts a stale token on a cache hit').",
  decisionImpact: "Why it matters — who hits it, how bad, under what input. Optional.",
  decisionDetails:
    "Optional fuller explanation (markdown) rendered under the assertion/impact: the reasoning behind the call, how the code actually behaves, edge cases, what you traced. The `assertion` stays the one-line headline — put the depth here so a reviewer who wants more than a sentence isn't left guessing. Use it on anything non-obvious, especially block/decide.",
  decisionConfidence:
    "REQUIRED — high | medium | low. How sure you are of this call. This is THE honesty signal the board surfaces, so set it truthfully: drop to medium/low when you couldn't fully verify, rather than claiming high and burying the doubt.",
  decisionPivot:
    "Optional — 'flips to ✅/⛔ if …'. ONLY when there's a real fork (an unverified gap that could change the call, or a load-bearing assumption). Omit on a clean ship — never noise.",
  decisionEvidence:
    "Optional right-pane artifacts for this decision: surface parts (usually a `diff`, plus maybe a `mermaid` control-flow or `code`). Absent → the decision renders full-width.",
  decisionProposal:
    "Optional concrete fix as {before, after, filename?, note?}: `before` is the current (changed) code, `after` is your proposed fix. Renders under the evidence as a 'Suggested fix' diff, so the reviewer sees the change AND the fix side by side. POPULATE IT whenever a concrete fix exists — especially on a block/decide — so a blocked decision shows how to unblock it.",
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
  "cursor-addressing TUIs are not resolved). chart: {kind:'chart', " +
  "chartType:'bar'|'line'|'area'|'pie'|'treemap'|'scatter', data:[{…row}], x:'<categoryField>', " +
  "y:'<numericField>'|['<f1>','<f2>'], stacked?, colors?, xLabel?, yLabel?, caption?} — row-oriented " +
  "numeric data rendered with Recharts (data is an array of objects; x names the category field, y " +
  "the numeric series — one field or several). Optional diff layout " +
  "'unified'|'split'. Combine freely, e.g. [{kind:'html',...},{kind:'image',assetId},{kind:'trace',steps}].";

const MCP_PART_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["html", "markdown", "mermaid", "diff", "image", "trace", "terminal", "chart"],
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
    chartType: {
      type: "string",
      enum: ["bar", "line", "area", "pie", "treemap", "scatter"],
      description: d.partChartType,
    },
    data: { type: "array", items: { type: "object" }, description: d.partChartData },
    x: { type: "string", description: d.partChartX },
    y: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
      description: d.partChartY,
    },
    stacked: { type: "boolean", description: d.partChartStacked },
    colors: { type: "array", items: { type: "string" }, description: d.partChartColors },
    xLabel: { type: "string", description: d.partChartXLabel },
    yLabel: { type: "string", description: d.partChartYLabel },
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
    "Publish a surface to the user's showcase board. A surface is an ordered list of parts (html, markdown, mermaid, diff, image, trace, chart). Returns the surface id, view URL, and sessionId — pass sessionId as `session` on later calls. On your first publish, pass sessionTitle naming the task. If the result includes userFeedback, those are new comments from the user. Call get_design_guide first if you have not this session.",
  publishSurfaceStdio:
    "Publish a surface to the user's showcase board. A surface is an ordered list of parts (html, markdown, mermaid, diff, image, trace, chart). Returns the surface id and view URL. On your first publish, pass sessionTitle naming the task. If the result includes userFeedback, those are new comments from the user. Call get_design_guide first if you have not this session.",
  updateSurface:
    "Revise a surface in place (same card, new version). Prefer this over publishing a near-duplicate. Pass the full replacement parts array. If the result includes userFeedback, read it.",
  publishDecisions:
    "Publish a WHOLE code review in one call — THE way to review a PR on showcase (docs/review-form-factor.md). Review scales with risk, not diff size: do the ANALYSIS with your `code-review` skill first, then this renders it. Pass: a plain-English `brief` (≤4 sentences, NO code identifiers — for a PM/designer/anyone), a `verdict` (block|approve|comment), a risk-ranked `decisions[]` array (ONE decision per thing that needs a human call — a 5,000-line diff is usually a handful, hardest first; decisions[0] is the lede), and the REQUIRED `manifest` (EVERY changed file tagged has-decision|reviewed-no-comment|mechanical-skipped — the trust backbone, so the reviewer can see nothing was hidden). Each decision is fixed structure: call (block|ship|decide), kind, scope, a one-sentence assertion, optional impact/details, REQUIRED confidence (the surfaced honesty signal), an optional pivot ('flips to ✅ if…'), optional evidence (surface parts — usually a diff — in the synced right pane), and an optional `proposal:{before,after}` suggested fix. Keep each decision's `id` STABLE across re-publishes — it's the human's chat handle and what preserves their adjudication when you revise. showcase renders a Brief + a scroll-snapped decision queue the human Accepts/Disagrees. Returns sessionId + the /?review=<session> URL.",
  publishSnippet:
    "Publish an HTML snippet — sugar for a surface with one html part. Send a body fragment only. Returns the id, view URL, and sessionId. Pass sessionTitle on first publish. Prefer publish_surface when you want a diff or multiple parts.",
  updateSnippet: "Revise an html snippet in place — sugar for update_surface with one html part.",
  deleteSurface:
    "Delete a surface you published — removes the card and ALL its versions from the board permanently. Use it to clean up while iterating: a stale, duplicate, or superseded card. Prefer update_surface to revise a card in place; reach for this only when the card should disappear entirely. Irreversible. Returns the deleted id and its sessionId.",
  waitForFeedback:
    "Block until the user adjudicates or comments on this session in their browser (or the timeout passes). On a review the user Accepts/Disagrees decisions; those arrive here as user comments, coalesced into one batch (delivered once, resuming from where the agent last left off). Use timeoutSeconds 0 for a non-blocking check. Act on what comes back in your terminal and republish the review with publish_decisions so the board reflects it.",
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
    name: "publish_decisions",
    description: MCP_TOOL_DESCRIPTIONS.publishDecisions,
    inputSchema: {
      type: "object",
      properties: {
        brief: { type: "string", description: d.brief },
        verdict: {
          type: "string",
          enum: ["block", "approve", "comment"],
          description: d.decisionVerdict,
        },
        decisions: {
          type: "array",
          description: d.decisions,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: d.decisionId },
              call: {
                type: "string",
                enum: ["block", "ship", "decide"],
                description: d.decisionCall,
              },
              kind: { type: "string", description: d.decisionKind },
              scope: {
                type: "string",
                enum: ["changed-line", "whole-file", "codebase"],
                description: d.decisionScope,
              },
              assertion: { type: "string", description: d.decisionAssertion },
              impact: { type: "string", description: d.decisionImpact },
              details: { type: "string", description: d.decisionDetails },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
                description: d.decisionConfidence,
              },
              pivot: { type: "string", description: d.decisionPivot },
              evidence: { ...MCP_PARTS_JSON_SCHEMA, description: d.decisionEvidence },
              proposal: {
                type: "object",
                description: d.decisionProposal,
                properties: {
                  before: { type: "string" },
                  after: { type: "string" },
                  filename: { type: "string" },
                  note: { type: "string" },
                },
                required: ["before", "after"],
              },
            },
            required: ["call", "kind", "scope", "assertion", "confidence"],
          },
        },
        manifest: {
          type: "array",
          description: d.decisionManifest,
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              disposition: {
                type: "string",
                enum: ["has-decision", "reviewed-no-comment", "mechanical-skipped"],
              },
              added: { type: "number" },
              removed: { type: "number" },
              decisionId: { type: "string" },
              note: { type: "string" },
            },
            required: ["path", "disposition"],
          },
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["brief", "decisions", "manifest"],
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
    name: "delete_surface",
    description: MCP_TOOL_DESCRIPTIONS.deleteSurface,
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
  publishDecisions: {
    brief: z.string().describe(d.brief),
    verdict: z.enum(["block", "approve", "comment"]).optional().describe(d.decisionVerdict),
    decisions: z
      .array(
        z.object({
          id: z.string().optional().describe(d.decisionId),
          call: z.enum(["block", "ship", "decide"]).describe(d.decisionCall),
          kind: z.string().describe(d.decisionKind),
          scope: z.enum(["changed-line", "whole-file", "codebase"]).describe(d.decisionScope),
          assertion: z.string().describe(d.decisionAssertion),
          impact: z.string().optional().describe(d.decisionImpact),
          details: z.string().optional().describe(d.decisionDetails),
          confidence: z.enum(["high", "medium", "low"]).describe(d.decisionConfidence),
          pivot: z.string().optional().describe(d.decisionPivot),
          evidence: z.array(mcpPartSchema).optional().describe(d.decisionEvidence),
          proposal: z
            .object({
              before: z.string(),
              after: z.string(),
              filename: z.string().optional(),
              note: z.string().optional(),
            })
            .optional()
            .describe(d.decisionProposal),
        }),
      )
      .describe(d.decisions),
    manifest: z
      .array(
        z.object({
          path: z.string(),
          disposition: z.enum(["has-decision", "reviewed-no-comment", "mechanical-skipped"]),
          added: z.number().optional(),
          removed: z.number().optional(),
          decisionId: z.string().optional(),
          note: z.string().optional(),
        }),
      )
      .describe(d.decisionManifest),
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
  deleteSurface: {
    id: z.string().describe(d.surfaceId),
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
} as const;
