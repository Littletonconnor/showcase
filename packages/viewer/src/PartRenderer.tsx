import { appPath, type Surface } from "./api.ts";
import type {
  ChartPart as ChartPartData,
  CodePart as CodePartData,
  DiffPart as DiffPartData,
  ImagePart as ImagePartData,
  JsonPart as JsonPartData,
  MarkdownPart as MarkdownPartData,
  MermaidPart as MermaidPartData,
  TerminalPart as TerminalPartData,
  TracePart as TracePartData,
} from "./api.ts";
import { ChartPart } from "./ChartPart.tsx";
import { CheckpointPart, ExplorableLock } from "./CheckpointPart.tsx";
import { CodePart } from "./CodePart.tsx";
import { DiffPart } from "./DiffPart.tsx";
import { ImagePart } from "./ImagePart.tsx";
import { JsonPart } from "./JsonPart.tsx";
import { useLearn } from "./learn.ts";
import { MarkdownPart } from "./MarkdownPart.tsx";
import { MermaidPart } from "./MermaidPart.tsx";
import { TerminalPart } from "./TerminalPart.tsx";
import { openComposer, type Thread } from "./threads.ts";
import { ThreadStrip } from "./ThreadStrip.tsx";
import { TracePart } from "./TracePart.tsx";
import { WalkthroughPart } from "./WalkthroughPart.tsx";

// Ask a sandboxed part what sits at a percent coordinate (the bridge's locate
// listener answers with the nearest data-section id + nearby text). The reply
// is agent-reachable data: token-matched, source-checked, capped, and used
// only as a quote string. 300ms budget — a silent frame degrades to a bare pin.
function locateInFrame(
  frame: HTMLIFrameElement,
  x: number,
  y: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const win = frame.contentWindow;
    if (!win) return resolve(undefined);
    const token = Math.random().toString(36).slice(2);
    const done = (quote?: string) => {
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      resolve(quote);
    };
    const timer = setTimeout(() => done(undefined), 300);
    const onMsg = (ev: MessageEvent) => {
      if (ev.source !== win) return;
      const d = ev.data as { __showcase?: boolean; type?: string; token?: string } | null;
      if (!d?.__showcase || d.type !== "located" || d.token !== token) return;
      const raw = d as { section?: unknown; text?: unknown };
      const section =
        typeof raw.section === "string" && raw.section.trim()
          ? `§${raw.section.trim().slice(0, 80)}`
          : "";
      const text =
        typeof raw.text === "string" ? raw.text.replace(/\s+/g, " ").trim().slice(0, 120) : "";
      done([section, text].filter(Boolean).join(" ") || undefined);
    };
    window.addEventListener("message", onMsg);
    win.postMessage({ __showcase: true, type: "locate", token, x, y }, "*");
  });
}

