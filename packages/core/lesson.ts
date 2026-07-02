// The learn form factor's wire model + the server-side lesson renderer (C8:
// the renderer owns the layout — typed slots in, a deterministic surface
// sequence out, byte-for-byte identical for the same input). Runtime-agnostic:
// pure data mapping and string building, no `node:` imports.
//
// A lesson renders as a SESSION of surfaces, not one card: a pinned syllabus
// card (the concept graph as mermaid, badged by mastery state) followed by one
// card per concept beat (hook checkpoint -> mental model -> worked example ->
// gated explorable -> checkpoints -> recap). Checkpoints are a data part the
// trusted viewer renders interactively; only the optional explorable is html,
// and it stays in the ordinary sandboxed-iframe path (C1). Design rationale:
// docs/learn-form-factor.md.

import {
  type Checkpoint,
  type CheckpointOption,
  isCheckpointKind,
  type SurfacePart,
} from "./types.ts";
import type { StoredConceptGraph, SyllabusState } from "./mastery.ts";
import { validateSurfaceParts } from "./surfaceParts.ts";

export type LearnerLevel = "novice" | "intermediate" | "advanced";

export interface LessonConcept {
  id: string;
  label: string;
  // The 2-3 canonical wrong mental models for this concept, enumerated BEFORE
  // instruction is written (P10). Checkpoint distractors tag these.
  misconceptions: string[];
}

export interface LessonExplorable {
  html: string;
  kits?: string[];
  // Predict-before-manipulate: the explorable's iframe stays locked until this
  // checkpoint is attempted (P4/P7).
  gate?: Checkpoint;
}

export interface LessonBeat {
  conceptId: string;
  // The opening prediction, asked before any teaching (P4).
  hook?: Checkpoint;
  // The mental model: markdown/mermaid/chart parts (one diagram per beat, prose
  // beside it — P9). html is not allowed here; interactivity goes through
  // `explorable` so it stays sandboxed.
  model: SurfacePart[];
  // Real artifacts: code/diff parts welcome — this is what codebase tours use.
  workedExample?: SurfacePart[];
  explorable?: LessonExplorable;
  checkpoints: Checkpoint[];
  recap: string;
}

export interface Lesson {
  topic: string;
  learnerLevel: LearnerLevel;
  conceptGraph: { concepts: LessonConcept[]; edges: [string, string][] };
  beats: LessonBeat[];
}

// --- validation -------------------------------------------------------------

const MAX_CONCEPTS = 12;
const MAX_BEATS = 16;
const MAX_CHECKPOINTS_PER_BEAT = 8;
const MAX_OPTIONS = 6;
const MAX_PROMPT = 4000;
const MAX_REVEAL = 4000;
const MAX_LABEL = 120;
const ID_RE = /^[\w.-]{1,80}$/;

// Part kinds allowed in model/workedExample slots — data parts the trusted
// viewer renders. html is deliberately excluded (explorables are the one html
// slot, so the sandbox story stays one story).
const BEAT_PART_KINDS = new Set([
  "markdown",
  "mermaid",
  "code",
  "diff",
  "chart",
  "image",
  "json",
  "terminal",
]);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

type Fail = { error: string };
const fail = (error: string): Fail => ({ error });

