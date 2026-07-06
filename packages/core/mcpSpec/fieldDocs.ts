import { BLUEPRINT_IDS } from "../blueprints.ts";
import { KIT_IDS } from "../kits.ts";
import { THEME_IDS } from "../themes.ts";

// Shared field descriptions, referenced by every tool-schema module so the
// same field reads identically on both transports.
export const d = {
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
  partChartType:
    "chart part: bar | line | area | pie | treemap | scatter | bubble | minimap | matrix | arc. " +
    "The last four are opt-in review-depth visuals — pick AT MOST ONE per PR, matched to its shape: " +
    "bubble (churn×complexity hotspots: numeric x/y, point size from z, per-row tone) for a broad " +
    "risk sweep; minimap (a one-strip file heat-map: segment width = y per x label) for a small PR's " +
    "where-did-it-land glance; matrix (rows = x, columns = x2, cell intensity = y) for a refactor's " +
    "co-change coupling; arc (nodes from x/x2 on a line, arc weight = y) for layered dependency flow.",
  partChartData:
    "chart part: row-oriented data — an array of objects, one per row/category. json part: the JSON value to render as a collapsible tree.",
  partCode: "code part: the source text, shiki-highlighted",
  partCodeLanguage: "code part: shiki language id (inferred from `title` when omitted)",
  partCodeLineStart: "code part: 1-based line number the excerpt starts at",
  partWalkthrough:
    "walkthrough part: a step-through code explainer — THE part for 'explain how X works in this " +
    "codebase'. The viewer renders a step player: prev/next + arrow keys + clickable step dots, an " +
    "annotation panel, a code pane where each step's `highlight` line ranges glow while the rest dim, " +
    "and an optional shared `mermaid` diagram whose node (per-step `node`) tracks the step. Each step " +
    "= ONE hop of the call path: {title, body (the annotation — why this code matters), file (path " +
    "label), code (the REAL excerpt, kept tight: 10-25 lines), language, lineStart (1-based, so " +
    "numbering matches the file), highlight ([[from,to]] ABSOLUTE line ranges), node}. 3-12 steps. " +
    "A reader can flag 'I'm lost here' on any step; it reaches you as a [confused] line naming the step.",
  partCheckpoint:
    "checkpoint part: a learn-mode assessment the viewer renders interactively (see publish_lesson). " +
    "{id, conceptId, kind: predict|mcq|completion|explain|trace|apply, prompt, code?, options?, " +
    "expected?, askConfidence?, reveal, gate?}",
  lessonTopic: 'The lesson subject, e.g. "Redis eviction policies" — also the mastery-store key',
  lessonLevel:
    "novice | intermediate | advanced — sets the worked-example-to-problem fading arc (default novice)",
  lessonGraph:
    "The 4-9 concepts this lesson teaches with prerequisite edges. Enumerate each concept's 2-3 " +
    "canonical misconceptions BEFORE writing beats — checkpoint distractors should tag them.",
  lessonBeats:
    "One beat per concept, in teaching order: hook (a predict checkpoint asked before any teaching), " +
    "model (markdown/mermaid/code/diff parts — one diagram + prose, one screenful), workedExample " +
    "(code/diff parts), explorable ({html, gate} — sandboxed interactive html unlocked by a predict " +
    "checkpoint), checkpoints (the retrieval practice — mcq distractors tag misconceptions), recap (one line)",
  checkpointObj:
    "A checkpoint: {id (stable, unique in the lesson), conceptId, kind (predict|mcq|completion|explain|" +
    "trace|apply), prompt, code? ({code,language} the prompt asks about), options? (2-6 for mcq/predict " +
    "choice — exactly one correct:true; wrong ones SHOULD carry a misconception tag), expected? (exact-" +
    "match answer for client-graded trace), askConfidence? (collect a 0-1 confidence for calibration " +
    "feedback), reveal (the resolution, shown only after an attempt)}",
  partChartX: "chart part: the field naming the category (x axis / pie slice label)",
  partChartY: "chart part: the numeric series field, or an array of fields for multiple series",
  partChartX2:
    "chart part: the second category field — the matrix column / the arc target node (required for matrix/arc)",
  partChartZ: "chart part: the numeric size field for bubble points (omit for uniform dots)",
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

export const MCP_PARTS_DESCRIPTION =
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
  "chartType:'bar'|'line'|'area'|'pie'|'treemap'|'scatter'|'bubble'|'minimap'|'matrix'|'arc', " +
  "data:[{…row}], x:'<categoryField>', y:'<numericField>'|['<f1>','<f2>'], x2?, z?, stacked?, " +
  "colors?, xLabel?, yLabel?, caption?} — row-oriented numeric data rendered by the trusted viewer " +
  "(data is an array of objects; x names the category field, y the numeric series — one field or " +
  "several; matrix/arc take the second category in x2, bubble sizes points from z). json: " +
  "{kind:'json', data:<any JSON value>} — a " +
  "collapsible tree. code: {kind:'code', code:'<source>', language?, title?, lineStart?} — a " +
  "shiki-highlighted source file/excerpt. Optional diff layout " +
  "'unified'|'split'. Combine freely, e.g. [{kind:'html',...},{kind:'image',assetId},{kind:'trace',steps}].";
