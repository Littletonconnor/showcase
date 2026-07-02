import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coerceLesson,
  renderBeatParts,
  renderLessonSurfaces,
  renderSyllabusParts,
  type Lesson,
} from "@showcase/core/lesson";
import {
  formatTelemetryComment,
  isTelemetryText,
  SANDBOX_TELEMETRY_TYPES,
  validateTelemetryEvent,
} from "@showcase/core/telemetry";

// A minimal valid lesson the tests mutate from.
const validLesson = () => ({
  topic: "Redis eviction",
  learnerLevel: "novice",
  conceptGraph: {
    concepts: [
      { id: "maxmemory", label: "maxmemory", misconceptions: ["unlimited by default"] },
      { id: "lru", label: "LRU approximation", misconceptions: ["true LRU", "FIFO"] },
    ],
    edges: [["maxmemory", "lru"]],
  },
  beats: [
    {
      conceptId: "maxmemory",
      hook: {
        id: "hook-1",
        conceptId: "maxmemory",
        kind: "predict",
        prompt: "What happens on SET when memory is full?",
        options: [
          { id: "a", label: "The SET fails", correct: true },
          { id: "b", label: "Oldest key evicted", misconception: "eviction is default" },
        ],
        reveal: "With no policy set, writes error.",
      },
      model: [{ kind: "markdown", markdown: "Redis bounds memory with `maxmemory`." }],
      checkpoints: [
        {
          id: "cp-1",
          conceptId: "maxmemory",
          kind: "mcq",
          prompt: "Default maxmemory-policy?",
          options: [
            { id: "a", label: "noeviction", correct: true },
            { id: "b", label: "allkeys-lru", misconception: "eviction is default" },
          ],
          reveal: "noeviction — writes fail at the limit.",
        },
      ],
      recap: "maxmemory bounds the keyspace; the policy decides what happens at the edge.",
    },
  ],
});

test("coerceLesson accepts a valid lesson and normalizes it", () => {
  const parsed = coerceLesson(validLesson());
  assert.ok("lesson" in parsed, JSON.stringify(parsed));
  const lesson = (parsed as { lesson: Lesson }).lesson;
  assert.equal(lesson.topic, "Redis eviction");
  assert.equal(lesson.beats.length, 1);
  assert.equal(lesson.conceptGraph.edges.length, 1);
});

test("coerceLesson rejects structural problems with precise errors", () => {
  const cases: [(l: any) => void, RegExp][] = [
    [(l) => delete l.topic, /"topic"/],
    [(l) => (l.conceptGraph.concepts = []), /concepts/],
    [(l) => l.conceptGraph.edges.push(["maxmemory", "nope"]), /unknown concept/],
    [(l) => (l.beats = []), /"beats"/],
    [(l) => (l.beats[0].conceptId = "nope"), /matches no concept/],
    [(l) => (l.beats[0].model = []), /"model"/],
    [(l) => delete l.beats[0].recap, /"recap"/],
    [(l) => delete l.beats[0].checkpoints[0].reveal, /"reveal"/],
    // mcq must have options with exactly one correct
    [(l) => delete l.beats[0].checkpoints[0].options, /requires "options"/],
    [(l) => (l.beats[0].checkpoints[0].options[1].correct = true), /exactly one/],
    // duplicate checkpoint ids across the lesson
    [(l) => (l.beats[0].checkpoints[0].id = "hook-1"), /duplicate checkpoint id/],
    // html is not a legal model part
    [
      (l) => l.beats[0].model.push({ kind: "html", html: "<p>x</p>" }),
      /not allowed here/,
    ],
  ];
  for (const [mutate, re] of cases) {
    const l = validLesson() as any;
    mutate(l);
    const parsed = coerceLesson(l);
    assert.ok("error" in parsed, `expected error for ${re}`);
    assert.match((parsed as { error: string }).error, re);
  }
});

test("a beat with no checkpoints and no hook is rejected (P1)", () => {
  const l = validLesson() as any;
  l.beats[0].checkpoints = [];
  delete l.beats[0].hook;
  const parsed = coerceLesson(l);
  assert.ok("error" in parsed);
  assert.match((parsed as { error: string }).error, /at least one checkpoint/);
});

test("renderLessonSurfaces is deterministic (C8) and shaped syllabus-first", () => {
  const parsed = coerceLesson(validLesson());
  assert.ok("lesson" in parsed);
  const lesson = (parsed as { lesson: Lesson }).lesson;
  const a = renderLessonSurfaces(lesson, {});
  const b = renderLessonSurfaces(lesson, {});
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a[0].badge.label, "Syllabus");
  assert.equal(a[0].parts[0].kind, "mermaid");
  assert.equal(a.length, 2);
  assert.equal(a[1].title, "1. maxmemory");
});

test("renderBeatParts orders the fixed arc and gates the explorable", () => {
  const parsed = coerceLesson({
    ...validLesson(),
    beats: [
      {
        ...validLesson().beats[0],
        workedExample: [{ kind: "code", code: "SET k v", language: "text" }],
        explorable: {
          html: "<div>play</div>",
          gate: {
            id: "gate-1",
            conceptId: "maxmemory",
            kind: "predict",
            prompt: "Predict before you play",
            reveal: "Now try it.",
          },
        },
      },
    ],
  });
  assert.ok("lesson" in parsed, JSON.stringify(parsed));
  const beat = (parsed as { lesson: Lesson }).lesson.beats[0];
  const parts = renderBeatParts(beat);
  const kinds = parts.map((p) => p.kind);
  // hook framing + hook, model, worked-example heading + code, gate + html,
  // checkpoint heading + checkpoint, recap
  assert.deepEqual(kinds, [
    "markdown",
    "checkpoint",
    "markdown",
    "markdown",
    "code",
    "checkpoint",
    "html",
    "markdown",
    "checkpoint",
    "markdown",
  ]);
  // The gate checkpoint immediately precedes the html part and carries gate:true.
  const htmlIdx = kinds.indexOf("html");
  const gatePart = parts[htmlIdx - 1] as { kind: "checkpoint"; checkpoint: { gate?: boolean } };
  assert.equal(gatePart.checkpoint.gate, true);
});

