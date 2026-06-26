import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  api,
  appPath,
  isReadonly,
  relTime,
  type ChartPart as ChartPartData,
  type CommentAnchor,
  type DiffPart as DiffPartData,
  type ImagePart as ImagePartData,
  type JsonPart as JsonPartData,
  type CodePart as CodePartData,
  type MarkdownPart as MarkdownPartData,
  type MermaidPart as MermaidPartData,
  type Surface,
  type SurfaceBadge,
  type TerminalPart as TerminalPartData,
  type TracePart as TracePartData,
  surfaceLink,
} from "./api.ts";
import { ChartPart } from "./ChartPart.tsx";
import { CodePart } from "./CodePart.tsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cx } from "./cx.ts";
import { DiffPart } from "./DiffPart.tsx";
import {
  BookOpen,
  CircleSlash,
  Code,
  ExternalLink,
  Link2,
  MessageSquare,
  MoreHorizontal,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { ImagePart } from "./ImagePart.tsx";
import { JsonPart } from "./JsonPart.tsx";
import { MarkdownPart } from "./MarkdownPart.tsx";
import { MermaidPart } from "./MermaidPart.tsx";
import { TerminalPart } from "./TerminalPart.tsx";
import {
  useActiveTheme,
  useResolvedMode,
  activeTheme as activeThemeNow,
  resolvedMode,
} from "./theme.ts";
import { TracePart } from "./TracePart.tsx";
import { Thread } from "./Thread.tsx";
import {
  APPROVAL_MARK,
  DISMISS_MARK,
  enterReading,
  focusSurface,
  sendComment,
  setScrollTarget,
  toast,
  useBoard,
} from "./state.ts";

// Card registry keyed by surface id: the "new surface" pill scrolls to the
// card element, and each card tracks its html-part iframes so the postMessage
// bridge in App can resolve the source surface + iframe by contentWindow (a
// surface may have more than one html part, so a card may own several frames).
export const cardEls = new Map<string, { card: HTMLDivElement; iframes: Set<HTMLIFrameElement> }>();

// Resolve which surface + iframe a postMessage came from, by contentWindow.
export function frameForSource(source: unknown): { id: string; iframe: HTMLIFrameElement } | null {
  for (const [id, { iframes }] of cardEls) {
    for (const iframe of iframes) {
      if (iframe.contentWindow === source) return { id, iframe };
    }
  }
  return null;
}

// While a deep-link scroll poll is active, IntersectionObserver callbacks on
// other cards must not call focusSurface — they would overwrite the URL with
// whichever card happens to cross the 50% threshold mid-scroll. The poll sets
// this to true and clears it when the position stabilises, at which point it
// calls focusSurface with the correct target surface id.
let deepLinkScrolling = false;

// Repeatedly scroll an element into view until its position stabilises.
// Iframe heights resolve asynchronously (postMessage resize), so a single
// scrollIntoView fires before the layout settles and the target drifts.
// Returns a cancel function so the caller can abort on cleanup.
function pollScrollIntoView(el: HTMLElement, surfaceId: string): () => void {
  // If the card is already near the top of the viewport, no polling needed —
  // skip straight to focusSurface so the app behaves identically to a load
  // without a deep-link target (no IO suppression window, no timers).
  const top = el.getBoundingClientRect().top;
  if (top >= -10 && top <= 200) {
    focusSurface(surfaceId);
    return () => {};
  }

  deepLinkScrolling = true;
  const started = performance.now();
  let lastTop: number | null = null;
  let stableChecks = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const finish = () => {
    deepLinkScrolling = false;
    focusSurface(surfaceId);
  };

  const tick = () => {
    if (stopped) return;
    el.scrollIntoView({ behavior: "instant", block: "start" });
    const top = el.getBoundingClientRect().top;
    if (lastTop !== null && Math.abs(top - lastTop) <= 5) stableChecks += 1;
    else stableChecks = 0;
    lastTop = top;
    // Stable for 3 consecutive checks → done; hard cap at 5 s.
    if (stableChecks >= 3 || performance.now() - started >= 5000) {
      finish();
      return;
    }
    timer = setTimeout(tick, 50);
  };

  tick();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    deepLinkScrolling = false;
  };
}

