import { z } from "zod";
import { d } from "./fieldDocs.ts";
import { MCP_PART_JSON_SCHEMA, mcpPartSchema } from "./partSchemas.ts";

export const LEARN_TOOL_DESCRIPTIONS = {
  publishLesson:
    "Publish a LESSON — the learn form factor (docs/learn-form-factor.md). Use it when the user wants " +
    "to LEARN or deeply understand a topic or codebase (drive it with your teach skill), not for quick " +
    "answers. You supply the typed plan; the server renders the fixed session anatomy: a syllabus card " +
    "(the concept graph, badged by mastery) plus one card per concept beat (hook prediction -> mental " +
    "model -> worked example -> gated explorable -> checkpoints -> recap). RULES the structure enforces " +
    "and you must not fight: never reveal an answer before an attempt (each checkpoint's reveal is " +
    "hidden until the learner commits); every concept gets checkpoints — reading is not the mastery " +
    "signal, answers are. Call get_learner_state FIRST so the lesson starts from prior mastery, not " +
    "zero. After publishing, park on wait_for_feedback: attempts arrive as [checkpoint] telemetry " +
    "lines. Grade free-text answers substantively (name what's right, the gap, one targeted question " +
    "back) and record the outcome with record_attempt; on a misconception-tagged miss, insert a " +
    "remediation card with update_lesson targeting THAT misconception. Returns sessionId, the syllabus " +
    "surface id, and one surface id per beat.",
  updateLesson:
    "Revise a lesson beat card in place (pass surfaceId + the full replacement beat), or INSERT a new " +
    "remediation card into the lesson session (pass session + beat, no surfaceId). The server renders " +
    "the beat layout; you fill the typed slots. Use it for: remediation after a misconception-tagged " +
    "miss (a short beat re-teaching JUST that wrong model, with a fresh checkpoint), fading scaffolding " +
    "as mastery rises, or fixing a beat the learner flagged as confusing.",
  getLearnerState:
    "Read the learner's cross-session mastery state: per-topic concept records (untouched|shaky|solid, " +
    "attempt counts, the misconceptions they actually hit, due dates) plus the interleaved due-for-" +
    "review queue. Call it BEFORE opening a lesson so you start from reality (fade scaffolding on " +
    "solid prerequisites, remediate shaky ones), and to run review sessions: generate FRESH variant " +
    "checkpoints for due concepts — vary the surface context, target the same concept; never replay " +
    "stored questions verbatim.",
  recordAttempt:
    "Record YOUR grading of a learner's free-text checkpoint answer (explain/completion/apply and " +
    "free-text predict — the kinds a client can't grade). Pass the lesson session (or topic), " +
    "conceptId, kind, correct, and the misconception tag if the answer revealed one. This is what " +
    "moves mastery for agent-graded kinds, so grade honestly — mastery gates what review resurfaces. " +
    "Client-graded kinds (mcq, choice predicts, exact-match trace) record themselves; do NOT " +
    "double-record those.",
} as const;

// Learn-mode JSON schemas, shared by publish_lesson and update_lesson.
export const MCP_CHECKPOINT_JSON_SCHEMA = {
  type: "object",
  description: d.checkpointObj,
  properties: {
    id: { type: "string" },
    conceptId: { type: "string" },
    kind: { type: "string", enum: ["predict", "mcq", "completion", "explain", "trace", "apply"] },
    prompt: { type: "string" },
    code: {
      type: "object",
      properties: { code: { type: "string" }, language: { type: "string" } },
      required: ["code"],
    },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          correct: { type: "boolean" },
          misconception: {
            type: "string",
            description: "Which wrong mental model this distractor diagnoses (P10)",
          },
        },
        required: ["id", "label"],
      },
    },
    expected: { type: "string" },
    askConfidence: { type: "boolean" },
    reveal: { type: "string" },
  },
  required: ["id", "conceptId", "kind", "prompt", "reveal"],
} as const;

export const MCP_BEAT_JSON_SCHEMA = {
  type: "object",
  properties: {
    conceptId: { type: "string" },
    hook: MCP_CHECKPOINT_JSON_SCHEMA,
    model: {
      type: "array",
      description:
        "The mental model: markdown/mermaid/code/diff/chart parts (no html — use explorable)",
      items: MCP_PART_JSON_SCHEMA,
    },
    workedExample: { type: "array", items: MCP_PART_JSON_SCHEMA },
    explorable: {
      type: "object",
      properties: {
        html: { type: "string", description: d.partHtml },
        kits: { type: "array", items: { type: "string" } },
        gate: MCP_CHECKPOINT_JSON_SCHEMA,
      },
      required: ["html"],
    },
    checkpoints: { type: "array", items: MCP_CHECKPOINT_JSON_SCHEMA },
    recap: { type: "string" },
  },
  required: ["conceptId", "model", "checkpoints", "recap"],
} as const;

