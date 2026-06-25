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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  ArrowUp,
  Bookmark,
  Check,
  ExternalLink,
  Link2,
  MapPin,
  MessageSquare,
  Sparkles,
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
import {
  focusSurface,
  notifyComposing,
  sendComment,
  sessionRespondKey,
  setScrollTarget,
  toast,
  togglePin,
  useBoard,
  useResponding,
  type ViewComment,
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

// A scannable status chip leading the card header — the review severity on a
// finding card ("Bug" / "Nit" / "Question" / "Praise"), or any short label. A
// solid tone dot makes it read as an intentional status indicator (Linear-style)
// rather than a flat pill; the tinted body + hairline ring keep it quiet.
const BADGE_TONE_CLASS: Record<SurfaceBadge["tone"], string> = {
  critical: "bg-red-500/10 text-red-700 ring-red-600/20 dark:text-red-300 dark:ring-red-400/25",
  warning:
    "bg-amber-500/12 text-amber-800 ring-amber-600/20 dark:text-amber-300 dark:ring-amber-400/25",
  info: "bg-blue-500/10 text-blue-700 ring-blue-600/20 dark:text-blue-300 dark:ring-blue-400/25",
  success:
    "bg-emerald-500/10 text-emerald-700 ring-emerald-600/20 dark:text-emerald-300 dark:ring-emerald-400/25",
  neutral: "bg-muted text-muted-foreground ring-border",
};
const BADGE_DOT_CLASS: Record<SurfaceBadge["tone"], string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  success: "bg-emerald-500",
  neutral: "bg-muted-foreground/55",
};

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

// A pin over the parts region at a comment's anchor (a dot centered on the
// point). Saved comments show a static dot with the note as a hover tooltip; the
// draft pin pulses while the note is being typed.
function AnnotationPin(props: { anchor: CommentAnchor; text?: string; draft?: boolean }) {
  return (
    <span
      className={cx(
        "pointer-events-auto absolute z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow-[0_1px_2px_rgba(0,0,0,0.35)] dark:border-card",
        props.draft && "animate-pulse motion-reduce:animate-none",
      )}
      style={{ left: `${props.anchor.xPct * 100}%`, top: `${props.anchor.yPct * 100}%` }}
      title={props.text}
    />
  );
}

