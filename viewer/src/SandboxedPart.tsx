import { useEffect, useMemo, useRef } from "react";
import { renderSandboxedPart } from "../../server/surfacePage.ts";
import { themeById } from "../../server/themes.ts";
import { isFlatten } from "./api.ts";
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

// The part CSS targets `body` as its root (the iframe document's body); a shadow
// root has no body, so remap those rules to `:host` (the host element). Only the
// leading `body` of a selector — `body {`, `body > x` — never `tbody`/attribute
// values (word boundary + a rule delimiter before it).
function bodyToHost(css: string): string {
  return css.replace(/(^|[{}>;,])(\s*)body\b/g, "$1$2:host");
}

// Flatten/PDF mode: render the part's HTML inline (in document flow) inside a
// shadow root instead of a srcdoc iframe, so a tall part splits across print
// pages instead of being stranded or clipped at the iframe height cap. The
// shadow root scopes the part's CSS, and `setHTMLUnsafe` parses @pierre/diffs'
// declarative shadow roots while — like all fragment parsing — never executing
// `<script>`, so the inlined library markup stays inert. Theme custom properties
// inherit across the shadow boundary from :root, so colors match the chrome.
function InlinePart(props: { body: string; css: string; class?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const activeTheme = useActiveTheme();
  const mode = useResolvedMode();
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const html = `<style>:host{display:block}${bodyToHost(props.css)}</style>${props.body}`;
    const sink = root as ShadowRoot & { setHTMLUnsafe?: (html: string) => void };
    if (typeof sink.setHTMLUnsafe === "function") sink.setHTMLUnsafe(html);
    else root.innerHTML = html;
  }, [props.body, props.css, activeTheme, mode]);
  return <div ref={hostRef} className={props.class ?? "partframe"} />;
}

type SandboxedPartProps = {
  body: string;
  css: string;
  class?: string;
};

// Dispatcher: the PDF export flattens rich parts into the document so they
// paginate; the live board renders each part in an opaque-origin sandbox iframe.
// isFlatten is a page-lifetime constant, so this branch is stable per mount —
// keeping the hook-bearing work in two child components satisfies the rules of hooks.
export function SandboxedPart(props: SandboxedPartProps) {
  if (isFlatten()) return <InlinePart body={props.body} css={props.css} class={props.class} />;
  return <FramePart {...props} />;
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
function FramePart(props: SandboxedPartProps) {
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
    const onMessage = (ev: MessageEvent) => {
      if (ev.source !== frame.contentWindow) return;
      const d = ev.data as {
        __showcase?: boolean;
        type?: string;
        height?: number;
      } | null;
      if (!d || !d.__showcase) return;
      if (d.type === "resize") {
        applyFrameHeight(frame, d.height);
      }
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
    // key={doc} forces a brand-new iframe (a guaranteed fresh parse) whenever the
    // document changes. Some Chrome builds don't re-parse an existing iframe when
    // its srcdoc attribute is updated, so a part that renders async (mermaid:
    // empty first, then the SVG) gets stuck on the initial empty document and the
    // surface shows an empty strip. Remounting on doc change sidesteps that.
    <iframe
      key={doc}
      ref={frameRef}
      className={props.class ?? "partframe"}
      sandbox="allow-scripts"
      srcDoc={doc}
    ></iframe>
  );
}
