// The agent-era review form factor (see docs/review-form-factor.md). The Brief
// (plain English, anyone) → a risk-ranked decision queue. Layout is Linear-style:
// the Brief is full-width, then a two-column region where the LEFT decisions
// scroll (gently snapping) and ONE sticky RIGHT pane crossfades to the *active*
// decision's evidence as you move down.
//
// One live action: Accept (A) — agree, move on. Local; drives the burndown. To
// push back, copy the decision's ref (the chip in its header) and ask in normal
// agent chat ("revise d-… : …"); when the agent re-publishes, the decision
// updates in place. There is no in-browser pushback verb — chat is the channel.
// Local Accepts are keyed by the decision's stable id (falling back to its text
// for older reviews), so a re-publish that merely rewords an assertion keeps the
// Accepts you've already made — only a substantively new decision (a new id)
// resets. Disabled in a static export (no agent) and inert in `?review-preview`.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, ChevronRight, CircleAlert, CircleCheck, Check, Copy } from "lucide-react";
import type {
  Decision,
  DecisionCall,
  FileDisposition,
  ManifestFile,
  Review,
} from "../../../server/types.ts";
import type {
  CodePart as CodePartData,
  DiffPart as DiffPartData,
  MarkdownPart as MarkdownPartData,
  MermaidPart as MermaidPartData,
  SurfacePart,
} from "../api.ts";
import { cx } from "../cx.ts";
import { CodePart } from "../CodePart.tsx";
import { DiffPart } from "../DiffPart.tsx";
import { MarkdownPart } from "../MarkdownPart.tsx";
import { MermaidPart } from "../MermaidPart.tsx";

const CALL = {
  block: { label: "Block", Icon: Ban, cls: "text-red-700 dark:text-red-300" },
  decide: { label: "Decide", Icon: CircleAlert, cls: "text-amber-700 dark:text-amber-300" },
  ship: { label: "Ship", Icon: CircleCheck, cls: "text-emerald-700 dark:text-emerald-300" },
} satisfies Record<DecisionCall, { label: string; Icon: typeof Ban; cls: string }>;

const VERDICT_LABEL = { block: "Block", approve: "Approve", comment: "Comments" } as const;
// How sure the agent is — plain words, not a "confidence" scale to decode.
const CONFIDENCE = {
  high: { label: "Confident", dot: "bg-emerald-500" },
  medium: { label: "Fairly sure", dot: "bg-amber-500" },
  low: { label: "Not sure", dot: "bg-red-500" },
} as const;

// Every changed file's disposition in the manifest — the dot + the label the
// human scans to account for a file that has no decision.
const DISPOSITION = {
  "has-decision": { label: "decision", dot: "bg-brand" },
  "reviewed-no-comment": { label: "reviewed · no comment", dot: "bg-muted-foreground/40" },
  "mechanical-skipped": { label: "mechanical · skipped", dot: "bg-border" },
} satisfies Record<FileDisposition, { label: string; dot: string }>;

// A mechanical-skipped file with real churn and no justification note is exactly
// what the skill's cold-set audit guards against — a real change buried in the
// skip set. Surface it from the manifest the review already carries (Layer 3 just
// renders the data; it forms no opinion about what the file *means*).
const SKIP_CHURN_FLAG = 50;
const isUnexplainedBigSkip = (f: ManifestFile) =>
  f.disposition === "mechanical-skipped" && !f.note && f.added + f.removed >= SKIP_CHURN_FLAG;

// Adjudication key: the decision's stable id when present (so a reworded-but-same
// decision carries the human's prior call across a re-publish), falling back to
// the assertion text for older reviews minted before ids existed.
const keyOf = (d: Decision) => d.id ?? d.assertion;

