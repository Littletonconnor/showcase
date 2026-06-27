// Renders a session's decision-queue review INSIDE the board's main panel (the
// place surfaces would go), so a review reads like any other session instead of
// a separate page. Fetches the review and live-updates on the `review-updated`
// SSE event — the same data path as the standalone ReviewPage, minus the page
// chrome.
import { useEffect, useState } from "react";
import type { FeedEvent } from "../../../server/events.ts";
import type { Review } from "../../../server/types.ts";
import { api, appPath, exportBundle, isReadonly } from "../api.ts";
import { ReviewView } from "./ReviewView.tsx";

export function ReviewInline(props: { sessionId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [missing, setMissing] = useState(false);

  // A static export inlines the review and disables the verbs; render it
  // read-only and skip the live channel (there's no server to stream from).
  const readonly = isReadonly() || !!exportBundle();
  const sessionId = props.sessionId;
  useEffect(() => {
    let live = true;
    const loadReview = () =>
      api<Review>(`/api/sessions/${encodeURIComponent(sessionId)}/review`)
        .then((r) => live && (setReview(r), setMissing(false)))
        .catch(() => live && setMissing(true));
    loadReview();

    if (readonly) return () => void (live = false);
    const es = new EventSource(appPath(`/api/events?session=${encodeURIComponent(sessionId)}`));
    es.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as FeedEvent;
      if (e.type === "review-updated" && e.sessionId === sessionId) loadReview();
    };
    return () => {
      live = false;
      es.close();
    };
  }, [sessionId, readonly]);

  if (missing || !review) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
        {missing ? "No review for this session yet." : "Loading review…"}
      </div>
    );
  }
  return <ReviewView review={review} sessionId={sessionId} readonly={readonly} embedded />;
}
