import { useState } from "react";
import type { ImagePart as ImagePartData } from "./api.ts";

// A trusted, viewer-chrome <img> for an uploaded asset (no iframe). The bytes
// live at /a/:id; an evicted/missing asset 404s, so show a placeholder rather
// than a broken image. Clicking opens the asset in a new tab.
export function ImagePart(props: { part: ImagePartData }) {
  const [failed, setFailed] = useState(false);
  const src = `/a/${props.part.assetId}`;
  return (
    <div className="border-t-[0.5px] border-border px-3.5 py-3">
      {failed ? (
        <div className="px-3.5 py-2.5 text-xs text-faint">
          Image unavailable — it may have been evicted.
        </div>
      ) : (
        <>
          <a href={src} target="_blank" rel="noopener">
            <img
              className="block h-auto max-w-full rounded-lg border-[0.5px] border-border"
              src={src}
              alt={props.part.alt ?? props.part.caption ?? "uploaded image"}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          </a>
          {props.part.caption ? (
            <div className="mt-1.5 text-xs text-muted-foreground">{props.part.caption}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
