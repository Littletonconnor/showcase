import { useRef, useState } from "react";
import { assetUrl, isReadonly, type ImagePart as ImagePartData } from "./api.ts";
import { openComposer, type Thread } from "./threads.ts";

// A trusted, viewer-chrome <img> for an uploaded asset (no iframe). The bytes
// live at /a/:id (or an inlined `data:` URI in a static export); an evicted/
// missing asset 404s, so show a placeholder rather than a broken image.
//
// Pin annotations (plannotator-style): on a live board, clicking the image
// opens the anchored-comment composer at that spot — the anchor carries the
// click position as percent coordinates, so it stays put at any render size.
// Existing pinned threads render as numbered dots; their text lives in the
// ThreadStrip below the part like every other anchored comment. The old
// open-in-new-tab click moves to a caption-row link.
export function ImagePart(props: {
  part: ImagePartData;
  surfaceId?: string;
  partIndex?: number;
  threads?: Thread[];
}) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const src = assetUrl(props.part.assetId);
  const interactive = props.surfaceId !== undefined && !isReadonly();

  const pins = (props.threads ?? []).flatMap((t, i) =>
    t.root.anchor?.pos && !t.root.resolved
      ? [{ pos: t.root.anchor.pos, n: i + 1, text: t.root.text }]
      : [],
  );

  const onClick = (e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img || !interactive) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    openComposer({
      surfaceId: props.surfaceId!,
      partIndex: props.partIndex ?? 0,
      pos: { x, y },
      x: e.clientX,
      y: e.clientY,
    });
  };

  return (
    <div className="border-t-[0.5px] border-border px-3.5 py-3">
      {failed ? (
        <div className="px-3.5 py-2.5 text-xs text-faint">
          Image unavailable — it may have been evicted.
        </div>
      ) : (
        <>
          <span className="relative inline-block max-w-full">
            <img
              ref={imgRef}
              data-image-part
              className={`block h-auto max-w-full rounded-lg border-[0.5px] border-border ${
                interactive ? "cursor-crosshair" : ""
              }`}
              src={src}
              alt={props.part.alt ?? props.part.caption ?? "uploaded image"}
              loading="lazy"
              title={interactive ? "Click to pin a comment here" : undefined}
              onClick={interactive ? onClick : undefined}
              onError={() => setFailed(true)}
            />
            {pins.map((p, i) => (
              <span
                key={i}
                data-image-pin
                title={p.text}
                style={{ left: `${p.pos.x}%`, top: `${p.pos.y}%` }}
                className="absolute z-10 flex size-4.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white shadow-md ring-2 ring-white/80 dark:ring-black/40"
              >
                {p.n}
              </span>
            ))}
          </span>
          <div className="mt-1.5 flex items-baseline gap-2 text-xs text-muted-foreground">
            {props.part.caption ? <span className="min-w-0">{props.part.caption}</span> : null}
            <a
              href={src}
              target="_blank"
              rel="noopener"
              className="ml-auto flex-none text-faint hover:text-foreground hover:underline"
            >
              open ↗
            </a>
          </div>
        </>
      )}
    </div>
  );
}
