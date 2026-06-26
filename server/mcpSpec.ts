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
  "sugar for a single html part. FOR A CODE REVIEW: call publish_review ONCE with a verdict, a " +
  "`changeMap` ({nodes, edges} — the headline visual: the changed pieces and how they interact, each " +
  "node tagged new/modified/touched/removed), and a findings[] array. Each " +
  "finding is a fixed structure: severity, the problem, a before→after `suggestion` (the current code " +
  "and your proposed code — showcase renders it as a diff that ALWAYS shows the change), and `fix` " +
  "(why it's better). showcase explodes the call into a verdict card (summary + tally + table + your " +
  "change map) + a card per finding. Pass `suggestion:{before,after}` for every fix — never " +
  "a raw `patch`, which renders empty if it isn't a valid unified diff. NEVER write a review as one " +
  "big markdown surface — that wall of text is the failure mode publish_review exists to prevent. " +
  "Call get_design_guide once before your first publish. On your first " +
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
  findingSeverity:
    "bug | nit | question | praise | note — picks the severity badge (bug→red, nit→amber, question→blue, praise→green, note→gray)",
  findingTitle: "One-line finding/piece title (the issue itself, not the filename)",
  findingFile:
    "File the finding is about — rides the card title (e.g. 'FinancialChatFeedback.java')",
  findingLine: "Line number — rides the title as :N",
  findingProblem: "What's wrong, or what this critical piece does and why it matters — markdown",
  findingFix:
    "WHY the suggested change is better (rationale) when you pass `suggestion`; otherwise a textual fix/follow-up — markdown (optional)",
  findingSuggestion:
    "The concrete fix as a before→after pair {before, after} — the CURRENT code and your PROPOSED code. showcase renders it as a clean inline diff and ALWAYS shows the change (it computes the diff from the two contents). PREFER this over `patch` for any fix you'd suggest.",
  findingPatch:
    "Fallback only: a unified/git diff hunk to show the PR's actual change in context. For a suggested fix, use `suggestion` instead — a raw patch renders empty if it isn't a valid unified diff. Must include `diff --git`/`---`/`+++` headers to render reliably.",
  findingDiagram: "Optional mermaid source visualizing the relevant flow/structure",
  findingConfidence:
    "REQUIRED — high | medium | low. How sure you are this finding is real and the fix is right. The honesty signal: a confident-looking change in an unchecked area is the most dangerous LLM output, so every finding must declare it.",
  findingCoverage:
    "REQUIRED — what you DID and did NOT check for this finding, e.g. 'reproduced with a unit test' / 'did not run the migration' / 'read the caller but not the callees'. Makes the verification gap visible.",
  findingVerified:
    "Optional boolean — true only if you actually ran/reproduced this (a stronger claim than confidence). Renders a ✓ verified marker.",
  findingScope:
    "Optional scope tier this was found at: changed-lines (a bug in the diff), whole-file (an inconsistency with the rest of the file), or codebase (an architectural conflict with code outside the diff). Tells the reviewer how far they must look to judge it.",
  findingBlastRadius:
    "Optional blast radius — a tiny call-graph {nodes, edges} (same shape as the review changeMap) of what calls this / what this calls / which tests cover it. Renders as a styled mini-map under the finding.",
  reviewChangeMap:
    "THE headline review visual: a structured map of what changed and how it interacts. Pass {nodes, edges}. Each node {id, label, status, kind?}: status is new|modified|touched|removed (color-coded green/amber/gray/red — `touched` = existing code the change pulls in but doesn't edit); kind is file|class|function|service|table|external (picks the shape). Each edge {from, to, label?}: from/to are node ids, label is the interaction (calls, reads, persists, installs…). showcase renders a consistently styled graph. Build it from your reading of the diff — show the changed pieces and every interaction between them.",
  reviewChangeNode:
    "A node: {id (unique, referenced by edges), label (the symbol/file name), status (new|modified|touched|removed), kind? (file|class|function|service|table|external)}",
  reviewChangeEdge:
    "An interaction: {from (node id), to (node id), label? (e.g. 'calls', 'persists'), status? (new = coupling the PR introduces → green; removed = a call it severs → red dashed; existing = unchanged context → gray)}. New and severed edges are the coupling changes worth scrutinizing.",
  reviewArchitecture:
    "Escape-hatch raw mermaid for the verdict card when `changeMap` can't express the diagram you want (e.g. a sequence diagram). Prefer `changeMap` for the changed pieces and how they interact; this is only rendered when no `changeMap` is given.",
  reviewChurn:
    "Optional per-file line churn for the verdict card, as [{file, added, removed}] — straight from `git diff --numstat <base>...<branch>`. showcase renders it as a green-added / red-removed bar chart (the shape of the PR), ranked by churn and capped to the top files.",
  reviewIntent:
    "What this PR is TRYING to do, in 1–2 sentences in the agent's own words (intent, not a file list). Leads the overview so the reviewer reads a map before entering the territory.",
  reviewRisk:
    "Composite, AGENT-AUTHORED risk for the overview: {size, surfaceArea, sensitivity, testDelta} each a 0–3 weight, plus a `band` (low|elevated|high). size=total churn, surfaceArea=distinct files/modules/exports touched, sensitivity=are touched paths auth/data-model/migration/money/deletion/config (weight heaviest), testDelta=did tests move with the change (untouched logic = riskier). You have the semantic context a path regex never will — judge it; showcase just renders the band + four sub-bars consistently.",
  reviewBudget:
    "One-line review budget for the overview, e.g. '~8 min · 3 files need real eyes · 9 mechanical'. Tells the reviewer where to spend attention.",
  reviewManifest:
    "Priority-ranked file manifest (replaces the alphabetical list) as [{file, added, removed, priority, note}]. priority is sensitive|logic|mechanical (sensitive first, mechanical collapses into a low-attention bucket); note is a one-line 'why it matters'. added/removed are the file's churn. Order is yours; showcase renders the rows with a priority dot, a churn sparkline, the note, and a reviewed checkbox.",
  reviewVerdict: "request_changes | approve | comment — the verdict badge on the lead card",
  reviewBranch: "Branch under review (shows in the verdict header, e.g. 'cl/ALLM-116')",
  reviewBase: "Base branch the review is against (e.g. 'master')",
  reviewSummary: "One-paragraph verdict summary for the lead card — markdown",
  reviewCoverage: "What you reviewed and deliberately skipped, so the user can trust the depth",
  reviewFindings:
    "The findings, each its own card. Per finding: severity, title, file/line, problem, a before→after `suggestion` for the fix (preferred over `patch`), `fix` (why it's better), and an optional mermaid `diagram`.",
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
  publishReview:
    "Publish a WHOLE code review in one call — the strongly preferred way to review a PR on showcase. Pass a `verdict` (request_changes|approve|comment), an optional `summary`/`coverage`, a `changeMap` ({nodes, edges} — the headline visual: the changed pieces and how they interact, color-coded new/modified/touched/removed), and a `findings` array; showcase explodes it into a verdict card (summary + tally + findings table + the change map) + ONE card per finding. Each finding card is FIXED structure: severity badge, the problem, a before→after `suggestion` rendered as an inline diff, and `fix` (why it's better). Same effort as writing the review, but it physically cannot become a wall of markdown — the structure is the API. For every fix you'd recommend, pass `suggestion:{before,after}` (NOT `patch`) so the diff always renders. Returns the sessionId + the created surface ids.",
  reviewFinding:
    "Publish ONE structured review finding as a multimodal card (prefer publish_review to submit a whole review at once). showcase composes it from your fields — a severity badge + the problem + a before→after suggested-change diff + the rationale. Never dump a review into one markdown surface. For a fix, pass `suggestion:{before,after}` (the current code and your proposed code) — showcase computes the diff so it ALWAYS shows the change; use `patch` only to show the PR's actual change in context. `title` and `problem` are required. Returns the surface id + URL; pass the returned sessionId as `session` on the rest of the review.",
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

