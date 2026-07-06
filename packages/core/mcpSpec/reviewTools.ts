import { z } from "zod";
import { d } from "./fieldDocs.ts";
import { MCP_PARTS_JSON_SCHEMA, mcpPartSchema } from "./partSchemas.ts";

export const REVIEW_TOOL_DESCRIPTIONS = {
  publishDecisions:
    "Publish a WHOLE code review in one call — THE way to review a PR on showcase (docs/review-form-factor.md). Review scales with risk, not diff size: do the ANALYSIS with your `code-review` skill first, then this renders it. Pass: a plain-English `brief` (≤4 sentences, NO code identifiers — for a PM/designer/anyone), a `verdict` (block|approve|comment), a risk-ranked `decisions[]` array (ONE decision per thing that needs a human call — a 5,000-line diff is usually a handful, hardest first; decisions[0] is the lede), and the REQUIRED `manifest` (EVERY changed file tagged has-decision|reviewed-no-comment|mechanical-skipped — the trust backbone, so the reviewer can see nothing was hidden). Each decision is fixed structure: call (block|ship|decide), kind, scope, a one-sentence assertion, optional impact/details, REQUIRED confidence (the surfaced honesty signal), an optional pivot ('flips to ✅ if…'), optional evidence (surface parts — usually a diff — in the synced right pane), and an optional `proposal:{before,after}` suggested fix. Keep each decision's `id` STABLE across re-publishes — it's the human's chat handle and what preserves their adjudication when you revise. For a big or multi-concern PR, also pass `chapters` — a guided read that organizes the WHOLE changeset into importance-ordered chapters (the heart first, consequences next, glue last), each with an overview, per-file summaries, and the live diff it covers; chapter files are validated against the manifest, so a guide can never invent or silently drop files. showcase renders a Brief + a scroll-snapped decision queue the human Accepts (pushback comes by pasting a decision's or chapter's id into your terminal), with the guided read beneath. Returns sessionId + the /?review=<session> URL.",
} as const;

export const HTTP_REVIEW_TOOLS = [
  {
    name: "publish_decisions",
    description: REVIEW_TOOL_DESCRIPTIONS.publishDecisions,
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
        chapters: {
          type: "array",
          description: d.reviewChapters,
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: d.chapterId },
              title: { type: "string" },
              overview: { type: "string" },
              files: {
                type: "array",
                items: {
                  type: "object",
                  properties: { path: { type: "string" }, summary: { type: "string" } },
                  required: ["path"],
                },
              },
              parts: { ...MCP_PARTS_JSON_SCHEMA, description: d.chapterParts },
            },
            required: ["title", "overview", "files"],
          },
        },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["brief", "decisions", "manifest"],
    },
  },
] as const;

export const STDIO_REVIEW_INPUT_SCHEMAS = {
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
    chapters: z
      .array(
        z.object({
          id: z.string().optional().describe(d.chapterId),
          title: z.string(),
          overview: z.string(),
          files: z.array(z.object({ path: z.string(), summary: z.string().optional() })),
          parts: z.array(mcpPartSchema).optional().describe(d.chapterParts),
        }),
      )
      .optional()
      .describe(d.reviewChapters),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
} as const;
