import { useEffect } from "react";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Card } from "./Card.tsx";
import { exitReading, readingStep, useBoard } from "./state.ts";

// Reading mode: a full-screen, distraction-free reader showing one surface at a
// time, centered at a comfortable width, with prev/next paging through the
// current stream (arrows + buttons, Escape closes). The stream's own cards are
// unmounted while this is open (see SessionView), so each surface — and its
// iframes — mounts in exactly one place.
export function ReadingView() {
  const readingId = useBoard((s) => s.readingId);
  const surfaces = useBoard((s) => s.surfaces);
  useEffect(() => {
    if (!readingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.key === "Escape") exitReading();
      else if (e.key === "ArrowRight") readingStep(1);
      else if (e.key === "ArrowLeft") readingStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readingId]);

  if (!readingId) return null;
  const i = surfaces.findIndex((s) => s.id === readingId);
  const surface = surfaces[i];
  if (!surface) return null;
  const navBtn =
    "flex size-9 flex-none items-center justify-center rounded-full border-[0.5px] border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground disabled:opacity-0";
  return (
    <div
      role="dialog"
      aria-label="Reader"
      className="fixed inset-0 z-50 flex flex-col bg-background/97 backdrop-blur-sm"
    >
      <div className="flex flex-none items-center gap-3 border-b-[0.5px] border-border px-5 py-3">
        <BookOpen className="size-4 flex-none text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">{surface.title}</span>
        <span className="flex-1" />
        <span className="flex-none text-[12px] text-faint tabular-nums">
          {i + 1} / {surfaces.length}
        </span>
        <button
          type="button"
          aria-label="Close reader"
          onClick={() => exitReading()}
          className="flex size-7 flex-none items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-stretch">
        <div className="hidden flex-none items-center px-3 sm:flex">
          <button
            type="button"
            aria-label="Previous"
            disabled={i <= 0}
            onClick={() => readingStep(-1)}
            className={navBtn}
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[780px] px-5 py-10">
            <Card surface={surface} key={surface.id} />
          </div>
        </div>
        <div className="hidden flex-none items-center px-3 sm:flex">
          <button
            type="button"
            aria-label="Next"
            disabled={i >= surfaces.length - 1}
            onClick={() => readingStep(1)}
            className={navBtn}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
