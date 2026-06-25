import { useEffect, useMemo, useRef } from "react";
import { renderSandboxedPart } from "../../server/surfacePage.ts";
import { themeById } from "../../server/themes.ts";
import { useActiveTheme, useResolvedMode } from "./theme.ts";

// location.origin is constant for the page lifetime — read it once, not per
// srcdoc rebuild.
const ORIGIN = location.origin;

// Size a surface iframe from a height the in-frame bridge reported. Shared by
// SandboxedPart (rich/comment frames) and App's bridge handler (html-part
// frames) so every sandboxed surface clamps to the same bounds — min one line,
// max generous enough for a long diff/markdown without runaway growth.
const MIN_H = 24;
const MAX_H = 4000;
export function applyFrameHeight(iframe: HTMLIFrameElement, reportedHeight: unknown): void {
  iframe.style.height = Math.min(Math.max(Number(reportedHeight), MIN_H), MAX_H) + "px";
}

// Renders agent-produced markup (markdown, mermaid, diff) inside the SAME
// opaque-origin sandbox html parts use, instead of innerHTML in the trusted
// viewer. The caller renders the part to a STRING (string building is not a DOM
// sink, so it is safe in the trusted origin); the markup only becomes live DOM
// inside this iframe, where an opaque origin + tight CSP contain any sanitizer
// regression. `body`/`css` are reactive — a theme switch rebuilds the doc and
// reloads the frame (the same way Card reloads html-part iframes on theme).
//
// Resize is handled locally: the bridge in the doc posts its content height, and
// each frame sizes itself from messages whose source is its own contentWindow.
// (Link clicks and the session-switch shortcut ride App's global bridge handler,
// which keys off message type, not the frame registry.)
export function SandboxedPart(props: { body: string; css: string; class?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const activeTheme = useActiveTheme();
  const mode = useResolvedMode();

  const doc = useMemo(
    () =>
      renderSandboxedPart({
        body: props.body,
        css: props.css,
        origin: ORIGIN,
        theme: themeById(activeTheme),
        mode,
      }),
    [props.body, props.css, activeTheme, mode],
  );

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // Some Chrome builds lay out opaque-origin srcdoc iframes with innerWidth 0,
    // so the content (an SVG diagram, a percentage box) collapses to an empty
    // strip. The frame reports its content width; when it's 0, push the frame's
    // real element width in so its layout no longer depends on the broken
    // innerWidth. Bounded so a genuinely 0-width frame can't loop.
    let widthInjections = 0;
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frame.contentWindow) return;
      const d = ev.data as {
        __showcase?: boolean;
        type?: string;
        height?: number;
        width?: number;
      } | null;
      if (!d || !d.__showcase || d.type !== "resize") return;
      if ((!d.width || d.width <= 0) && widthInjections < 3 && frame.clientWidth > 0) {
        widthInjections++;
        frame.contentWindow?.postMessage(
          { __showcase: true, type: "host-width", width: frame.clientWidth },
          "*",
        );
        return;
      }
      applyFrameHeight(frame, d.height);
    };
    window.addEventListener("message", onMessage);

    // Chrome field-trial workaround: certain Chrome 149 A/B experiments break
    // layout measurement in opaque-origin srcdoc iframes — scrollHeight,
    // offsetHeight, innerWidth all read as 0.  The bridge may fire with only
    // the body-padding height (≤ MIN_H) because the content was never laid
    // out, then never re-fire because no resize occurs.  Re-setting the
    // srcdoc attribute forces a fresh HTML parse that consistently recovers
    // layout.  One retry after 2 s is enough; the re-parsed bridge fires
    // within ~60 ms.
    const retryId = setTimeout(() => {
      if (frame.isConnected && frame.srcdoc && frame.offsetHeight <= MIN_H) {
        const s = frame.srcdoc;
        frame.srcdoc = "";
        requestAnimationFrame(() => {
          frame.srcdoc = s;
        });
      }
    }, 2000);

    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(retryId);
    };
  }, [doc]);

  return (
    <iframe
      ref={frameRef}
      className={props.class ?? "partframe"}
      sandbox="allow-scripts"
      srcDoc={doc}
    ></iframe>
  );
}
