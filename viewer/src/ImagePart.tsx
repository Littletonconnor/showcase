import { useState } from "react";
import type { ImagePart as ImagePartData } from "./api.ts";

// A trusted, viewer-chrome <img> for an uploaded asset (no iframe). The bytes
// live at /a/:id; an evicted/missing asset 404s, so show a placeholder rather
// than a broken image. Clicking opens the asset in a new tab.
export function ImagePart(props: { part: ImagePartData }) {
  const [failed, setFailed] = useState(false);
  const src = `/a/${props.part.assetId}`;
  return (
    <div className="imagepart">
      {failed ? (
        <div className="asset-gone">Image unavailable — it may have been evicted.</div>
      ) : (
        <>
          <a href={src} target="_blank" rel="noopener">
            <img
              className="asset-img"
              src={src}
              alt={props.part.alt ?? props.part.caption ?? "uploaded image"}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          </a>
          {props.part.caption ? <div className="asset-caption">{props.part.caption}</div> : null}
        </>
      )}
    </div>
  );
}
