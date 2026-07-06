// Per-learner mastery persistence — the learn vertical's memory across
// sessions (docs/learn-form-factor.md). Follows the JsonFileStore pattern
// (whole file in memory, the jsonFile.ts atomic write + .bak mirror) but is
// its OWN small store: mastery is learner state, not board
// content, so it lives in its own file (~/.showcase/mastery.json, override
// SHOWCASE_MASTERY) and never touches the board's Store interface (C4).
//
// Corruption policy is softer than the board's: mastery is derived data (the
// worst loss is re-reviewing early), so an unreadable file falls back to the
// .bak, and an unreadable .bak falls back to EMPTY with a warning — a learn
// session must never crash on a corrupt mastery file.

import {
  applyAttempt,
  collectDue,
  type DueConcept,
  initialRecord,
  isDue,
  type MasteryRecord,
  type MasteryTopic,
  type StoredConceptGraph,
  type SyllabusState,
} from "@showcase/core/mastery";
import type { CheckpointKind } from "@showcase/core/types";
import { readJsonFile, writeJsonFile } from "./jsonFile.ts";

export type {
  DueConcept,
  MasteryRecord,
  MasteryTopic,
  StoredConceptGraph,
  SyllabusState,
} from "@showcase/core/mastery";

interface FileShape {
  topics: Record<string, MasteryTopic>;
}

const clone = <T>(v: T): T => structuredClone(v);

export class MasteryStore {
  private topics = new Map<string, MasteryTopic>();
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private filePath: string;
  private clock: () => Date;

  // `clock` is the injected time source — tests and the review-due "time
  // travel" query pass explicit dates; production uses the default.
  constructor(filePath: string, clock: () => Date = () => new Date()) {
    this.filePath = filePath;
    this.clock = clock;
  }

  private async load() {
    if (this.loaded) return;
    this.loadPromise ??= this.loadFromDisk().finally(() => {
      this.loaded = true;
    });
    await this.loadPromise;
  }

  // Lenient recovery: any unreadable file falls back to the .bak, then to
  // EMPTY — a learn session must never crash on a corrupt mastery file.
  private async loadFromDisk() {
    const data = await readJsonFile<FileShape>(this.filePath, "lenient");
    for (const [topic, t] of Object.entries(data?.topics ?? {})) {
      if (t && typeof t === "object" && t.conceptGraph) this.topics.set(topic, t);
    }
  }

  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(() =>
        writeJsonFile(
          this.filePath,
          JSON.stringify({ topics: Object.fromEntries(this.topics) } satisfies FileShape, null, 2),
        ),
      );
    return this.writeQueue;
  }

  // Register (or refresh) a topic's concept graph and its live lesson session.
  // Mastery records survive: existing records keep their state; new concepts
  // get untouched records lazily on first attempt.
  async upsertTopic(
    topic: string,
    graph: StoredConceptGraph,
    live?: { sessionId?: string; syllabusSurfaceId?: string },
  ): Promise<MasteryTopic> {
    await this.load();
    const now = this.clock();
    const existing = this.topics.get(topic);
    const entry: MasteryTopic = {
      topic,
      conceptGraph: clone(graph),
      records: existing?.records ?? {},
      ...(live?.sessionId
        ? { sessionId: live.sessionId }
        : existing?.sessionId
          ? { sessionId: existing.sessionId }
          : {}),
      ...(live?.syllabusSurfaceId
        ? { syllabusSurfaceId: live.syllabusSurfaceId }
        : existing?.syllabusSurfaceId
          ? { syllabusSurfaceId: existing.syllabusSurfaceId }
          : {}),
      updatedAt: now.toISOString(),
    };
    // Keep labels current for concepts still in the graph.
    for (const c of graph.concepts) {
      const rec = entry.records[c.id];
      if (rec) rec.label = c.label;
    }
    this.topics.set(topic, entry);
    await this.persist();
    return clone(entry);
  }

  async getTopic(topic: string): Promise<MasteryTopic | null> {
    await this.load();
    const t = this.topics.get(topic);
    return t ? clone(t) : null;
  }

  async listTopics(): Promise<MasteryTopic[]> {
    await this.load();
    return [...this.topics.values()].map(clone);
  }

  // The topic whose latest lesson session is `sessionId` — how telemetry finds
  // where an attempt belongs.
  async topicForSession(sessionId: string): Promise<MasteryTopic | null> {
    await this.load();
    for (const t of this.topics.values()) {
      if (t.sessionId === sessionId) return clone(t);
    }
    return null;
  }

  // Record one graded attempt and return the updated record, or null when the
  // topic/concept is unknown. `at` overrides the clock (time-injected tests).
  async recordAttempt(
    topic: string,
    conceptId: string,
    attempt: { checkpointKind: CheckpointKind; correct: boolean; misconception?: string },
    at?: Date,
  ): Promise<MasteryRecord | null> {
    await this.load();
    const t = this.topics.get(topic);
    if (!t) return null;
    const concept = t.conceptGraph.concepts.find((c) => c.id === conceptId);
    if (!concept) return null;
    const now = at ?? this.clock();
    const rec = t.records[conceptId] ?? initialRecord(topic, conceptId, concept.label, now);
    const updated = applyAttempt(rec, attempt, now);
    t.records[conceptId] = updated;
    t.updatedAt = now.toISOString();
    await this.persist();
    return clone(updated);
  }

  async reset(topic: string): Promise<boolean> {
    await this.load();
    const had = this.topics.delete(topic);
    if (had) await this.persist();
    return had;
  }

  // Concept states for the syllabus card: solid/shaky from the record, "due"
  // overriding either once the review date arrives, untouched otherwise.
  async statesForTopic(topic: string, at?: Date): Promise<Record<string, SyllabusState>> {
    await this.load();
    const t = this.topics.get(topic);
    if (!t) return {};
    const now = at ?? this.clock();
    const out: Record<string, SyllabusState> = {};
    for (const c of t.conceptGraph.concepts) {
      const rec = t.records[c.id];
      out[c.id] = rec ? (isDue(rec, now) ? "due" : rec.state) : "untouched";
    }
    return out;
  }

  // Due checkpoints across every topic, interleaved (P11).
  async due(at?: Date): Promise<DueConcept[]> {
    await this.load();
    return collectDue([...this.topics.values()], at ?? this.clock());
  }
}