// A footer action: a ghost shadcn icon button with a tooltip. `href` renders an
// anchor (open-in-new-tab); otherwise a button. The faint resting colour keeps
// the toolbar quiet until hovered, so it reads as chrome, not agent UI.
function IconAction(props: {
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  children: ReactNode;
}) {
  const cls = cx("text-faint", props.danger && "hover:text-destructive");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {props.href ? (
          <Button asChild variant="ghost" size="icon-sm" className={cls} aria-label={props.label}>
            <a href={props.href} target="_blank" rel="noreferrer">
              {props.children}
            </a>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cls}
            aria-label={props.label}
            onClick={props.onClick}
          >
            {props.children}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>{props.label}</TooltipContent>
    </Tooltip>
  );
}

// Per-surface utility actions that aren't part of the comment loop — copy link,
// open in a new tab, delete — collapsed behind a single ⋯ menu so the footer
// toolbar stays scannable and every still-visible icon is a loop action. Mirrors
// the session row's overflow menu in App.tsx, so the app has one pattern for
// "secondary actions" instead of two.
function SurfaceOverflowMenu(props: { surfaceId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const link = surfaceLink(props.surfaceId);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cx("text-faint", open && "text-foreground")}
          aria-label="More actions"
          title="More actions"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast("Link copied");
            } catch {
              toast("Couldn't copy the link");
            }
          }}
        >
          <Link2 />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={link} target="_blank" rel="noreferrer">
            <ExternalLink />
            Open in new tab
          </a>
        </DropdownMenuItem>
        {!isReadonly() ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                if (confirm(`Delete "${props.title}"?`)) {
                  await api(`/api/surfaces/${props.surfaceId}`, { method: "DELETE" });
                }
              }}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A scannable status chip leading the card header — the review severity on a
// finding card ("Bug" / "Nit" / "Question" / "Praise"), or any short label. A
// solid tone dot makes it read as an intentional status indicator (Linear-style)
// rather than a flat pill; the tinted body + hairline ring keep it quiet.
export const BADGE_TONE_CLASS: Record<SurfaceBadge["tone"], string> = {
  critical: "bg-red-500/10 text-red-700 ring-red-600/20 dark:text-red-300 dark:ring-red-400/25",
  warning:
    "bg-amber-500/12 text-amber-800 ring-amber-600/20 dark:text-amber-300 dark:ring-amber-400/25",
  info: "bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300 dark:ring-blue-400/25",
  success:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-400/25",
  neutral: "bg-muted text-muted-foreground ring-border",
};
export const BADGE_DOT_CLASS: Record<SurfaceBadge["tone"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  success: "bg-emerald-500",
  neutral: "bg-muted-foreground/55",
};

// Severity order for rollups/sorting — worst first.
export const BADGE_TONE_ORDER: SurfaceBadge["tone"][] = [
  "critical",
  "warning",
  "info",
  "success",
  "neutral",
];

function SurfaceBadgeChip(props: { badge: SurfaceBadge }) {
  const tone = props.badge.tone;
  return (
    <span
      className={cx(
        "inline-flex flex-none items-center gap-1.5 rounded-full py-[3px] pr-2 pl-[7px] text-[11px] leading-none font-semibold ring-1 ring-inset",
        BADGE_TONE_CLASS[tone] ?? BADGE_TONE_CLASS.neutral,
      )}
    >
      <span
        className={cx(
          "size-1.5 flex-none rounded-full",
          BADGE_DOT_CLASS[tone] ?? BADGE_DOT_CLASS.neutral,
        )}
      />
      {props.badge.label}
    </span>
  );
}

