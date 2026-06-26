// The agent-era review form factor (render-only mockup; see
// docs/review-form-factor.md). The Brief (plain English, anyone) → a risk-ranked
// decision queue. Layout is Linear-style: the Brief is full-width, then a
// two-column region where the LEFT decisions scroll (gently snapping) and ONE
// sticky RIGHT pane crossfades to the *active* decision's evidence as you move
// down. A decision with no evidence shows a quiet placeholder (option A). `j`/`k`
// traverse the queue. Interactions (Accept / Prove it / Challenge) are stubs here
// and get wired in a later increment.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, CircleAlert, CircleCheck } from "lucide-react";
import type { DiffPart as DiffPartData, MarkdownPart as MarkdownPartData } from "../api.ts";
import type {
  CodePart as CodePartData,
  MermaidPart as MermaidPartData,
  SurfacePart,
} from "../api.ts";
import { cx } from "../cx.ts";
import { CodePart } from "../CodePart.tsx";
import { DiffPart } from "../DiffPart.tsx";
import { MarkdownPart } from "../MarkdownPart.tsx";
import { MermaidPart } from "../MermaidPart.tsx";
import type { Decision, DecisionCall, Review } from "./types.ts";

const CALL = {
  block: { label: "Block", Icon: Ban, cls: "text-red-700 dark:text-red-300" },
  decide: { label: "Decide", Icon: CircleAlert, cls: "text-amber-700 dark:text-amber-300" },
  ship: { label: "Ship", Icon: CircleCheck, cls: "text-emerald-700 dark:text-emerald-300" },
} satisfies Record<DecisionCall, { label: string; Icon: typeof Ban; cls: string }>;

const VERDICT_LABEL = { block: "Block", approve: "Approve", comment: "Comments" } as const;
const CONFIDENCE_DOT = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-red-500",
} as const;

// Render a piece of evidence by reusing the existing trusted part renderers.
function EvidencePart(props: { part: SurfacePart }) {
  switch (props.part.kind) {
    case "diff":
      return <DiffPart part={props.part as DiffPartData} />;
    case "mermaid":
      return <MermaidPart part={props.part as MermaidPartData} />;
    case "code":
      return <CodePart part={props.part as CodePartData} />;
    case "markdown":
      return <MarkdownPart part={props.part as MarkdownPartData} />;
    default:
      return null;
  }
}

function Chip(props: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        props.className,
      )}
    >
      {props.children}
    </span>
  );
}

function Verb(props: { tone: "accept" | "challenge"; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cx(
        "rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors",
        props.tone === "accept"
          ? "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
          : "text-muted-foreground hover:bg-hover",
      )}
    >
      {props.children}
    </button>
  );
}

// One decision in the left column — the fixed seven-slot grammar. Active gets a
// left accent bar so it visibly links to the sticky evidence on the right.
function DecisionSection(props: {
  decision: Decision;
  index: number;
  total: number;
  active: boolean;
  refCb: (el: HTMLLIElement | null) => void;
}) {
  const d = props.decision;
  const call = CALL[d.call];
  return (
    <li
      ref={props.refCb}
      data-idx={props.index}
      className={cx(
        "scroll-mt-8 snap-start border-l-2 py-6 pl-5 transition-colors",
        props.active ? "border-brand" : "border-transparent",
      )}
    >
      <div className="flex flex-col gap-2.5">
        {/* 1 — rank + scope */}
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span className="tabular-nums">
            Decision {props.index + 1} / {props.total}
          </span>
          <span className="text-border">·</span>
          <Chip className="bg-muted text-muted-foreground">{d.kind}</Chip>
          <Chip className="bg-muted text-muted-foreground">{d.scope}</Chip>
        </div>

        {/* 2 — the call */}
        <div className={cx("inline-flex items-center gap-1.5 text-[13px] font-semibold", call.cls)}>
          <call.Icon className="size-4" />
          {call.label}
        </div>

        {/* 3 — assertion */}
        <p className="text-[16px] leading-snug font-medium text-foreground">{d.assertion}</p>

        {/* 4 — why it matters */}
        {d.impact ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">→ {d.impact}</p>
        ) : null}

        {/* 5 — the honesty ledger */}
        <div className="mt-1 flex flex-col gap-1.5 border-t-[0.5px] border-border pt-2.5 text-[12.5px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <span className={cx("size-1.5 rounded-full", CONFIDENCE_DOT[d.confidence])} />
            <span>
              {d.confidence === "high" ? "sure" : d.confidence} · {d.coverage}
            </span>
          </div>
          {(d.gaps ?? []).map((g, i) => (
            <div key={i} className="flex items-center gap-2 text-muted-foreground">
              <span className="text-red-600 dark:text-red-400">✗ {g.what}</span>
              <button
                type="button"
                className="rounded-md border-[0.5px] border-border px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand-subtle"
              >
                Prove it
              </button>
            </div>
          ))}
        </div>

        {/* 6 — the pivot (conditional) */}
        {d.pivot ? <p className="text-[12.5px] text-faint italic">⤳ {d.pivot}</p> : null}

        {/* 7 — the verbs */}
        <div className="mt-1 flex items-center gap-2">
          <Verb tone="accept">Accept</Verb>
          <Verb tone="challenge">Challenge</Verb>
        </div>
      </div>
    </li>
  );
}

