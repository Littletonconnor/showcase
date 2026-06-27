// Renders a session's decision-queue review INSIDE the board's main panel (the
// place surfaces would go), so a review reads like any other session instead of
// a separate page. Fetches the review + its comment trail and live-updates on
// the `review-updated` / `comment-created` SSE events — the same data path as
// the standalone ReviewPage, minus the page chrome.
import { useEffect, useState } from "react";
import type { FeedEvent } from "../../../server/events.ts";
import type { Comment, Review } from "../../../server/types.ts";
import { api, appPath } from "../api.ts";
import { ReviewView } from "./ReviewView.tsx";

export function ReviewInline(props: { sessionId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [missing, setMissing] = useState(false);

  const sessionId = props.sessionId;
  useEffect(() => {
    let live = true;
    const loadReview = () =>
      api<Review>(`/api/sessions/${encodeURIComponent(sessionId)}/review`)
        .then((r) => live && (setReview(r), setMissing(false)))
        .catch(() => live && setMissing(true));
    const loadComments = () =>
      api<{ comments: Comment[] }>(`/api/comments?session=${encodeURIComponent(sessionId)}`)
        .then((r) => live && setComments(r.comments))
        .catch(() => {});
    loadReview();
    loadComments();

    const es = new EventSource(appPath(`/api/events?session=${encodeURIComponent(sessionId)}`));
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as FeedEvent;
      if (e.type === "review-updated" && e.sessionId === sessionId) loadReview();
      else if (e.type === "comment-created" && e.sessionId === sessionId) loadComments();
    };
    return () => {
      live = false;
      es.close();
    };
  }, [sessionId]);

  if (missing || !review) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        {missing ? "No review for this session yet." : "Loading review…"}
      </div>
    );
  }
  return <ReviewView review={review} sessionId={sessionId} comments={comments} embedded />;
}