// A small note input for a clicked diff line. Enter sends, Escape cancels.
// Floats near the top of the parts region, centered. (Point-anchored
// annotations were retired — line comments are the one anchored-feedback path,
// since they point at exactly the code the agent must change.)
function LineCommentComposer(props: {
  anchor: CommentAnchor;
  onSend: (text: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div className="absolute top-2 left-1/2 z-30 w-60 max-w-[88%] -translate-x-1/2 rounded-lg border-[0.5px] border-border bg-card p-2 shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-faint">
        <Code className="size-3" /> Comment on line {props.anchor.line}
      </div>
      <Input
        ref={inputRef}
        placeholder="What about this line?"
        aria-label="Line comment"
        className="h-8 text-[13px]"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const text = e.currentTarget.value.trim();
            if (text) void props.onSend(text);
            else props.onCancel();
          } else if (e.key === "Escape") {
            props.onCancel();
          }
        }}
      />
    </div>
  );
}

// A labeled verdict action for finding cards. The review's primary decisions —
// Approve / Dismiss / Request change — read as real buttons with words, not
// ghost icons, so the daily review verbs are unmistakable at a glance.
function VerdictButton(props: {
  label: string;
  onClick: () => void;
  tone: "approve" | "dismiss" | "change";
  children: ReactNode;
}) {
  const toneCls = {
    approve: "text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300",
    dismiss: "text-muted-foreground hover:bg-hover",
    change: "text-brand hover:bg-brand-subtle",
  }[props.tone];
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors [&_svg]:size-3.5",
        toneCls,
      )}
    >
      {props.children}
      {props.label}
    </button>
  );
}

