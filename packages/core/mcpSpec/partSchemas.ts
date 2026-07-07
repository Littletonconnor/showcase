import { z } from "zod";
import { d, MCP_PARTS_DESCRIPTION } from "./fieldDocs.ts";

export const MCP_PART_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      // Every kind the server accepts — schema-enforcing clients can otherwise
      // never emit (or round-trip via get_surface → update_surface) a part the
      // enum omits.
      enum: [
        "html",
        "markdown",
        "mermaid",
        "diff",
        "image",
        "trace",
        "terminal",
        "chart",
        "json",
        "code",
        "walkthrough",
      ],
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
      description: `trace part: ${d.traceSteps}. ${d.partWalkthrough}`,
      // Two step shapes share this key: a trace step ({label, kind?, detail?,
      // ts?}) and a walkthrough step ({title, body, file?, code?, language?,
      // lineStart?, highlight?, node?}). Kept permissive here so schema-
      // enforcing clients can emit both; the server validates strictly per kind.
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: d.traceLabel },
          kind: { type: "string", description: d.traceKind },
          detail: { type: "string", description: d.traceDetail },
          ts: { type: "string", description: d.traceTs },
          title: { type: "string", description: "walkthrough step: one line naming the hop" },
          body: { type: "string", description: "walkthrough step: the annotation" },
          file: { type: "string", description: "walkthrough step: path label" },
          code: { type: "string", description: "walkthrough step: the real excerpt" },
          language: { type: "string" },
          lineStart: { type: "number" },
          highlight: {
            type: "array",
            items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
            description: "walkthrough step: absolute [from,to] line ranges to emphasize",
          },
          node: { type: "string", description: "walkthrough step: mermaid node id to mark active" },
        },
      },
    },
    chartType: {
      type: "string",
      enum: [
        "bar",
        "line",
        "area",
        "pie",
        "treemap",
        "scatter",
        "bubble",
        "minimap",
        "matrix",
        "arc",
      ],
      description: d.partChartType,
    },
    // `data` is shared: an array of rows for chart parts, any JSON value for
    // json parts — so it can't be typed narrower than "anything" here.
    data: { description: d.partChartData },
    x: { type: "string", description: d.partChartX },
    y: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
      description: d.partChartY,
    },
    x2: { type: "string", description: d.partChartX2 },
    z: { type: "string", description: d.partChartZ },
    stacked: { type: "boolean", description: d.partChartStacked },
    colors: { type: "array", items: { type: "string" }, description: d.partChartColors },
    xLabel: { type: "string", description: d.partChartXLabel },
    yLabel: { type: "string", description: d.partChartYLabel },
    code: { type: "string", description: d.partCode },
    language: { type: "string", description: d.partCodeLanguage },
    lineStart: { type: "number", description: d.partCodeLineStart },
  },
  required: ["kind"],
} as const;

export const MCP_PARTS_JSON_SCHEMA = {
  type: "array",
  description: MCP_PARTS_DESCRIPTION,
  items: MCP_PART_JSON_SCHEMA,
} as const;

export const MCP_BADGE_JSON_SCHEMA = {
  type: "object",
  description: d.badge,
  properties: {
    tone: { type: "string", enum: ["critical", "warning", "info", "success", "neutral"] },
    label: { type: "string" },
  },
  required: ["tone", "label"],
} as const;

export const diffFileSchema = z.object({
  filename: z.string(),
  before: z.string(),
  after: z.string(),
  language: z.string().optional(),
});

export const traceStepSchema = z.object({
  label: z.string().describe(d.traceLabel),
  kind: z.string().optional().describe(d.traceKind),
  detail: z.string().optional().describe(d.traceDetail),
  ts: z.string().optional().describe(d.traceTs),
});

export const walkthroughStepSchema = z.object({
  title: z.string().describe("one line naming the hop"),
  body: z.string().describe("the annotation — why this code matters, what to notice"),
  file: z.string().optional().describe("path label, e.g. packages/server/app.ts"),
  code: z.string().optional().describe("the REAL excerpt for this step, kept tight"),
  language: z.string().optional(),
  lineStart: z.number().optional().describe("1-based, so numbering matches the file"),
  highlight: z
    .array(z.tuple([z.number(), z.number()]))
    .optional()
    .describe("absolute [from,to] line ranges to emphasize; the rest dims"),
  node: z.string().optional().describe("mermaid node id to mark active for this step"),
});

export const mcpPartSchema = z
  .object({
    // Must cover every kind the server accepts: the SDK enforces this schema on
    // publish AND on the get_surface → update_surface round-trip, so a missing
    // kind makes any surface carrying it unrevisable over stdio.
    kind: z.enum([
      "html",
      "markdown",
      "mermaid",
      "diff",
      "image",
      "trace",
      "terminal",
      "chart",
      "json",
      "code",
      "checkpoint",
      "walkthrough",
    ]),
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
    // Shared by trace parts (trace steps) and walkthrough parts (walkthrough
    // steps) — the server validates strictly per kind.
    steps: z
      .array(z.union([traceStepSchema, walkthroughStepSchema]))
      .optional()
      .describe(`trace: ${d.traceSteps}. walkthrough: ${d.partWalkthrough}`),
    text: z.string().optional().describe(d.terminalText),
    cols: z.number().optional().describe(d.terminalCols),
    chartType: z
      .enum([
        "bar",
        "line",
        "area",
        "pie",
        "treemap",
        "scatter",
        "bubble",
        "minimap",
        "matrix",
        "arc",
      ])
      .optional()
      .describe(d.partChartType),
    data: z.unknown().optional().describe(d.partChartData),
    x: z.string().optional().describe(d.partChartX),
    y: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe(d.partChartY),
    x2: z.string().optional().describe(d.partChartX2),
    z: z.string().optional().describe(d.partChartZ),
    stacked: z.boolean().optional().describe(d.partChartStacked),
    colors: z.array(z.string()).optional().describe(d.partChartColors),
    xLabel: z.string().optional().describe(d.partChartXLabel),
    yLabel: z.string().optional().describe(d.partChartYLabel),
    code: z.string().optional().describe(d.partCode),
    language: z.string().optional().describe(d.partCodeLanguage),
    lineStart: z.number().optional().describe(d.partCodeLineStart),
    // checkpoint part payload — kept loose here (the server validates strictly)
    // so a get_surface -> update_surface round-trip of a lesson card survives.
    checkpoint: z.object({}).passthrough().optional().describe(d.partCheckpoint),
  })
  .describe(
    "A surface part: html {kind:'html',html}; markdown {kind:'markdown',markdown} (prose); mermaid " +
      "{kind:'mermaid',mermaid} (diagram source → SVG); diff {kind:'diff',patch}; image " +
      "{kind:'image',assetId} (from upload_asset); trace {kind:'trace',steps} and/or {kind:'trace',assetId}; " +
      "terminal {kind:'terminal',text} (monospace output; ANSI SGR colors rendered); chart " +
      "{kind:'chart',chartType,data,x,y} (native chart); json {kind:'json',data} (collapsible tree); " +
      "code {kind:'code',code,language?} (shiki-highlighted source); walkthrough " +
      "{kind:'walkthrough',title?,mermaid?,steps} (a step-through code explainer — THE part for " +
      "'explain how X works in this codebase'); checkpoint " +
      "{kind:'checkpoint',checkpoint} (a learn-mode assessment — prefer publish_lesson/update_lesson " +
      "over hand-building these)",
  );

export const badgeStdioSchemas = {
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
