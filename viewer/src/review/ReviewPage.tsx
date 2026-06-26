// Loads a stored decision-queue review for a session and renders the form
// factor. Reached via `?review=<sessionId>` (see main.tsx). The data path:
// the agent publishes to POST /api/sessions/:id/review; this fetches it back.
import { useEffect, useState } from "react";
import type { Review } from "../../../server/types.ts";
import { api } from "../api.ts";
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

  useEffect(() => {
    let live = true;
    api<Review>(`/api/sessions/${encodeURIComponent(props.sessionId)}/review`)
      .then((r) => live && setReview(r))
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [props.sessionId]);

  if (error) return <Centered>No review found for this session.</Centered>;
  if (!review) return <Centered>Loading review…</Centered>;
  return <ReviewView review={review} />;
}