function coerceCheckpoint(
  raw: unknown,
  path: string,
  conceptIds: Set<string>,
  seenIds: Set<string>,
): { checkpoint: Checkpoint } | Fail {
  if (!isObj(raw)) return fail(`${path}: must be an object`);
  const id = str(raw.id).trim();
  if (!ID_RE.test(id)) return fail(`${path}: "id" must match ${ID_RE} (got "${id}")`);
  if (seenIds.has(id)) return fail(`${path}: duplicate checkpoint id "${id}"`);
  const conceptId = str(raw.conceptId).trim();
  if (!conceptIds.has(conceptId)) {
    return fail(`${path}: "conceptId" ("${conceptId}") matches no concept in the graph`);
  }
  if (!isCheckpointKind(raw.kind)) {
    return fail(`${path}: "kind" must be predict|mcq|completion|explain|trace|apply`);
  }
  const prompt = str(raw.prompt).trim();
  if (!prompt) return fail(`${path}: "prompt" is required`);
  if (prompt.length > MAX_PROMPT) return fail(`${path}: "prompt" exceeds ${MAX_PROMPT} chars`);
  const reveal = str(raw.reveal).trim();
  if (!reveal) return fail(`${path}: "reveal" is required — every attempt gets a resolution`);
  if (reveal.length > MAX_REVEAL) return fail(`${path}: "reveal" exceeds ${MAX_REVEAL} chars`);

  let options: CheckpointOption[] | undefined;
  if (raw.options !== undefined) {
    if (!Array.isArray(raw.options) || raw.options.length < 2) {
      return fail(`${path}: "options" must be an array of at least 2 choices`);
    }
    if (raw.options.length > MAX_OPTIONS) {
      return fail(`${path}: "options" exceeds ${MAX_OPTIONS} choices`);
    }
    options = [];
    const optIds = new Set<string>();
    let correct = 0;
    for (let i = 0; i < raw.options.length; i++) {
      const o = raw.options[i];
      if (!isObj(o)) return fail(`${path}.options[${i}]: must be an object`);
      const oid = str(o.id).trim() || String.fromCharCode(97 + i);
      if (optIds.has(oid)) return fail(`${path}.options[${i}]: duplicate option id "${oid}"`);
      optIds.add(oid);
      const label = str(o.label).trim();
      if (!label) return fail(`${path}.options[${i}]: "label" is required`);
      if (o.correct === true) correct++;
      options.push({
        id: oid,
        label: label.slice(0, 400),
        ...(o.correct === true ? { correct: true } : {}),
        ...(str(o.misconception).trim()
          ? { misconception: str(o.misconception).trim().slice(0, 200) }
          : {}),
      });
    }
    if (correct !== 1) {
      return fail(`${path}: "options" must mark exactly one choice correct (got ${correct})`);
    }
  }
  if (raw.kind === "mcq" && !options) {
    return fail(`${path}: an mcq checkpoint requires "options"`);
  }

  let code: Checkpoint["code"];
  if (isObj(raw.code) && str(raw.code.code).trim()) {
    code = {
      code: str(raw.code.code),
      ...(str(raw.code.language) ? { language: str(raw.code.language) } : {}),
    };
  }
  const expected = str(raw.expected).trim();
  const checkpoint: Checkpoint = {
    id,
    conceptId,
    kind: raw.kind,
    prompt,
    ...(code ? { code } : {}),
    ...(options ? { options } : {}),
    ...(expected ? { expected: expected.slice(0, 400) } : {}),
    ...(raw.askConfidence === true ? { askConfidence: true } : {}),
    reveal,
  };
  seenIds.add(id);
  return { checkpoint };
}

function coerceBeatParts(raw: unknown, path: string): { parts: SurfacePart[] } | Fail {
  const parsed = validateSurfaceParts(raw);
  if (!parsed.ok) return fail(`${path}: ${parsed.error}`);
  for (const p of parsed.parts) {
    if (!BEAT_PART_KINDS.has(p.kind)) {
      return fail(
        `${path}: part kind "${p.kind}" is not allowed here — interactive html goes in "explorable"`,
      );
    }
  }
  return { parts: parsed.parts };
}

