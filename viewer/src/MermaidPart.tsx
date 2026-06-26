import { useEffect, useState } from "react";
import type { MermaidPart as MermaidPartData } from "./api.ts";
import { SandboxedPart } from "./SandboxedPart.tsx";
import { useActiveTheme, useResolvedMode } from "./theme.ts";

// Wrapper styles shipped into the sandbox iframe. Mermaid bakes theme colors
// into the SVG itself (read from the trusted viewer's vars at render time), so
// the iframe only needs to center and constrain it.
// Wrapper styles shipped into the sandbox iframe — center and constrain the SVG.
const MERMAID_CSS = `
body { margin: 0; padding: 14px 16px; background: transparent; text-align: center; }
svg { max-width: 100%; height: auto; }
`;

// mermaid.render namespaces the SVG's internal ids with this; it must be unique
// per render across the whole document, so a module-level counter, not a uuid.
let seq = 0;

// Mermaid's stock themes ignore our design tokens, so the diagram reads as
// generic mermaid. Instead drive its `base` theme from the viewer's own CSS
// custom properties (read live — this part renders in the trusted origin, so
// getComputedStyle is fine). The vars already flip light/dark, so re-rendering
// on a scheme change (below) is all that's needed to stay in sync. Returns the
// `themeVariables` + `themeCSS` mermaid needs to match showcase's look.
function showcaseTheme() {
  const css = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;

  const text = v("--text", "#1a1915");
  const muted = v("--muted", "#6b6a62");
  const border = v("--border-2", "#d6d2c4");
  const panel = v("--panel", "#f0eee6");
  const surface = v("--surface", "#ffffff");
  const bg = v("--bg", "#f7f6f1");
  const accent = v("--accent", "#bd5b3c");
  const accentBg = v("--accent-bg", "#f6e7df");
  // The viewer has no font token — its system stack lives on `body` — so match
  // the diagram font to whatever the rest of the viewer is actually rendering.
  const font = getComputedStyle(document.body).fontFamily || "ui-sans-serif, system-ui, sans-serif";

  return {
    themeVariables: {
      fontFamily: font,
      fontSize: "14px",
      // shared / flowchart
      primaryColor: panel,
      primaryBorderColor: border,
      primaryTextColor: text,
      secondaryColor: surface,
      tertiaryColor: bg,
      mainBkg: panel,
      nodeBorder: border,
      lineColor: muted,
      textColor: text,
      clusterBkg: bg,
      clusterBorder: border,
      edgeLabelBackground: bg,
      // sequence diagrams have their own palette
      actorBkg: panel,
      actorBorder: border,
      actorTextColor: text,
      actorLineColor: muted,
      signalColor: muted,
      signalTextColor: text,
      labelBoxBkgColor: surface,
      labelBoxBorderColor: border,
      labelTextColor: text,
      loopTextColor: text,
      noteBkgColor: accentBg,
      noteBorderColor: border,
      noteTextColor: text,
      sequenceNumberColor: surface,
    },
    // Flat-and-clean to match the design language: rounded rects, hairline
    // strokes, no heavy borders. Plus agent-facing accent classes (see below).
    themeCSS: `
      .node rect, .node polygon, rect.actor, .labelBox { rx: 10px; ry: 10px; }
      .node rect, rect.actor { stroke-width: 1px; }
      /* Node labels read as UI text, not diagram filler: a touch of weight and
         tighter tracking so boxes feel deliberate. */
      .node .nodeLabel, .node span, .node text, rect.actor + text, .actor text {
        font-weight: 500;
        letter-spacing: -0.006em;
      }
      /* Lift nodes off the card with a soft layered shadow so the diagram reads
         as designed rather than flat (no-op in dark, where the border carries
         it). */
      .node rect, .node polygon, .node circle, rect.actor, .labelBox {
        filter: drop-shadow(0 1px 1px rgba(20, 18, 10, 0.05))
          drop-shadow(0 2px 5px rgba(20, 18, 10, 0.06));
      }
      /* Subgraph containers: rounder + a warm hairline, so they frame without
         competing with the nodes. */
      .cluster rect { rx: 12px; ry: 12px; }
      /* Edges: a hair softer than the nodes, with rounded joins so the basis
         curves don't kink at the arrowhead. */
      .edgePath .path, .flowchart-link, .actor-line,
      .messageLine0, .messageLine1 {
        stroke-width: 1.25px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .marker, marker path { fill: ${muted}; stroke: ${muted}; }
      /* Edge labels sit on a chip so they stay legible over a crossing edge. */
      .edgeLabel .label, .edgeLabel foreignObject { border-radius: 6px; }

      /* Agent-applied highlight classes, colored from --accent. Apply in a
         flowchart with A:::accent (a node) or 'class A,B accent'. 'accent'
         fills a node with the brand color; 'accentLine' recolors an edge
         (pair with linkStyle to target a specific link). */
      .node.accent > rect, .node.accent > polygon, .node.accent > circle,
      .node.accent > path { fill: ${accentBg}; stroke: ${accent}; }
      .node.accent .nodeLabel, .node.accent span, .node.accent text { fill: ${accent}; color: ${accent}; }
      .flowchart-link.accentLine, .edgePath.accentLine > .path { stroke: ${accent}; }
    `,
  };
}

