import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  applyAttempt,
  collectDue,
  initialRecord,
  isDue,
  type MasteryTopic,
} from "@showcase/core/mastery";
import { MasteryStore } from "@showcase/server/masteryStore";

const T0 = new Date("2026-01-01T12:00:00Z");
const days = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

test("scheduler: correct answers expand the interval 1 -> 3 -> ~ease", () => {
  let rec = initialRecord("t", "c", "C", T0);
  assert.equal(rec.state, "untouched");
  rec = applyAttempt(rec, { checkpointKind: "mcq", correct: true }, T0);
  assert.equal(rec.intervalDays, 1);
  rec = applyAttempt(rec, { checkpointKind: "mcq", correct: true }, days(1));
  assert.equal(rec.intervalDays, 3);
  rec = applyAttempt(rec, { checkpointKind: "mcq", correct: true }, days(4));
  assert.ok(rec.intervalDays >= 6, String(rec.intervalDays));
  assert.equal(rec.dueAt, new Date(days(4).getTime() + rec.intervalDays * 86400000).toISOString());
});

test("scheduler: a miss resets the interval, dips ease, and marks shaky", () => {
  let rec = initialRecord("t", "c", "C", T0);
  rec = applyAttempt(rec, { checkpointKind: "explain", correct: true }, T0);
  rec = applyAttempt(rec, { checkpointKind: "explain", correct: true }, days(2));
  const easeBefore = rec.ease;
  rec = applyAttempt(rec, { checkpointKind: "mcq", correct: false, misconception: "m1" }, days(5));
  assert.equal(rec.state, "shaky");
  assert.equal(rec.intervalDays, 1);
  assert.ok(rec.ease < easeBefore);
  assert.equal(rec.attempts.at(-1)?.misconception, "m1");
});

test("solid requires 2+ SPACED correct generative attempts; recognition never suffices", () => {
  // Two mcq (recognition) corrects, spaced: still shaky.
  let rec = initialRecord("t", "c", "C", T0);
  rec = applyAttempt(rec, { checkpointKind: "mcq", correct: true }, T0);
  rec = applyAttempt(rec, { checkpointKind: "mcq", correct: true }, days(2));
  assert.equal(rec.state, "shaky");
  // Two generative corrects in the SAME sitting: still shaky (not spaced).
  rec = initialRecord("t", "c", "C", T0);
  rec = applyAttempt(rec, { checkpointKind: "explain", correct: true }, T0);
  rec = applyAttempt(
    rec,
    { checkpointKind: "apply", correct: true },
    new Date(T0.getTime() + 60_000),
  );
  assert.equal(rec.state, "shaky");
  // Two generative corrects a day apart: solid.
  rec = initialRecord("t", "c", "C", T0);
  rec = applyAttempt(rec, { checkpointKind: "explain", correct: true }, T0);
  rec = applyAttempt(rec, { checkpointKind: "apply", correct: true }, days(1));
  assert.equal(rec.state, "solid");
});

test("isDue: untouched is never due; touched becomes due when dueAt passes", () => {
  const rec = initialRecord("t", "c", "C", T0);
  assert.equal(isDue(rec, days(100)), false);
  const touched = applyAttempt(rec, { checkpointKind: "mcq", correct: true }, T0);
  assert.equal(isDue(touched, T0), false);
  assert.equal(isDue(touched, days(2)), true);
});