// The complete changed-file manifest (Phase 1 — trust): every file in the diff,
// each accounted for. Collapsed by default so it doesn't crowd the Brief; a file
// with a decision links to it, the rest carry why they got none.
function Manifest(props: {
  files: ManifestFile[];
  decisionIndex: Map<string, number>;
  onJump: (index: number) => void;
}) {
  const files = props.files;
  const withDecision = files.filter((f) => f.disposition === "has-decision").length;
  const reviewedClean = files.filter((f) => f.disposition === "reviewed-no-comment").length;
  const skipped = files.filter((f) => f.disposition === "mechanical-skipped").length;
  const explainedSkips = files.filter(
    (f) => f.disposition === "mechanical-skipped" && f.note,
  ).length;
  const flagged = files.filter(isUnexplainedBigSkip).length;
  return (
    <details className="group mt-5 max-w-[820px] overflow-hidden rounded-lg border-[0.5px] border-border bg-card/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium text-foreground select-none">
        <ChevronRight className="size-3.5 text-faint transition-transform group-open:rotate-90" />
        All {files.length} file{files.length === 1 ? "" : "s"} changed
        <span className="font-normal text-faint">
          · {withDecision} decision{withDecision === 1 ? "" : "s"} · {reviewedClean} reviewed-clean
          {skipped > 0
            ? ` · ${skipped} skipped${explainedSkips > 0 ? ` (${explainedSkips} explained)` : ""}`
            : ""}
        </span>
        {flagged > 0 ? (
          <span className="ml-auto shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
            ⚠ {flagged} high-churn skip{flagged === 1 ? "" : "s"} unexplained
          </span>
        ) : (
          <span className="ml-auto shrink-0 font-normal text-faint">nothing omitted</span>
        )}
      </summary>
      <ul className="border-t-[0.5px] border-border">
        {files.map((f, i) => {
          const disp = DISPOSITION[f.disposition];
          const flag = isUnexplainedBigSkip(f);
          const idx = f.decisionId != null ? props.decisionIndex.get(f.decisionId) : undefined;
          return (
            <li
              key={i}
              className="flex items-center gap-3 border-b-[0.5px] border-border/40 px-4 py-1.5 text-[12.5px] last:border-0"
            >
              <span
                className={cx("size-1.5 shrink-0 rounded-full", flag ? "bg-amber-500" : disp.dot)}
              />
              <span className="truncate font-mono text-[12px] text-foreground" title={f.path}>
                {f.path}
              </span>
              {f.note ? (
                <span className="truncate text-[11.5px] text-faint">— {f.note}</span>
              ) : null}
              <span className="ml-auto shrink-0 tabular-nums text-[11px]">
                <span className="text-emerald-600 dark:text-emerald-400">+{f.added}</span>{" "}
                <span className="text-red-600 dark:text-red-400">−{f.removed}</span>
              </span>
              {idx !== undefined ? (
                <button
                  type="button"
                  onClick={() => props.onJump(idx)}
                  className="shrink-0 text-[11px] font-medium text-brand hover:underline"
                >
                  decision {idx + 1} →
                </button>
              ) : (
                <span
                  className={cx(
                    "shrink-0 text-[11px]",
                    flag ? "text-amber-700 dark:text-amber-400" : "text-faint",
                  )}
                >
                  {flag ? "skipped · high churn, no note" : disp.label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Kbd(props: { children: ReactNode }) {
  return (
    <kbd className="ml-1 rounded border-[0.5px] border-border bg-muted px-1 py-px font-mono text-[10px] leading-none text-muted-foreground">
      {props.children}
    </kbd>
  );
}

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

// The decision's stable ref — click to copy, then paste into agent chat to scope
// a revision ("revise d-… : …"). The durable handle that replaces the old verbs.
function CopyRef(props: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy this decision's ref — paste it into chat to revise it"
      onClick={() => {
        void navigator.clipboard?.writeText(props.id);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 rounded border-[0.5px] border-border bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {copied ? (
        <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="size-3 opacity-70" />
      )}
      {copied ? "copied" : props.id}
    </button>
  );
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

// One decision in the left column — the fixed grammar. Active gets a left accent
// bar that links it to the sticky evidence on the right.
function DecisionSection(props: {
  decision: Decision;
  index: number;
  total: number;
  active: boolean;
  accepted: boolean;
  showVerbs: boolean;
  interactive: boolean;
  refCb: (el: HTMLLIElement | null) => void;
  onAccept: () => void;
  onUndo: () => void;
}) {
  const d = props.decision;
  const call = CALL[d.call];
  const conf = CONFIDENCE[d.confidence];
  const accepted = props.accepted;
  return (
    <li
      ref={props.refCb}
      data-idx={props.index}
      className={cx(
        "scroll-mt-8 snap-start border-l-2 py-6 pl-5 transition-colors",
        props.active ? "border-brand" : "border-transparent",
        accepted && "opacity-65",
      )}
    >
      <div className="flex flex-col gap-2.5">
        {/* rank + scope (+ adjudication, once accepted) */}
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span className="tabular-nums">
            Decision {props.index + 1} / {props.total}
          </span>
          <span className="text-border">·</span>
          <Chip className="bg-muted text-muted-foreground">{d.kind}</Chip>
          <Chip className="bg-muted text-muted-foreground">{d.scope}</Chip>
          {d.id ? <CopyRef id={d.id} /> : null}
          {accepted && (
            <Chip className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              ✓ Accepted
            </Chip>
          )}
        </div>

        {/* the call */}
        <div className={cx("inline-flex items-center gap-1.5 text-[13px] font-semibold", call.cls)}>
          <call.Icon className="size-4" />
          {call.label}
        </div>

        {/* assertion */}
        <p className="text-[16px] leading-snug font-medium text-foreground">{d.assertion}</p>

        {/* why it matters */}
        {d.impact ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">→ {d.impact}</p>
        ) : null}

        {/* the rationale — the agent's fuller explanation of the call (markdown).
            Renders below the one-line assertion/impact for anyone who wants the
            reasoning, edge cases, and why it landed on this call. */}
        {d.details ? (
          <div className="text-[13px] leading-relaxed text-muted-foreground">
            <MarkdownPart part={{ kind: "markdown", markdown: d.details }} />
          </div>
        ) : null}

        {/* how sure the agent is — the one honest signal we surface. We don't
            render self-reported "what I verified" claims (nothing backs them);
            trust is this confidence + the agent's skill. */}
        <div className="mt-1 flex items-center gap-2 border-t-[0.5px] border-border pt-3 text-[12.5px]">
          <span className="text-[11px] font-medium tracking-wide text-faint uppercase">
            How sure
          </span>
          <span className="flex items-center gap-1.5 font-medium text-foreground">
            <span className={cx("size-1.5 rounded-full", conf.dot)} />
            {conf.label}
          </span>
        </div>

        {/* the pivot (conditional) */}
        {d.pivot ? <p className="text-[12.5px] text-faint italic">⤳ {d.pivot}</p> : null}

        {/* the verb — Accept (one key). To push back, copy the decision's ref
            (its header chip) and ask in normal agent chat; the agent revises and
            re-publishes, and the decision updates in place. */}
        {props.showVerbs &&
          (accepted ? (
            <div className="mt-1 flex items-center gap-2 text-[12px] text-faint">
              <span>Accepted</span>
              {props.interactive && (
                <button
                  type="button"
                  onClick={props.onUndo}
                  className="rounded-md px-1.5 py-0.5 font-medium text-muted-foreground hover:bg-hover"
                >
                  undo
                </button>
              )}
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                onClick={props.onAccept}
                disabled={!props.interactive}
                className="inline-flex items-center rounded-md px-2.5 py-1 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:pointer-events-none disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
              >
                Accept <Kbd>A</Kbd>
              </button>
              <span className="text-[11px] text-faint">
                disagree? copy the ref above and tell the agent in chat
              </span>
            </div>
          ))}
      </div>
    </li>
  );
}

// The sticky right pane — the active decision's evidence, then any suggested
// change beneath it. Keyed on `index` so it crossfades as the active changes.
function EvidencePane(props: { decision: Decision; index: number }) {
  const d = props.decision;
  const evidence = d.evidence ?? [];
  const proposal = d.proposal;
  const empty = evidence.length === 0 && !proposal;
  return (
    <div
      key={props.index}
      className="animate-in fade-in-0 duration-200 flex max-h-[calc(100svh-3rem)] flex-col gap-4 overflow-auto"
    >
      {empty ? (
        <div className="rounded-lg border-[0.5px] border-dashed border-border px-4 py-10 text-center text-[13px] text-faint">
          No code to show — this one is judged from the description.
        </div>
      ) : (
        <>
          {evidence.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {/* When a fix follows, name the evidence so it reads "the change
                  → the suggested fix" — the pairing a blocked decision needs. */}
              {proposal && (
                <div className="text-[11px] tracking-wide text-faint uppercase">The change</div>
              )}
              <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
                {evidence.map((p, i) => (
                  <EvidencePart key={i} part={p} />
                ))}
              </div>
            </div>
          )}
          {proposal && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                Suggested fix
              </div>
              <div className="overflow-hidden rounded-lg border-[0.5px] border-emerald-500/30 bg-card">
                <DiffPart
                  part={{
                    kind: "diff",
                    files: [
                      {
                        filename: proposal.filename ?? "suggestion",
                        before: proposal.before,
                        after: proposal.after,
                      },
                    ],
                  }}
                />
              </div>
              {proposal.note && (
                <p className="text-[12.5px] text-muted-foreground">{proposal.note}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function ReviewView(props: {
  review: Review;
  sessionId?: string;
  readonly?: boolean;
  onBack?: () => void;
  // When rendered inside the board's main panel (not the standalone page), fill
  // the parent height instead of the viewport so it scrolls within the column.
  embedded?: boolean;
}) {
  const r = props.review;
  const interactive = !!props.sessionId && !props.readonly;
  const showVerbs = !props.readonly;

  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);

  // Accepted decisions, keyed by the decision's stable id (see keyOf) so a
  // re-publish keeps the Accepts you've made — only a substantively new decision
  // resets. Drives the burndown.
  const [accepted, setAccepted] = useState<Set<string>>(() => new Set());

  // decisionId → its position in the queue, so a manifest row can jump to its
  // decision (and to render "decision N →" links).
  const decisionIndex = useMemo(() => {
    const m = new Map<string, number>();
    r.decisions.forEach((d, i) => {
      if (d.id) m.set(d.id, i);
    });
    return m;
  }, [r.decisions]);

  function accept(idx: number) {
    const key = keyOf(r.decisions[idx]);
    setAccepted((prev) => new Set(prev).add(key));
    const next = r.decisions.findIndex((d, i) => i > idx && !accepted.has(keyOf(d)));
    if (next >= 0) {
      itemRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(next);
    }
  }
  function jumpToDecision(idx: number) {
    itemRefs.current[idx]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(idx);
  }
  function undo(idx: number) {
    const key = keyOf(r.decisions[idx]);
    setAccepted((prev) => {
      const n = new Set(prev);
      n.delete(key);
      return n;
    });
  }

  // Active decision: the topmost section sitting in the top band of the scroll
  // container (rootMargin trims the bottom 70%, so "in view" ≈ near top).
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

  // j/k (or ↑/↓) move; a accepts the active decision.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const down = e.key === "j" || e.key === "ArrowDown";
      const up = e.key === "k" || e.key === "ArrowUp";
      if (down || up) {
        e.preventDefault();
        const next = Math.max(0, Math.min(r.decisions.length - 1, active + (down ? 1 : -1)));
        itemRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
        setActive(next);
      } else if (interactive && e.key === "a") {
        e.preventDefault();
        accept(active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, r.decisions.length, interactive, accepted]);

  // Burndown toward a reachable "Review complete": every decision Accepted. To
  // push back on one, the human uses its copy-ref in chat — the agent revises and
  // re-publishes, which updates it in place rather than parking it here.
  const total = r.decisions.length;
  const settled = useMemo(
    () => r.decisions.reduce((n, d) => n + (accepted.has(keyOf(d)) ? 1 : 0), 0),
    [r.decisions, accepted],
  );

  return (
    <div
      ref={scrollRef}
      className={cx(
        "snap-y snap-proximity overflow-y-auto bg-background text-foreground",
        props.embedded ? "h-full" : "h-svh",
      )}
    >
      <div className="mx-auto max-w-[1180px] px-6 py-8">
        {/* The headline region is its own snap point. Without it, the only snap
            targets are the decision <li>s, so any relayout (streaming comments,
            a review re-fetch, async shiki highlighting) re-snaps the proximity
            container to decision 1 and yanks the Brief out of view. */}
        <header className="snap-start scroll-mt-8">
          {/* top bar — back to board + the derived verdict + a burndown/legend */}
          <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px]">
            {props.onBack && (
              <button
                type="button"
                onClick={props.onBack}
                className="rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-hover"
              >
                ← Board
              </button>
            )}
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
              {showVerbs
                ? settled === total
                  ? `Review complete · ${total} decision${total === 1 ? "" : "s"}`
                  : `${settled} / ${total} accepted`
                : `${total} decision${total === 1 ? "" : "s"}`}
            </span>
          </div>

          {/* The Brief — plain English, for anyone. Full-width; scrolls away. */}
          <p className="max-w-[68ch] text-[17px] leading-relaxed text-foreground">{r.brief}</p>

          {/* A non-blocking format nudge: the server flags a Brief that reads like
              code (jargon/identifiers), the skill resolves it on the next publish.
              Never blocks — the loop stays live. */}
          {r.briefWarning ? (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11.5px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <CircleAlert className="size-3.5 shrink-0" />
              {r.briefWarning}
            </div>
          ) : null}

          {/* Evidence warnings — a code decision with nothing to look at, or a diff
              whose patch won't render. Same non-blocking nudge as the Brief warning;
              the agent self-corrects on the next publish. */}
          {r.warnings && r.warnings.length > 0 ? (
            <div className="mt-2 flex flex-col gap-1">
              {r.warnings.map((w, i) => (
                <div
                  key={i}
                  className="inline-flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11.5px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          ) : null}

          {/* one-line legend so the keys are obvious */}
          {showVerbs && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
              <span>
                <Kbd>A</Kbd> accept
              </span>
              <span>
                <Kbd>J</Kbd>
                <Kbd>K</Kbd> move
              </span>
              <span>disagree? copy a decision's ref and tell the agent in chat</span>
            </div>
          )}

          {/* The complete changed-file manifest — every file accounted for, so the
            risk-ranked queue never gives a false sense of "that's everything". */}
          {r.manifest && r.manifest.length > 0 && (
            <Manifest files={r.manifest} decisionIndex={decisionIndex} onJump={jumpToDecision} />
          )}
        </header>

        {/* The decision region: left scrolls, right is sticky and snaps to active. */}
        <div className="mt-6 grid gap-x-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          {/* Trailing space so the LAST decisions can still scroll up into the
              active band (otherwise the snap traps you before reaching them). */}
          <ol className="-ml-5 pb-[55vh]">
            {r.decisions.map((d, i) => (
              <DecisionSection
                key={i}
                decision={d}
                index={i}
                total={total}
                active={i === active}
                accepted={accepted.has(keyOf(d))}
                showVerbs={showVerbs}
                interactive={interactive}
                refCb={(el) => (itemRefs.current[i] = el)}
                onAccept={() => accept(i)}
                onUndo={() => undo(i)}
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
