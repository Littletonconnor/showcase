// Mastery model + spaced-review scheduler — pure and runtime-agnostic (no
// `node:` imports, no clock reads: `now` is always injected). Persistence lives
// in server/masteryStore.ts; this file owns the wire shapes and the state
// transitions so they can be unit-tested with a fake clock.
//
// The scheduler is a deliberately simple SM-2 variant (see
// docs/learn-form-factor.md): spacing existing matters far more than schedule
// optimality, so this is an expanding schedule with an ease factor, not a
// research-grade model. "Solid" requires 2+ spaced correct attempts on
// GENERATIVE checkpoint kinds — recognition alone (mcq) never reaches solid,
// because generation is the stronger retention signal (P1/P3).

import type { CheckpointKind } from "./types.ts";

export type MasteryState = "untouched" | "shaky" | "solid";

// What the syllabus card badges: the mastery state, with "due" overriding a
// touched state once its spaced-review date arrives.
export type SyllabusState = MasteryState | "due";

// Kinds where the learner produces (rather than recognizes) the answer. Only
// these count toward "solid".
export const GENERATIVE_KINDS: readonly CheckpointKind[] = [
  "completion",
  "explain",
  "apply",
  "trace",
  "predict",
];

export interface MasteryAttempt {
  at: string; // ISO timestamp
  checkpointKind: CheckpointKind;
  correct: boolean;
  misconception?: string;
}

export interface MasteryRecord {
  topic: string;
  conceptId: string;
  label: string;
  state: MasteryState;
  attempts: MasteryAttempt[];
  ease: number; // SM-2-style ease factor
  intervalDays: number;
  dueAt: string; // ISO timestamp of the next spaced review
}

// A stored concept graph per topic — what the syllabus card and review-due
// variants are generated from (labels + prerequisite edges survive sessions).
export interface StoredConceptGraph {
  concepts: { id: string; label: string }[];
  edges: [string, string][];
}

export interface MasteryTopic {
  topic: string;
  conceptGraph: StoredConceptGraph;
  records: Record<string, MasteryRecord>; // keyed by conceptId
  // The latest lesson session/syllabus for this topic, so telemetry can update
  // the syllabus card in place as mastery moves.
  sessionId?: string;
  syllabusSurfaceId?: string;
  updatedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Scheduler tuning. MIN/MAX bound the ease factor; the first two correct
// intervals are fixed (1 then 3 days) before the multiplicative schedule takes
// over — the standard SM-2 opening.
const EASE_START = 2.2;
const EASE_MIN = 1.3;
const EASE_MAX = 2.8;
const EASE_GAIN = 0.05;
const EASE_LOSS = 0.2;
const MAX_ATTEMPTS_KEPT = 50;

export function initialRecord(
  topic: string,
  conceptId: string,
  label: string,
  now: Date,
): MasteryRecord {
  return {
    topic,
    conceptId,
    label,
    state: "untouched",
    attempts: [],
    ease: EASE_START,
    intervalDays: 0,
    dueAt: now.toISOString(),
  };
}

// Two attempts are "spaced" when at least 8 hours apart — enough to rule out
// same-sitting repeats without demanding a full calendar day.
const SPACED_MS = 8 * 60 * 60 * 1000;

function isSolid(attempts: MasteryAttempt[]): boolean {
  const generative = attempts.filter(
    (a) => a.correct && GENERATIVE_KINDS.includes(a.checkpointKind),
  );
  for (let i = 1; i < generative.length; i++) {
    const gap = Date.parse(generative[i].at) - Date.parse(generative[0].at);
    if (gap >= SPACED_MS) return true;
  }
  return false;
}

// Apply one graded attempt. Pure: returns a new record. An incorrect answer
// resets the interval short and dips ease (state -> shaky); a correct answer
// grows the interval by ease. Ungraded acts (skips, ungraded free text) do not
// come through here — only objective outcomes move mastery (P3).
export function applyAttempt(
  record: MasteryRecord,
  attempt: { checkpointKind: CheckpointKind; correct: boolean; misconception?: string },
  now: Date,
): MasteryRecord {
  const entry: MasteryAttempt = {
    at: now.toISOString(),
    checkpointKind: attempt.checkpointKind,
    correct: attempt.correct,
    ...(attempt.misconception ? { misconception: attempt.misconception } : {}),
  };
  const attempts = [...record.attempts, entry].slice(-MAX_ATTEMPTS_KEPT);
  let ease = record.ease;
  let intervalDays: number;
  let state: MasteryState;
  if (attempt.correct) {
    ease = Math.min(EASE_MAX, ease + EASE_GAIN);
    intervalDays =
      record.intervalDays <= 0
        ? 1
        : record.intervalDays === 1
          ? 3
          : Math.round(record.intervalDays * ease);
    state = isSolid(attempts) ? "solid" : "shaky";
  } else {
    ease = Math.max(EASE_MIN, ease - EASE_LOSS);
    intervalDays = 1;
    state = "shaky";
  }
  return {
    ...record,
    attempts,
    ease,
    intervalDays,
    state,
    dueAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString(),
  };
}

// Due = a touched concept whose spaced review date has arrived. Untouched
// concepts are never "due" (there is nothing to review yet).
export function isDue(record: MasteryRecord, now: Date): boolean {
  return record.state !== "untouched" && Date.parse(record.dueAt) <= now.getTime();
}

export interface DueConcept {
  topic: string;
  conceptId: string;
  label: string;
  state: MasteryState;
  dueAt: string;
  overdueDays: number;
  // The misconceptions this learner actually hit on this concept — review
  // variants should target them.
  misconceptions: string[];
}

// Collect due concepts across topics, INTERLEAVED (P11): round-robin across
// topics rather than blocked per topic, most-overdue first within each.
export function collectDue(topics: MasteryTopic[], now: Date): DueConcept[] {
  const perTopic = topics.map((t) =>
    Object.values(t.records)
      .filter((r) => isDue(r, now))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
      .map(
        (r): DueConcept => ({
          topic: t.topic,
          conceptId: r.conceptId,
          label: r.label,
          state: r.state,
          dueAt: r.dueAt,
          overdueDays: Math.max(0, Math.floor((now.getTime() - Date.parse(r.dueAt)) / DAY_MS)),
          misconceptions: [
            ...new Set(r.attempts.flatMap((a) => (a.misconception ? [a.misconception] : []))),
          ],
        }),
      ),
  );
  const out: DueConcept[] = [];
  for (let i = 0; perTopic.some((list) => i < list.length); i++) {
    for (const list of perTopic) {
      if (i < list.length) out.push(list[i]);
    }
  }
  return out;
}