// Learn-mode zod shapes (mirroring the JSON schemas above).
export const checkpointSchema = z
  .object({
    id: z.string(),
    conceptId: z.string(),
    kind: z.enum(["predict", "mcq", "completion", "explain", "trace", "apply"]),
    prompt: z.string(),
    code: z.object({ code: z.string(), language: z.string().optional() }).optional(),
    options: z
      .array(
        z.object({
          id: z.string(),
          label: z.string(),
          correct: z.boolean().optional(),
          misconception: z.string().optional(),
        }),
      )
      .optional(),
    expected: z.string().optional(),
    askConfidence: z.boolean().optional(),
    reveal: z.string(),
  })
  .describe(d.checkpointObj);

export const lessonBeatSchema = z.object({
  conceptId: z.string(),
  hook: checkpointSchema.optional(),
  model: z.array(mcpPartSchema),
  workedExample: z.array(mcpPartSchema).optional(),
  explorable: z
    .object({
      html: z.string().describe(d.partHtml),
      kits: z.array(z.string()).optional().describe(d.partKits),
      gate: checkpointSchema.optional(),
    })
    .optional(),
  checkpoints: z.array(checkpointSchema),
  recap: z.string(),
});

export const HTTP_LEARN_TOOLS = [
  {
    name: "publish_lesson",
    description: LEARN_TOOL_DESCRIPTIONS.publishLesson,
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: d.lessonTopic },
        learnerLevel: {
          type: "string",
          enum: ["novice", "intermediate", "advanced"],
          description: d.lessonLevel,
        },
        conceptGraph: {
          type: "object",
          description: d.lessonGraph,
          properties: {
            concepts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  misconceptions: { type: "array", items: { type: "string" } },
                },
                required: ["id", "label"],
              },
            },
            edges: {
              type: "array",
              items: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 },
              description: "Prerequisite edges [from, to]",
            },
          },
          required: ["concepts"],
        },
        beats: { type: "array", description: d.lessonBeats, items: MCP_BEAT_JSON_SCHEMA },
        session: { type: "string", description: d.session },
        sessionTitle: { type: "string", description: d.sessionTitle },
        agent: { type: "string", description: d.agent },
      },
      required: ["topic", "conceptGraph", "beats"],
    },
  },
  {
    name: "update_lesson",
    description: LEARN_TOOL_DESCRIPTIONS.updateLesson,
    inputSchema: {
      type: "object",
      properties: {
        surfaceId: {
          type: "string",
          description: "Beat card to revise in place (omit to insert a new remediation card)",
        },
        session: {
          type: "string",
          description: "Lesson session to insert into (required when surfaceId is omitted)",
        },
        beat: MCP_BEAT_JSON_SCHEMA,
        title: { type: "string", description: "Card title (e.g. the misconception being fixed)" },
      },
      required: ["beat"],
    },
  },
  {
    name: "get_learner_state",
    description: LEARN_TOOL_DESCRIPTIONS.getLearnerState,
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Scope to one topic (omit for all)" },
      },
    },
  },
  {
    name: "record_attempt",
    description: LEARN_TOOL_DESCRIPTIONS.recordAttempt,
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string", description: "The lesson session (resolves the topic)" },
        topic: { type: "string", description: "Mastery topic (alternative to session)" },
        conceptId: { type: "string" },
        kind: {
          type: "string",
          enum: ["predict", "mcq", "completion", "explain", "trace", "apply"],
        },
        correct: { type: "boolean", description: "Your grading of the learner's answer" },
        misconception: {
          type: "string",
          description: "The wrong mental model the answer revealed, if any",
        },
      },
      required: ["conceptId", "kind", "correct"],
    },
  },
] as const;

export const STDIO_LEARN_INPUT_SCHEMAS = {
  publishLesson: {
    topic: z.string().describe(d.lessonTopic),
    learnerLevel: z.enum(["novice", "intermediate", "advanced"]).optional().describe(d.lessonLevel),
    conceptGraph: z
      .object({
        concepts: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            misconceptions: z.array(z.string()).optional(),
          }),
        ),
        edges: z.array(z.tuple([z.string(), z.string()])).optional(),
      })
      .describe(d.lessonGraph),
    beats: z.array(lessonBeatSchema).describe(d.lessonBeats),
    sessionTitle: z.string().optional().describe(d.stdioSessionTitle),
  },
  updateLesson: {
    surfaceId: z
      .string()
      .optional()
      .describe("Beat card to revise in place (omit to insert a remediation card)"),
    session: z
      .string()
      .optional()
      .describe("Lesson session to insert into (required when surfaceId is omitted)"),
    beat: lessonBeatSchema,
    title: z.string().optional().describe("Card title (e.g. the misconception being fixed)"),
  },
  getLearnerState: {
    topic: z.string().optional().describe("Scope to one topic (omit for all)"),
  },
  recordAttempt: {
    session: z.string().optional().describe("The lesson session (resolves the topic)"),
    topic: z.string().optional().describe("Mastery topic (alternative to session)"),
    conceptId: z.string(),
    kind: z.enum(["predict", "mcq", "completion", "explain", "trace", "apply"]),
    correct: z.boolean().describe("Your grading of the learner's answer"),
    misconception: z
      .string()
      .optional()
      .describe("The wrong mental model the answer revealed, if any"),
  },
} as const;
