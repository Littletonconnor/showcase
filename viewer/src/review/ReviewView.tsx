// The agent-era review form factor (see docs/review-form-factor.md). The Brief
// (plain English, anyone) → a risk-ranked decision queue. Layout is Linear-style:
// the Brief is full-width, then a two-column region where the LEFT decisions
// scroll (gently snapping) and ONE sticky RIGHT pane crossfades to the *active*
// decision's evidence as you move down.
//
// Three live actions, each a single key (the human directs the agent):
//   • Accept (A)   — agree, move on. Local; drives the burndown.
//   • Verify (V)   — make the agent check a gap it flagged. Sends a scoped ask.
//   • Disagree (D) — tell it it's wrong; it defends with evidence or revises.
// Verify/Disagree go over the existing comment channel and thread under the
// decision; when the agent re-publishes, the decision updates in place. Local
// state is keyed by the decision's text, so a re-publish never wipes the Accepts
// you've already made — only a decision whose wording actually changed resets.
// Disabled in a static export (no agent) and inert in `?review-preview`.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, CircleAlert, CircleCheck } from "lucide-react";
import type {
  Comment,
  Decision,
  DecisionCall,
  DecisionGap,
  Review,
} from "../../../server/types.ts";
import type {
  CodePart as CodePartData,
  DiffPart as DiffPartData,
  MarkdownPart as MarkdownPartData,
  MermaidPart as MermaidPartData,
  SurfacePart,
} from "../api.ts";
import { api } from "../api.ts";
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
const CONFIDENCE = {
  high: { label: "High confidence", dot: "bg-emerald-500" },
  medium: { label: "Medium confidence", dot: "bg-amber-500" },
  low: { label: "Low confidence", dot: "bg-red-500" },
} as const;

