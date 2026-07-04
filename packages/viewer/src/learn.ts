// Learn-mode client state: which checkpoints have been attempted (drives the
// structural reveal gating and the explorable unlock) plus the telemetry POST.
// The durable record is the telemetry comment server-side; a fresh browser
// rebuilds its reveal state from those comments as they load (hydrateAttempts
// below), so earned reveals survive reloads AND follow the learner across
// browsers — no localStorage copy to drift.
import { create } from "zustand";
import { parseCheckpointComment, type TelemetryEvent } from "@showcase/core/telemetry";
import type { Comment } from "./api.ts";
import { postJson } from "./postJson.ts";
import { useBoard } from "./state.ts";

export interface AttemptState {
  answer: string | string[];
  correct?: boolean;
  skipped?: boolean;
  confidence?: number;
}

interface LearnState {
  attempts: Record<string, AttemptState>;
}

export const useLearn = create<LearnState>(() => ({ attempts: {} }));

export function markAttempt(checkpointId: string, state: AttemptState): void {
  useLearn.setState({ attempts: { ...useLearn.getState().attempts, [checkpointId]: state } });
}

// Rebuild attempt state from the session's telemetry comments — the server's
// durable copy of every attempt. An entry already in memory wins (it's this
// tab's own richer state, possibly still in flight to the server).
export function hydrateAttempts(comments: readonly Comment[]): void {
  const current = useLearn.getState().attempts;
  let patch: Record<string, AttemptState> | null = null;
  for (const c of comments) {
    if (c.author !== "user") continue;
    const parsed = parseCheckpointComment(c.text);
    if (!parsed || current[parsed.checkpointId] || patch?.[parsed.checkpointId]) continue;
    patch = {
      ...patch,
      [parsed.checkpointId]: {
        answer: parsed.answer,
        ...(parsed.correct !== undefined ? { correct: parsed.correct } : {}),
        ...(parsed.skipped ? { skipped: true } : {}),
        ...(parsed.confidence !== undefined ? { confidence: parsed.confidence } : {}),
      },
    };
  }
  if (patch) useLearn.setState({ attempts: { ...current, ...patch } });
}

// Comments arrive on session load and live over SSE — hydrating on every
// change also unlocks a second browser's reveals the moment the first one
// answers.
useBoard.subscribe((state, prev) => {
  if (state.comments !== prev.comments) hydrateAttempts(state.comments);
});

// Post one event from a TRUSTED component (checkpoint UI). Fire-and-forget:
// a failed post must not block the learner's reveal — the attempt still
// happened; only the agent's copy is lost, and they can re-ask.
export function postTelemetry(surfaceId: string, event: TelemetryEvent): void {
  void postJson("/api/telemetry", { surface: surfaceId, event });
}

// Forward one event a sandboxed frame emitted via showcase.emit. The caller
// (bridge.ts) has already validated it against the closed union and the
// sandbox allowlist; the server re-checks both (sandbox: true).
export function postSandboxTelemetry(surfaceId: string, event: TelemetryEvent): void {
  void postJson("/api/telemetry", { surface: surfaceId, event, sandbox: true });
}
