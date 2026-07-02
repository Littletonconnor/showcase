// Learn-mode client state: which checkpoints have been attempted (drives the
// structural reveal gating and the explorable unlock) plus the telemetry POST.
// Attempts persist to localStorage so a reload doesn't re-lock reveals the
// learner already earned — the durable record is the telemetry comment
// server-side; this is only the local render state.
import { create } from "zustand";
import { api } from "./api.ts";
import type { TelemetryEvent } from "@showcase/core/telemetry";

export interface AttemptState {
  answer: string | string[];
  correct?: boolean;
  skipped?: boolean;
  confidence?: number;
}

const STORAGE_KEY = "showcase-checkpoint-attempts";

function loadStored(): Record<string, AttemptState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

interface LearnState {
  attempts: Record<string, AttemptState>;
}

export const useLearn = create<LearnState>(() => ({ attempts: loadStored() }));

export function attemptFor(checkpointId: string): AttemptState | undefined {
  return useLearn.getState().attempts[checkpointId];
}

export function markAttempt(checkpointId: string, state: AttemptState): void {
  const attempts = { ...useLearn.getState().attempts, [checkpointId]: state };
  useLearn.setState({ attempts });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // localStorage full/unavailable — render state just won't survive reload
  }
}

// Post one event from a TRUSTED component (checkpoint UI). Fire-and-forget:
// a failed post must not block the learner's reveal — the attempt still
// happened; only the agent's copy is lost, and they can re-ask.
export function postTelemetry(surfaceId: string, event: TelemetryEvent): void {
  void api("/api/telemetry", {
    method: "POST",
    body: JSON.stringify({ surface: surfaceId, event }),
  }).catch(() => {});
}

// Forward one event a sandboxed frame emitted via showcase.emit. The caller
// (bridge.ts) has already validated it against the closed union and the
// sandbox allowlist; the server re-checks both (sandbox: true).
export function postSandboxTelemetry(surfaceId: string, event: TelemetryEvent): void {
  void api("/api/telemetry", {
    method: "POST",
    body: JSON.stringify({ surface: surfaceId, event, sandbox: true }),
  }).catch(() => {});
}
