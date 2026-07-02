// API integration for the learn vertical: publish a lesson, drive telemetry
// through the comment pipe, watch mastery move and the syllabus refresh —
// the loop's server half, end to end against the real app + stores.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "@showcase/server/app";
import { MasteryStore } from "@showcase/server/masteryStore";
import { JsonFileStore } from "@showcase/server/storage";

const T0 = new Date("2026-01-01T12:00:00Z");

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "showcase-learn-"));
  const clock = { now: T0 };
  const masteryStore = new MasteryStore(join(dir, "mastery.json"), () => clock.now);
  const app = createApp({
    store: new JsonFileStore(join(dir, "data.json")),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
    masteryStore,
  });
  return { app, clock, masteryStore };
}

const json = (body: unknown, method = "POST") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const lessonBody = () => ({
  topic: "Redis eviction",
  learnerLevel: "novice",
  conceptGraph: {
    concepts: [
      { id: "maxmemory", label: "maxmemory", misconceptions: [] },
      { id: "lru", label: "LRU approximation", misconceptions: ["true LRU"] },
    ],
    edges: [["maxmemory", "lru"]],
  },
  beats: [
    {
      conceptId: "lru",
      model: [{ kind: "markdown", markdown: "Redis samples keys; it is not a true LRU." }],
      checkpoints: [
        {
          id: "cp-lru-1",
          conceptId: "lru",
          kind: "mcq",
          prompt: "How does Redis pick an eviction victim?",
          options: [
            { id: "a", label: "Exact oldest key", misconception: "true LRU" },
            { id: "b", label: "Best of a random sample", correct: true },
          ],
          reveal: "It samples (default 5) and evicts the best candidate.",
        },
      ],
      recap: "Approximated LRU: sampled, not exact.",
    },
  ],
});

async function publishLesson(app: ReturnType<typeof makeApp>["app"]) {
  const res = await app.request("/api/lessons", json(lessonBody()));
  const text = await res.text();
  assert.equal(res.status, 201, text);
  return JSON.parse(text) as {
    sessionId: string;
    syllabusId: string;
    beats: { surfaceId: string; conceptId: string }[];
  };
}

test("publish_lesson creates a syllabus + beat surfaces pinned to the learn blueprint", async () => {
  const { app } = makeApp();
  const lesson = await publishLesson(app);
  assert.ok(lesson.syllabusId);
  assert.equal(lesson.beats.length, 1);
  const syllabus = (await (await app.request(`/api/surfaces/${lesson.syllabusId}`)).json()) as any;
  assert.equal(syllabus.blueprint, "learn");
  assert.equal(syllabus.parts[0].kind, "mermaid");
  assert.match(syllabus.parts[0].mermaid, /maxmemory/);
  const beat = (await (
    await app.request(`/api/surfaces/${lesson.beats[0].surfaceId}`)
  ).json()) as any;
  const kinds = beat.parts.map((p: any) => p.kind);
  assert.ok(kinds.includes("checkpoint"));
  // The reveal travels in the part data (the viewer gates it structurally).
  const cp = beat.parts.find((p: any) => p.kind === "checkpoint");
  assert.equal(cp.checkpoint.id, "cp-lru-1");
});

test("an invalid lesson is a 400 with the precise field error", async () => {
  const { app } = makeApp();
  const bad = lessonBody() as any;
  bad.beats[0].checkpoints[0].options = undefined;
  const res = await app.request("/api/lessons", json(bad));
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as any).error, /mcq checkpoint requires/);
});