// Change-map / blast-radius graph — shared by publish_review's `changeMap`
// (the headline visual) and each finding's `blastRadius` (the mini call-graph).
// Edges carry an optional `status` so new/severed coupling is color-coded the
// same way node status is (§8.2).
const MCP_CHANGEMAP_JSON_SCHEMA = {
  type: "object",
  properties: {
    nodes: {
      type: "array",
      description: d.reviewChangeNode,
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["new", "modified", "touched", "removed"] },
          kind: {
            type: "string",
            enum: ["file", "class", "function", "service", "table", "external"],
          },
        },
        required: ["id", "label", "status"],
      },
    },
    edges: {
      type: "array",
      description: d.reviewChangeEdge,
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["new", "removed", "existing"] },
        },
        required: ["from", "to"],
      },
    },
  },
  required: ["nodes"],
} as const;

// One finding — shared by review_finding (the whole input) and publish_review
// (each item in `findings`).
const MCP_FINDING_JSON_SCHEMA = {
  type: "object",
  properties: {
    severity: {
      type: "string",
      enum: ["bug", "nit", "question", "praise", "note"],
      description: d.findingSeverity,
    },
    title: { type: "string", description: d.findingTitle },
    file: { type: "string", description: d.findingFile },
    line: { type: "number", description: d.findingLine },
    problem: { type: "string", description: d.findingProblem },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: d.findingConfidence,
    },
    coverage: { type: "string", description: d.findingCoverage },
    verified: { type: "boolean", description: d.findingVerified },
    scope: {
      type: "string",
      enum: ["changed-lines", "whole-file", "codebase"],
      description: d.findingScope,
    },
    suggestion: {
      type: "object",
      description: d.findingSuggestion,
      properties: {
        before: { type: "string", description: "The current code (verbatim)" },
        after: { type: "string", description: "Your proposed replacement" },
      },
      required: ["before", "after"],
    },
    fix: { type: "string", description: d.findingFix },
    patch: { type: "string", description: d.findingPatch },
    diagram: { type: "string", description: d.findingDiagram },
    blastRadius: { ...MCP_CHANGEMAP_JSON_SCHEMA, description: d.findingBlastRadius },
  },
  required: ["title", "problem", "confidence", "coverage"],
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
    name: "publish_review",
    description: MCP_TOOL_DESCRIPTIONS.publishReview,
    inputSchema: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["request_changes", "approve", "comment"],
          description: d.reviewVerdict,
        },
        branch: { type: "string", description: d.reviewBranch },
        base: { type: "string", description: d.reviewBase },
        summary: { type: "string", description: d.reviewSummary },
        coverage: { type: "string", description: d.reviewCoverage },
        intent: { type: "string", description: d.reviewIntent },
        risk: {
          type: "object",
          description: d.reviewRisk,
          properties: {
            size: { type: "number", minimum: 0, maximum: 3 },
            surfaceArea: { type: "number", minimum: 0, maximum: 3 },
            sensitivity: { type: "number", minimum: 0, maximum: 3 },
            testDelta: { type: "number", minimum: 0, maximum: 3 },
            band: { type: "string", enum: ["low", "elevated", "high"] },
          },
        },
        budget: { type: "string", description: d.reviewBudget },
        manifest: {
          type: "array",
          description: d.reviewManifest,
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              added: { type: "number" },
              removed: { type: "number" },
              priority: { type: "string", enum: ["sensitive", "logic", "mechanical"] },
              note: { type: "string" },
            },
            required: ["file"],
          },
        },
        changeMap: { ...MCP_CHANGEMAP_JSON_SCHEMA, description: d.reviewChangeMap },
        architecture: { type: "string", description: d.reviewArchitecture },
        churn: {
          type: "array",
          description: d.reviewChurn,
          items: {
            type: "object",
            properties: {
              file: { type: "string" },
              added: { type: "number" },
              removed: { type: "number" },
            },
            required: ["file", "added", "removed"],
          },
        },
        findings: { type: "array", items: MCP_FINDING_JSON_SCHEMA, description: d.reviewFindings },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["findings"],
    },
  },
  {
    name: "review_finding",
    description: MCP_TOOL_DESCRIPTIONS.reviewFinding,
    inputSchema: {
      type: "object",
      properties: {
        ...MCP_FINDING_JSON_SCHEMA.properties,
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "problem"],
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

const suggestionStdioSchema = z
  .object({ before: z.string(), after: z.string() })
  .describe(d.findingSuggestion);

// Change-map / blast-radius graph (stdio) — edges carry an optional `status`
// (§8.2). Shared by publishReview.changeMap and each finding's blastRadius.
const changeMapStdioSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(["new", "modified", "touched", "removed"]),
      kind: z.enum(["file", "class", "function", "service", "table", "external"]).optional(),
    }),
  ),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
        status: z.enum(["new", "removed", "existing"]).optional(),
      }),
    )
    .optional(),
});