export function Card(props: { surface: Surface }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const iframesRef = useRef<Set<HTMLIFrameElement>>(new Set());
  // Absolute part index -> its iframe, for html parts only. Lets the version
  // dropdown rebuild each `/s/:id?part=N` src across every html part.
  const htmlFramesRef = useRef<Map<number, HTMLIFrameElement>>(new Map());
  const stopPollRef = useRef<(() => void) | undefined>(undefined);
  const activeTheme = useActiveTheme();
  const mode = useResolvedMode();
  const scrollTarget = useBoard((s) => s.scrollTarget);

  // Line comments: clicking a diff line sets `draftAnchor` and opens a small
  // composer; on send the comment carries the line anchor through to the agent.
  const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);

  const surfaceId = props.surface.id;
  // Approve / Dismiss are review-verdict decisions: they only do anything on a
  // finding card (one carrying a severity badge), where they resolve the finding
  // and strike its chip in the header verdict bar. On a plain diagram/explainer
  // there's no verdict to burn down, so they'd be two buttons with no effect —
  // gate them on the badge so every visible action has a purpose on its card.
  const isFinding = !!props.surface.badge;

  // Start the polling scroll when this card becomes the scrollTarget.
  useEffect(() => {
    const card = cardRef.current;
    if (!card || scrollTarget !== surfaceId) return;
    setScrollTarget(null);
    stopPollRef.current?.();
    stopPollRef.current = pollScrollIntoView(card, surfaceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget, surfaceId]);

  useEffect(() => {
    return () => stopPollRef.current?.();
  }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    cardEls.set(surfaceId, { card, iframes: iframesRef.current });
    // Update the URL as the user scrolls past surfaces (replaceState, no
    // history noise). The first card that crosses the 50% threshold wins.
    const observer = new IntersectionObserver(
      (entries) => {
        if (deepLinkScrolling) return;
        for (const entry of entries) {
          if (entry.isIntersecting) focusSurface(surfaceId);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(card);
    return () => {
      observer.disconnect();
      cardEls.delete(surfaceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surfaceId]);

  const versionRange = (latest: number) => {
    const out = [];
    for (let v = latest; v >= Math.max(1, latest - props.surface.history.length); v--) out.push(v);
    return out;
  };

  // Ref callback factory for an html part's iframe: register it in both the
  // per-card iframe set (bridge resolution) and the index map (version rebuild).
  const htmlFrameRef = (i: number) => (el: HTMLIFrameElement | null) => {
    if (el) {
      htmlFramesRef.current.set(i, el);
      iframesRef.current.add(el);
    } else {
      const prev = htmlFramesRef.current.get(i);
      htmlFramesRef.current.delete(i);
      if (prev) iframesRef.current.delete(prev);
    }
  };

  // Structured feedback: a one-tap "Approve" that posts a recognizable user
  // signal to the agent (delivered like any comment — instantly if the agent is
  // listening, queued otherwise). Lives in the trusted viewer chrome, so it's a
  // genuine author:"user" message — the fast path for "yes, this is right" during
  // iteration, vs typing it out. The "Request a change" path is just the composer.
  const approveAction =
    !isReadonly() && isFinding ? (
      <VerdictButton
        tone="approve"
        label="Approve"
        onClick={() => {
          void sendComment(
            { surface: surfaceId, text: APPROVAL_MARK, author: "user" },
            surfaceId,
            APPROVAL_MARK,
          );
          toast("Sent approval to your agent");
        }}
      >
        <ThumbsUp />
      </VerdictButton>
    ) : null;

  // Dismiss — the "won't change this" decision. Like Approve it posts a
  // recognizable user marker and resolves the finding (the header verdict bar
  // strikes resolved findings); the agent reads it as "drop this one".
  const dismissAction =
    !isReadonly() && isFinding ? (
      <VerdictButton
        tone="dismiss"
        label="Dismiss"
        onClick={() => {
          void sendComment(
            { surface: surfaceId, text: DISMISS_MARK, author: "user" },
            surfaceId,
            DISMISS_MARK,
          );
          toast("Dismissed — told your agent to drop it");
        }}
      >
        <CircleSlash />
      </VerdictButton>
    ) : null;

  // Post a line comment from the draft line composer.
  const sendAnnotation = (text: string): Promise<string | null> => {
    const anchor = draftAnchor;
    if (!anchor) return Promise.resolve(null);
    setDraftAnchor(null);
    return sendComment(
      { surface: surfaceId, text, author: "user", anchor },
      surfaceId,
      text,
      anchor,
    );
  };

  // Per-surface secondary actions, shared by the collapsed footer bar and the
  // persistent-composer footer (see Thread). "Read" (the focused one-at-a-time
  // reader) is an explainer affordance, so it shows only on non-finding cards —
  // a review card wants density and burndown, not a slideshow. Copy link / open
  // / delete live in the ⋯ overflow.
  const surfaceActions = (
    <>
      {!isFinding ? (
        <IconAction label="Read — focused, one at a time" onClick={() => enterReading(surfaceId)}>
          <BookOpen />
        </IconAction>
      ) : null}
      <SurfaceOverflowMenu surfaceId={surfaceId} title={props.surface.title} />
    </>
  );

  return (
    <div
      className="card mb-4 animate-in overflow-hidden rounded-xl border-[0.5px] border-border bg-card fade-in-0 slide-in-from-bottom-1 shadow-[0_1px_2px_rgba(0,0,0,0.035),0_1px_3px_rgba(0,0,0,0.045)] transition-[box-shadow,border-color] duration-200 ease-out hover:border-[var(--border-2)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_20px_rgba(0,0,0,0.07)] motion-reduce:animate-none dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.3)] dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_8px_24px_rgba(0,0,0,0.45)]"
      data-id={surfaceId}
      ref={cardRef}
    >
      <div className="flex items-center gap-2 px-4 py-3">
        {props.surface.badge ? <SurfaceBadgeChip badge={props.surface.badge} /> : null}
        <span className="card-title truncate text-[14px] font-semibold tracking-[-0.01em] text-foreground max-[700px]:min-w-0 max-[700px]:flex-[0_1_auto]">
          {props.surface.title}
        </span>
        {/* A new version rebuilds the select, resetting the selection to the
            latest like the live iframe src does. */}
        {props.surface.version > 1 ? (
          <Select
            key={props.surface.version}
            defaultValue={String(props.surface.version)}
            onValueChange={(ver) => {
              const cb = Date.now();
              for (const [part, frame] of htmlFramesRef.current) {
                frame.src = `/s/${surfaceId}?part=${part}&ver=${ver}&cb=${cb}&theme=${activeThemeNow()}&mode=${resolvedMode()}`;
              }
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-[22px] flex-none gap-1 rounded-full border-border px-2.5 text-[11px] font-medium text-muted-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {versionRange(props.surface.version).map((v) => (
                <SelectItem value={String(v)} key={v} className="text-xs">
                  v{v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          // v1 has no other versions to switch to, so it's plain text — not a
          // pill that mimics the (interactive) version Select above.
          <span className="flex-none text-[11px] font-normal text-faint tabular-nums">v1</span>
        )}
        <span className="flex-1"></span>
        <span className="flex-none text-[11px] text-faint tabular-nums">
          {relTime(props.surface.updatedAt)}
        </span>
      </div>
      {/* Parts render in order, dispatched by kind. The fallback is reserved for
          a kind this viewer build doesn't know — which happens when a long-open
          tab predates a newly added part type. It must NOT assume diff (an
          unknown part is not a broken diff), so it shows a neutral refresh hint
          instead. An html iframe src changes only when the version, the active
          theme, or the resolved light/dark mode does, so unrelated refetches
          never reload it. The parts sit in a positioned wrapper so the line
          comment composer can layer over them. */}
      <div className="relative">
        {props.surface.parts.map((part, i) => {
          switch (part.kind) {
            case "html":
              return (
                <iframe
                  key={i}
                  ref={htmlFrameRef(i)}
                  className="block h-[120px] w-full border-0 border-t-[0.5px] border-border bg-transparent"
                  sandbox="allow-scripts"
                  title={
                    props.surface.parts.length > 1
                      ? `${props.surface.title} (part ${i + 1})`
                      : props.surface.title
                  }
                  src={appPath(
                    `/s/${surfaceId}?part=${i}&ver=${props.surface.version}&cb=${props.surface.version}&theme=${activeTheme}&mode=${mode}`,
                  )}
                ></iframe>
              );
            case "markdown":
              return <MarkdownPart key={i} part={part as MarkdownPartData} />;
            case "mermaid":
              return <MermaidPart key={i} part={part as MermaidPartData} />;
            case "diff":
              return (
                <DiffPart
                  key={i}
                  part={part as DiffPartData}
                  onLineClick={isReadonly() ? undefined : (a) => setDraftAnchor(a)}
                />
              );
            case "image":
              return <ImagePart key={i} part={part as ImagePartData} />;
            case "trace":
              return <TracePart key={i} part={part as TracePartData} />;
            case "terminal":
              return <TerminalPart key={i} part={part as TerminalPartData} />;
            case "json":
              return <JsonPart key={i} part={part as JsonPartData} />;
            case "code":
              return <CodePart key={i} part={part as CodePartData} />;
            case "chart":
              return <ChartPart key={i} part={part as ChartPartData} />;
            default:
              return (
                <div
                  className="border-t-[0.5px] border-border px-3.5 py-2.5 text-xs text-faint"
                  key={i}
                >
                  Can&rsquo;t show this part — refresh showcase to update the viewer.
                </div>
              );
          }
        })}
        {draftAnchor ? (
          <LineCommentComposer
            anchor={draftAnchor}
            onSend={sendAnnotation}
            onCancel={() => setDraftAnchor(null)}
          />
        ) : null}
      </div>
      <Thread
        surfaceId={surfaceId}
        placeholder="Leave a comment…"
        collapsible
        readonly={isReadonly()}
        actions={(startReply) => (
          <TooltipProvider delayDuration={300}>
            {!isReadonly() ? (
              <>
                {approveAction}
                {dismissAction}
                <VerdictButton
                  tone="change"
                  label={isFinding ? "Request change" : "Comment"}
                  onClick={startReply}
                >
                  <MessageSquare />
                </VerdictButton>
              </>
            ) : null}
            <span className="flex-1" />
            {surfaceActions}
          </TooltipProvider>
        )}
        secondaryActions={
          <TooltipProvider delayDuration={300}>
            {approveAction}
            {dismissAction}
            {surfaceActions}
          </TooltipProvider>
        }
        send={(text) => sendComment({ surface: surfaceId, text, author: "user" }, surfaceId, text)}
      />
    </div>
  );
}
