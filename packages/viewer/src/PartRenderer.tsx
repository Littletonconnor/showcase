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
import type { Thread } from "./threads.ts";
import { ThreadStrip } from "./ThreadStrip.tsx";
import { TracePart } from "./TracePart.tsx";
import { WalkthroughPart } from "./WalkthroughPart.tsx";

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
        return <DiffPart part={part as DiffPartData} />;
      case "image":
        return <ImagePart part={part as ImagePartData} />;
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
  return (
    <div data-part-anchor data-part-index={i}>
      {partEl}
      <ThreadStrip threads={props.threads} />
    </div>
  );
}
