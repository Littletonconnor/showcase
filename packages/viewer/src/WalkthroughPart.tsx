// The walkthrough part — the codebase-explainer flagship. A trusted-origin
// step player: annotation + real code excerpt per step, the step's `highlight`
// line ranges glowing while the rest dim, an optional shared mermaid diagram
// whose active node tracks the step, prev/next + clickable dots + arrow keys,
// and an "I'm lost here" affordance that posts a confusion_flag telemetry
// event anchored to the exact step.
//
// C1: everything here is DATA rendered as React nodes. Annotations go through
// InlineText (text nodes); code renders as shiki TOKENS (content + color),
// never an HTML string; the diagram reuses MermaidPart, which keeps mermaid's
// sandboxed render path.
import { useEffect, useMemo, useRef, useState } from "react";
import type { WalkthroughPart as WalkthroughPartData, WalkthroughStep } from "@showcase/core/types";
import { themeById } from "@showcase/core/themes";
import { Button } from "@/components/ui/button";
import { Check, ChevronLeft, ChevronRight, HelpCircle } from "lucide-react";
import { cx } from "./cx.ts";
import { isReadonly } from "./api.ts";
import { InlineText } from "./CheckpointPart.tsx";
import { loadLangs, setCurrentThemes, tokenize, type TokenLine } from "./highlight.ts";
import { postTelemetry } from "./learn.ts";
import { openComposer } from "./threads.ts";
import { MermaidPart } from "./MermaidPart.tsx";
import { useResolvedMode, useSurfaceTheme } from "./theme.ts";

// Append the active-node accent to the shared diagram source. `class` (not
// `:::`) so it composes with classes the author already applied.
function diagramForStep(mermaid: string, node: string | undefined): string {
  if (!node || !/^[\w.-]+$/.test(node)) return mermaid;
  return `${mermaid}\nclass ${node} accent`;
}

// Plain-text fallback lines until the grammar loads (or for unknown langs).
const plainLines = (code: string): TokenLine[] => code.split("\n").map((l) => [{ content: l }]);

function inRanges(line: number, ranges: [number, number][] | undefined): boolean {
  if (!ranges || ranges.length === 0) return false;
  return ranges.some(([from, to]) => line >= from && line <= to);
}