// Validate a published lesson. Mirrors coerceReview's contract: the normalized
// lesson, or a precise error string (a 400, never a partial publish).
export function coerceLesson(raw: unknown): { lesson: Lesson } | Fail {
  if (!isObj(raw)) return fail("body must be an object");
  const topic = str(raw.topic).trim();
  if (!topic) return fail('"topic" is required');
  const learnerLevel: LearnerLevel =
    raw.learnerLevel === "intermediate" || raw.learnerLevel === "advanced"
      ? raw.learnerLevel
      : "novice";

  const graphRaw = isObj(raw.conceptGraph) ? raw.conceptGraph : {};
  if (!Array.isArray(graphRaw.concepts) || graphRaw.concepts.length === 0) {
    return fail('"conceptGraph.concepts" must be a non-empty array');
  }
  if (graphRaw.concepts.length > MAX_CONCEPTS) {
    return fail(`"conceptGraph.concepts" exceeds ${MAX_CONCEPTS} — a lesson is 4-9 concepts`);
  }
  const concepts: LessonConcept[] = [];
  const conceptIds = new Set<string>();
  for (let i = 0; i < graphRaw.concepts.length; i++) {
    const c = graphRaw.concepts[i];
    if (!isObj(c)) return fail(`concept ${i}: must be an object`);
    const id = str(c.id).trim();
    if (!ID_RE.test(id)) return fail(`concept ${i}: "id" must match ${ID_RE}`);
    if (conceptIds.has(id)) return fail(`concept ${i}: duplicate id "${id}"`);
    conceptIds.add(id);
    const label = str(c.label).trim();
    if (!label) return fail(`concept ${i} ("${id}"): "label" is required`);
    const misconceptions = Array.isArray(c.misconceptions)
      ? c.misconceptions.flatMap((m) => (str(m).trim() ? [str(m).trim().slice(0, 300)] : []))
      : [];
    concepts.push({ id, label: label.slice(0, MAX_LABEL), misconceptions });
  }
  const edges: [string, string][] = [];
  for (const e of Array.isArray(graphRaw.edges) ? graphRaw.edges : []) {
    if (!Array.isArray(e) || e.length !== 2) return fail('"edges" entries must be [from, to] pairs');
    const [from, to] = [str(e[0]).trim(), str(e[1]).trim()];
    if (!conceptIds.has(from) || !conceptIds.has(to)) {
      return fail(`edge [${from} -> ${to}] references an unknown concept`);
    }
    edges.push([from, to]);
  }

  if (!Array.isArray(raw.beats) || raw.beats.length === 0) {
    return fail('"beats" must be a non-empty array');
  }
  if (raw.beats.length > MAX_BEATS) return fail(`"beats" exceeds ${MAX_BEATS}`);
  const beats: LessonBeat[] = [];
  const checkpointIds = new Set<string>();
  for (let i = 0; i < raw.beats.length; i++) {
    const parsed = coerceBeat(raw.beats[i], `beat ${i}`, conceptIds, checkpointIds);
    if ("error" in parsed) return parsed;
    beats.push(parsed.beat);
  }
  return { lesson: { topic, learnerLevel, conceptGraph: { concepts, edges }, beats } };
}

