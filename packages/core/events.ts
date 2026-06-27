export type FeedEvent =
  | { type: "session-created" | "session-updated" | "session-deleted"; id: string }
  | { type: "surface-created" | "surface-updated"; id: string; sessionId: string; version: number }
  | { type: "surface-deleted"; id: string; sessionId: string }
  // Emitted when a decision-queue review is (re-)published for a session, so the
  // open review page re-fetches and the agent's revise lands in place — the live
  // half of the Prove-it / Challenge loop (docs/review-form-factor.md).
  | { type: "review-updated"; sessionId: string }
  | {
      type: "comment-created";
      id: string;
      sessionId: string;
      surfaceId: string | null;
      seq: number;
      // Who authored it — lets the viewer treat an agent reply as "agent is
      // working" activity while ignoring the user's own comments.
      author: string;
    }
  // Emitted when a session gains its first / loses its last agent waiter (an
  // author=user wait_for_feedback long-poll). Drives the viewer's live
  // "agent is listening" presence.
  | { type: "agent-presence"; sessionId: string; listening: boolean };

type Listener = (event: FeedEvent) => void;

// One bus per app instance (one process serves one board locally). An
// instance field rather than a module singleton so two apps in one process
// can't leak events to each other.
export class EventBus {
  private listeners = new Set<Listener>();

  broadcast(event: FeedEvent) {
    for (const fn of this.listeners) fn(event);
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