// One surface part, dispatched by kind, wrapped in the anchor div the
// sandbox-selection bridge resolves selections against (frame -> closest
// data-part-anchor wrapper) with its anchored threads rendered beneath it.
// Card owns the chrome (header/footer/scroll registration); this owns what a
// part looks like. The fallback branch is reserved for a kind this viewer
// build doesn't know — which happens when a long-open tab predates a newly
// added part type. It must NOT assume diff (an unknown part is not a broken
// diff), so it shows a neutral refresh hint instead.
export function PartRenderer(props: {
  surface: Surface;
  index: number;
  threads: Thread[];
  // Registers an html part's iframe with the card (bridge resolution + the
  // version dropdown's src rebuild).
  frameRef: (el: HTMLIFrameElement | null) => void;
  // Pre-rendered sandbox doc for a static export (no /s/:id server route);
  // undefined on a live board.
  exportDoc: string | undefined;
  theme: string;
  mode: string;
  // Pin-anywhere mode (armed from the card footer): a trusted transparent
  // overlay sits over the part, one click becomes a percent-coordinate pin
  // anchor, and the composer opens there. The overlay exists ONLY while armed
  // so it never steals interaction from an explorable or a diff. Sandboxed
  // content stays untouched — the overlay and pins live in the trusted origin.
  pinMode?: boolean;
  onPinPlaced?: () => void;
}) {
  const { surface, index: i } = props;
  const part = surface.parts[i];
  // Checkpoint attempts drive explorable gating, so a committed attempt
  // re-renders the part and mounts the unlocked iframe.
  const learnAttempts = useLearn((s) => s.attempts);

  const partEl = (() => {
    switch (part.kind) {
      case "html": {
        // Explorable gating (learn mode): the lesson renderer places a
        // gate checkpoint immediately before its explorable html part.
        // Until that checkpoint records an attempt, the iframe never
        // mounts — a locked placeholder stands in (P4: predict before
        // you manipulate).
        const prev = surface.parts[i - 1];
        if (
          prev?.kind === "checkpoint" &&
          prev.checkpoint.gate &&
          !learnAttempts[prev.checkpoint.id]
        ) {
          return <ExplorableLock gateId={prev.checkpoint.id} />;
        }
        return (
          <iframe
            ref={props.frameRef}
            className="block h-[120px] w-full border-0 border-t-[0.5px] border-border bg-transparent"
            sandbox="allow-scripts"
            title={surface.parts.length > 1 ? `${surface.title} (part ${i + 1})` : surface.title}
            {...(props.exportDoc !== undefined
              ? { srcDoc: props.exportDoc }
              : {
                  src: appPath(
                    `/s/${surface.id}?part=${i}&ver=${surface.version}&cb=${surface.version}&theme=${props.theme}&mode=${props.mode}`,
                  ),
                })}
          ></iframe>
        );
      }
      case "markdown":
        return <MarkdownPart part={part as MarkdownPartData} />;
      case "mermaid":
        return <MermaidPart part={part as MermaidPartData} />;
      case "diff":
        return <DiffPart part={part as DiffPartData} surfaceId={surface.id} partIndex={i} />;
      case "image":
        return (
          <ImagePart
            part={part as ImagePartData}
            surfaceId={surface.id}
            partIndex={i}
            threads={props.threads}
          />
        );
      case "trace":
        return <TracePart part={part as TracePartData} />;
      case "terminal":
        return <TerminalPart part={part as TerminalPartData} />;
      case "json":
        return <JsonPart part={part as JsonPartData} />;
      case "code":
        return <CodePart part={part as CodePartData} />;
      case "chart":
        return <ChartPart part={part as ChartPartData} />;
      case "checkpoint":
        return <CheckpointPart surfaceId={surface.id} checkpoint={part.checkpoint} />;
      case "walkthrough":
        return <WalkthroughPart surfaceId={surface.id} partIndex={i} part={part} />;
      default:
        return (
          <div className="border-t-[0.5px] border-border px-3.5 py-2.5 text-xs text-faint">
            Can&rsquo;t show this part — refresh showcase to update the viewer.
          </div>
        );
    }
  })();
  // Pins over non-image parts (ImagePart places its own, image-relative, so a
  // pin lands exactly where the image was clicked). Wrapper-relative percent
  // coordinates; resolved threads drop their dot.
  const pins =
    part.kind === "image"
      ? []
      : props.threads.flatMap((t, n) =>
          t.root.anchor?.pos && !t.root.resolved
            ? [{ pos: t.root.anchor.pos, n: n + 1, text: t.root.text }]
            : [],
        );

  const placePin = async (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const at = { x: e.clientX, y: e.clientY };
    const x = Math.round(((at.x - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((at.y - rect.top) / rect.height) * 1000) / 10;
    // Sandboxed parts can say what sits under the pin (nearest data-section +
    // nearby text via the bridge's locate round-trip), so the agent reads
    // "at 34%, 56% §hero 'Start free trial'" instead of bare coordinates.
    const frame = e.currentTarget.parentElement?.querySelector("iframe") ?? null;
    props.onPinPlaced?.();
    const quote = frame ? await locateInFrame(frame, x, y) : undefined;
    openComposer({
      surfaceId: surface.id,
      partIndex: i,
      pos: { x, y },
      ...(quote ? { quote } : {}),
      x: at.x,
      y: at.y,
    });
  };

  return (
    <div data-part-anchor data-part-index={i}>
      {/* The relative box scopes pins + the overlay to the PART's geometry —
          the thread strip below must not shift percent coordinates. */}
      <div className="relative">
        {partEl}
        {pins.map((p, n) => (
          <span
            key={n}
            data-part-pin
            title={p.text}
            style={{ left: `${p.pos.x}%`, top: `${p.pos.y}%` }}
            className="absolute z-10 flex size-4.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-blue-500 text-[10px] font-semibold text-white shadow-md ring-2 ring-white/80 dark:ring-black/40"
          >
            {p.n}
          </span>
        ))}
        {props.pinMode && part.kind !== "image" ? (
          <div
            data-pin-overlay
            title="Click to pin a note here — Esc to cancel"
            onClick={placePin}
            className="absolute inset-0 z-20 cursor-crosshair bg-blue-500/5 ring-2 ring-inset ring-blue-500/40"
          />
        ) : null}
      </div>
      <ThreadStrip threads={props.threads} />
    </div>
  );
}