// A small note input pinned near a draft annotation. Enter sends, Escape cancels.
// Left-clamped so it stays inside the card (which clips overflow).
function AnnotationComposer(props: {
  anchor: CommentAnchor;
  onSend: (text: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  return (
    <div
      className="absolute z-30 mt-2 w-60 max-w-[88%] rounded-lg border-[0.5px] border-border bg-card p-2 shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
      style={{
        left: `${Math.min(58, Math.max(2, props.anchor.xPct * 100))}%`,
        top: `${props.anchor.yPct * 100}%`,
      }}
    >
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-faint">
        <MapPin className="size-3" /> Note about this spot
      </div>
      <Input
        ref={inputRef}
        placeholder="What about here?"
        aria-label="Annotation note"
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

  // Annotations: `annotating` arms the click-capture overlay; clicking drops a
  // pin (`draftAnchor`) and opens a note composer; on send the comment carries
  // the anchor. Existing anchored comments render as pins over the parts region.
  const partsRef = useRef<HTMLDivElement>(null);
  const [annotating, setAnnotating] = useState(false);
  const [draftAnchor, setDraftAnchor] = useState<CommentAnchor | null>(null);
  const anchored = useBoard((s) => s.comments).filter(
    (cm) => cm.surfaceId === props.surface.id && cm.anchor,
  );

  const surfaceId = props.surface.id;

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
  const approveAction = !isReadonly() ? (
    <IconAction
      label="Approve — looks good"
      onClick={() => {
        const text = "✓ Approved — this looks good.";
        void sendComment({ surface: surfaceId, text, author: "user" }, surfaceId, text);
        toast("Sent approval to your agent");
      }}
    >
      <ThumbsUp />
    </IconAction>
  ) : null;

  // Annotate toggle: arm the click-capture overlay (or cancel an in-progress one).
  const annotateAction = !isReadonly() ? (
    <IconAction
      label={annotating ? "Cancel — click the card to cancel" : "Pin a note to a spot"}
      onClick={() => {
        setDraftAnchor(null);
        setAnnotating((v) => !v);
      }}
    >
      <MapPin className={annotating ? "text-brand" : undefined} />
    </IconAction>
  ) : null;

  // Post an anchored comment from the draft pin's note composer.
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

  // Per-surface secondary actions (pin / copy link / open / delete) — shared by
  // the collapsed footer bar and the persistent-composer footer (see Thread).
  const pinned = !!props.surface.pinned;
  const surfaceActions = (
    <>
      {!isReadonly() ? (
        <IconAction
          label={pinned ? "Remove from Library" : "Pin to your Library"}
          onClick={() => void togglePin(surfaceId, !pinned)}
        >
          <Bookmark
            className={pinned ? "text-brand" : undefined}
            fill={pinned ? "currentColor" : "none"}
          />
        </IconAction>
      ) : null}
      <IconAction
        label="Copy link to this surface"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(surfaceLink(surfaceId));
            toast("Link copied");
          } catch {
            toast("Couldn't copy the link");
          }
        }}
      >
        <Link2 />
      </IconAction>
      <IconAction label="Open in a new tab" href={surfaceLink(surfaceId)}>
        <ExternalLink />
      </IconAction>
      {!isReadonly() ? (
        <>
          <span className="mx-1 h-4 w-px bg-border" />
          <IconAction
            label="Delete surface"
            danger
            onClick={async () => {
              if (confirm(`Delete "${props.surface.title}"?`)) {
                await api(`/api/surfaces/${surfaceId}`, { method: "DELETE" });
              }
            }}
          >
            <Trash2 />
          </IconAction>
        </>
      ) : null}
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
          <Badge
            variant="outline"
            className="flex-none rounded-full border-border px-2 py-0 text-[11px] font-normal text-faint"
          >
            v1
          </Badge>
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
          never reload it. The parts sit in a positioned wrapper so annotation
          pins + the click-capture overlay can layer over them. */}
      <div className="relative" ref={partsRef}>
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
              return <DiffPart key={i} part={part as DiffPartData} />;
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
        {anchored.map((cm) => (
          <AnnotationPin key={cm.id} text={cm.text} anchor={cm.anchor!} />
        ))}
        {draftAnchor ? <AnnotationPin draft anchor={draftAnchor} /> : null}
        {annotating ? (
          <div
            className="absolute inset-0 z-20 cursor-crosshair bg-brand/[0.04]"
            title="Click a spot on the card to pin a note"
            onClick={(e) => {
              const el = partsRef.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              const c01 = (n: number) => Math.min(1, Math.max(0, n));
              setAnnotating(false);
              setDraftAnchor({
                xPct: c01((e.clientX - r.left) / r.width),
                yPct: c01((e.clientY - r.top) / r.height),
              });
            }}
          />
        ) : null}
        {draftAnchor ? (
          <AnnotationComposer
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
                {annotateAction}
                <IconAction label="Request a change" onClick={startReply}>
                  <MessageSquare />
                </IconAction>
              </>
            ) : null}
            <span className="flex-1" />
            {surfaceActions}
          </TooltipProvider>
        )}
        secondaryActions={
          <TooltipProvider delayDuration={300}>
            {approveAction}
            {annotateAction}
            {surfaceActions}
          </TooltipProvider>
        }
        send={(text) => sendComment({ surface: surfaceId, text, author: "user" }, surfaceId, text)}
      />
    </div>
  );
}

