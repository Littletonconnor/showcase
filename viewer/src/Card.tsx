import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { renderHtmlPage } from "../../server/surfacePage.ts";
import { DEFAULT_THEME_ID, THEMES, themeById } from "../../server/themes.ts";
import {
  api,
  appPath,
  exportBundle,
  inlineAssetRefs,
  isReadonly,
  relTime,
  type ChartPart as ChartPartData,
  type DiffPart as DiffPartData,
  type HtmlPart as HtmlPartData,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
import { BookOpen, Check, Copy, ExternalLink, Link2, MoreHorizontal, Trash2 } from "lucide-react";
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
  SurfaceThemeContext,
} from "./theme.ts";
import { TracePart } from "./TracePart.tsx";
import { enterReading, focusSurface, setScrollTarget, toast, useBoard } from "./state.ts";

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
function SurfaceOverflowMenu(props: { surfaceId: string; title: string; theme?: string }) {
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
            <DropdownMenuLabel className="text-faint">Theme</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={props.theme ?? DEFAULT_THEME_ID}
              onValueChange={async (id) => {
                await api(`/api/surfaces/${props.surfaceId}`, {
                  method: "PUT",
                  body: JSON.stringify({ theme: id }),
                });
              }}
            >
              {THEMES.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id}>
                  {t.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
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

// The card's stable handle: a click-to-copy chip of the surface id, always
// shown in the header. Copy it and mention it to your agent in the terminal —
// that's how a surface is referenced now (the in-browser comment thread is
// gone). A monospace pill so it reads as an identifier, not prose.
function CardIdChip(props: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy card ID ${props.id}`}
      title="Copy card ID — mention it to your agent"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.id);
          setCopied(true);
          toast("Card ID copied");
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast("Couldn't copy the card ID");
        }
      }}
      className="inline-flex flex-none items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {props.id}
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

  const surfaceId = props.surface.id;
  // This surface's theme — its own if set, else the global board theme. Drives
  // both this card's html-part iframe srcs and (via SurfaceThemeContext) every
  // rich part rendered inside it.
  const surfaceTheme = props.surface.theme ?? activeTheme;

  // In a static export there is no `/s/:id` server route, so html parts can't
  // load from it. Render each html part to a self-contained sandbox doc here
  // (the same `renderHtmlPage` the server uses), with `/a/:id` asset refs inlined
  // — then the iframe gets a `srcdoc` instead of a `src`. Recomputes on theme/
  // mode change, so light/dark still toggles, exactly like the data parts.
  const exportHtmlDocs = useMemo(() => {
    if (!exportBundle()) return null;
    const docs = new Map<number, string>();
    props.surface.parts.forEach((part, i) => {
      if (part.kind === "html") {
        const p = part as HtmlPartData;
        docs.set(
          i,
          renderHtmlPage({
            title: props.surface.title,
            html: inlineAssetRefs(p.html),
            origin: location.origin,
            theme: themeById(surfaceTheme),
            mode,
            kits: p.kits,
          }),
        );
      }
    });
    return docs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.surface.parts, props.surface.title, surfaceTheme, mode]);
  // A badged card is a review finding; the focused "Read" affordance is for
  // explainers, so it shows only on non-finding cards.
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

  // Per-surface secondary actions in the footer toolbar. "Read" (the focused
  // one-at-a-time reader) is an explainer affordance, so it shows only on
  // non-finding cards — a review card wants density, not a slideshow. Copy
  // link / open / delete live in the ⋯ overflow.
  const surfaceActions = (
    <>
      {!isFinding ? (
        <IconAction label="Read — focused, one at a time" onClick={() => enterReading(surfaceId)}>
          <BookOpen />
        </IconAction>
      ) : null}
      <SurfaceOverflowMenu
        surfaceId={surfaceId}
        title={props.surface.title}
        theme={props.surface.theme}
      />
    </>
  );

  return (
    <SurfaceThemeContext.Provider value={props.surface.theme}>
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
            latest like the live iframe src does. Version switching drives html
            parts via `/s/:id`, which a static export has no server for — so it's
            a live-only affordance; an export is a snapshot of the current version. */}
          {props.surface.version > 1 && !exportBundle() ? (
            <Select
              key={props.surface.version}
              defaultValue={String(props.surface.version)}
              onValueChange={(ver) => {
                const cb = Date.now();
                for (const [part, frame] of htmlFramesRef.current) {
                  frame.src = `/s/${surfaceId}?part=${part}&ver=${ver}&cb=${cb}&theme=${props.surface.theme ?? activeThemeNow()}&mode=${resolvedMode()}`;
                }
              }}
            >
              <SelectTrigger
                size="sm"
                data-print-hide
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
          <CardIdChip id={surfaceId} />
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
              case "html": {
                const exportDoc = exportHtmlDocs?.get(i);
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
                    {...(exportDoc !== undefined
                      ? { srcDoc: exportDoc }
                      : {
                          src: appPath(
                            `/s/${surfaceId}?part=${i}&ver=${props.surface.version}&cb=${props.surface.version}&theme=${surfaceTheme}&mode=${mode}`,
                          ),
                        })}
                  ></iframe>
                );
              }
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
        </div>
        {/* Footer toolbar: per-surface utilities. Interactive chrome — hidden when
          the board is printed/saved as PDF. There is no inline composer: to
          discuss a surface with the agent, copy its card id (the header chip) and
          mention it in your terminal. */}
        <div
          data-print-hide
          className="flex min-h-[34px] items-center gap-0.5 border-t-[0.5px] border-border px-2.5 py-2"
        >
          <TooltipProvider delayDuration={300}>
            <span className="flex-1" />
            {surfaceActions}
          </TooltipProvider>
        </div>
      </div>
    </SurfaceThemeContext.Provider>
  );
}