test("telemetry rides the comment pipe exactly-once and moves mastery + syllabus", async () => {
  const { app, clock } = makeApp();
  const lesson = await publishLesson(app);
  const beatId = lesson.beats[0].surfaceId;

  // A wrong mcq attempt lands as a [checkpoint] comment.
  const res = await app.request(
    "/api/telemetry",
    json({
      surface: beatId,
      event: {
        v: 1,
        type: "checkpoint_attempt",
        checkpointId: "cp-lru-1",
        conceptId: "lru",
        kind: "mcq",
        answer: ["a"],
        correct: false,
        misconception: "true LRU",
        confidence: 0.9,
        latencyMs: 4000,
      },
    }),
  );
  assert.equal(res.status, 201);

  // Delivered through the author=user channel with the misconception tag...
  const wait = (await (
    await app.request(`/api/comments?session=${lesson.sessionId}&author=user&wait=0`)
  ).json()) as { comments: { text: string }[] };
  assert.equal(wait.comments.length, 1);
  assert.match(wait.comments[0].text, /^\[checkpoint\] cp-lru-1 \(mcq, concept lru\): INCORRECT/);
  assert.match(wait.comments[0].text, /misconception="true LRU"/);

  // ...exactly once: the cursor advanced, a re-read yields nothing.
  const again = (await (
    await app.request(`/api/comments?session=${lesson.sessionId}&author=user&wait=0`)
  ).json()) as { comments: unknown[] };
  assert.equal(again.comments.length, 0);

  // Mastery moved to shaky and the syllabus card re-rendered in place (v2).
  const mastery = (await (await app.request("/api/mastery?topic=Redis%20eviction")).json()) as any;
  const lru = mastery.topics[0].concepts.find((c: any) => c.id === "lru");
  assert.equal(lru.state, "shaky");
  assert.deepEqual(lru.misconceptions, ["true LRU"]);
  const syllabus = (await (await app.request(`/api/surfaces/${lesson.syllabusId}`)).json()) as any;
  assert.equal(syllabus.version, 2);
  assert.match(syllabus.parts[0].mermaid, /:::shaky/);

  // Time-travel: the concept comes due and review-due surfaces it.
  clock.now = new Date(T0.getTime() + 3 * 86400000);
  const due = (await (await app.request("/api/review-due")).json()) as any;
  assert.equal(due.due.length, 1);
  assert.equal(due.due[0].conceptId, "lru");
  assert.deepEqual(due.due[0].misconceptions, ["true LRU"]);
});

test("malformed and sandbox-disallowed telemetry is dropped, never stored", async () => {
  const { app } = makeApp();
  const lesson = await publishLesson(app);
  const beatId = lesson.beats[0].surfaceId;
  const drop = async (body: unknown) => {
    const res = await app.request("/api/telemetry", json(body));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { stored: false });
  };
  // Malformed shapes.
  await drop({ surface: beatId, event: { v: 1, type: "nonsense" } });
  await drop({ surface: beatId, event: { v: 1, type: "checkpoint_attempt" } });
  await drop({ surface: beatId, event: "not an object" });
  // A sandbox-flagged event outside the allowlist (a forged checkpoint attempt).
  await drop({
    surface: beatId,
    sandbox: true,
    event: {
      v: 1,
      type: "checkpoint_attempt",
      checkpointId: "cp-lru-1",
      conceptId: "lru",
      kind: "mcq",
      answer: ["b"],
      correct: true,
      latencyMs: 1,
    },
  });
  // Nothing reached the comment stream.
  const wait = (await (
    await app.request(`/api/comments?session=${lesson.sessionId}&author=user&wait=0`)
  ).json()) as { comments: unknown[] };
  assert.equal(wait.comments.length, 0);
  // But a sandbox explorable_interaction IS accepted and marked as such.
  const ok = await app.request(
    "/api/telemetry",
    json({
      surface: beatId,
      sandbox: true,
      event: { v: 1, type: "explorable_interaction", name: "slider", value: "42" },
    }),
  );
  assert.equal(ok.status, 201);
  const delivered = (await (
    await app.request(`/api/comments?session=${lesson.sessionId}&author=user&wait=0`)
  ).json()) as { comments: { text: string }[] };
  assert.match(delivered.comments[0].text, /^\[explorable\] slider="42"/);
  assert.match(delivered.comments[0].text, /sandboxed card script/);
});