// What the verbs hand the agent — each names the decision (so the reply threads)
// and forces a narrow, predictable action. The first line is the human gist; the
// rest is the instruction.
function verifyText(idx: number, gap: DecisionGap): string {
  return (
    `Verify · decision ${idx + 1}: ${gap.what}\n` +
    (gap.proveScope ? `How: ${gap.proveScope}\n` : "") +
    `Then update decision ${idx + 1} in place via publish_decisions; if it changes the call, say so.`
  );
}
function disagreeText(idx: number, assertion: string, objection: string): string {
  return (
    `Disagree · decision ${idx + 1}: ${objection}\n` +
    `(the decision claims: "${assertion}")\n` +
    `Defend this with evidence, or concede and revise decision ${idx + 1} via publish_decisions — no hedging.`
  );
}
// Which decision a comment belongs to (1-based in the text → 0-based index).
function decisionRefOf(text: string): number | null {
  const m = /decision\s+(\d+)/i.exec(text);
  return m ? Number(m[1]) - 1 : null;
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
  state?: "accepted" | "disputed";
  thread: Comment[];
  showVerbs: boolean;
  interactive: boolean;
  composerOpen: boolean;
  refCb: (el: HTMLLIElement | null) => void;
  onAccept: () => void;
  onUndo: () => void;
  onVerify: (gapIdx: number) => void;
  onOpenDisagree: () => void;
  onCloseDisagree: () => void;
  onSubmitDisagree: (objection: string) => void;
}) {
  const d = props.decision;
  const call = CALL[d.call];
  const conf = CONFIDENCE[d.confidence];
  const accepted = props.state === "accepted";
  const disputed = props.state === "disputed";
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
        {/* rank + scope (+ adjudication, once decided) */}
        <div className="flex items-center gap-2 text-[11px] text-faint">
          <span className="tabular-nums">
            Decision {props.index + 1} / {props.total}
          </span>
          <span className="text-border">·</span>
          <Chip className="bg-muted text-muted-foreground">{d.kind}</Chip>
          <Chip className="bg-muted text-muted-foreground">{d.scope}</Chip>
          {accepted && (
            <Chip className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              ✓ Accepted
            </Chip>
          )}
          {disputed && (
            <Chip className="bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
              Disagreed
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

        {/* the honesty ledger — labeled rows so it scans, not a wall of prose */}
        <div className="mt-1 flex flex-col gap-2 border-t-[0.5px] border-border pt-3 text-[12.5px]">
          <div className="flex items-center gap-1.5">
            <span className={cx("size-1.5 rounded-full", conf.dot)} />
            <span className="font-medium text-foreground">{conf.label}</span>
          </div>
          <div className="flex gap-2">
            <span className="shrink-0 text-[11px] font-medium tracking-wide text-faint uppercase">
              Checked
            </span>
            <span className="text-muted-foreground">{d.coverage}</span>
          </div>
          {(d.gaps ?? []).length > 0 && (
            <div className="flex gap-2">
              <span className="shrink-0 text-[11px] font-medium tracking-wide text-faint uppercase">
                Not&nbsp;yet
              </span>
              <div className="flex flex-col gap-1.5">
                {(d.gaps ?? []).map((g, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-red-600 dark:text-red-400">{g.what}</span>
                    {props.showVerbs && (
                      <button
                        type="button"
                        onClick={() => props.onVerify(i)}
                        disabled={!props.interactive}
                        className="mt-px shrink-0 rounded-md border-[0.5px] border-border px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand-subtle disabled:pointer-events-none disabled:opacity-40"
                      >
                        Verify
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* the pivot (conditional) */}
        {d.pivot ? <p className="text-[12.5px] text-faint italic">⤳ {d.pivot}</p> : null}

        {/* the conversation trail — your Verify/Disagree and the agent's replies */}
        {props.thread.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5 border-l-2 border-border/70 pl-3">
            {props.thread.map((c) => {
              const mine = c.author === "user";
              return (
                <div key={c.id} className="flex flex-col gap-0.5 text-[12px]">
                  <span
                    className={cx(
                      "text-[10px] font-medium tracking-wide uppercase",
                      mine ? "text-brand" : "text-faint",
                    )}
                  >
                    {mine ? "You" : c.author}
                  </span>
                  <span className="whitespace-pre-wrap text-muted-foreground">
                    {c.text.split("\n")[0]}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* the verbs — one key each */}
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
            <div className="mt-1 flex flex-col gap-2">
              {disputed && (
                <div className="text-[12px] text-amber-700 dark:text-amber-400">
                  Waiting on the agent to defend or revise…
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={props.onAccept}
                  disabled={!props.interactive}
                  className="inline-flex items-center rounded-md px-2.5 py-1 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:pointer-events-none disabled:opacity-40 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
                >
                  Accept <Kbd>A</Kbd>
                </button>
                <button
                  type="button"
                  onClick={() => props.onVerify(0)}
                  disabled={!props.interactive || (props.decision.gaps ?? []).length === 0}
                  title={
                    (props.decision.gaps ?? []).length === 0
                      ? "No flagged gap to verify"
                      : "Make the agent check a flagged gap"
                  }
                  className="inline-flex items-center rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
                >
                  Verify <Kbd>V</Kbd>
                </button>
                <button
                  type="button"
                  onClick={props.onOpenDisagree}
                  disabled={!props.interactive}
                  className="inline-flex items-center rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-hover disabled:pointer-events-none disabled:opacity-40"
                >
                  Disagree <Kbd>D</Kbd>
                </button>
              </div>
              {props.composerOpen && (
                <DisagreeComposer
                  onCancel={props.onCloseDisagree}
                  onSubmit={props.onSubmitDisagree}
                />
              )}
            </div>
          ))}
      </div>
    </li>
  );
}

// Disagree opens this: the objection that gets dispatched to the agent as a
// scoped defend-or-revise task.
function DisagreeComposer(props: { onCancel: () => void; onSubmit: (objection: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-lg border-[0.5px] border-border bg-muted/40 p-2.5">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) props.onSubmit(text);
        }}
        rows={2}
        placeholder="What's wrong with this conclusion? The agent must defend it or revise."
        className="resize-y rounded-md border-[0.5px] border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-faint focus-visible:border-brand focus-visible:outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => props.onSubmit(text)}
          disabled={!text.trim()}
          className="rounded-md bg-brand px-2.5 py-1 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          Send
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-hover"
        >
          Cancel
        </button>
        <span className="text-[11px] text-faint">⌘↵ to send · Esc to close</span>
      </div>
    </div>
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
      <div className="text-[11px] tracking-wide text-faint uppercase">
        Evidence · decision {props.index + 1}
      </div>
      {empty ? (
        <div className="rounded-lg border-[0.5px] border-dashed border-border px-4 py-10 text-center text-[13px] text-faint">
          No code to show — this one is judged from the description.
        </div>
      ) : (
        <>
          {evidence.length > 0 && (
            <div className="overflow-hidden rounded-lg border-[0.5px] border-border bg-card">
              {evidence.map((p, i) => (
                <EvidencePart key={i} part={p} />
              ))}
            </div>
          )}
          {proposal && (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                Suggested change
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
  comments?: Comment[];
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

  // Reviewer adjudication, keyed by the decision's TEXT (not its index) so a
  // re-publish keeps the Accepts you've made — only a decision whose assertion
  // actually changed (e.g. one the agent revised) resets. Drives the burndown.
  const [state, setState] = useState<Record<string, "accepted" | "disputed">>({});
  const [composerOpen, setComposerOpen] = useState<number | null>(null);

  // Comments grouped under the decision they reference.
  const threads = useMemo(() => {
    const by = new Map<number, Comment[]>();
    for (const c of props.comments ?? []) {
      const idx = decisionRefOf(c.text);
      if (idx === null) continue;
      (by.get(idx) ?? by.set(idx, []).get(idx)!).push(c);
    }
    return by;
  }, [props.comments]);

  async function send(text: string) {
    if (!props.sessionId) return;
    await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({ session: props.sessionId, author: "user", text }),
    });
  }

  function accept(idx: number) {
    const key = r.decisions[idx].assertion;
    setState((prev) => ({ ...prev, [key]: "accepted" }));
    const next = r.decisions.findIndex((d, i) => i > idx && state[d.assertion] === undefined);
    if (next >= 0) {
      itemRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActive(next);
    }
  }
  function undo(idx: number) {
    const key = r.decisions[idx].assertion;
    setState((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
  }
  function verify(idx: number, gapIdx: number) {
    const gap = r.decisions[idx].gaps?.[gapIdx];
    if (!gap || !interactive) return;
    void send(verifyText(idx, gap));
  }
  function disagree(idx: number, objection: string) {
    if (!objection.trim() || !interactive) return;
    setState((prev) => ({ ...prev, [r.decisions[idx].assertion]: "disputed" }));
    setComposerOpen(null);
    void send(disagreeText(idx, r.decisions[idx].assertion, objection.trim()));
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

  // j/k (or ↑/↓) move; a accept · v verify · d disagree the active decision.
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
      } else if (interactive && e.key === "v") {
        e.preventDefault();
        verify(active, 0);
      } else if (interactive && e.key === "d") {
        e.preventDefault();
        setComposerOpen(active);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, r.decisions.length, interactive, state]);

  const decided = r.decisions.filter((d) => state[d.assertion] === "accepted").length;
  const total = r.decisions.length;

  return (
    <div
      ref={scrollRef}
      className={cx(
        "snap-y snap-proximity overflow-y-auto bg-background text-foreground",
        props.embedded ? "h-full" : "h-svh",
      )}
    >
      <div className="mx-auto max-w-[1180px] px-6 py-8">
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
              ? decided === total
                ? `Review complete · ${total} accepted`
                : `${decided} / ${total} accepted`
              : `${total} decision${total === 1 ? "" : "s"}`}
          </span>
        </div>

        {/* The Brief — plain English, for anyone. Full-width; scrolls away. */}
        <p className="max-w-[68ch] text-[17px] leading-relaxed text-foreground">{r.brief}</p>

        {/* one-line legend so the keys are obvious */}
        {showVerbs && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
            <span>
              <Kbd>A</Kbd> accept
            </span>
            <span>
              <Kbd>V</Kbd> make it verify a flagged gap
            </span>
            <span>
              <Kbd>D</Kbd> disagree — it defends or revises
            </span>
            <span>
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> move
            </span>
          </div>
        )}

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
                state={state[d.assertion]}
                thread={threads.get(i) ?? []}
                showVerbs={showVerbs}
                interactive={interactive}
                composerOpen={composerOpen === i}
                refCb={(el) => (itemRefs.current[i] = el)}
                onAccept={() => accept(i)}
                onUndo={() => undo(i)}
                onVerify={(gi) => verify(i, gi)}
                onOpenDisagree={() => setComposerOpen(i)}
                onCloseDisagree={() => setComposerOpen(null)}
                onSubmitDisagree={(obj) => disagree(i, obj)}
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