test("syllabus badges reflect mastery states", () => {
  const graph = {
    concepts: [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ],
    edges: [["a", "b"] as [string, string]],
  };
  const parts = renderSyllabusParts("T", graph, { a: "solid", b: "due" });
  const mermaid = (parts[0] as { mermaid: string }).mermaid;
  assert.match(mermaid, /a\["Alpha \*"\]:::solid/);
  assert.match(mermaid, /b\["Beta !"\]:::due/);
  assert.match(mermaid, /a --> b/);
  const legend = (parts[1] as { markdown: string }).markdown;
  assert.match(legend, /1 solid/);
  assert.match(legend, /1 due/);
});

test("mermaid labels are sanitized against label breakouts", () => {
  const parts = renderSyllabusParts(
    "T",
    { concepts: [{ id: "x", label: 'evil"]; click x href "js' }], edges: [] },
    {},
  );
  const mermaid = (parts[0] as { mermaid: string }).mermaid;
  assert.ok(!mermaid.includes('"];'), mermaid);
  assert.match(mermaid, /x\["evil/);
});

// --- telemetry ---------------------------------------------------------------

test("validateTelemetryEvent accepts each closed-union member and strips junk", () => {
  const attempt = validateTelemetryEvent({
    v: 1,
    type: "checkpoint_attempt",
    checkpointId: "cp-1",
    conceptId: "lru",
    kind: "mcq",
    answer: ["b"],
    correct: false,
    misconception: "true LRU",
    confidence: 0.845,
    latencyMs: 12345.6,
    evil: "<script>",
  });
  assert.ok(attempt);
  assert.equal((attempt as any).evil, undefined);
  assert.equal((attempt as any).confidence, 0.85);
  assert.equal((attempt as any).latencyMs, 12346);

  assert.ok(
    validateTelemetryEvent({ v: 1, type: "checkpoint_skipped", checkpointId: "c", conceptId: "d" }),
  );
  assert.ok(validateTelemetryEvent({ v: 1, type: "explorable_gate_passed", checkpointId: "g" }));
  assert.ok(
    validateTelemetryEvent({ v: 1, type: "explorable_interaction", name: "slider.mem", value: "42" }),
  );
  assert.ok(validateTelemetryEvent({ v: 1, type: "confusion_flag", anchor: "beat 2" }));
});

test("validateTelemetryEvent drops malformed, oversized, and unknown events", () => {
  const bad: unknown[] = [
    null,
    "string",
    {},
    { v: 2, type: "confusion_flag" },
    { v: 1, type: "not_a_type" },
    { v: 1, type: "checkpoint_attempt", checkpointId: "c", conceptId: "d" }, // missing kind/answer
    {
      v: 1,
      type: "checkpoint_attempt",
      checkpointId: "c!", // illegal id chars
      conceptId: "d",
      kind: "mcq",
      answer: "a",
      latencyMs: 1,
    },
    { v: 1, type: "explorable_interaction", name: "has spaces", value: "x" },
    { v: 1, type: "explorable_interaction", name: "n", value: 42 },
    { v: 1, type: "explorable_interaction", name: "x".repeat(65), value: "v" },
    {
      v: 1,
      type: "checkpoint_attempt",
      checkpointId: "c",
      conceptId: "d",
      kind: "mcq",
      answer: Array.from({ length: 9 }, () => "a"), // too many answer items
      latencyMs: 1,
    },
  ];
  for (const raw of bad) {
    assert.equal(validateTelemetryEvent(raw), null, JSON.stringify(raw));
  }
});

test("oversized strings are capped, newlines flattened", () => {
  const e = validateTelemetryEvent({
    v: 1,
    type: "explorable_interaction",
    name: "slider",
    value: "line1\nline2\t" + "x".repeat(500),
  });
  assert.ok(e);
  const value = (e as { value: string }).value;
  assert.ok(value.length <= 200);
  assert.ok(!value.includes("\n"));
});

test("formatTelemetryComment produces fixed, prefixed lines", () => {
  const line = formatTelemetryComment({
    v: 1,
    type: "checkpoint_attempt",
    checkpointId: "cp-1",
    conceptId: "lru",
    kind: "mcq",
    answer: ["b"],
    correct: false,
    misconception: "true LRU",
    confidence: 0.9,
    latencyMs: 8200,
  });
  assert.match(line, /^\[checkpoint\] cp-1 \(mcq, concept lru\): INCORRECT/);
  assert.match(line, /misconception="true LRU"/);
  assert.ok(isTelemetryText(line));
  const sandboxLine = formatTelemetryComment({
    v: 1,
    type: "explorable_interaction",
    name: "s",
    value: "v",
  });
  assert.match(sandboxLine, /sandboxed card script/);
  assert.ok(isTelemetryText(sandboxLine));
  assert.ok(!isTelemetryText("ordinary user comment"));
});

test("the sandbox allowlist contains only explorable_interaction", () => {
  assert.deepEqual([...SANDBOX_TELEMETRY_TYPES], ["explorable_interaction"]);
});