export function Thread(props: {
  surfaceId: string | null;
  // Set for the session-level chat (surfaceId null): scopes the responding
  // indicator to `session:<id>` instead of a surface.
  sessionId?: string;
  placeholder: string;
  send: (text: string) => Promise<string | null>;
  // When set, the composer is hidden behind a Comment action and the other
  // per-card actions (open/delete/…) share the footer toolbar. The bar sits on
  // the card surface, set off by a hairline divider and muted action styling,
  // so a user's comment never reads as part of the agent-rendered UI.
  collapsible?: boolean;
  readonly?: boolean;
  actions?: (startReply: () => void) => ReactNode;
  // Link/open/delete, shown under the persistent composer once a card has
  // messages — the chat input takes the footer, these recede beneath it.
  secondaryActions?: ReactNode;
}) {
  const [replying, setReplying] = useState(false);
  const comments = useBoard((s) => s.comments);
  const respondKey =
    props.surfaceId ?? (props.sessionId ? sessionRespondKey(props.sessionId) : null);
  const responding = useResponding(respondKey);
  const list = comments.filter((c) => c.surfaceId === props.surfaceId);
  const hasMessages = list.length > 0;
  // Heartbeat the agent's feedback wait while this composer is active, so
  // queueing a second message doesn't get cut off by the first.
  const onComposing = props.readonly
    ? undefined
    : () => notifyComposing({ session: props.sessionId, surface: props.surfaceId });
  // Once a card has a conversation, pin the composer at the bottom like a chat
  // input; an untouched card keeps it collapsed behind the Comment action so it
  // stays compact.
  const showComposer = !props.readonly && (hasMessages || replying);
  // Keep the newest message in view as the thread grows (a chat-input feel).
  const endRef = useRef<HTMLDivElement>(null);
  const count = list.length;
  useEffect(() => {
    if (count > 0 || responding)
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, responding]);
  return (
    <div className="thread">
      {list.length || responding ? (
        <div className="flex flex-col border-t-[0.5px] border-border px-3.5 py-3">
          {list.map((c, i) => {
            // First message of a run from the same author wears the label +
            // timestamp; continuations stack tighter under it.
            const startsRun = i === 0 || list[i - 1].author !== c.author;
            return <CommentRow comment={c} startsRun={startsRun} key={c.id} />;
          })}
          {responding ? <TypingIndicator hasMessages={hasMessages} /> : null}
          <div ref={endRef} />
        </div>
      ) : null}
      {props.collapsible ? (
        <div className="border-t-[0.5px] border-border px-2.5 py-2">
          {showComposer ? (
            <div className="flex flex-col gap-1.5">
              <Composer
                placeholder={props.placeholder}
                send={props.send}
                autofocus={replying}
                onCancel={hasMessages ? undefined : () => setReplying(false)}
                onComposing={onComposing}
              />
              {hasMessages && props.secondaryActions ? (
                <div className="flex items-center justify-end gap-0.5">
                  {props.secondaryActions}
                </div>
              ) : null}
            </div>
          ) : (
            // Pin a min height so swapping the bar for the inline composer (when
            // you start the first comment) never pops the card above.
            <div className="flex min-h-[34px] items-center gap-0.5">
              {props.actions?.(() => setReplying(true))}
            </div>
          )}
        </div>
      ) : !props.readonly ? (
        <div className="border-t-[0.5px] border-border px-2.5 py-2">
          <Composer placeholder={props.placeholder} send={props.send} onComposing={onComposing} />
        </div>
      ) : null}
    </div>
  );
}

