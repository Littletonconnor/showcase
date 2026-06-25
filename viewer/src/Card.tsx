import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  api,
  appPath,
  isReadonly,
  relTime,
  type ChartPart as ChartPartData,
  type DiffPart as DiffPartData,
  type ImagePart as ImagePartData,
  type JsonPart as JsonPartData,
  type CodePart as CodePartData,
  type MarkdownPart as MarkdownPartData,
  type MermaidPart as MermaidPartData,
  type Surface,
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
import { ArrowUp, ExternalLink, Link2, MessageSquare, Trash2 } from "lucide-react";
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
  sendComment,
  setScrollTarget,
  toast,
  useBoard,
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

  // Per-surface secondary actions (copy link / open / delete) — shared by the
  // collapsed footer bar and the persistent-composer footer (see Thread).
  const surfaceActions = (
    <>
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
          never reload it. */}
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
      <Thread
        surfaceId={surfaceId}
        placeholder="Leave a comment…"
        collapsible
        readonly={isReadonly()}
        actions={(startReply) => (
          <TooltipProvider delayDuration={300}>
            {!isReadonly() ? (
              <IconAction label="Comment" onClick={startReply}>
                <MessageSquare />
              </IconAction>
            ) : null}
            <span className="flex-1" />
            {surfaceActions}
          </TooltipProvider>
        )}
        secondaryActions={<TooltipProvider delayDuration={300}>{surfaceActions}</TooltipProvider>}
        send={(text) => sendComment({ surface: surfaceId, text, author: "user" }, surfaceId, text)}
      />
    </div>
  );
}

function Thread(props: {
  surfaceId: string | null;
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
  const list = comments.filter((c) => c.surfaceId === props.surfaceId);
  const hasMessages = list.length > 0;
  // Once a card has a conversation, pin the composer at the bottom like a chat
  // input; an untouched card keeps it collapsed behind the Comment action so it
  // stays compact.
  const showComposer = !props.readonly && (hasMessages || replying);
  // Keep the newest message in view as the thread grows (a chat-input feel).
  const endRef = useRef<HTMLDivElement>(null);
  const count = list.length;
  useEffect(() => {
    if (count > 0) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count]);
  return (
    <div className="thread">
      {list.length ? (
        <div className="flex flex-col border-t-[0.5px] border-border px-3.5 py-3">
          {list.map((c, i) => {
            // First message of a run from the same author wears the label +
            // timestamp; continuations stack tighter under it.
            const startsRun = i === 0 || list[i - 1].author !== c.author;
            return <CommentRow comment={c} startsRun={startsRun} key={c.id} />;
          })}
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
        <Composer placeholder={props.placeholder} send={props.send} />
      ) : null}
    </div>
  );
}

function CommentRow(props: { comment: ViewComment; startsRun: boolean }) {
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
        onInput={(e) => setEmpty(!e.currentTarget.value.trim())}
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