export function coerceBeat(
  raw: unknown,
  path: string,
  conceptIds: Set<string>,
  checkpointIds: Set<string>,
): { beat: LessonBeat } | Fail {
  if (!isObj(raw)) return fail(`${path}: must be an object`);
  const conceptId = str(raw.conceptId).trim();
  if (!conceptIds.has(conceptId)) {
    return fail(`${path}: "conceptId" ("${conceptId}") matches no concept in the graph`);
  }
  let hook: Checkpoint | undefined;
  if (raw.hook !== undefined) {
    const parsed = coerceCheckpoint(raw.hook, `${path}.hook`, conceptIds, checkpointIds);
    if ("error" in parsed) return parsed;
    hook = parsed.checkpoint;
  }
  const model = coerceBeatParts(raw.model, `${path}.model`);
  if ("error" in model) return model;
  if (model.parts.length === 0) {
    return fail(`${path}: "model" needs at least one part — the mental model is the teaching`);
  }
  let workedExample: SurfacePart[] | undefined;
  if (raw.workedExample !== undefined) {
    const parsed = coerceBeatParts(raw.workedExample, `${path}.workedExample`);
    if ("error" in parsed) return parsed;
    if (parsed.parts.length > 0) workedExample = parsed.parts;
  }
  let explorable: LessonExplorable | undefined;
  if (isObj(raw.explorable) && str(raw.explorable.html).trim()) {
    let gate: Checkpoint | undefined;
    if (raw.explorable.gate !== undefined) {
      const parsed = coerceCheckpoint(
        raw.explorable.gate,
        `${path}.explorable.gate`,
        conceptIds,
        checkpointIds,
      );
      if ("error" in parsed) return parsed;
      gate = parsed.checkpoint;
    }
    explorable = {
      html: str(raw.explorable.html),
      ...(Array.isArray(raw.explorable.kits)
        ? { kits: raw.explorable.kits.filter((k): k is string => typeof k === "string") }
        : {}),
      ...(gate ? { gate } : {}),
    };
  }
  const checkpoints: Checkpoint[] = [];
  if (!Array.isArray(raw.checkpoints)) {
    return fail(`${path}: "checkpoints" must be an array — a beat without retrieval is re-reading`);
  }
  if (raw.checkpoints.length > MAX_CHECKPOINTS_PER_BEAT) {
    return fail(`${path}: "checkpoints" exceeds ${MAX_CHECKPOINTS_PER_BEAT}`);
  }
  for (let i = 0; i < raw.checkpoints.length; i++) {
    const parsed = coerceCheckpoint(
      raw.checkpoints[i],
      `${path}.checkpoints[${i}]`,
      conceptIds,
      checkpointIds,
    );
    if ("error" in parsed) return parsed;
    checkpoints.push(parsed.checkpoint);
  }
  if (checkpoints.length === 0 && !hook) {
    return fail(`${path}: a beat needs at least one checkpoint (or a hook) — P1 is the point`);
  }
  const recap = str(raw.recap).trim();
  if (!recap) return fail(`${path}: "recap" is required`);
  return {
    beat: {
      conceptId,
      ...(hook ? { hook } : {}),
      model: model.parts,
      ...(workedExample ? { workedExample } : {}),
      ...(explorable ? { explorable } : {}),
      checkpoints,
      recap: recap.slice(0, 2000),
    },
  };
}

// --- rendering (the layout owner, C8) ----------------------------------------

