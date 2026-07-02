// Learner-interaction telemetry — the learn loop's return path (see
// docs/learn-form-factor.md and the security walkthrough in
// docs/learn-implementation-report.md). Deliberately dependency-free (no zod):
// the trusted viewer's sandbox bridge imports validateTelemetryEvent, and this
// module must cost nothing beyond itself in the bundle.

import { type CheckpointKind, isCheckpointKind } from "./types.ts";

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);


// A closed, versioned union. Everything is validated at the edge: the trusted
// viewer posts these from checkpoint components, and the sandbox bridge
// forwards ONLY `explorable_interaction` after re-validating (see
// docs/SECURITY.md + the learn form-factor doc). Length caps keep one event
// from bloating the agent's context; unknown shapes are dropped, never stored.

export type TelemetryEvent =
  | {
      v: 1;
      type: "checkpoint_attempt";
      checkpointId: string;
      conceptId: string;
      kind: CheckpointKind;
      answer: string | string[];
      correct?: boolean;
      misconception?: string;
      confidence?: number; // 0..1, calibration only (P3)
      latencyMs: number;
    }
  | { v: 1; type: "checkpoint_skipped"; checkpointId: string; conceptId: string }
  | { v: 1; type: "explorable_gate_passed"; checkpointId: string }
  | { v: 1; type: "explorable_interaction"; name: string; value: string }
  | { v: 1; type: "confusion_flag"; anchor?: string };

// The only event type the sandbox bridge may forward — everything else comes
// from trusted viewer components only.
export const SANDBOX_TELEMETRY_TYPES: readonly string[] = ["explorable_interaction"];

const MAX_ANSWER = 2000;
const MAX_ANSWER_ITEMS = 8;
const NAME_RE = /^[\w.-]{1,64}$/;
// Same short-token grammar checkpoint/concept ids use in lesson.ts.
const ID_RE = /^[\w.-]{1,80}$/;

const oneLine = (s: string, max: number): string =>
  s.replace(/[\r\n\t]+/g, " ").slice(0, max);

// Strict shape validation into a FRESH object (unknown fields never ride
// through). Returns null for anything malformed, oversized, or outside the
// closed union — callers drop silently.
export function validateTelemetryEvent(raw: unknown): TelemetryEvent | null {
  if (!isObj(raw) || raw.v !== 1 || typeof raw.type !== "string") return null;
  const id = (v: unknown): string | null =>
    typeof v === "string" && ID_RE.test(v.trim()) ? v.trim() : null;
  switch (raw.type) {
    case "checkpoint_attempt": {
      const checkpointId = id(raw.checkpointId);
      const conceptId = id(raw.conceptId);
      if (!checkpointId || !conceptId || !isCheckpointKind(raw.kind)) return null;
      let answer: string | string[];
      if (typeof raw.answer === "string") {
        answer = oneLine(raw.answer, MAX_ANSWER);
      } else if (
        Array.isArray(raw.answer) &&
        raw.answer.length <= MAX_ANSWER_ITEMS &&
        raw.answer.every((a) => typeof a === "string")
      ) {
        answer = raw.answer.map((a) => oneLine(a, 200));
      } else {
        return null;
      }
      if (typeof raw.latencyMs !== "number" || !isFinite(raw.latencyMs) || raw.latencyMs < 0) {
        return null;
      }
      if (raw.correct !== undefined && typeof raw.correct !== "boolean") return null;
      if (
        raw.confidence !== undefined &&
        (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1)
      ) {
        return null;
      }
      if (raw.misconception !== undefined && typeof raw.misconception !== "string") return null;
      return {
        v: 1,
        type: "checkpoint_attempt",
        checkpointId,
        conceptId,
        kind: raw.kind,
        answer,
        ...(raw.correct !== undefined ? { correct: raw.correct } : {}),
        ...(typeof raw.misconception === "string" && raw.misconception.trim()
          ? { misconception: oneLine(raw.misconception.trim(), 200) }
          : {}),
        ...(raw.confidence !== undefined
          ? { confidence: Math.round(raw.confidence * 100) / 100 }
          : {}),
        latencyMs: Math.min(Math.round(raw.latencyMs), 10_000_000),
      };
    }
    case "checkpoint_skipped": {
      const checkpointId = id(raw.checkpointId);
      const conceptId = id(raw.conceptId);
      if (!checkpointId || !conceptId) return null;
      return { v: 1, type: "checkpoint_skipped", checkpointId, conceptId };
    }
    case "explorable_gate_passed": {
      const checkpointId = id(raw.checkpointId);
      if (!checkpointId) return null;
      return { v: 1, type: "explorable_gate_passed", checkpointId };
    }
    case "explorable_interaction": {
      if (typeof raw.name !== "string" || !NAME_RE.test(raw.name)) return null;
      if (typeof raw.value !== "string") return null;
      return {
        v: 1,
        type: "explorable_interaction",
        name: raw.name,
        value: oneLine(raw.value, 200),
      };
    }
    case "confusion_flag": {
      const anchor =
        typeof raw.anchor === "string" && raw.anchor.trim()
          ? oneLine(raw.anchor.trim(), 200)
          : undefined;
      return { v: 1, type: "confusion_flag", ...(anchor ? { anchor } : {}) };
    }
    default:
      return null;
  }
}

// Render an event as the compact, fixed-format comment line that rides the
// feedback pipe. The FORMAT is the provenance signal: a `[checkpoint]` line is
// machine-built by this server from a validated event, never free text — the
// prefix + key=value grammar is what tells the agent (and the viewer) "this is
// telemetry, not something the human typed". explorable values originate in
// sandboxed, agent-authored script, so their line says so.
export function formatTelemetryComment(e: TelemetryEvent): string {
  switch (e.type) {
    case "checkpoint_attempt": {
      const answer = Array.isArray(e.answer) ? e.answer.join(", ") : e.answer;
      const graded =
        e.correct === undefined ? "ungraded — grade it and reply" : e.correct ? "correct" : "INCORRECT";
      const bits = [
        `[checkpoint] ${e.checkpointId} (${e.kind}, concept ${e.conceptId}): ${graded}`,
        `answer=${JSON.stringify(answer)}`,
        ...(e.misconception ? [`misconception=${JSON.stringify(e.misconception)}`] : []),
        ...(e.confidence !== undefined ? [`confidence=${e.confidence}`] : []),
        `latency=${(e.latencyMs / 1000).toFixed(1)}s`,
      ];
      return bits.join(" ");
    }
    case "checkpoint_skipped":
      return `[checkpoint] ${e.checkpointId} (concept ${e.conceptId}): skipped — repeated skips mean change the approach, not mastery`;
    case "explorable_gate_passed":
      return `[explorable] gate ${e.checkpointId} passed — the explorable is now unlocked`;
    case "explorable_interaction":
      return `[explorable] ${e.name}=${JSON.stringify(e.value)} (emitted by sandboxed card script, not typed by the user)`;
    case "confusion_flag":
      return `[confused] the learner flagged confusion${e.anchor ? ` at ${JSON.stringify(e.anchor)}` : ""} — pause and probe before moving on`;
  }
}

// True when a comment's text is a machine-built telemetry line (the viewer
// renders these as compact chips instead of chat bubbles).
export const isTelemetryText = (text: string): boolean =>
  /^\[(checkpoint|explorable|confused)\] /.test(text);
