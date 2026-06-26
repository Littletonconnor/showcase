import { useEffect, useMemo, useRef } from "react";
import { ArrowDown, Check } from "lucide-react";
import { type Surface, type SurfaceBadge } from "./api.ts";
import { BADGE_DOT_CLASS, BADGE_TONE_CLASS, BADGE_TONE_ORDER, cardEls } from "./Card.tsx";
import { cx } from "./cx.ts";
import { root } from "./host.ts";
import {
  APPROVAL_MARK,
  DISMISS_MARK,
  isResolutionComment,
  sendComment,
  useBoard,
} from "./state.ts";

// Canonical review finding labels (R1: critical→Bug, warning→Nit, info→Question,
// success→Praise). The burndown counts these and only these — a verdict card
// ("Request changes") or an "Explainer" badge is not a finding to resolve, so it
// never blocks the review from reaching "complete".
const FINDING_LABELS = new Set(["Bug", "Nit", "Question", "Praise"]);
// Verdict labels an agent's summary card might carry, matched case-insensitively
// to name the terminal state ("Review complete — Request changes").
const VERDICT_LABELS = new Set(["request changes", "approved", "approve", "looks good"]);

const scrollToCard = (id: string) =>
  cardEls.get(id)?.card.scrollIntoView({ behavior: "smooth", block: "start" });