export function MermaidPart(props: { part: MermaidPartData }) {
  const activeTheme = useActiveTheme();
  const mode = useResolvedMode();
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Initial paint, plus a re-render whenever the color scheme flips or the
  // board theme changes: mermaid bakes theme colors into the SVG at render time
  // (unlike shiki's dual-theme output, which a CSS rule can flip), so the diagram
  // must be re-rendered on both. applyTheme injects the chrome vars before
  // activeTheme updates, so the getComputedStyle in showcaseTheme() already sees
  // the new values.
  useEffect(() => {
    let disposed = false;
    const render = async () => {
      const src = props.part.mermaid ?? "";
      try {
        // Lazy-load mermaid (a heavy dep) only when a mermaid part actually
        // mounts. mermaid is the default export.
        const mermaid = (await import("mermaid")).default;
        // securityLevel 'strict' makes mermaid sanitize the generated SVG with
        // its bundled DOMPurify and disables inline HTML labels and click
        // handlers — this part renders in the trusted viewer origin (no
        // sandbox), so never relax it. suppressErrorRendering keeps a parse
        // failure from injecting mermaid's "bomb" graphic into document.body;
        // we render our own error fallback instead.
        const { themeVariables, themeCSS } = showcaseTheme();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "base",
          themeVariables,
          themeCSS,
          // Layout polish: gentle curved edges and generous spacing so diagrams
          // breathe and read as designed rather than cramped default mermaid.
          flowchart: {
            curve: "basis",
            nodeSpacing: 54,
            rankSpacing: 58,
            padding: 16,
            useMaxWidth: true,
          },
          sequence: { useMaxWidth: true, mirrorActors: false, boxMargin: 12 },
        });
        const { svg: out } = await mermaid.render(`mmd-${seq++}`, src);
        if (!disposed) {
          setError(null);
          setSvg(out);
        }
      } catch (e) {
        if (!disposed) {
          setSvg("");
          setError(e instanceof Error ? e.message : "Could not render diagram.");
        }
      }
    };
    void render();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.part.mermaid, activeTheme, mode]);

  return (
    <div className="border-t-[0.5px] border-border">
      {error ? (
        <div className="px-3.5 py-2.5 text-left text-xs text-faint">
          Couldn&rsquo;t render diagram — {error}
          <pre className="mt-1.5 mb-0 overflow-auto rounded-lg border-[0.5px] border-border bg-muted px-2.5 py-2 font-mono text-xs text-foreground">
            {props.part.mermaid}
          </pre>
        </div>
      ) : (
        // The SVG string is produced here (trusted), then parsed inside an
        // opaque-origin iframe — a second boundary behind mermaid's DOMPurify.
        <SandboxedPart class="block w-full border-0 bg-transparent" body={svg} css={MERMAID_CSS} />
      )}
    </div>
  );
}