test("record_attempt grades agent-side and update_lesson revises/appends beats", async () => {
  const { app } = makeApp();
  const lesson = await publishLesson(app);

  // The agent grades an explain answer correct.
  const grade = await app.request(
    "/api/mastery/attempt",
    json({ session: lesson.sessionId, conceptId: "lru", kind: "explain", correct: true }),
  );
  assert.equal(grade.status, 201);
  assert.equal(((await grade.json()) as any).record.state, "shaky");

  // Revise the existing beat in place.
  const beat = lessonBody().beats[0];
  beat.model = [{ kind: "markdown", markdown: "Revised model." }];
  const revised = await app.request(
    "/api/lessons/beats",
    json({ surfaceId: lesson.beats[0].surfaceId, beat }),
  );
  const revisedText = await revised.text();
  assert.equal(revised.status, 200, revisedText);
  assert.equal(JSON.parse(revisedText).version, 2);

  // Append a remediation card (no surfaceId).
  const remediation = await app.request(
    "/api/lessons/beats",
    json({
      session: lesson.sessionId,
      title: "Not a true LRU",
      beat: {
        conceptId: "lru",
        model: [
          { kind: "markdown", markdown: "You picked the true-LRU model. Here is why it fails." },
        ],
        checkpoints: [
          {
            id: "cp-lru-remed",
            conceptId: "lru",
            kind: "mcq",
            prompt: "With sample size 5, can the globally oldest key survive an eviction?",
            options: [
              { id: "a", label: "Yes — it may not be in the sample", correct: true },
              { id: "b", label: "No — LRU always finds it", misconception: "true LRU" },
            ],
            reveal: "Yes. Sampling means the true oldest can be missed.",
          },
        ],
        recap: "Sampled eviction is probabilistic.",
      },
    }),
  );
  const remediationText = await remediation.text();
  assert.equal(remediation.status, 200, remediationText);
  const card = JSON.parse(remediationText) as any;
  assert.equal(card.badge.label, "Remediation");
  const surfaces = (await (
    await app.request(`/api/sessions/${lesson.sessionId}/surfaces`)
  ).json()) as any[];
  assert.equal(surfaces.length, 3); // syllabus + beat + remediation
});

test("mastery routes degrade cleanly with no mastery store", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showcase-learn-nomastery-"));
  const app = createApp({
    store: new JsonFileStore(join(dir, "data.json")),
    viewerHtml: "<html>viewer</html>",
    guideMarkdown: "# guide",
    setupText: "# setup",
  });
  // Lessons still publish; telemetry still flows as comments.
  const res = await app.request("/api/lessons", json(lessonBody()));
  assert.equal(res.status, 201);
  const lesson = (await res.json()) as any;
  const t = await app.request(
    "/api/telemetry",
    json({
      surface: lesson.beats[0].surfaceId,
      event: {
        v: 1,
        type: "checkpoint_attempt",
        checkpointId: "cp-lru-1",
        conceptId: "lru",
        kind: "mcq",
        answer: ["b"],
        correct: true,
        latencyMs: 1,
      },
    }),
  );
  assert.equal(t.status, 201);
  assert.deepEqual(await (await app.request("/api/mastery")).json(), { topics: [], due: [] });
  assert.deepEqual(await (await app.request("/api/review-due")).json(), { due: [] });
  const attempt = await app.request(
    "/api/mastery/attempt",
    json({ topic: "x", conceptId: "c", kind: "mcq", correct: true }),
  );
  assert.equal(attempt.status, 400);
});

test("the MCP transport exposes the learn tools end to end", async () => {
  const { app } = makeApp();
  const rpc = async (method: string, params: unknown, id = 1) => {
    const res = await app.request("/mcp", json({ jsonrpc: "2.0", id, method, params }));
    return (await res.json()) as any;
  };
  const tools = await rpc("tools/list", {});
  const names = tools.result.tools.map((t: any) => t.name);
  for (const n of ["publish_lesson", "update_lesson", "get_learner_state", "record_attempt"]) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
  const published = await rpc("tools/call", {
    name: "publish_lesson",
    arguments: { ...lessonBody(), sessionTitle: "Learn: Redis eviction" },
  });
  assert.ok(!published.result.isError, JSON.stringify(published.result));
  const payload = JSON.parse(published.result.content[0].text);
  assert.ok(payload.syllabusId);
  const state = await rpc("tools/call", { name: "get_learner_state", arguments: {} });
  const parsed = JSON.parse(state.result.content[0].text);
  assert.equal(parsed.topics[0].topic, "Redis eviction");
});