// Mermaid renders in the trusted viewer with securityLevel "strict", but keep
// labels boring anyway: strip the characters that could close a quoted label
// or read as mermaid syntax.
const mermaidLabel = (s: string): string =>
  s.replace(/[[\]{}()"`|<>#;]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);

const MASTERY_BADGE: Record<string, string> = {
  untouched: "",
  shaky: " ~",
  solid: " *",
  due: " !",
};

// The syllabus card body: the concept graph as a mermaid flowchart, each node
// classed by mastery state, plus a one-line legend. Deterministic for a given
// (graph, states) input; the server re-renders it in place as telemetry moves
// mastery, so the badges update live through the ordinary surface-update path.
export function renderSyllabusParts(
  topic: string,
  graph: StoredConceptGraph,
  states: Record<string, SyllabusState>,
): SurfacePart[] {
  const lines: string[] = ["flowchart TD"];
  for (const c of graph.concepts) {
    const state = states[c.id] ?? "untouched";
    lines.push(`  ${c.id}["${mermaidLabel(c.label)}${MASTERY_BADGE[state] ?? ""}"]:::${state}`);
  }
  for (const [from, to] of graph.edges) {
    lines.push(`  ${from} --> ${to}`);
  }
  lines.push(
    "  classDef untouched fill:#e5e7eb,stroke:#9ca3af,color:#374151",
    "  classDef shaky fill:#fef3c7,stroke:#d97706,color:#92400e",
    "  classDef solid fill:#d1fae5,stroke:#059669,color:#065f46",
    "  classDef due fill:#fee2e2,stroke:#dc2626,color:#991b1b",
  );
  const counts = { untouched: 0, shaky: 0, solid: 0, due: 0 };
  for (const c of graph.concepts) counts[states[c.id] ?? "untouched"]++;
  const legend =
    `**${topic}** — your map. \`*\` solid · \`~\` shaky · \`!\` due for review · plain = not yet touched.\n\n` +
    `Progress: ${counts.solid} solid · ${counts.shaky} shaky · ${counts.due} due · ${counts.untouched} to go. ` +
    `Mastery moves only on checkpoint answers, never on "feels clear".`;
  return [
    { kind: "mermaid", mermaid: lines.join("\n") },
    { kind: "markdown", markdown: legend },
  ];
}

// A checkpoint as a surface part. Trivial, but kept as the single constructor
// so every checkpoint enters the parts list one way.
const checkpointPart = (checkpoint: Checkpoint): SurfacePart => ({ kind: "checkpoint", checkpoint });

// One beat -> its card's ordered parts. The fixed arc (hook -> model -> worked
// example -> gated explorable -> checkpoints -> recap) is the layout contract:
// the agent fills slots, the order and framing never vary (C8).
export function renderBeatParts(beat: LessonBeat): SurfacePart[] {
  const parts: SurfacePart[] = [];
  if (beat.hook) {
    parts.push({
      kind: "markdown",
      markdown: "**Before I explain — commit to a prediction.** (Being wrong here is the useful part.)",
    });
    parts.push(checkpointPart(beat.hook));
  }
  parts.push(...beat.model);
  if (beat.workedExample) {
    parts.push({ kind: "markdown", markdown: "#### Worked example" });
    parts.push(...beat.workedExample);
  }
  if (beat.explorable) {
    if (beat.explorable.gate) {
      parts.push(checkpointPart({ ...beat.explorable.gate, gate: true }));
    }
    parts.push({
      kind: "html",
      html: beat.explorable.html,
      ...(beat.explorable.kits && beat.explorable.kits.length > 0
        ? { kits: beat.explorable.kits }
        : {}),
    });
  }
  if (beat.checkpoints.length > 0) {
    parts.push({ kind: "markdown", markdown: "#### Check yourself" });
    for (const cp of beat.checkpoints) parts.push(checkpointPart(cp));
  }
  parts.push({ kind: "markdown", markdown: `> **Recap** — ${beat.recap}` });
  return parts;
}

export interface RenderedLessonSurface {
  title: string;
  parts: SurfacePart[];
  badge: { tone: "info" | "warning" | "neutral"; label: string };
}

// The whole lesson -> its ordered surface sequence: syllabus first, then one
// card per beat, titled by the concept it teaches.
export function renderLessonSurfaces(
  lesson: Lesson,
  states: Record<string, SyllabusState> = {},
): RenderedLessonSurface[] {
  const labelById = new Map(lesson.conceptGraph.concepts.map((c) => [c.id, c.label]));
  const out: RenderedLessonSurface[] = [
    {
      title: `${lesson.topic} — syllabus`,
      parts: renderSyllabusParts(lesson.topic, lesson.conceptGraph, states),
      badge: { tone: "neutral", label: "Syllabus" },
    },
  ];
  lesson.beats.forEach((beat, i) => {
    out.push({
      title: `${i + 1}. ${labelById.get(beat.conceptId) ?? beat.conceptId}`,
      parts: renderBeatParts(beat),
      badge: { tone: "info", label: "Lesson" },
    });
  });
  return out;
}

// Telemetry (the loop's return path) lives in ./telemetry.ts — zod-free so the
// trusted viewer can import the validator without dragging the parts schema in.
export {
  formatTelemetryComment,
  isTelemetryText,
  SANDBOX_TELEMETRY_TYPES,
  type TelemetryEvent,
  validateTelemetryEvent,
} from "./telemetry.ts";
