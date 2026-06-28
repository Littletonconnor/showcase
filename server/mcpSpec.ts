import { z } from "zod";
import { BLUEPRINT_IDS } from "./blueprints.ts";
import { KIT_IDS } from "./kits.ts";
import { THEME_IDS } from "./themes.ts";

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
  "SESSION PRESETS: a session can be pinned to a PRESET (an explainer blueprint + theme) so every " +
  "surface in it comes out in the same structure + look no matter what is asked — a design-doc session, " +
  "a product-demo session, a data-viz session. If the user asks for a kind of session ('make this a " +
  "design-doc session') call configure_session up front; otherwise pass `blueprint` on your first " +
  "publish and it pins for the rest of the session. Then author every surface to the preset's structure. " +
  "A repo or user can also set a default preset that new sessions start in. Discover presets via " +
  "GET /api/blueprints. Several presets also have a TAILORED tool that takes typed fields and renders a " +
  "fixed layout (so every instance looks identical, like publish_decisions does for a review): " +
  "publish_postmortem, publish_dashboard, publish_design_doc, publish_status, publish_architecture, " +
  "publish_product_demo, and publish_product_direction (the 'wf product style' — visualize a product and weigh " +
  "options with pros & cons, ending in a 'Leaning & why' call). Prefer the tailored tool when one fits; fall back to publish_surface for free-form. " +
  "REFERENCING A SURFACE: every card shows a copy-to-clipboard ref in its header. The user copies it — " +
  "it carries the surface id AND title — and pastes it to you in YOUR TERMINAL, where the conversation " +
  "happens. To act on a referenced surface, call get_surface with its id to read its CURRENT full " +
  "content (every part), then update_surface to revise it in place. list_surfaces is the title index " +
  "for a session; get_surface is the full content of one. " +
  "FEEDBACK FROM THE BROWSER: on a review the user adjudicates in the tab — Accept burns a decision down " +
  "(local). To push back they copy a decision's ref (shown in its header) and paste it to you in YOUR " +
  "TERMINAL to scope a revision — there's no browser pushback verb. On other surfaces the user leaves " +
  "comments: call wait_for_feedback after publishing (or anything you want a reaction to) to receive them, " +
  "and any publish/update result may also carry a userFeedback array — comments left since your last call, " +
  "delivered once. Act on feedback in your normal terminal loop: make the change, then republish the review " +
  "with publish_decisions so the board updates.";