const findingStdioSchema = z.object({
  severity: z.enum(["bug", "nit", "question", "praise", "note"]).optional(),
  title: z.string(),
  file: z.string().optional(),
  line: z.number().optional(),
  problem: z.string(),
  confidence: z.enum(["high", "medium", "low"]).describe(d.findingConfidence),
  coverage: z.string().describe(d.findingCoverage),
  verified: z.boolean().optional().describe(d.findingVerified),
  scope: z.enum(["changed-lines", "whole-file", "codebase"]).optional().describe(d.findingScope),
  fix: z.string().optional(),
  suggestion: suggestionStdioSchema.optional(),
  patch: z.string().optional(),
  diagram: z.string().optional(),
  blastRadius: changeMapStdioSchema.optional().describe(d.findingBlastRadius),
});

export const STDIO_MCP_INPUT_SCHEMAS = {
  publishSurface: {
    title: z.string().describe(d.title),
    parts: z.array(mcpPartSchema).describe(MCP_PARTS_DESCRIPTION),
    badge: badgeStdioSchemas.badge,
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishReview: {
    verdict: z.enum(["request_changes", "approve", "comment"]).optional().describe(d.reviewVerdict),
    branch: z.string().optional().describe(d.reviewBranch),
    base: z.string().optional().describe(d.reviewBase),
    summary: z.string().optional().describe(d.reviewSummary),
    coverage: z.string().optional().describe(d.reviewCoverage),
    intent: z.string().optional().describe(d.reviewIntent),
    risk: z
      .object({
        size: z.number().min(0).max(3).optional(),
        surfaceArea: z.number().min(0).max(3).optional(),
        sensitivity: z.number().min(0).max(3).optional(),
        testDelta: z.number().min(0).max(3).optional(),
        band: z.enum(["low", "elevated", "high"]).optional(),
      })
      .optional()
      .describe(d.reviewRisk),
    budget: z.string().optional().describe(d.reviewBudget),
    manifest: z
      .array(
        z.object({
          file: z.string(),
          added: z.number().optional(),
          removed: z.number().optional(),
          priority: z.enum(["sensitive", "logic", "mechanical"]).optional(),
          note: z.string().optional(),
        }),
      )
      .optional()
      .describe(d.reviewManifest),
    changeMap: changeMapStdioSchema.optional().describe(d.reviewChangeMap),
    architecture: z.string().optional().describe(d.reviewArchitecture),
    churn: z
      .array(z.object({ file: z.string(), added: z.number(), removed: z.number() }))
      .optional()
      .describe(d.reviewChurn),
    findings: z.array(findingStdioSchema).describe(d.reviewFindings),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  reviewFinding: {
    severity: z
      .enum(["bug", "nit", "question", "praise", "note"])
      .optional()
      .describe(d.findingSeverity),
    title: z.string().describe(d.findingTitle),
    file: z.string().optional().describe(d.findingFile),
    line: z.number().optional().describe(d.findingLine),
    problem: z.string().describe(d.findingProblem),
    confidence: z.enum(["high", "medium", "low"]).describe(d.findingConfidence),
    coverage: z.string().describe(d.findingCoverage),
    verified: z.boolean().optional().describe(d.findingVerified),
    scope: z.enum(["changed-lines", "whole-file", "codebase"]).optional().describe(d.findingScope),
    fix: z.string().optional().describe(d.findingFix),
    suggestion: suggestionStdioSchema.optional(),
    patch: z.string().optional().describe(d.findingPatch),
    diagram: z.string().optional().describe(d.findingDiagram),
    blastRadius: changeMapStdioSchema.optional().describe(d.findingBlastRadius),
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