// The "agent is responding…" bubble — agent-aligned, three softly bouncing dots.
// Shown while we expect a reply (the user sent to a listening session); cleared
// when the reply lands or the responding timeout elapses.
function TypingIndicator(props: { hasMessages: boolean }) {
  return (
    <div
      className={cx(
        "cmt items-start flex flex-col",
        props.hasMessages ? "mt-3" : "mt-0",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
      )}
      aria-label="Agent is responding"
    >
      <div className="flex items-center gap-1 rounded-2xl bg-muted px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-foreground/40 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 0.15 - 0.3}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// A prompt proposed by a surface's own UI (a sendPrompt() button — the
// drill-down loop). It is stamped author:"surface", never "user", so it can't
// reach the agent on its own (untrusted markup must not impersonate the user).
// This renders it as an explicit suggestion the user relays with one tap, which
// re-posts it as a genuine user message — closing the loop while keeping the
// trust boundary.
function SurfaceSuggestion(props: { comment: ViewComment; startsRun: boolean }) {
  const [sent, setSent] = useState(false);
  const relay = async () => {
    const sid = props.comment.surfaceId;
    if (!sid || sent) return;
    setSent(true);
    await sendComment(
      { surface: sid, text: props.comment.text, author: "user" },
      sid,
      props.comment.text,
    );
  };
  return (
    <div
      className={cx(
        "cmt flex flex-col items-start",
        props.startsRun ? "mt-3 first:mt-0" : "mt-0.5",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
      )}
      data-cid={props.comment.id}
    >
      <div className="max-w-[88%] rounded-2xl border border-dashed border-border bg-background px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-faint">
          <Sparkles className="size-3" />
          Suggested by this surface
        </div>
        <div className="text-[13px] leading-snug break-words whitespace-pre-wrap text-foreground">
          {props.comment.text}
        </div>
        {!isReadonly() ? (
          <button
            type="button"
            disabled={sent}
            onClick={relay}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {sent ? (
              <>
                <Check className="size-3" /> Sent
              </>
            ) : (
              <>
                <ArrowUp className="size-3" /> Send to agent
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CommentRow(props: { comment: ViewComment; startsRun: boolean }) {
  if (props.comment.author === "surface")
    return <SurfaceSuggestion comment={props.comment} startsRun={props.startsRun} />;
  const isUser = props.comment.author === "user";
  // `cmt` + `user` are oracle hooks (the e2e suite asserts `.thread .cmt.user`).
  // Sender is conveyed by alignment + colour — no label. The comment text is
  // plain text rendered as a React text node: it escapes by construction and
  // never becomes HTML, so it's the sanctioned non-iframe path for
  // agent-authored *data* and needs no sandbox. The timestamp is a hover title.
  return (
    <div
      className={cx(
        "cmt group/cmt flex flex-col",
        // Continuations within a run hug the previous bubble; a new run gets air.
        props.startsRun ? "mt-3 first:mt-0" : "mt-0.5",
        isUser ? "user items-end" : "items-start",
        // Pending bubbles pulse; settled ones get a quick one-shot enter. Both
        // yield to prefers-reduced-motion.
        props.comment.pending
          ? "animate-pulse opacity-60 motion-reduce:animate-none"
          : "animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
      )}
      data-cid={props.comment.id}
    >
      <div
        className={cx(
          "max-w-[88%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug break-words whitespace-pre-wrap",
          isUser ? "bg-brand text-primary-foreground" : "bg-muted text-foreground",
        )}
        title={relTime(props.comment.createdAt)}
      >
        {props.comment.text}
      </div>
    </div>
  );
}

function Composer(props: {
  placeholder: string;
  send: (text: string) => Promise<string | null>;
  autofocus?: boolean;
  onCancel?: () => void;
  // Fired on focus and on each keystroke so the thread can heartbeat "still
  // composing" to the server (it throttles), keeping a parked agent's feedback
  // batch open while the user queues more messages.
  onComposing?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Track emptiness so the send button can disable when there's nothing to post.
  const [empty, setEmpty] = useState(true);
  const send = async () => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    setEmpty(true);
    const error = await props.send(text);
    // on failure the text goes back in the input — never silently lost
    if (error !== null) {
      if (!input.value) input.value = text;
      setEmpty(false);
      input.focus();
      toast(`Couldn't post that comment — ${error}. It's back in the box.`);
    }
  };
  useEffect(() => {
    if (props.autofocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        ref={inputRef}
        placeholder={props.placeholder}
        aria-label="Comment"
        title="Press Enter to send"
        className="h-8 flex-1 rounded-lg text-[13px]"
        onFocus={() => props.onComposing?.()}
        onInput={(e) => {
          setEmpty(!e.currentTarget.value.trim());
          props.onComposing?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
          // Escape folds the composer back to the action bar — but only when
          // it's empty, so an in-progress reply can't be lost to a stray key.
          else if (e.key === "Escape" && !inputRef.current?.value && props.onCancel)
            props.onCancel();
        }}
      />
      {props.onCancel ? (
        <Button size="sm" variant="ghost" className="h-8" onClick={props.onCancel}>
          Cancel
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="default"
        className="size-8 flex-none rounded-lg"
        disabled={empty}
        aria-label="Send comment"
        title="Send (Enter)"
        onClick={send}
      >
        <ArrowUp className="size-4" />
      </Button>
    </div>
  );
}