// Rides on every wait_for_feedback delivery (both transports) as an in-context
// reminder, right when the agent is deciding how to respond.
export const FEEDBACK_REPLY_NOTE =
  "These are the user's comments on the surfaces they're watching. (On a review the user Accepts decisions " +
  "locally and pushes back by pasting a decision's ref into your terminal, so that arrives as an ordinary " +
  "terminal message, not here.) Act on them in your terminal: make the change and republish the review with " +
  "publish_decisions so the board updates, then call wait_for_feedback again if you expect more.";

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
  theme: `Optional theme this surface renders under (${THEME_IDS.join(
    " | ",
  )}). Sets the palette for the card's parts so themed mockups stay consistent — pick one and reuse it across a set of mockups instead of restyling each. Omit for the board default. On update_surface, pass null to reset.`,
  blueprint: `Optional explainer blueprint — a named PRESET that applies a theme + kit composition + a section structure in one shot (built-ins: ${BLUEPRINT_IDS.join(
    " | ",
  )}; a board/repo may define more — see get_design_guide or GET /api/blueprints). Use it for repeatable, consistent output: a "design-doc", a branded "product-demo", a "data-viz" dashboard. It fills gaps only — an explicit theme or part kits still win. IMPORTANT: a blueprint passed here PINS to the session — every later surface inherits it automatically (until you pass a different one), so a whole session stays in one format no matter what is asked. Author your parts to follow the blueprint's structure, tagging each section/step data-section="<id>". To set the preset up front without publishing, or to switch it, use configure_session. On update_surface, pass null to clear.`,
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
  partPatch:
    "diff part: a REAL unified/git diff string (from `git diff`) — compact, with `@@ -n,m +n,m @@` hunk headers. Do NOT hand-write a pseudo-patch (prose `@@` markers, no line numbers): it won't parse and renders blank. If you don't have actual diff output, use `files:[{before,after}]` instead.",
  partFiles:
    "diff part: before/after pairs — heavier (full contents) but ROBUST for hand-authored evidence (no patch-format footguns). Prefer real `patch` from `git diff`; reach for this when you're constructing the snippet yourself.",
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
    "Right-pane artifacts for this decision: surface parts (usually a `diff`, plus maybe a `mermaid` control-flow or `code`). EFFECTIVELY REQUIRED for any decision about specific code — a changed-line / whole-file call with no evidence is unadjudicable (the reviewer can't see what you're judging) and the server warns on it. Omit ONLY for a genuinely codeless call (a process/architecture point), where it renders full-width.",
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
    "Publish a WHOLE code review in one call — THE way to review a PR on showcase (docs/review-form-factor.md). Review scales with risk, not diff size: do the ANALYSIS with your `code-review` skill first, then this renders it. Pass: a plain-English `brief` (≤4 sentences, NO code identifiers — for a PM/designer/anyone), a `verdict` (block|approve|comment), a risk-ranked `decisions[]` array (ONE decision per thing that needs a human call — a 5,000-line diff is usually a handful, hardest first; decisions[0] is the lede), and the REQUIRED `manifest` (EVERY changed file tagged has-decision|reviewed-no-comment|mechanical-skipped — the trust backbone, so the reviewer can see nothing was hidden). Each decision is fixed structure: call (block|ship|decide), kind, scope, a one-sentence assertion, optional impact/details, REQUIRED confidence (the surfaced honesty signal), an optional pivot ('flips to ✅ if…'), optional evidence (surface parts — usually a diff — in the synced right pane), and an optional `proposal:{before,after}` suggested fix. Keep each decision's `id` STABLE across re-publishes — it's the human's chat handle and what preserves their adjudication when you revise. showcase renders a Brief + a scroll-snapped decision queue the human Accepts (pushback comes by pasting a decision's id into your terminal). Returns sessionId + the /?review=<session> URL.",
  publishSnippet:
    "Publish an HTML snippet — sugar for a surface with one html part. Send a body fragment only. Returns the id, view URL, and sessionId. Pass sessionTitle on first publish. Prefer publish_surface when you want a diff or multiple parts.",
  updateSnippet: "Revise an html snippet in place — sugar for update_surface with one html part.",
  deleteSurface:
    "Delete a surface you published — removes the card and ALL its versions from the board permanently. Use it to clean up while iterating: a stale, duplicate, or superseded card. Prefer update_surface to revise a card in place; reach for this only when the card should disappear entirely. Irreversible. Returns the deleted id and its sessionId.",
  waitForFeedback:
    "Block until the user comments on a surface in this session in their browser (or the timeout passes), coalesced into one batch (delivered once, resuming from where the agent last left off). (Review Accepts are local and pushback comes via a decision's copy-ref pasted into your terminal, so review adjudications do NOT arrive here.) Use timeoutSeconds 0 for a non-blocking check. Act on what comes back in your terminal and republish the review with publish_decisions so the board reflects it.",
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
  publishPostmortem:
    "Publish a blameless incident POSTMORTEM as a structured surface — you supply typed fields, the server renders the fixed layout (so every postmortem looks the same). Pass: summary, impact{affected,experience,duration}, timeline[]{at,event}, fiveWhys[]{why,because} (the chain from the customer-visible failure to a SYSTEMIC cause), contributingFactors (the 'why didn't tests/monitoring catch it' note), fixes{immediate[],necessary[],additional[]}, wentWell/wentPainful, followups[]{item,owner,ticket,due,status}, and impactLevel/reoccurrence. Renders into a postmortem session.",
  publishDashboard:
    "Publish a metrics DASHBOARD (data-viz) as a structured surface. Pass: headline{value,label,delta}, stats[]{label,value}, bars{caption,data[]{label,value}}, trend{caption,values[]}, detail[]{label,value}, takeaway. The server renders the fixed dashboard layout (headline → breakdown chart → trend → detail → takeaway) so every dashboard reads the same.",
  publishDesignDoc:
    "Publish a DESIGN DOC / RFC as a structured surface following the detailed template. The GOAL must be a problem statement (no implementation leakage). Pass: status, meta{author,reviewers,links[]}, summary, goal{problem,metrics}, invariants{trueInvariants,preferences,assumptions}, background, solutionSpace{note,axes[]{axis,options[]{label,chosen},rationale}} (axes = independent technical decisions, candidates named by property), proposed{summary,failureModes,observability}, scope{inScope,outScope,milestones[]}, rollout, testing, openQuestions[]{question,owner}.",
  publishStatus:
    "Publish a recurring STATUS report as a structured surface. Pass: state (on-track|at-risk|off-track), headline, shipped[]{item,note}, inFlight[]{item,pct}, blockers, next[]. The server renders the fixed status layout so every weekly update reads identically.",
  publishArchitecture:
    "Publish a system ARCHITECTURE overview as a structured surface. Pass: components[]{name,role} (the server auto-draws a pipeline diagram from the names), overview, dataFlow[], decisions, scale. Fixed layout: overview diagram → components + data flow → key decisions → scale & failure.",
  publishProductDemo:
    "Publish a branded PRODUCT DEMO walkthrough as a structured, stepped surface (hook → problem → feature → proof → cta). Pass: hook{headline,sub,stats[]}, problem{text,stats[]}, featureTitle + features[]{title,body}, proof{stats[],quote,quoteBy}, cta{headline,body,actions[],tags[]}. The server renders the animate-kit stepper so the demo plays/scrubs the same way every time.",
  publishProductDirection:
    "THE tool for the 'wf product style' — visualize what a product looks like and weigh options with pros & cons, ending in a 'Leaning & why' recommendation. You supply typed fields; the server renders the fixed Wealthfront product-direction layout (branded `.wf` spine: Direction eyebrow → product view → detail → alternatives → comparison → phasing → leaning) so EVERY surface comes out consistent and polished — never hand-roll this in html. Pass: direction (the one-line likely path, shown in the 'Direction' chip), heading (the serif title), sub, view (RAW html of the bespoke product mockup — the ONE freehand slot; author it with the kit's classes: a `.frame` app mockup with `.side`/`.main`/`.body`, or a `.flow` pipeline), detail[]{icon,title,body}, alternatives[]{key,icon,title,tag{label,kind:future|interrupts|non-blocking|shortcut|cost},mockup(optional raw html),pro,con,lean(true on the recommended one)}, comparison{headers[],rows[]{label,cells[]},winner(1-based option column)}, phases[]{when:now|next|later,title,items[]}, and leaning{verdict,recommendation,why,alternatives} (the payoff — always include). Pins the wealthfront theme + kit. For free-form product art that doesn't fit this spine, fall back to publish_surface with blueprint:\"wealthfront-product\".",
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
        theme: { description: d.theme },
        blueprint: { description: d.blueprint },
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
    description: MCP_TOOL_DESCRIPTIONS.updateSnippet,
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
    name: "get_surface",
    description: MCP_TOOL_DESCRIPTIONS.getSurfaceHttp,
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
    name: "publish_postmortem",
    description: MCP_TOOL_DESCRIPTIONS.publishPostmortem,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        incidentId: { type: "string" },
        summary: { type: "string" },
        impact: {
          type: "object",
          properties: {
            affected: { type: "string" },
            experience: { type: "string" },
            duration: { type: "string" },
          },
        },
        timeline: {
          type: "array",
          items: {
            type: "object",
            properties: {
              at: { type: "string" },
              event: { type: "string" },
              marker: { type: "string", enum: ["ok", "warn", "danger", "info"] },
            },
            required: ["at", "event"],
          },
        },
        fiveWhys: {
          type: "array",
          items: {
            type: "object",
            properties: { why: { type: "string" }, because: { type: "string" } },
            required: ["why", "because"],
          },
        },
        contributingFactors: { type: "string" },
        fixes: {
          type: "object",
          properties: {
            immediate: { type: "array", items: { type: "string" } },
            necessary: { type: "array", items: { type: "string" } },
            additional: { type: "array", items: { type: "string" } },
          },
        },
        wentWell: { type: "string" },
        wentPainful: { type: "string" },
        followups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              status: { type: "string", enum: ["open", "done"] },
              ticket: { type: "string" },
              owner: { type: "string" },
              due: { type: "string" },
            },
            required: ["item"],
          },
        },
        impactLevel: { type: "string", enum: ["Low", "Medium", "High"] },
        reoccurrence: { type: "string", enum: ["Low", "Medium", "High"] },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "summary", "fiveWhys"],
    },
  },
  {
    name: "publish_dashboard",
    description: MCP_TOOL_DESCRIPTIONS.publishDashboard,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        headline: {
          type: "object",
          properties: {
            value: { type: "string" },
            label: { type: "string" },
            delta: { type: "string" },
          },
          required: ["value", "label"],
        },
        stats: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
            required: ["label", "value"],
          },
        },
        bars: {
          type: "object",
          properties: {
            caption: { type: "string" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: { label: { type: "string" }, value: { type: "number" } },
                required: ["label", "value"],
              },
            },
          },
        },
        trend: {
          type: "object",
          properties: {
            caption: { type: "string" },
            values: { type: "array", items: { type: "number" } },
          },
        },
        detail: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, value: { type: "string" } },
          },
        },
        takeaway: { type: "string" },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "headline"],
    },
  },
  {
    name: "publish_design_doc",
    description: MCP_TOOL_DESCRIPTIONS.publishDesignDoc,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        status: { type: "string", enum: ["Draft", "In review", "Approved", "Implemented"] },
        meta: {
          type: "object",
          properties: {
            author: { type: "string" },
            reviewers: { type: "string" },
            links: { type: "array", items: { type: "string" } },
          },
        },
        summary: { type: "string" },
        goal: {
          type: "object",
          properties: { problem: { type: "string" }, metrics: { type: "string" } },
          required: ["problem"],
        },
        invariants: {
          type: "object",
          properties: {
            trueInvariants: { type: "string" },
            preferences: { type: "string" },
            assumptions: { type: "string" },
          },
        },
        background: { type: "string" },
        solutionSpace: {
          type: "object",
          properties: {
            note: { type: "string" },
            axes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  axis: { type: "string" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: "string" },
                        chosen: { type: "boolean" },
                      },
                      required: ["label"],
                    },
                  },
                  rationale: { type: "string" },
                },
                required: ["axis", "options"],
              },
            },
          },
        },
        proposed: {
          type: "object",
          properties: {
            summary: { type: "string" },
            failureModes: { type: "string" },
            observability: { type: "string" },
          },
        },
        scope: {
          type: "object",
          properties: {
            inScope: { type: "string" },
            outScope: { type: "string" },
            milestones: { type: "array", items: { type: "string" } },
          },
        },
        rollout: { type: "string" },
        testing: { type: "string" },
        openQuestions: {
          type: "array",
          items: {
            type: "object",
            properties: { question: { type: "string" }, owner: { type: "string" } },
            required: ["question"],
          },
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "summary", "goal"],
    },
  },
  {
    name: "publish_status",
    description: MCP_TOOL_DESCRIPTIONS.publishStatus,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        state: { type: "string", enum: ["on-track", "at-risk", "off-track"] },
        headline: { type: "string" },
        shipped: {
          type: "array",
          items: {
            type: "object",
            properties: { item: { type: "string" }, note: { type: "string" } },
            required: ["item"],
          },
        },
        inFlight: {
          type: "array",
          items: {
            type: "object",
            properties: { item: { type: "string" }, pct: { type: "number" } },
            required: ["item"],
          },
        },
        blockers: { type: "string" },
        next: { type: "array", items: { type: "string" } },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title"],
    },
  },
  {
    name: "publish_architecture",
    description: MCP_TOOL_DESCRIPTIONS.publishArchitecture,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        overview: { type: "string" },
        components: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, role: { type: "string" } },
            required: ["name"],
          },
        },
        dataFlow: { type: "array", items: { type: "string" } },
        decisions: { type: "string" },
        scale: { type: "string" },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "components"],
    },
  },
  {
    name: "publish_product_demo",
    description: MCP_TOOL_DESCRIPTIONS.publishProductDemo,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        hook: {
          type: "object",
          properties: {
            headline: { type: "string" },
            sub: { type: "string" },
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
              },
            },
          },
          required: ["headline"],
        },
        problem: {
          type: "object",
          properties: {
            text: { type: "string" },
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
              },
            },
          },
        },
        featureTitle: { type: "string" },
        features: {
          type: "array",
          items: {
            type: "object",
            properties: { title: { type: "string" }, body: { type: "string" } },
            required: ["title", "body"],
          },
        },
        proof: {
          type: "object",
          properties: {
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: { value: { type: "string" }, label: { type: "string" } },
              },
            },
            quote: { type: "string" },
            quoteBy: { type: "string" },
          },
        },
        cta: {
          type: "object",
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
            actions: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["headline"],
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "hook"],
    },
  },
  {
    name: "publish_product_direction",
    description: MCP_TOOL_DESCRIPTIONS.publishProductDirection,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        direction: {
          type: "string",
          description: "The one-line likely path, shown in the 'Direction' chip",
        },
        heading: { type: "string", description: "The serif-italic title" },
        sub: { type: "string" },
        view: {
          type: "string",
          description:
            "RAW html of the bespoke product mockup (the one freehand slot) — author with kit classes: a .frame app mockup (.side/.main/.body) or a .flow pipeline",
        },
        detail: {
          type: "array",
          items: {
            type: "object",
            properties: {
              icon: {
                type: "string",
                description: "Tabler icon name (with or without ti- prefix)",
              },
              title: { type: "string" },
              body: { type: "string" },
            },
            required: ["title", "body"],
          },
        },
        alternatives: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: 'Short label, e.g. "A"' },
              icon: { type: "string" },
              title: { type: "string" },
              tag: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["future", "interrupts", "non-blocking", "shortcut", "cost"],
                  },
                },
                required: ["label"],
              },
              mockup: { type: "string", description: "Optional raw html of a tiny in-card mockup" },
              pro: { type: "string" },
              con: { type: "string" },
              lean: { type: "boolean", description: "true on the recommended option" },
            },
            required: ["title"],
          },
        },
        comparison: {
          type: "object",
          properties: {
            headers: { type: "array", items: { type: "string" } },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  cells: { type: "array", items: { type: "string" } },
                },
                required: ["label", "cells"],
              },
            },
            winner: { type: "number", description: "1-based option column to highlight" },
          },
        },
        phases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              when: { type: "string", enum: ["now", "next", "later"] },
              title: { type: "string" },
              items: { type: "array", items: { type: "string" } },
            },
            required: ["when", "items"],
          },
        },
        leaning: {
          type: "object",
          properties: {
            verdict: {
              type: "string",
              description: "Short pill text, e.g. 'Recommend the Memory tab'",
            },
            recommendation: { type: "string" },
            why: { type: "string" },
            alternatives: { type: "string", description: "When each alternative would win" },
          },
          required: ["recommendation"],
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["title", "leaning"],
    },
  },
  {
    name: "configure_session",
    description: MCP_TOOL_DESCRIPTIONS.configureSession,
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
    theme: z.string().optional().describe(d.theme),
    blueprint: z.string().optional().describe(d.blueprint),
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
  publishPostmortem: {
    title: z.string(),
    incidentId: z.string().optional(),
    summary: z.string(),
    impact: z
      .object({
        affected: z.string().optional(),
        experience: z.string().optional(),
        duration: z.string().optional(),
      })
      .optional(),
    timeline: z
      .array(
        z.object({
          at: z.string(),
          event: z.string(),
          marker: z.enum(["ok", "warn", "danger", "info"]).optional(),
        }),
      )
      .optional(),
    fiveWhys: z.array(z.object({ why: z.string(), because: z.string() })),
    contributingFactors: z.string().optional(),
    fixes: z
      .object({
        immediate: z.array(z.string()).optional(),
        necessary: z.array(z.string()).optional(),
        additional: z.array(z.string()).optional(),
      })
      .optional(),
    wentWell: z.string().optional(),
    wentPainful: z.string().optional(),
    followups: z
      .array(
        z.object({
          item: z.string(),
          status: z.enum(["open", "done"]).optional(),
          ticket: z.string().optional(),
          owner: z.string().optional(),
          due: z.string().optional(),
        }),
      )
      .optional(),
    impactLevel: z.enum(["Low", "Medium", "High"]).optional(),
    reoccurrence: z.enum(["Low", "Medium", "High"]).optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishDashboard: {
    title: z.string(),
    headline: z.object({ value: z.string(), label: z.string(), delta: z.string().optional() }),
    stats: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    bars: z
      .object({
        caption: z.string().optional(),
        data: z.array(z.object({ label: z.string(), value: z.number() })),
      })
      .optional(),
    trend: z.object({ caption: z.string().optional(), values: z.array(z.number()) }).optional(),
    detail: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    takeaway: z.string().optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishDesignDoc: {
    title: z.string(),
    status: z.enum(["Draft", "In review", "Approved", "Implemented"]).optional(),
    meta: z
      .object({
        author: z.string().optional(),
        reviewers: z.string().optional(),
        links: z.array(z.string()).optional(),
      })
      .optional(),
    summary: z.string(),
    goal: z.object({ problem: z.string(), metrics: z.string().optional() }),
    invariants: z
      .object({
        trueInvariants: z.string().optional(),
        preferences: z.string().optional(),
        assumptions: z.string().optional(),
      })
      .optional(),
    background: z.string().optional(),
    solutionSpace: z
      .object({
        note: z.string().optional(),
        axes: z.array(
          z.object({
            axis: z.string(),
            options: z.array(z.object({ label: z.string(), chosen: z.boolean().optional() })),
            rationale: z.string().optional(),
          }),
        ),
      })
      .optional(),
    proposed: z
      .object({
        summary: z.string().optional(),
        failureModes: z.string().optional(),
        observability: z.string().optional(),
      })
      .optional(),
    scope: z
      .object({
        inScope: z.string().optional(),
        outScope: z.string().optional(),
        milestones: z.array(z.string()).optional(),
      })
      .optional(),
    rollout: z.string().optional(),
    testing: z.string().optional(),
    openQuestions: z
      .array(z.object({ question: z.string(), owner: z.string().optional() }))
      .optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishStatus: {
    title: z.string(),
    state: z.enum(["on-track", "at-risk", "off-track"]).optional(),
    headline: z.string().optional(),
    shipped: z.array(z.object({ item: z.string(), note: z.string().optional() })).optional(),
    inFlight: z.array(z.object({ item: z.string(), pct: z.number().optional() })).optional(),
    blockers: z.string().optional(),
    next: z.array(z.string()).optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishArchitecture: {
    title: z.string(),
    overview: z.string().optional(),
    components: z.array(z.object({ name: z.string(), role: z.string().optional() })),
    dataFlow: z.array(z.string()).optional(),
    decisions: z.string().optional(),
    scale: z.string().optional(),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishProductDemo: {
    title: z.string(),
    hook: z.object({
      headline: z.string(),
      sub: z.string().optional(),
      stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
    }),
    problem: z
      .object({
        text: z.string().optional(),
        stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
      })
      .optional(),
    featureTitle: z.string().optional(),
    features: z.array(z.object({ title: z.string(), body: z.string() })).optional(),
    proof: z
      .object({
        stats: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
        quote: z.string().optional(),
        quoteBy: z.string().optional(),
      })
      .optional(),
    cta: z.object({
      headline: z.string(),
      body: z.string().optional(),
      actions: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
    }),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  publishProductDirection: {
    title: z.string(),
    direction: z
      .string()
      .optional()
      .describe("The one-line likely path, shown in the 'Direction' chip"),
    heading: z.string().optional().describe("The serif-italic title"),
    sub: z.string().optional(),
    view: z
      .string()
      .optional()
      .describe(
        "RAW html of the bespoke product mockup (the one freehand slot) — kit classes: a .frame app mockup (.side/.main/.body) or a .flow pipeline",
      ),
    detail: z
      .array(z.object({ icon: z.string().optional(), title: z.string(), body: z.string() }))
      .optional(),
    alternatives: z
      .array(
        z.object({
          key: z.string().optional(),
          icon: z.string().optional(),
          title: z.string(),
          tag: z
            .object({
              label: z.string(),
              kind: z.enum(["future", "interrupts", "non-blocking", "shortcut", "cost"]).optional(),
            })
            .optional(),
          mockup: z.string().optional(),
          pro: z.string().optional(),
          con: z.string().optional(),
          lean: z.boolean().optional(),
        }),
      )
      .optional(),
    comparison: z
      .object({
        headers: z.array(z.string()).optional(),
        rows: z.array(z.object({ label: z.string(), cells: z.array(z.string()) })).optional(),
        winner: z.number().optional().describe("1-based option column to highlight"),
      })
      .optional(),
    phases: z
      .array(
        z.object({
          when: z.enum(["now", "next", "later"]),
          title: z.string().optional(),
          items: z.array(z.string()),
        }),
      )
      .optional(),
    leaning: z.object({
      verdict: z.string().optional(),
      recommendation: z.string(),
      why: z.string().optional(),
      alternatives: z.string().optional(),
    }),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
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
} as const;

// MCP resources + prompts — the protocol-native read-back/recipe layer, shared
// by both transports (HTTP in mcpHttp.ts, stdio in mcp/server.ts). Resources let
// a client browse/attach published surfaces; prompts expose the flagship recipes
// (review, explainer) as ready-to-run templates.
export const SURFACE_RESOURCE_URI = "showcase://surface/";
export const SURFACE_RESOURCE_TEMPLATE = `${SURFACE_RESOURCE_URI}{id}`;

// Parse a surface id out of a showcase://surface/<id> uri (null if it isn't one).
export function parseSurfaceUri(uri: string): string | null {
  if (!uri.startsWith(SURFACE_RESOURCE_URI)) return null;
  const id = uri.slice(SURFACE_RESOURCE_URI.length).trim();
  return id.length > 0 ? id : null;
}

// The MCP Prompt descriptors (the prompts/list payload shape).
export const MCP_PROMPT_DEFS = [
  {
    name: "review_pr",
    title: "Review a PR on showcase",
    description:
      "Review a pull request as a decision queue (publish_decisions): a plain-English brief, a risk-ranked list of decisions, and a complete changed-file manifest.",
    arguments: [
      { name: "branch", description: "Branch or PR to review (optional)", required: false },
    ],
  },
  {
    name: "explainer",
    title: "Build an animated explainer",
    description:
      "Turn a concept or a screenshot into an animated, scrubbable explainer surface the user can step through.",
    arguments: [{ name: "topic", description: "What to explain (optional)", required: false }],
  },
] as const;

// Build a prompts/get result for a prompt name + args. Returns null for an
// unknown name so the caller can 404. The text guides the agent through the
// flagship workflow; the live contract lives in get_design_guide / the playbook.
export function promptMessages(
  name: string,
  args: Record<string, unknown>,
): {
  description: string;
  messages: { role: "user"; content: { type: "text"; text: string } }[];
} | null {
  const text = (body: string) => ({
    description: MCP_PROMPT_DEFS.find((p) => p.name === name)?.description ?? name,
    messages: [{ role: "user" as const, content: { type: "text" as const, text: body } }],
  });
  const arg = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (name) {
    case "review_pr": {
      const branch = arg("branch");
      return text(
        `Review ${branch ? `the PR on \`${branch}\`` : "the current pull request"} on showcase. ` +
          "Do the analysis FIRST with your `code-review` skill, scoped to risk not diff size. Then call " +
          "publish_decisions ONCE with: a plain-English `brief` (≤4 sentences, no code identifiers), a " +
          "`verdict` (block|approve|comment), a risk-ranked `decisions[]` (one per thing that needs a human " +
          "call, hardest first, each with a stable `id`, `confidence`, and — where a concrete fix exists — a " +
          "`proposal`), and the REQUIRED `manifest` (EVERY changed file tagged has-decision / " +
          "reviewed-no-comment / mechanical-skipped). Do not write the review as one big markdown surface.",
      );
    }
    case "explainer": {
      const topic = arg("topic");
      return text(
        `Build an animated explainer ${topic ? `of ${topic}` : "of the concept the user shares (a screenshot or snippet)"} ` +
          "on showcase. Call get_design_guide first. Publish a surface whose html part opts into the `animate` " +
          "kit: cumulative `.step` reveals the user can scrub, each tagged data-label, building the idea up one " +
          "beat at a time (question → mechanism → payoff). Keep the conversation in the terminal — when the user " +
          "asks to change a step, call get_surface to read the current content, then update_surface to revise it " +
          "in place.",
      );
    }
    default:
      return null;
  }
}