// One step's code pane: numbered token lines, highlight ranges emphasized with
// an accent bar + tint, everything else dimmed when ranges exist. Scrolls the
// first highlighted line into view (within the pane, never the page).
function CodePane(props: {
  step: WalkthroughStep;
  stepIndex: number;
  onLineComment?: (line: number, at: { x: number; y: number }) => void;
}) {
  const { step } = props;
  const activeTheme = useSurfaceTheme();
  const mode = useResolvedMode();
  const [, bumpRender] = useState(0);
  const paneRef = useRef<HTMLDivElement>(null);
  const firstHitRef = useRef<HTMLDivElement>(null);

  const code = step.code ?? "";
  const lang = step.language ?? "text";
  const lineStart = step.lineStart ?? 1;
  const hasRanges = !!step.highlight && step.highlight.length > 0;

  // Load the grammar, then re-render to upgrade from the plain fallback.
  useEffect(() => {
    let disposed = false;
    if (lang && lang !== "text") {
      void loadLangs([lang]).then(() => {
        if (!disposed) bumpRender((n) => n + 1);
      });
    }
    return () => {
      disposed = true;
    };
  }, [lang]);

  const lines = useMemo(() => {
    setCurrentThemes(themeById(activeTheme).shiki);
    return tokenize(code, lang, mode === "dark") ?? plainLines(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, lang, mode, activeTheme]);

  // Bring the step's first highlighted line into view inside the pane.
  useEffect(() => {
    const pane = paneRef.current;
    const target = firstHitRef.current;
    if (!pane || !target) return;
    const top = target.offsetTop - pane.offsetTop;
    pane.scrollTo({ top: Math.max(0, top - pane.clientHeight / 3), behavior: "smooth" });
  }, [props.stepIndex, lines]);

  if (!code) return null;
  let firstHitSeen = false;
  const lineEnd = lineStart + lines.length - 1;
  return (
    <div className="mx-4 mb-3 overflow-hidden rounded-lg border-[0.5px] border-border">
      {step.file ? (
        <div className="flex items-center gap-2 border-b-[0.5px] border-border bg-muted/40 px-3 py-1.5">
          <span className="truncate font-mono text-[11.5px] font-medium text-muted-foreground">
            {step.file}
            {lineStart > 1 ? `:${lineStart}-${lineEnd}` : ""}
          </span>
          {lang && lang !== "text" ? (
            <span className="ml-auto rounded bg-muted px-1.5 py-[1px] font-mono text-[10.5px] lowercase text-faint">
              {lang}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        ref={paneRef}
        className="max-h-[420px] overflow-auto bg-muted/20 py-2 font-mono text-[12px] leading-[1.55]"
      >
        {lines.map((tokens, i) => {
          const lineNo = lineStart + i;
          const hit = inRanges(lineNo, step.highlight);
          const isFirstHit = hit && !firstHitSeen;
          if (isFirstHit) firstHitSeen = true;
          return (
            <div
              key={i}
              ref={isFirstHit ? firstHitRef : undefined}
              data-line={lineNo}
              data-highlighted={hit ? "true" : undefined}
              className={cx(
                "flex border-l-2 px-3 whitespace-pre transition-opacity duration-200",
                hit
                  ? "border-blue-500/70 bg-blue-500/8"
                  : hasRanges
                    ? "border-transparent opacity-40"
                    : "border-transparent",
              )}
            >
              <button
                type="button"
                tabIndex={-1}
                title="Comment on this line"
                onClick={(e) => props.onLineComment?.(lineNo, { x: e.clientX, y: e.clientY })}
                className="mr-3 w-9 flex-none cursor-pointer border-0 bg-transparent p-0 text-right font-mono text-faint select-none hover:font-semibold hover:text-blue-500"
              >
                {lineNo}
              </button>
              <span className="min-h-[1.55em]">
                {tokens.map((t, j) => (
                  <span key={j} style={t.color ? { color: t.color } : undefined}>
                    {t.content}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WalkthroughPart(props: {
  surfaceId: string;
  partIndex?: number;
  part: WalkthroughPartData;
}) {
  const { part } = props;
  const steps = part.steps;
  const [index, setIndex] = useState(0);
  const [flagged, setFlagged] = useState(false);
  const step = steps[Math.min(index, steps.length - 1)];
  const readonly = isReadonly();

  const go = (next: number) => setIndex(Math.max(0, Math.min(steps.length - 1, next)));

  const flagConfusion = () => {
    postTelemetry(props.surfaceId, {
      v: 1,
      type: "confusion_flag",
      anchor: `${part.title ?? "walkthrough"} step ${index + 1}: ${step.title}`.slice(0, 200),
    });
    setFlagged(true);
    setTimeout(() => setFlagged(false), 2500);
  };

  return (
    <div
      className="border-t-[0.5px] border-border outline-none focus-visible:ring-1 focus-visible:ring-brand/30"
      data-walkthrough
      data-wt-step={index}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(index + 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(index - 1);
        }
      }}
    >
      {/* header: title, step dots, I'm-lost, prev/next */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        {part.title ? (
          <span className="truncate text-[13px] font-semibold text-foreground">{part.title}</span>
        ) : null}
        <span className="flex-none text-[11px] text-faint tabular-nums">
          {index + 1}/{steps.length}
        </span>
        <span className="mx-1 flex flex-1 flex-wrap items-center gap-1.5">
          {steps.map((s, i) => (
            <button
              key={i}
              type="button"
              title={`${i + 1}. ${s.title}`}
              aria-label={`Go to step ${i + 1}: ${s.title}`}
              onClick={() => go(i)}
              className={cx(
                "size-2 flex-none rounded-full transition-all",
                i === index
                  ? "scale-125 bg-blue-500"
                  : i < index
                    ? "bg-blue-500/40 hover:bg-blue-500/70"
                    : "bg-muted-foreground/25 hover:bg-muted-foreground/50",
              )}
            />
          ))}
        </span>
        {!readonly ? (
          <button
            type="button"
            onClick={flagConfusion}
            title="Tell the agent this step lost you — it gets the exact step"
            className="inline-flex flex-none items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-faint transition-colors hover:bg-muted/50 hover:text-muted-foreground"
          >
            {flagged ? (
              <Check className="size-3.5 text-emerald-500" />
            ) : (
              <HelpCircle className="size-3.5" />
            )}
            {flagged ? "Sent to the agent" : "I\u2019m lost here"}
          </button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Previous step"
          disabled={index === 0}
          onClick={() => go(index - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Next step"
          disabled={index === steps.length - 1}
          onClick={() => go(index + 1)}
        >
          <ChevronRight />
        </Button>
      </div>

      {/* the annotation for this step */}
      <div className="px-4 pb-3" data-wt-annotation>
        <div className="rounded-lg border-[0.5px] border-blue-500/20 bg-blue-500/5 px-3 py-2">
          <div className="text-[12.5px] font-semibold text-foreground">
            <span className="mr-1.5 text-blue-600/80 tabular-nums dark:text-blue-400/80">
              {index + 1}.
            </span>
            {step.title}
          </div>
          <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <InlineText text={step.body} />
          </div>
        </div>
      </div>

      {/* the shared diagram, active node tracking the step — and the reverse:
          clicking a step's node jumps the walkthrough there (cycling forward
          through steps that share the node) */}
      {part.mermaid ? (
        <MermaidPart
          key={step.node ?? "_"}
          part={{ kind: "mermaid", mermaid: diagramForStep(part.mermaid, step.node) }}
          clickableNodes={steps.flatMap((s) => (s.node ? [s.node] : []))}
          onNodeClick={(node) => {
            const hits = steps.flatMap((s, i) => (s.node === node ? [i] : []));
            const next = hits.find((i) => i > index) ?? hits[0];
            if (next !== undefined) go(next);
          }}
        />
      ) : null}

      <CodePane
        step={step}
        stepIndex={index}
        onLineComment={
          readonly
            ? undefined
            : (line, at) =>
                openComposer({
                  surfaceId: props.surfaceId,
                  partIndex: props.partIndex ?? 0,
                  line,
                  ...(step.file ? { file: step.file } : {}),
                  step: index,
                  x: at.x,
                  y: at.y,
                })
        }
      />
    </div>
  );
}
