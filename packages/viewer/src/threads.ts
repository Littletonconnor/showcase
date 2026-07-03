// Anchored-comment client state: the pending selection/composer target (one at
// a time, plannotator-style popover) plus the post/resolve calls. Threads
// themselves are derived from the board's comment list (state.ts) — this
// module only owns the ephemeral "where is the composer pointing" state.
import { create } from "zustand";
import { api, type Comment } from "./api.ts";
import { toast } from "./state.ts";

export interface ComposerTarget {
  surfaceId: string;
  partIndex: number;
  // Anchor precision (whichever the source affordance knows).
  quote?: string;
  line?: number;
  file?: string;
  step?: number;
  // Viewport position the popover anchors to (fixed coordinates).
  x: number;
  y: number;
}

interface ThreadState {
  composer: ComposerTarget | null;
}

export const useThreads = create<ThreadState>(() => ({ composer: null }));

export function openComposer(target: ComposerTarget): void {
  useThreads.setState({ composer: target });
}

export function closeComposer(): void {
  if (useThreads.getState().composer) useThreads.setState({ composer: null });
}

// Post the anchored comment. author=user: this is a genuine trusted-origin
// keystroke path (the quote rode in from the sandbox as data, but the TEXT is
// typed here).
export async function postAnchoredComment(target: ComposerTarget, text: string): Promise<boolean> {
  try {
    await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({
        surface: target.surfaceId,
        text,
        anchor: {
          partIndex: target.partIndex,
          ...(target.quote ? { quote: target.quote } : {}),
          ...(target.line !== undefined ? { line: target.line } : {}),
          ...(target.file ? { file: target.file } : {}),
          ...(target.step !== undefined ? { step: target.step } : {}),
        },
      }),
    });
    toast("Sent — the agent reads this on its next check-in");
    return true;
  } catch {
    toast("Couldn't send the comment");
    return false;
  }
}

export async function replyInThread(rootId: string, text: string): Promise<boolean> {
  try {
    await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({ replyTo: rootId, text }),
    });
    return true;
  } catch {
    toast("Couldn't send the reply");
    return false;
  }
}

export async function setResolved(rootId: string, resolved: boolean): Promise<void> {
  await api(`/api/comments/${rootId}`, {
    method: "PATCH",
    body: JSON.stringify({ resolved }),
  }).catch(() => toast("Couldn't update the thread"));
}

// Group a surface's comments into anchored threads: roots (anchored, no
// replyTo) with their replies in seq order. Whole-card comments (no anchor)
// are left out — the popover flow always anchors.
export interface Thread {
  root: Comment;
  replies: Comment[];
}

export function threadsFor(comments: Comment[], surfaceId: string): Map<number, Thread[]> {
  const byPart = new Map<number, Thread[]>();
  const roots = comments.filter((c) => c.surfaceId === surfaceId && c.anchor && !c.replyTo);
  for (const root of roots) {
    const replies = comments.filter((c) => c.replyTo === root.id);
    const list = byPart.get(root.anchor!.partIndex) ?? [];
    list.push({ root, replies });
    byPart.set(root.anchor!.partIndex, list);
  }
  return byPart;
}
