// Loads a stored decision-queue review for a session and renders the form
// factor. Reached via `?review=<sessionId>` (see main.tsx). The data path:
// the agent publishes to POST /api/sessions/:id/review; this fetches it back,
// and re-fetches whenever the agent re-publishes (the `review-updated` SSE
// event) so a revision updates the decision in place.
import { useEffect, useState } from "react";
import type { FeedEvent } from "@showcase/core/events";
import type { Review } from "@showcase/core/types";
import { api, appPath, exportBundle, isReadonly } from "../api.ts";
import { ReviewView } from "./ReviewView.tsx";

function Centered(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background text-[14px] text-muted-foreground">
      {props.children}
    </div>
  );
}

export function ReviewPage(props: { sessionId: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readonly = isReadonly() || !!exportBundle();

  const sessionId = props.sessionId;
  useEffect(() => {
    let live = true;
    const loadReview = () =>
      api<Review>(`/api/sessions/${encodeURIComponent(sessionId)}/review`)
        .then((r) => live && setReview(r))
        .catch((e) => live && setError(String(e?.message ?? e)));
    loadReview();

    // A static export has no server to stream from — the review is already
    // inlined and the verbs are disabled, so skip the live channel entirely.
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

  if (error) return <Centered>No review found for this session.</Centered>;
  if (!review) return <Centered>Loading review…</Centered>;
  return (
    <ReviewView
      review={review}
      sessionId={sessionId}
      readonly={readonly}
      onBack={() => (location.search = "")}
    />
  );
}
