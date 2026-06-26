// The agent-era review form factor (render-only mockup; see
// docs/review-form-factor.md). The Brief (plain English, anyone) → a risk-ranked
// decision queue, each decision in one fixed seven-slot grammar, laid out
// two-column with evidence on the right (full-width when a decision has none).
// Interactions (Accept / Prove it / Challenge / Override) are stubbed here and
// wired in a later increment.
import type { ReactNode } from "react";
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
  block: { label: "Block", Icon: Ban, cls: "text-red-700 dark:text-red-300", dot: "bg-red-500" },
  decide: {
    label: "Decide",
    Icon: CircleAlert,
    cls: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  ship: {
    label: "Ship",
    Icon: CircleCheck,
    cls: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
} satisfies Record<DecisionCall, { label: string; Icon: typeof Ban; cls: string; dot: string }>;

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

function DecisionRow(props: { decision: Decision; index: number; total: number }) {
  const d = props.decision;
  const call = CALL[d.call];
  const hasEvidence = (d.evidence?.length ?? 0) > 0;

  const left = (
    <div className="flex flex-col gap-2.5 p-5">
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
      <p className="text-[15px] leading-snug font-medium text-foreground">{d.assertion}</p>

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
  );

  return (
    <li className="overflow-hidden rounded-xl border-[0.5px] border-border bg-card">
      <div className={cx("grid", hasEvidence && "md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]")}>
        {left}
        {hasEvidence ? (
          <div className="border-border bg-background/40 p-3 md:border-l-[0.5px]">
            {d.evidence!.map((p, i) => (
              <EvidencePart key={i} part={p} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
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

export function ReviewView(props: { review: Review }) {
  const r = props.review;
  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto max-w-[1080px] px-6 py-10">
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
            {r.decisions.length} decision{r.decisions.length === 1 ? "" : "s"} · 0 decided
          </span>
        </div>

        {/* The Brief — plain English, for anyone. */}
        <p className="max-w-[68ch] text-[17px] leading-relaxed text-foreground">{r.brief}</p>

        {/* The decision queue. */}
        <ol className="mt-8 flex flex-col gap-4">
          {r.decisions.map((d, i) => (
            <DecisionRow key={i} decision={d} index={i} total={r.decisions.length} />
          ))}
        </ol>
      </div>
    </div>
  );
}