// A live verdict for a review session: rolls up the finding-card badges into
// scannable count chips ("2 Bug · 1 Nit"), worst-severity first, so the review
// reads as one artifact instead of a scattered pile. Derived from the cards the
// agent already publishes — no extra authoring — and each chip jumps to the
// first finding of that label. A finding the user has Approved or Dismissed is
// "resolved"; once every finding under a label is resolved the chip strikes
// through and dims, so you watch the review burn down. Nothing for no badges.
export function ReviewSummary(props: { surfaces: Surface[] }) {
  const comments = useBoard((s) => s.comments);
  const resolved = useMemo(() => {
    const ids = new Set<string>();
    for (const c of comments) {
      if (c.surfaceId && isResolutionComment(c)) ids.add(c.surfaceId);
    }
    return ids;
  }, [comments]);

  const byLabel = new Map<
    string,
    { tone: SurfaceBadge["tone"]; total: number; done: number; firstId: string }
  >();
  for (const s of props.surfaces) {
    if (!s.badge) continue;
    const g = byLabel.get(s.badge.label) ?? {
      tone: s.badge.tone,
      total: 0,
      done: 0,
      firstId: s.id,
    };
    g.total += 1;
    if (resolved.has(s.id)) g.done += 1;
    byLabel.set(s.badge.label, g);
  }
  const groups = [...byLabel.entries()].sort(
    (a, b) => BADGE_TONE_ORDER.indexOf(a[1].tone) - BADGE_TONE_ORDER.indexOf(b[1].tone),
  );

  // The burndown: open (unresolved) findings, worst-severity first, drive the
  // "Next open finding" pager and the open/resolved tally. Excludes verdict and
  // explainer badges (see FINDING_LABELS) so "Review complete" means the findings
  // are done, not that every badge has been touched.
  const findings = props.surfaces.filter((s) => s.badge && FINDING_LABELS.has(s.badge.label));
  const openFindings = findings
    .filter((s) => !resolved.has(s.id))
    .sort(
      (a, b) => BADGE_TONE_ORDER.indexOf(a.badge!.tone) - BADGE_TONE_ORDER.indexOf(b.badge!.tone),
    );
  const findingsTotal = findings.length;
  const openCount = openFindings.length;
  const verdict = props.surfaces.find(
    (s) => s.badge && VERDICT_LABELS.has(s.badge.label.toLowerCase()),
  )?.badge?.label;

  // Keyboard-driven review traversal (§ P5): fly through the open findings and
  // resolve them without the mouse, so the review has a visible terminal state.
  //   j / k — next / previous open finding (worst first, wrapping)
  //   n     — next open finding (skips resolved; alias of j for the unreviewed pass)
  //   a / d — approve / dismiss the finding at the cursor (drives the burndown)
  //   c     — comment on the finding at the cursor (opens its composer in place)
  // A ref holds the live list so the once-mounted handler always sees the current
  // set as findings resolve out from under the cursor.
  const openRef = useRef(openFindings);
  openRef.current = openFindings;
  const cursorRef = useRef(-1);
  const jumpToOpen = (dir: 1 | -1) => {
    const list = openRef.current;
    if (!list.length) return;
    cursorRef.current = (((cursorRef.current + dir) % list.length) + list.length) % list.length;
    scrollToCard(list[cursorRef.current].id);
  };
  // The finding "under the cursor" — defaults to the first open one before any
  // j/k, so `a`/`d`/`c` act on the top of the burndown immediately.
  const currentFinding = () => {
    const list = openRef.current;
    if (!list.length) return undefined;
    const i = cursorRef.current < 0 ? 0 : Math.min(cursorRef.current, list.length - 1);
    return list[i];
  };
  const resolveCurrent = (mark: string) => {
    const f = currentFinding();
    if (!f) return;
    scrollToCard(f.id);
    void sendComment({ surface: f.id, text: mark, author: "user" }, f.id, mark);
    // The resolved finding drops out of openRef on the next render; clamp the
    // cursor so it lands on what's now in its place (the next open finding).
    cursorRef.current = Math.max(0, Math.min(cursorRef.current, openRef.current.length - 2));
  };
  const commentCurrent = () => {
    const f = currentFinding();
    if (!f) return;
    const card = cardEls.get(f.id)?.card;
    if (!card) return;
    scrollToCard(f.id);
    // Open the card's composer (the "Request change" verdict button toggles it).
    const btn = [...card.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Request change",
    );
    btn?.click();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!["j", "k", "n", "a", "d", "c"].includes(e.key)) return;
      const el = root().activeElement as HTMLElement | null;
      const tag = el?.tagName;
      // Don't hijack typing in the composer, an editable title, or a focused part.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "IFRAME" || el?.isContentEditable)
        return;
      if (useBoard.getState().readingId || !openRef.current.length) return;
      e.preventDefault();
      if (e.key === "j" || e.key === "n") jumpToOpen(1);
      else if (e.key === "k") jumpToOpen(-1);
      else if (e.key === "a") resolveCurrent(APPROVAL_MARK);
      else if (e.key === "d") resolveCurrent(DISMISS_MARK);
      else if (e.key === "c") commentCurrent();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (byLabel.size === 0) return null;
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {/* Per-label chips: each an exact count, worst-severity first, jumping to
          its first finding; struck through once every card under it resolves. */}
      <div className="flex flex-wrap items-center gap-1.5 pl-0.5">
        {groups.map(([label, g]) => {
          const allDone = g.done === g.total;
          return (
            <button
              key={label}
              type="button"
              title={
                allDone
                  ? `${label} — resolved`
                  : g.done > 0
                    ? `Jump to ${label} (${g.done}/${g.total} resolved)`
                    : `Jump to ${label}`
              }
              onClick={() => scrollToCard(g.firstId)}
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full py-[3px] pr-2 pl-[7px] text-[11px] leading-none font-semibold ring-1 ring-inset transition-all hover:opacity-80",
                BADGE_TONE_CLASS[g.tone] ?? BADGE_TONE_CLASS.neutral,
                allDone && "opacity-55 line-through",
              )}
            >
              {allDone ? (
                <Check className="size-2.5" strokeWidth={3} />
              ) : (
                <span
                  className={cx(
                    "size-1.5 rounded-full",
                    BADGE_DOT_CLASS[g.tone] ?? BADGE_DOT_CLASS.neutral,
                  )}
                />
              )}
              {g.total} {label}
            </button>
          );
        })}
      </div>
      {/* The burndown row: an open/resolved tally and a pager while findings are
          open, an explicit terminal verdict once they're all resolved. */}
      {findingsTotal > 0 ? (
        <div className="flex items-center gap-2 pl-0.5 text-[11px]">
          {openCount > 0 ? (
            <>
              <span className="tabular-nums text-faint">
                {openCount} open · {findingsTotal - openCount} resolved
              </span>
              <button
                type="button"
                onClick={() => jumpToOpen(1)}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-brand transition-colors hover:bg-brand-subtle"
              >
                Next open finding
                <ArrowDown className="size-3" />
              </button>
              <span className="text-faint/70 max-[700px]:hidden">
                j/k move · a approve · d dismiss · c comment
              </span>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="size-3" strokeWidth={3} />
              Review complete{verdict ? ` — ${verdict}` : ""}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
