import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  api,
  appPath,
  isReadonly,
  relTime,
  sessionLabel,
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
import { CommentIcon, LinkIcon, OpenIcon, TrashIcon } from "./icons.tsx";
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
  sessionsNow,
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

  return (
    <div
      className="card mb-5 overflow-hidden rounded-xl border-[0.5px] border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_6px_rgba(0,0,0,0.05)] transition-[box-shadow,border-color] duration-[0.18s] ease-in-out hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.07)]"
      data-id={surfaceId}
      ref={cardRef}
    >
      <div className="flex items-center gap-2.5 px-4 py-[13px]">
        <span className="card-title text-sm font-[550] tracking-[-0.006em] text-foreground max-[700px]:min-w-0 max-[700px]:flex-[0_1_auto] max-[700px]:truncate">
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
              className="h-6 gap-1 rounded-full px-2.5 text-[11px] text-muted-foreground"
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
          <Badge variant="outline" className="rounded-full font-normal text-muted-foreground">
            v1
          </Badge>
        )}
        <span className="flex-1"></span>
        <span className="text-xs text-faint">{relTime(props.surface.updatedAt)}</span>
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
                <CommentIcon />
              </IconAction>
            ) : null}
            <span className="flex-1" />
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
              <LinkIcon />
            </IconAction>
            <IconAction label="Open in a new tab" href={surfaceLink(surfaceId)}>
              <OpenIcon />
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
                  <TrashIcon />
                </IconAction>
              </>
            ) : null}
          </TooltipProvider>
        )}
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
}) {
  const [replying, setReplying] = useState(false);
  const comments = useBoard((s) => s.comments);
  const list = comments.filter((c) => c.surfaceId === props.surfaceId);
  return (
    <div className="thread">
      {list.length ? (
        <div className="flex flex-col gap-3 border-t-[0.5px] border-border px-3.5 py-3">
          {list.map((c) => (
            <CommentRow comment={c} key={c.id} />
          ))}
        </div>
      ) : null}
      {props.collapsible ? (
        // Pin the footer height and center its content so swapping the action
        // bar for the inline composer (and back) never changes the footer
        // height — the card above must not pop when you start or finish a
        // comment.
        <div className="flex min-h-11 items-center border-t-[0.5px] border-border px-2 py-[5px] [&>*]:min-w-0 [&>*]:flex-1">
          {!props.readonly && replying ? (
            <Composer
              placeholder={props.placeholder}
              send={props.send}
              autofocus
              onCancel={() => setReplying(false)}
            />
          ) : (
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

// The paste block a copied comment puts on the clipboard — enough context
// for an agent to act on the comment when handed it directly.
function pasteBlock(c: ViewComment): string {
  if (c.surfaceId) {
    return `showcase comment on “${c.surfaceTitle ?? "a surface"}” (surface ${c.surfaceId}):\n“${c.text}”`;
  }
  const s = sessionsNow().find((x) => x.id === c.sessionId);
  return `showcase comment, session “${s ? sessionLabel(s) : c.sessionId}”:\n“${c.text}”`;
}

function CommentRow(props: { comment: ViewComment }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pasteBlock(props.comment));
      toast("Copied — paste it to your agent");
    } catch {
      toast("Couldn't copy to clipboard");
    }
  };
  const isUser = props.comment.author === "user";
  // `cmt` + `user` and the `.who` text "you" are oracle hooks (the e2e suite
  // asserts `.thread .cmt.user .who` reads "you") — keep them as marker classes.
  // The comment text is plain text rendered as a React text node: it escapes by
  // construction and never becomes HTML, so it's the sanctioned non-iframe path
  // for agent-authored *data* (like image/trace parts) and needs no sandbox.
  return (
    <div
      className={cx(
        "cmt group/cmt flex flex-col gap-1",
        isUser ? "user items-end" : "items-start",
        !!props.comment.pending && "opacity-55",
      )}
      data-cid={props.comment.id}
    >
      <div className="flex items-baseline gap-2 px-1">
        <span
          className={cx(
            "who text-[11px] font-medium",
            isUser ? "text-brand" : "text-muted-foreground",
          )}
        >
          {isUser ? "you" : props.comment.author}
        </span>
        <span className="text-[10.5px] text-faint">{relTime(props.comment.createdAt)}</span>
      </div>
      <div className={cx("flex max-w-[88%] items-end gap-1", isUser && "flex-row-reverse")}>
        <div
          className={cx(
            "min-w-0 rounded-2xl px-3 py-1.5 text-[13px] leading-snug break-words whitespace-pre-wrap",
            isUser ? "bg-brand text-primary-foreground" : "bg-muted text-foreground",
          )}
        >
          {props.comment.text}
        </div>
        {isUser && !props.comment.pending ? (
          <button
            className="mb-0.5 flex-none rounded px-1 text-xs text-faint opacity-0 transition-opacity group-hover/cmt:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
            title="Copy for pasting to your agent"
            onClick={copy}
          >
            ⧉
          </button>
        ) : null}
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
  const send = async () => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    const error = await props.send(text);
    // on failure the text goes back in the input — never silently lost
    if (error !== null) {
      if (!input.value) input.value = text;
      input.focus();
      toast(`Couldn't post that comment — ${error}. It's back in the box.`);
    }
  };
  useEffect(() => {
    if (props.autofocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex gap-2">
      <Input
        ref={inputRef}
        placeholder={props.placeholder}
        className="h-8 flex-1 text-[13px]"
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
          // Escape folds the composer back to the action bar — but only when
          // it's empty, so an in-progress reply can't be lost to a stray key.
          else if (e.key === "Escape" && !inputRef.current?.value && props.onCancel)
            props.onCancel();
        }}
      />
      <Button size="sm" variant="secondary" onClick={send}>
        Comment
      </Button>
      {props.onCancel ? (
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      ) : null}
    </div>
  );
}