test("collectDue interleaves across topics, most overdue first within each", () => {
  const mk = (topic: string, conceptId: string, dueOffsetDays: number): MasteryTopic => {
    let rec = initialRecord(topic, conceptId, conceptId, T0);
    rec = applyAttempt(rec, { checkpointKind: "mcq", correct: true }, T0);
    rec = { ...rec, dueAt: days(dueOffsetDays).toISOString() };
    return {
      topic,
      conceptGraph: { concepts: [{ id: conceptId, label: conceptId }], edges: [] },
      records: { [conceptId]: rec },
      updatedAt: T0.toISOString(),
    };
  };
  const a: MasteryTopic = {
    ...mk("redis", "a1", 1),
    records: {
      ...mk("redis", "a1", 1).records,
      ...mk("redis", "a2", 2).records,
    },
  };
  const b = mk("effect", "b1", 1);
  const due = collectDue([a, b], days(10));
  assert.deepEqual(
    due.map((d) => `${d.topic}/${d.conceptId}`),
    ["redis/a1", "effect/b1", "redis/a2"],
  );
  assert.ok(due[0].overdueDays >= 8);
});

// --- MasteryStore persistence -------------------------------------------------

const tmpStore = () => join(mkdtempSync(join(tmpdir(), "showcase-mastery-")), "mastery.json");

test("MasteryStore round-trips topics, records, and survives reload", async () => {
  const path = tmpStore();
  const clock = { now: T0 };
  const store = new MasteryStore(path, () => clock.now);
  await store.upsertTopic(
    "redis",
    { concepts: [{ id: "lru", label: "LRU" }], edges: [] },
    { sessionId: "s1", syllabusSurfaceId: "syl1" },
  );
  const rec = await store.recordAttempt("redis", "lru", {
    checkpointKind: "mcq",
    correct: false,
    misconception: "true LRU",
  });
  assert.equal(rec?.state, "shaky");
  // A fresh instance reads the same file.
  const store2 = new MasteryStore(path, () => clock.now);
  const topic = await store2.getTopic("redis");
  assert.equal(topic?.sessionId, "s1");
  assert.equal(topic?.records.lru.attempts.length, 1);
  assert.equal(await store2.topicForSession("s1").then((t) => t?.topic), "redis");
  // States: shaky now, due after the interval passes.
  assert.deepEqual(await store2.statesForTopic("redis"), { lru: "shaky" });
  clock.now = days(3);
  assert.deepEqual(await store2.statesForTopic("redis"), { lru: "due" });
  const due = await store2.due();
  assert.equal(due.length, 1);
  assert.deepEqual(due[0].misconceptions, ["true LRU"]);
  // Reset clears the topic.
  assert.equal(await store2.reset("redis"), true);
  assert.equal(await store2.reset("redis"), false);
});

test("MasteryStore never crashes on a corrupt file — warns and starts empty", async () => {
  const path = tmpStore();
  writeFileSync(path, "{ not json !!!");
  const store = new MasteryStore(path, () => T0);
  assert.deepEqual(await store.listTopics(), []);
  // And it can write over the corruption.
  await store.upsertTopic("t", { concepts: [{ id: "c", label: "C" }], edges: [] });
  assert.equal((await store.listTopics()).length, 1);
});

test("MasteryStore recovers from the .bak when the live file is corrupted", async () => {
  const path = tmpStore();
  const store = new MasteryStore(path, () => T0);
  await store.upsertTopic("t", { concepts: [{ id: "c", label: "C" }], edges: [] });
  writeFileSync(path, "garbage");
  const store2 = new MasteryStore(path, () => T0);
  assert.equal((await store2.listTopics()).length, 1);
});

test("upsertTopic preserves existing records and refreshes labels", async () => {
  const path = tmpStore();
  const store = new MasteryStore(path, () => T0);
  await store.upsertTopic("t", { concepts: [{ id: "c", label: "Old" }], edges: [] });
  await store.recordAttempt("t", "c", { checkpointKind: "mcq", correct: true });
  await store.upsertTopic("t", {
    concepts: [
      { id: "c", label: "New" },
      { id: "d", label: "D" },
    ],
    edges: [["c", "d"]],
  });
  const topic = await store.getTopic("t");
  assert.equal(topic?.records.c.label, "New");
  assert.equal(topic?.records.c.attempts.length, 1);
  assert.deepEqual(await store.statesForTopic("t"), { c: "shaky", d: "untouched" });
});
