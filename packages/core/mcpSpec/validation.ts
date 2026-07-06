import { z } from "zod";
import { d, MCP_PARTS_DESCRIPTION } from "./fieldDocs.ts";
import { STDIO_REVIEW_INPUT_SCHEMAS } from "./reviewTools.ts";
import { STDIO_SURFACE_INPUT_SCHEMAS } from "./surfaceTools.ts";

// Per-tool zod validators for the HTTP transport. The stdio server gets input
// validation for free — the MCP SDK validates each call against the same shapes
// in STDIO_MCP_INPUT_SCHEMAS — but the streamable-HTTP transport hand-rolls
// JSON-RPC, so it must validate tools/call arguments itself and return a
// structured `-32602 invalid params` instead of letting bad input fail
// stringly-typed deep inside a flow. These reuse the stdio shapes 1:1 and add the
// HTTP-only routing envelope (session/agent the stdio server manages internally).
// `.passthrough()` keeps unknown keys so the preset tools — which forward the raw
// args as their typed `data` payload to the server, which re-validates — lose
// nothing.
const httpEnvelope = {
  session: z.string().optional().describe(d.session),
  agent: z.string().optional().describe(d.agent),
};
const toolObject = (shape: z.ZodRawShape) => z.object(shape).passthrough();
// Part-bearing fields stay LOOSE on purpose: the publish flow coerces parts
// leniently (drops empties, clamps a bad chartType, strips unsafe colors) and
// supports kinds beyond the advertised schema, so the gate only checks the
// envelope is shaped right (parts present and an array of part-like objects) and
// leaves per-part validation to the coercion layer. Likewise decisions/manifest:
// `coerceReview` already does the rich semantic validation and returns warnings,
// so the gate just confirms they're arrays.
const loosePart = z.object({ kind: z.string() }).passthrough();
const looseObjects = z.array(z.object({}).passthrough());
export const HTTP_MCP_TOOL_SCHEMAS: Record<string, z.ZodTypeAny> = {
  publish_surface: toolObject({
    ...STDIO_SURFACE_INPUT_SCHEMAS.publishSurface,
    parts: z.array(loosePart).describe(MCP_PARTS_DESCRIPTION),
    ...httpEnvelope,
  }),
  publish_decisions: toolObject({
    brief: STDIO_REVIEW_INPUT_SCHEMAS.publishDecisions.brief,
    verdict: STDIO_REVIEW_INPUT_SCHEMAS.publishDecisions.verdict,
    decisions: looseObjects.describe(d.decisions),
    manifest: looseObjects.describe(d.decisionManifest),
    sessionTitle: STDIO_REVIEW_INPUT_SCHEMAS.publishDecisions.sessionTitle,
    ...httpEnvelope,
  }),
  update_surface: toolObject({
    ...STDIO_SURFACE_INPUT_SCHEMAS.updateSurface,
    parts: z.array(loosePart).optional().describe(d.replacementParts),
  }),
  publish_snippet: toolObject({ ...STDIO_SURFACE_INPUT_SCHEMAS.publishSnippet, ...httpEnvelope }),
  update_snippet: toolObject({ ...STDIO_SURFACE_INPUT_SCHEMAS.updateSnippet }),
  delete_surface: toolObject({ ...STDIO_SURFACE_INPUT_SCHEMAS.deleteSurface }),
  wait_for_feedback: toolObject({
    session: z.string().describe("Session id to watch"),
    afterSeq: z.number().optional().describe(d.afterSeq),
    timeoutSeconds: z.number().optional().describe(`${d.timeout} (default 60)`),
  }),
  list_surfaces: toolObject({
    session: z.string().optional().describe("Optional session id to scope the list"),
  }),
  get_surface: toolObject({ ...STDIO_SURFACE_INPUT_SCHEMAS.getSurface }),
  upload_asset: toolObject({
    ...STDIO_SURFACE_INPUT_SCHEMAS.uploadAsset,
    session: z.string().optional().describe(d.assetSession),
  }),
  // Preset payloads are re-validated server-side; the gate only checks the
  // routing envelope so it never false-rejects a valid preset body.
  publish_postmortem: toolObject(httpEnvelope),
  publish_dashboard: toolObject(httpEnvelope),
  publish_design_doc: toolObject(httpEnvelope),
  publish_status: toolObject(httpEnvelope),
  publish_architecture: toolObject(httpEnvelope),
  publish_product_demo: toolObject(httpEnvelope),
  publish_product_direction: toolObject(httpEnvelope),
  configure_session: toolObject({
    ...STDIO_SURFACE_INPUT_SCHEMAS.configureSession,
    session: z.string().describe("Session id to configure"),
  }),
  get_design_guide: toolObject({}),
  // Lesson payloads are re-validated server-side (coerceLesson/coerceBeat give
  // precise field-level errors), so the gate checks only the envelope shape.
  publish_lesson: toolObject({
    topic: z.string().describe(d.lessonTopic),
    conceptGraph: z.object({}).passthrough().describe(d.lessonGraph),
    beats: looseObjects.describe(d.lessonBeats),
    sessionTitle: z.string().optional().describe(d.sessionTitle),
    ...httpEnvelope,
  }),
  update_lesson: toolObject({
    surfaceId: z.string().optional(),
    beat: z.object({}).passthrough(),
    title: z.string().optional(),
    ...httpEnvelope,
  }),
  get_learner_state: toolObject({ topic: z.string().optional() }),
  reply: toolObject({ ...STDIO_SURFACE_INPUT_SCHEMAS.reply, ...httpEnvelope }),
  record_attempt: toolObject({
    topic: z.string().optional(),
    conceptId: z.string(),
    kind: z.enum(["predict", "mcq", "completion", "explain", "trace", "apply"]),
    correct: z.boolean(),
    misconception: z.string().optional(),
    ...httpEnvelope,
  }),
};

// Format a ZodError into a compact, agent-actionable string: each issue as
// `path: message`, joined. A root-level issue (empty path) is labeled "(root)".
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

// Validate one tool's arguments against its schema. Unknown tool → pass through
// (callTool rejects it with the existing "unknown tool" path). Returns a
// structured error string the caller turns into a JSON-RPC -32602.
export function validateToolInput(
  name: string,
  args: unknown,
): { ok: true } | { ok: false; error: string } {
  const schema = HTTP_MCP_TOOL_SCHEMAS[name];
  if (!schema) return { ok: true };
  const parsed = schema.safeParse(args ?? {});
  return parsed.success ? { ok: true } : { ok: false, error: formatZodIssues(parsed.error) };
}