// The sticky right pane — the active decision's evidence (or a quiet placeholder).
// Keyed on `index` so the content crossfades when the active decision changes.
function EvidencePane(props: { decision: Decision; index: number }) {
  const d = props.decision;
  const has = (d.evidence?.length ?? 0) > 0;
  return (
    <div
      key={props.index}
      className="animate-in fade-in-0 duration-200 max-h-[calc(100svh-3rem)] overflow-auto"
    >
      <div className="mb-2 text-[11px] tracking-wide text-faint uppercase">
        Evidence · decision {props.index + 1}
      </div>
      {has ? (
        <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
          {d.evidence!.map((p, i) => (
            <EvidencePart key={i} part={p} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border-[0.5px] border-dashed border-border px-4 py-10 text-center text-[13px] text-faint">
          No code to show — this one is judged from the description.
        </div>
      )}
    </div>
  );
}

export function ReviewView(props: { review: Review }) {
  const r = props.review;
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);

  // Track the active decision: the topmost whose section sits in the top band of
  // the scroll container (rootMargin trims the bottom 70%, so "in view" ≈ near top).
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.idx))
          .sort((a, b) => a - b)[0];
        if (top !== undefined) setActive(top);
      },
      { root, rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    for (const el of itemRefs.current) if (el) obs.observe(el);
    return () => obs.disconnect();
  }, [r.decisions.length]);

  // j / k traverse the queue (scroll the section into view; the observer follows).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const next = Math.max(0, Math.min(r.decisions.length - 1, active + (e.key === "j" ? 1 : -1)));
      itemRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, r.decisions.length]);

  return (
    <div
      ref={scrollRef}
      className="h-svh snap-y snap-proximity overflow-y-auto bg-background text-foreground"
    >
      <div className="mx-auto max-w-[1180px] px-6 py-10">
        {/* The only metric — a derived verdict chip, not a dashboard. */}
        <div className="mb-4 flex items-center gap-2 text-[12px]">
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold",
              r.verdict === "block"
                ? "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                : r.verdict === "approve"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {VERDICT_LABEL[r.verdict]}
          </span>
          <span className="text-faint">
            {r.decisions.length} decision{r.decisions.length === 1 ? "" : "s"} · 0 decided · j/k to
            move
          </span>
        </div>

        {/* The Brief — plain English, for anyone. Full-width; scrolls away. */}
        <p className="max-w-[68ch] text-[17px] leading-relaxed text-foreground">{r.brief}</p>

        {/* The decision region: left scrolls, right is sticky and snaps to active. */}
        <div className="mt-6 grid gap-x-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <ol className="-ml-5">
            {r.decisions.map((d, i) => (
              <DecisionSection
                key={i}
                decision={d}
                index={i}
                total={r.decisions.length}
                active={i === active}
                refCb={(el) => (itemRefs.current[i] = el)}
              />
            ))}
          </ol>
          <div className="hidden md:block">
            <div className="sticky top-6 pt-6">
              <EvidencePane decision={r.decisions[active]} index={active} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
