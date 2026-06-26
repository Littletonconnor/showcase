import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plug,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { AgentMark } from "./agentMarks.tsx";
import {
  api,
  isReadonly,
  layoutMode,
  relTime,
  sessionLabel,
  sessionLink,
  type SessionRow,
  type Surface,
  type SurfaceBadge,
} from "./api.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { routeGet, routeSubscribe, root } from "./host.ts";
import {
  BADGE_DOT_CLASS,
  BADGE_TONE_CLASS,
  BADGE_TONE_ORDER,
  Card,
  cardEls,
  frameForSource,
  Thread,
} from "./Card.tsx";
import { cx } from "./cx.ts";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { applyFrameHeight } from "./SandboxedPart.tsx";
import { renderNotes } from "./notes.ts";
import { initTheme } from "./theme.ts";
import {
  applyRoute,
  checkVersion,
  clearUnread,
  connect,
  dismissUpdate,
  exitReading,
  goHome,
  groupSessions,
  isResolutionComment,
  nearBottom,
  readingStep,
  refreshSessions,
  refreshSessionsQuiet,
  select,
  selectAdjacent,
  selectedNow,
  sessionsNow,
  sendComment,
  setPillTarget,
  toast,
  updateNoticeFrom,
  useBoard,
  useSessionListening,
} from "./state.ts";

// The shadcn SidebarProvider persists its open/collapsed state to a
// `sidebar_state` cookie; read it back on mount so the rail restores across
// reloads (defaultOpen feeds the provider's initial state).
function readSidebarCookie(): boolean {
  const m = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return m ? m[1] === "true" : true;
}

// Stream-only layout: no sidebar, session list, or session chrome — just the
// current session's stream. Driven by the self-hosted public-read "session"
// link (see api.ts `layoutMode`).
const streamMode = () => layoutMode() === "stream";

// The wordmark, doubling as a home link: clicking it clears the current session
// and returns to the empty board (goHome). A real <button> so it's keyboard- and
// screen-reader-reachable. The live dot stays visible when the rail collapses to
// the icon width; the wordmark text fades out (the `group-data-[collapsible=icon]`
// context comes from the Sidebar primitive).
const BRAND_CLASS =
  "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[15px] font-semibold tracking-[-0.01em] text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40";

function Brand(props?: { className?: string }) {
  const live = useBoard((s) => s.live);
  return (
    <button
      className={cx(BRAND_CLASS, props?.className)}
      type="button"
      aria-label="showcase — home"
      onClick={() => goHome()}
    >
      <span
        className={cx(
          "size-[7px] flex-none rounded-full transition-all duration-300",
          live ? "bg-[#4caf78] shadow-[0_0_0_3px_rgba(76,175,120,0.18)]" : "bg-faint",
        )}
        title={live ? "Live" : "Reconnecting…"}
      ></span>
      <span className="truncate group-data-[collapsible=icon]:hidden">showcase</span>
    </button>
  );
}

// Live filter for the session list. Collapses away with the icon rail. Escape
// clears the query (then blurs on a second press if already empty), and a clear
// affordance appears once there's text.
function SessionSearch(props: { query: string; onQuery: (q: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative group-data-[collapsible=icon]:hidden">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" />
      <Input
        ref={inputRef}
        type="text"
        role="searchbox"
        aria-label="Search chats"
        placeholder="Search chats…"
        value={props.query}
        onChange={(e) => props.onQuery(e.target.value)}
        className="h-8 rounded-lg border-border/70 bg-surface pr-7 pl-8 text-[13px] shadow-none transition-colors hover:border-border focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            if (props.query) {
              e.preventDefault();
              props.onQuery("");
            } else {
              inputRef.current?.blur();
            }
          }
        }}
      />
      {props.query ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute top-1/2 right-2 flex size-4 -translate-y-1/2 items-center justify-center rounded text-faint transition-colors hover:text-foreground"
          onClick={() => {
            props.onQuery("");
            inputRef.current?.focus();
          }}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// The footer's tidy "Help & resources" cluster: one quiet SidebarMenuButton that
// opens a DropdownMenu of the guide/setup/connect links. Collapses to a single
// icon on the rail (with a tooltip), so the footer never reads as leftover text.
function FooterMenu(props: { onConnect: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          tooltip="Help & resources"
          className="text-muted-foreground data-[state=open]:bg-hover"
        >
          <Settings2 />
          <span>Help &amp; resources</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-52">
        <DropdownMenuItem asChild>
          <a href="/guide" target="_blank" rel="noreferrer">
            <BookOpen />
            Design guide
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/setup" target="_blank" rel="noreferrer">
            <Terminal />
            Agent setup
          </a>
        </DropdownMenuItem>
        {!isReadonly() ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onConnect}>
              <Plug />
              Connect Claude Code
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function App() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sessions = useBoard((s) => s.sessions);
  const sessionsLoading = useBoard((s) => s.sessionsLoading);
  const unread = useBoard((s) => s.unread);
  const pillTarget = useBoard((s) => s.pillTarget);

  // Escape closes the integrations modal while it is open.
  useEffect(() => {
    if (!connectOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConnectOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [connectOpen]);

  useEffect(() => {
    refreshSessions(routeGet().surfaceId);
    connect();
    checkVersion();
    void initTheme();
    const timer = setInterval(() => {
      if (sessionsNow().length > 0) refreshSessionsQuiet();
    }, 45_000);
    window.addEventListener("message", onBridgeMessage);
    // returning to the tab counts as seeing the selected session
    const onVisibility = () => {
      const id = selectedNow();
      if (!document.hidden && id) clearUnread(id);
    };
    document.addEventListener("visibilitychange", onVisibility);
    // Cmd+Option+Up/Down jumps between sessions without reaching for the
    // sidebar — Down moves to the next session in the list, Up the previous.
    const onKeydown = (e: KeyboardEvent) => {
      if (streamMode()) return;
      if (!e.metaKey || !e.altKey || e.ctrlKey || e.shiftKey) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        void selectAdjacent(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        void selectAdjacent(-1);
      }
    };
    window.addEventListener("keydown", onKeydown);
    // Routing: react to route changes (back/forward).
    const unsub = routeSubscribe(applyRoute);
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", onBridgeMessage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeydown);
      unsub();
    };
  }, []);

  // unseen activity badges the tab title
  useEffect(() => {
    document.title = unread.size ? `(${unread.size}) showcase` : "showcase";
  }, [unread]);

  // sessions bucketed by recency for the sidebar; recomputes whenever the
  // session list changes (incl. the 45s quiet refresh, which keeps the
  // Today/Yesterday split fresh as the day rolls over)
  const sessionGroups = useMemo(() => groupSessions(sessions, new Date()), [sessions]);

  // Live filter: keep only sessions whose title (or agent name) contains the
  // query, dropping groups that empty out. A blank query is the identity, so
  // the unfiltered list shows through with no extra work.
  const q = query.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    if (!q) return sessionGroups;
    return sessionGroups
      .map((g) => ({
        label: g.label,
        sessions: g.sessions.filter(
          (s) => sessionLabel(s).toLowerCase().includes(q) || s.agent.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.sessions.length > 0);
  }, [sessionGroups, q]);
  const noMatches = q.length > 0 && visibleGroups.length === 0;

  // Stream mode has no chrome — just the current session's stream in a plain
  // scroll container. The Sidebar layout is reserved for the full board.
  if (streamMode()) {
    return (
      <>
        <main
          className="h-full min-w-0 overflow-y-auto"
          onScroll={() => {
            if (nearBottom()) setPillTarget(null);
          }}
        >
          <SessionView />
        </main>
        <Toaster />
        <NewSurfacePill target={pillTarget} />
      </>
    );
  }

  return (
    <>
      <SidebarProvider defaultOpen={readSidebarCookie()}>
        <Sidebar collapsible="icon">
          <SidebarHeader className="gap-2">
            <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
              <Brand className="min-w-0 flex-1" />
              <SidebarTrigger className="size-7 flex-none rounded-md text-faint transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-brand/40" />
            </div>
            <SessionSearch query={query} onQuery={setQuery} />
            <UpdateBanner />
          </SidebarHeader>
          <SidebarContent id="sessionList" className="gap-0 px-1.5">
            {sessionsLoading ? (
              <SidebarGroup className="pt-2">
                <SidebarMenu className="gap-0.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <SidebarMenuItem key={i}>
                      <SidebarMenuSkeleton showIcon className="h-9" />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ) : (
              <>
                {visibleGroups.map((group, gi) => (
                  <SidebarGroup
                    key={group.label}
                    className={cx("py-0", gi === 0 ? "pt-1" : "pt-3.5")}
                  >
                    <SidebarGroupLabel className="mb-1 h-5 px-2 text-[10px] font-medium tracking-[0.09em] text-faint/70 uppercase">
                      {group.label}
                    </SidebarGroupLabel>
                    <SidebarMenu className="gap-0.5">
                      {group.sessions.map((s) => (
                        <SessionItem session={s} key={s.id} />
                      ))}
                    </SidebarMenu>
                  </SidebarGroup>
                ))}
                {noMatches ? (
                  <div className="px-3 py-8 text-center text-[13px] text-faint group-data-[collapsible=icon]:hidden">
                    No chats match “{query.trim()}”.
                  </div>
                ) : null}
              </>
            )}
          </SidebarContent>
          <SidebarFooter className="border-t-[0.5px] border-border p-1.5">
            <SidebarMenu>
              <SidebarMenuItem>
                <FooterMenu onConnect={() => setConnectOpen(true)} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="min-w-0">
          {/* Phone widths: a slim top bar with the offcanvas trigger + wordmark. */}
          <header className="flex flex-none items-center gap-1 border-b-[0.5px] border-border bg-panel px-2 py-2 md:hidden">
            <SidebarTrigger
              id="menuBtn"
              aria-label="Show sessions"
              className="relative size-9 text-muted-foreground hover:text-foreground"
            >
              <span
                className={cx(
                  "absolute top-1.5 right-1.5 size-[7px] rounded-full bg-brand",
                  unread.size > 0 ? "block" : "hidden",
                )}
                id="menuDot"
              ></span>
            </SidebarTrigger>
            <Brand />
          </header>
          <main
            className="min-h-0 min-w-0 flex-1 overflow-y-auto"
            onScroll={() => {
              if (nearBottom()) setPillTarget(null);
            }}
          >
            <Onboard onConnect={() => setConnectOpen(true)} />
            <SessionView />
          </main>
        </SidebarInset>
      </SidebarProvider>
      {connectOpen ? <ConnectModal onClose={() => setConnectOpen(false)} /> : null}
      <ReadingView />
      <Toaster />
      <NewSurfacePill target={pillTarget} />
    </>
  );
}

// "new surface ↓" pill — appears when a surface arrives off-screen and jumps to
// it on click. Shared by both layouts.
function NewSurfacePill(props: { target: string | null }) {
  return (
    <button
      id="newPill"
      className="fixed bottom-16 left-1/2 z-40 flex -translate-x-1/2 cursor-pointer items-center gap-1 rounded-full border-[0.5px] border-brand bg-brand-subtle py-1.5 pr-3 pl-3.5 text-[12px] text-brand shadow-[0_4px_14px_rgba(0,0,0,0.12)] transition hover:bg-brand hover:text-primary-foreground"
      hidden={props.target === null}
      onClick={() => {
        if (props.target)
          cardEls.get(props.target)?.card.scrollIntoView({ behavior: "smooth", block: "start" });
        setPillTarget(null);
      }}
    >
      new surface
      <ArrowDown className="size-3.5" />
    </button>
  );
}

// Sidebar notice for a newer published release; the matching release notes
// render as a card at the top of the stream (see WhatsNewCard). Dismissing
// either hides both until the next release.
function UpdateBanner() {
  const versionInfo = useBoard((s) => s.versionInfo);
  const dismissedUpdate = useBoard((s) => s.dismissedUpdate);
  const v = updateNoticeFrom(versionInfo, dismissedUpdate);
  if (!v) return null;
  return (
    <div
      className="mx-3 mt-0 mb-2 rounded-[10px] border-[0.5px] border-border bg-brand-subtle px-[11px] py-[9px] text-[12px]"
      role="status"
    >
      <div className="flex items-center gap-1">
        New version <strong>{v.latest}</strong>
        <button
          className="ml-auto flex size-5 cursor-pointer items-center justify-center rounded-[5px] text-muted-foreground hover:bg-hover hover:text-foreground"
          aria-label={`Dismiss update notice for ${v.latest}`}
          onClick={() => dismissUpdate(v.latest!)}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {v.upgradeCommand ? (
        <button
          className="mt-1.5 flex w-full cursor-pointer items-center gap-1.5 rounded-md border-[0.5px] border-border bg-card px-[7px] py-1 text-left text-[11px] text-muted-foreground hover:border-[var(--border-2)] hover:text-foreground"
          title="Copy upgrade command"
          onClick={() => {
            navigator.clipboard.writeText(v.upgradeCommand!);
            toast("Copied: " + v.upgradeCommand);
          }}
        >
          <code className="min-w-0 flex-1 truncate font-mono">{v.upgradeCommand}</code>
          <Copy className="size-3 flex-none" />
        </button>
      ) : null}
    </div>
  );
}

// Release notes as a card in the stream — the surface already renders cards,
// so "what's new" is just content. Shares dismissal with the banner.
function WhatsNewCard() {
  const versionInfo = useBoard((s) => s.versionInfo);
  const dismissedUpdate = useBoard((s) => s.dismissedUpdate);
  const v = updateNoticeFrom(versionInfo, dismissedUpdate);
  if (!v?.notes) return null;
  return (
    <div
      className="card group mb-4 overflow-hidden rounded-xl border-[0.5px] border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.035),0_1px_3px_rgba(0,0,0,0.045)] transition-[box-shadow,border-color] duration-200 ease-out hover:border-[var(--border-2)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_20px_rgba(0,0,0,0.07)] dark:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_rgba(0,0,0,0.3)] dark:hover:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_8px_24px_rgba(0,0,0,0.45)]"
      id="whatsNew"
    >
      <div className="flex items-center gap-2.5 px-4 py-[13px]">
        <span className="card-title text-sm font-[550] tracking-[-0.006em] text-foreground">
          What&rsquo;s new in {v.latest}
        </span>
        <span className="text-xs text-faint">update available</span>
        <span className="flex-1"></span>
        <button
          className="cursor-pointer rounded-md px-[7px] py-[3px] text-xs text-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-hover hover:text-foreground max-[700px]:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={() => dismissUpdate(v.latest!)}
        >
          dismiss
        </button>
      </div>
      {/* renderNotes returns trusted, server-authored release-notes markup (not
          agent content) — styled here via descendant utilities since the inner
          elements come from an HTML string. */}
      <div
        className="px-4 pt-1.5 pb-3 text-[13px]/[1.6] [&_a]:text-brand [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-medium [&_li]:my-[3px] [&_ul]:my-1 [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: renderNotes(v.notes!) }}
      ></div>
    </div>
  );
}

// Messages from sandboxed surface iframes (see server/surfacePage.ts bridge).
async function onBridgeMessage(ev: MessageEvent) {
  const d = ev.data as {
    __showcase?: boolean;
    type?: string;
    height?: number;
    text?: unknown;
    url?: string;
    key?: string;
  } | null;
  if (!d || !d.__showcase) return;
  // Every host-affecting message must come from a frame the viewer actually
  // embedded — never an unexpected/nested frame. send-prompt and resize prove
  // this implicitly (frameForSource resolves the exact html frame); the
  // remaining types reach the host UI directly, so gate them on isOwnFrame.
  // (frameForSource only knows html-part frames; switch-session is sent only by
  // those, but open-link is sent by rich-part frames too, so use the broader
  // check that recognizes any embedded iframe.)
  if (d.type === "switch-session") {
    if (!isOwnFrame(ev.source)) return;
    if (streamMode()) return;
    // A surface iframe forwarded the session-switch shortcut because focus was
    // inside it (see server/surfacePage.ts). Mirror the parent keydown handler.
    void selectAdjacent(d.key === "ArrowUp" ? -1 : 1);
    return;
  }
  // Resolve the source surface + iframe by contentWindow — a surface may own
  // several html-part iframes, so resize must target the exact one.
  const src = frameForSource(ev.source);
  if (d.type === "resize" && src) {
    applyFrameHeight(src.iframe, d.height);
  } else if (d.type === "send-prompt" && src) {
    if (isReadonly()) return;
    // sendPrompt is surface-originated: a script inside the sandbox can fire it
    // (or post this message directly) with no user involvement. It must NEVER
    // become an author:"user" comment — that label is reserved for the composer
    // (genuine keystrokes in this trusted origin), so untrusted content rendered
    // in a surface can't impersonate the user to the agent. We stamp it
    // author:"surface": it shows in the surface's thread, but the feedback
    // channel only delivers "user" comments, so it never reaches the agent on
    // its own. The user can relay it deliberately if they choose.
    await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({ surface: src.id, text: String(d.text), author: "surface" }),
    });
    toast("Added to this surface’s thread");
  } else if (d.type === "open-link" && isOwnFrame(ev.source)) {
    // Only ever open real external links. The in-frame click handler forwards
    // just http(s) hrefs, but a surface can call openLink() directly (or post
    // this message raw) with any scheme — javascript:, data:, file: — so
    // re-check host-side, where it can't be bypassed. Parse once and act on the
    // parsed result: validate `protocol` and open the normalized `href` from the
    // same parse, so there's no gap between what we check and what window.open
    // re-parses (and a malformed string is rejected outright).
    let link: URL;
    try {
      link = new URL(String(d.url));
    } catch {
      return;
    }
    if (link.protocol !== "http:" && link.protocol !== "https:") return;
    if (confirm(`Open external link?\n\n${link.href}`))
      window.open(link.href, "_blank", "noopener");
  } else if (d.type === "copy" && isOwnFrame(ev.source)) {
    void navigator.clipboard?.writeText(String(d.text)).catch(() => {});
  }
}

// True when `source` is the contentWindow of an iframe the viewer embedded
// (html or rich part). frameForSource only tracks html-part frames; this is the
// broader gate for messages rich-part frames also send (open-link). Identity
// comparison works across the opaque-origin boundary even though the frame's
// document is unreadable.
function isOwnFrame(source: unknown): boolean {
  for (const f of root().querySelectorAll("iframe")) {
    if (f.contentWindow === source) return true;
  }
  return false;
}

function SessionItem(props: { session: SessionRow }) {
  const selected = useBoard((s) => s.selected);
  const unread = useBoard((s) => s.unread);
  const { setOpenMobile } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const label = sessionLabel(props.session);
  const isSel = props.session.id === selected;
  const isUnread = unread.has(props.session.id);
  const isVacant = props.session.surfaceCount === 0;
  // On phones the offcanvas should close once you pick a session.
  const open = () => {
    select(props.session.id);
    setOpenMobile(false);
  };
  const rename = async (next: string) => {
    setRenaming(false);
    const trimmed = next.trim();
    if (!trimmed || trimmed === label) return;
    await api(`/api/sessions/${props.session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: trimmed }),
    });
  };
  const remove = async () => {
    if (!confirm(`Delete "${label}" and its surfaces?`)) return;
    await api(`/api/sessions/${props.session.id}`, { method: "DELETE" });
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(sessionLink(props.session.id));
      toast("Link copied");
    } catch {
      toast("Couldn't copy the link");
    }
  };

  // While renaming, the whole row becomes a borderless input pinned to the
  // session-title type so the edit lands exactly where the label was.
  if (renaming) {
    return (
      <SidebarMenuItem data-id={props.session.id}>
        <div className="flex h-auto items-center gap-2 rounded-lg px-2 py-2">
          <span className="flex-none">
            <AgentMark agent={props.session.agent} />
          </span>
          <input
            autoFocus
            defaultValue={label}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-[5px] bg-card px-1 py-px text-[13px] font-medium text-foreground shadow-[0_0_0_0.5px_var(--border-2)] outline-none"
            onBlur={(e) => rename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              else if (e.key === "Escape") {
                e.currentTarget.value = label;
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem data-id={props.session.id}>
      <SidebarMenuButton
        isActive={isSel}
        size="lg"
        tooltip={label}
        aria-current={isSel ? "true" : undefined}
        onClick={open}
        className={cx(
          "h-auto items-start gap-2 rounded-lg py-1 pr-7 transition-colors duration-150 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2",
          // One quiet selection signal, claude.ai-style: a soft accent-subtle
          // tint with the title in accent — no competing white lift or left
          // rail. Hover is a calm gray wash. The agent mark stays neutral.
          isSel
            ? "bg-brand-subtle hover:bg-brand-subtle data-[active=true]:bg-brand-subtle"
            : "hover:bg-hover/60 data-[active=true]:bg-brand-subtle",
        )}
      >
        {/* The agent mark anchors the row at the icon-rail width too. */}
        <span className="mt-0.5 flex-none text-muted-foreground group-data-[collapsible=icon]:mt-0">
          <AgentMark agent={props.session.agent} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px group-data-[collapsible=icon]:hidden">
          {/* Title line: name truncates, surface count rides quietly at the far
              right as a bare tabular number (no parens) — scannable, not noisy. */}
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span
              className={cx(
                "min-w-0 flex-1 truncate text-[13px] leading-snug",
                isSel
                  ? "font-medium text-brand"
                  : isVacant
                    ? "font-normal text-muted-foreground"
                    : "font-medium text-foreground",
              )}
            >
              {label}
            </span>
            {props.session.surfaceCount > 0 ? (
              <span
                className={cx(
                  "flex-none text-[11px] leading-snug tabular-nums group-hover/menu-item:opacity-0",
                  isSel ? "text-brand/55" : "text-faint/70",
                )}
              >
                {props.session.surfaceCount}
              </span>
            ) : null}
          </span>
          <span
            className={cx(
              "flex items-center gap-1 text-[11px] leading-snug",
              isSel ? "text-brand/60" : isVacant ? "text-faint/70" : "text-faint/90",
            )}
          >
            {props.session.listening ? (
              <span
                className="inline-block size-1.5 flex-none animate-pulse rounded-full bg-[#4caf78] motion-reduce:animate-none"
                title="Agent is listening"
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">
              {props.session.agent} · {relTime(props.session.lastActiveAt)}
            </span>
            {/* Open review findings — the resume signal. Hidden on hover so it
                never collides with the ⋯ action, like the surface count. */}
            {props.session.openFindings ? (
              <span
                className="flex-none rounded-full bg-amber-500/15 px-1.5 font-medium tabular-nums text-amber-700 group-hover/menu-item:opacity-0 dark:text-amber-300"
                title={`${props.session.openFindings} open finding${
                  props.session.openFindings === 1 ? "" : "s"
                }`}
              >
                {props.session.openFindings} open
              </span>
            ) : null}
          </span>
        </span>
      </SidebarMenuButton>
      {/* The unread dot hides once the row is hovered or its menu is open, so it
          never collides with the ⋯ action. */}
      {isUnread ? (
        <span
          className={cx(
            "pointer-events-none absolute top-1/2 right-3 size-1.5 -translate-y-1/2 rounded-full bg-brand group-data-[collapsible=icon]:hidden group-hover/menu-item:hidden",
            menuOpen && "hidden",
          )}
        />
      ) : null}
      {!isReadonly() ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              aria-label={`Session options for "${label}"`}
              className={cx("text-faint hover:text-foreground", menuOpen && "opacity-100")}
            >
              <MoreHorizontal />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-44">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={copyLink}>
              <Link2 />
              Copy link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </SidebarMenuItem>
  );
}

// A live verdict for a review session: rolls up the finding-card badges into
// scannable count chips ("2 Bug · 1 Nit"), worst-severity first, so the review
// reads as one artifact instead of a scattered pile. Derived from the cards the
// agent already publishes — no extra authoring — and each chip jumps to the
// first finding of that label. A finding the user has Approved or Dismissed is
// "resolved"; once every finding under a label is resolved the chip strikes
// through and dims, so you watch the review burn down. Nothing for no badges.
// Canonical review finding labels (R1: critical→Bug, warning→Nit, info→Question,
// success→Praise). The burndown counts these and only these — a verdict card
// ("Request changes") or an "Explainer" badge is not a finding to resolve, so it
// never blocks the review from reaching "complete".
const FINDING_LABELS = new Set(["Bug", "Nit", "Question", "Praise"]);
// Verdict labels an agent's summary card might carry, matched case-insensitively
// to name the terminal state ("Review complete — Request changes").
const VERDICT_LABELS = new Set(["request changes", "approved", "approve", "looks good"]);

function ReviewSummary(props: { surfaces: Surface[] }) {
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

  // `j` / `k` page through the open findings (worst first), wrapping. A ref holds
  // the live list so the once-mounted key handler always sees the current set as
  // findings resolve out from under the cursor.
  const openRef = useRef(openFindings);
  openRef.current = openFindings;
  const cursorRef = useRef(-1);
  const jumpToOpen = (dir: 1 | -1) => {
    const list = openRef.current;
    if (!list.length) return;
    cursorRef.current = (((cursorRef.current + dir) % list.length) + list.length) % list.length;
    cardEls.get(list[cursorRef.current].id)?.card.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "j" && e.key !== "k") return;
      const el = root().activeElement as HTMLElement | null;
      const tag = el?.tagName;
      // Don't hijack typing in the composer, an editable title, or a focused part.
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "IFRAME" || el?.isContentEditable)
        return;
      if (useBoard.getState().readingId || !openRef.current.length) return;
      e.preventDefault();
      jumpToOpen(e.key === "j" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (byLabel.size === 0) return null;
  const jumpTo = (id: string) =>
    cardEls.get(id)?.card.scrollIntoView({ behavior: "smooth", block: "start" });
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
              onClick={() => jumpTo(g.firstId)}
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
              <span className="text-faint/70 max-[700px]:hidden">or press j / k</span>
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

// Reading mode: a full-screen, distraction-free reader showing one surface at a
// time, centered at a comfortable width, with prev/next paging through the
// current stream (arrows + buttons, Escape closes). The stream's own cards are
// unmounted while this is open (see SessionView), so each surface — and its
// iframes — mounts in exactly one place.
function ReadingView() {
  const readingId = useBoard((s) => s.readingId);
  const surfaces = useBoard((s) => s.surfaces);
  useEffect(() => {
    if (!readingId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.key === "Escape") exitReading();
      else if (e.key === "ArrowRight") readingStep(1);
      else if (e.key === "ArrowLeft") readingStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readingId]);

  if (!readingId) return null;
  const i = surfaces.findIndex((s) => s.id === readingId);
  const surface = surfaces[i];
  if (!surface) return null;
  const navBtn =
    "flex size-9 flex-none items-center justify-center rounded-full border-[0.5px] border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground disabled:opacity-0";
  return (
    <div
      role="dialog"
      aria-label="Reader"
      className="fixed inset-0 z-50 flex flex-col bg-background/97 backdrop-blur-sm"
    >
      <div className="flex flex-none items-center gap-3 border-b-[0.5px] border-border px-5 py-3">
        <BookOpen className="size-4 flex-none text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">{surface.title}</span>
        <span className="flex-1" />
        <span className="flex-none text-[12px] text-faint tabular-nums">
          {i + 1} / {surfaces.length}
        </span>
        <button
          type="button"
          aria-label="Close reader"
          onClick={() => exitReading()}
          className="flex size-7 flex-none items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-stretch">
        <div className="hidden flex-none items-center px-3 sm:flex">
          <button
            type="button"
            aria-label="Previous"
            disabled={i <= 0}
            onClick={() => readingStep(-1)}
            className={navBtn}
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[780px] px-5 py-10">
            <Card surface={surface} key={surface.id} />
          </div>
        </div>
        <div className="hidden flex-none items-center px-3 sm:flex">
          <button
            type="button"
            aria-label="Next"
            disabled={i >= surfaces.length - 1}
            onClick={() => readingStep(1)}
            className={navBtn}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionView() {
  const sessions = useBoard((s) => s.sessions);
  const selected = useBoard((s) => s.selected);
  const surfaces = useBoard((s) => s.surfaces);
  const streamLoading = useBoard((s) => s.streamLoading);
  // While the reader is open it mounts the focused surface; unmount the stream's
  // copy so each surface (and its iframes) lives in exactly one place.
  const reading = useBoard((s) => s.readingId !== null);
  const current = sessions.find((x) => x.id === selected);
  const surfaceCount = current?.surfaceCount ?? 0;
  return (
    <div id="sessionView" hidden={sessions.length === 0}>
      <div className="sticky top-0 z-[5] border-b-[0.5px] border-border bg-background/85 px-7 pt-3 pb-2.5 backdrop-blur-md max-[700px]:px-4 max-[700px]:pt-3 max-[700px]:pb-2.5">
        <div className="mx-auto flex max-w-[860px] flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {current ? (
              <span className="flex-none text-muted-foreground">
                <AgentMark agent={current.agent} />
              </span>
            ) : null}
            <SessionTitle current={current} />
            <span className="flex-1" />
            {current && !isReadonly() ? <AgentPresence agent={current.agent} /> : null}
          </div>
          <span className="pl-0.5 text-[12px] text-faint" id="sessMeta">
            {current
              ? `${current.agent} · started ${relTime(current.createdAt)}${
                  surfaceCount > 0
                    ? ` · ${surfaceCount} surface${surfaceCount === 1 ? "" : "s"}`
                    : ""
                }`
              : ""}
          </span>
          <ReviewSummary surfaces={surfaces} />
        </div>
      </div>
      <div
        id="stream"
        className="mx-auto max-w-[860px] px-7 pt-[22px] pb-[120px] max-[700px]:px-3.5 max-[700px]:pt-4 max-[700px]:pb-[120px]"
      >
        <WhatsNewCard />
        {streamLoading ? (
          <CardSkeletons />
        ) : surfaces.length === 0 ? (
          <EmptySession />
        ) : reading ? null : (
          surfaces.map((s) => <Card surface={s} key={s.id} />)
        )}
        {selected && !streamLoading && !isReadonly() ? <SessionChat sessionId={selected} /> : null}
      </div>
    </div>
  );
}

// The session-level chat: talk to your agent about the whole session, not a
// specific card. Posts surfaceless comments; the agent replies session-level
// (reply_to_user with no surfaceId). Reuses the card Thread with surfaceId=null.
function SessionChat(props: { sessionId: string }) {
  const listening = useSessionListening();
  return (
    <div className="mt-4 overflow-hidden rounded-xl border-[0.5px] border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <MessageSquare className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold text-foreground">Chat with your agent</span>
        <span className="flex-1" />
        <span className="text-[11px] text-faint">
          {listening ? "listening" : "agent idle — messages queue until it checks"}
        </span>
      </div>
      <Thread
        surfaceId={null}
        sessionId={props.sessionId}
        placeholder="Message your agent…"
        readonly={isReadonly()}
        send={(text) => sendComment({ session: props.sessionId, text, author: "user" }, null, text)}
      />
    </div>
  );
}

// Placeholder cards while a session's surfaces load — same shell as a real
// card (border + radius), so the stream never flashes blank or jumps when the
// real content lands.
function CardSkeletons() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-xl border-[0.5px] border-border bg-card">
          <div className="flex items-center gap-2 px-4 py-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-[18px] w-9 rounded-full" />
            <span className="flex-1" />
            <Skeleton className="h-3 w-12" />
          </div>
          <div className="border-t-[0.5px] border-border px-4 py-5">
            <Skeleton className={cx("h-28 w-full rounded-md", i === 1 && "h-20")} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Empty-session state: a calm centred message, not a bare line of faint text.
function EmptySession() {
  return (
    <div className="px-6 py-24 text-center" id="streamEmpty">
      <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-hover text-muted-foreground">
        <Sparkles className="size-5" />
      </div>
      <p className="mt-4 text-[14px] font-medium text-foreground">No surfaces yet</p>
      <p className="mt-1 text-[13px] text-faint">
        Surfaces your agent publishes to this session will appear here.
      </p>
    </div>
  );
}

// Live presence chip in the session header: green "Listening" while the agent
// is parked in wait_for_feedback (messages reach it instantly), or a clickable
// "Agent idle" that copies an instruction to arm the agent's chat loop. This is
// the honest signal for the pull-based bridge — showcase can't push to the
// editor, so the user needs to see whether a reply is even coming.
function AgentPresence(props: { agent: string }) {
  const listening = useSessionListening();
  const label = props.agent || "your agent";
  if (listening) {
    return (
      <span
        className="flex-none inline-flex items-center gap-1.5 rounded-full bg-[#4caf78]/12 px-2 py-0.5 text-[11px] font-medium text-[#2e7d54] dark:text-[#5fd699]"
        title={`${label} is parked in wait_for_feedback — your messages reach it instantly.`}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-[#4caf78] motion-reduce:animate-none" />
        Listening
      </span>
    );
  }
  const armText = `Keep calling wait_for_feedback on showcase and reply to me with reply_to_user, looping, so I can chat with you from the browser.`;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(armText);
          toast(`Copied — paste it to ${label} to start the chat loop.`);
        } catch {
          toast("Couldn't copy the instruction");
        }
      }}
      className="flex-none inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-faint transition-colors hover:bg-hover hover:text-muted-foreground"
      title={`${label} isn't listening. Click to copy an instruction that arms it (it must call wait_for_feedback to receive your messages).`}
    >
      <span className="size-1.5 rounded-full bg-faint" />
      Agent idle
      {/* The trailing copy glyph signals this status pill is also a button —
          clicking copies the wake instruction (the title spells it out). */}
      <Copy className="size-3 opacity-70" />
    </button>
  );
}

function SessionTitle(props: { current: SessionRow | undefined }) {
  const elRef = useRef<HTMLSpanElement>(null);
  // contenteditable owns its text while focused; sync from state otherwise
  useEffect(() => {
    const el = elRef.current;
    if (el && props.current && root().activeElement !== el) {
      el.textContent = sessionLabel(props.current);
    }
  }, [props.current]);
  const commit = async () => {
    const el = elRef.current;
    if (isReadonly() || !props.current || !el) return;
    const next = el.textContent?.trim() ?? "";
    if (next && next !== sessionLabel(props.current)) {
      await api(`/api/sessions/${props.current.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: next }),
      });
    }
  };
  return (
    <span
      id="sessTitle"
      className="-mx-1 min-w-10 truncate rounded-md px-1 text-[17px] font-semibold tracking-[-0.01em] text-foreground outline-none transition-colors hover:bg-hover focus:bg-card focus:shadow-[0_0_0_0.5px_var(--border-2)]"
      title={!isReadonly() ? "Click to rename" : undefined}
      ref={elRef}
      contentEditable={!isReadonly()}
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-label="Session title"
      onBlur={commit}
      onKeyDown={(e) => {
        const el = elRef.current;
        if (!el) return;
        if (e.key === "Enter") {
          e.preventDefault();
          el.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          if (props.current) el.textContent = sessionLabel(props.current);
          el.blur();
        }
      }}
    ></span>
  );
}

// withOrigin on the server rewrites these localhost URLs to the deployed
// origin when serving the built document — keep them as plain literals.
const SETUP_SNIP = "curl -s http://localhost:8229/setup >> AGENTS.md";
const TRY_SNIP =
  "curl -s -X POST http://localhost:8229/api/snippets -H 'content-type: application/json' " +
  `-d '{"agent": "me", "title": "Hello", "html": "<h2>It works</h2>"}'`;

function Onboard(props: { onConnect: () => void }) {
  const sessions = useBoard((s) => s.sessions);
  return (
    <div
      id="onboard"
      className="mx-auto max-w-[660px] px-7 py-[72px] max-[700px]:px-[18px] max-[700px]:py-10 [&_h1]:mt-0 [&_h1]:mb-1.5 [&_h1]:text-[21px] [&_h1]:font-medium [&_h2]:mt-[26px] [&_h2]:mb-2 [&_h2]:text-[13px] [&_h2]:font-medium [&_h2]:tracking-[0.02em] [&_h2]:text-muted-foreground [&_h2]:lowercase"
      hidden={sessions.length > 0}
    >
      {!isReadonly() ? (
        <>
          <h1>The show hasn&rsquo;t started yet</h1>
          <p className="mb-8 text-[14px] text-muted-foreground">
            showcase is a live surface where coding agents draw HTML snippets — diagrams, sketches,
            explainers — while they work in your terminal.
          </p>
          <h2>teach your agent about it</h2>
          <Snip text={SETUP_SNIP} />
          <h2>or try it yourself</h2>
          <Snip text={TRY_SNIP} />
          <h2>using claude code?</h2>
          <button
            className="group inline-flex cursor-pointer items-center gap-1.5 rounded-lg border-[0.5px] border-border bg-card px-3.5 py-2 text-[13px] text-foreground transition-colors hover:border-muted-foreground"
            onClick={props.onConnect}
          >
            Connect Claude Code
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
        </>
      ) : (
        <>
          <h1>Nothing here yet</h1>
          <p className="mb-8 text-[14px] text-muted-foreground">
            This showcase board does not have any sessions yet.
          </p>
        </>
      )}
    </div>
  );
}

// Install instructions for the Claude Code plugin: a background monitor that
// streams the user's comments to the agent as notifications, plus the showcase
// MCP server. There is no browser→terminal handoff, so "connect" is two
// copy-paste commands, stated honestly.
const MARKETPLACE_CMD = "/plugin marketplace add modem-dev/showcase";
const INSTALL_CMD = "/plugin install showcase@showcase";

function ConnectModal(props: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/[0.42] px-5 pt-[7vh] pb-5"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-[14px] border-[0.5px] border-border bg-background px-6 pt-[22px] pb-[26px] shadow-[0_16px_48px_rgba(0,0,0,0.35)] [&_code]:rounded [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs"
        role="dialog"
        aria-modal="true"
        aria-label="Connect Claude Code"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center">
          <h2 className="m-0 flex-1 text-[17px] font-semibold">Connect Claude Code</h2>
          <button
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-foreground"
            aria-label="Close"
            onClick={props.onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-[18px] text-sm/[1.55] text-muted-foreground">
          Install the showcase plugin so your comments reach the agent on their own. A background
          monitor streams each comment to Claude Code as a notification — no copy-pasting, no
          re-arming a watcher.
        </p>
        <ModalSection>1 · add the marketplace</ModalSection>
        <Snip text={MARKETPLACE_CMD} />
        <ModalSection>2 · install the plugin</ModalSection>
        <Snip text={INSTALL_CMD} />
        <p className="mt-3 text-[13px]/[1.55] text-muted-foreground">
          Run both inside Claude Code. On install it asks for your <strong>Showcase URL</strong>{" "}
          (default <code>http://localhost:8229</code>, or your deployed instance) and an optional
          token.
        </p>
        <ModalSection>what it runs</ModalSection>
        <p className="mt-3 text-[13px]/[1.55] text-muted-foreground">
          The plugin connects the showcase MCP server and runs <code>showcase watch</code> against
          your board as a background process — unsandboxed, the same trust level as hooks, with no
          per-comment prompt. Comments are delivered to the agent exactly once.
        </p>
        <p className="mt-[18px] border-t-[0.5px] border-border pt-3.5 text-[13px]/[1.55] text-faint">
          Requires Claude Code ≥ 2.1.105. It&rsquo;s two commands, not a true one-click — Claude
          Code has no browser-to-terminal handoff yet.
        </p>
      </div>
    </div>
  );
}

// The modal's lowercase section heading (was `.modal h3`).
function ModalSection(props: { children: ReactNode }) {
  return (
    <h3 className="mt-[18px] mb-2 text-xs font-medium tracking-[0.02em] text-muted-foreground lowercase">
      {props.children}
    </h3>
  );
}

function Snip(props: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-[10px] border-[0.5px] border-border bg-card py-3 pr-11 pl-3.5 font-mono text-[12px]/[1.6] break-all whitespace-pre-wrap text-foreground">
      {props.text}
      <button
        className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-md border-[0.5px] border-border bg-background text-faint transition-colors hover:text-foreground"
        aria-label={copied ? "Copied" : "Copy"}
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          navigator.clipboard.writeText(props.text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5 text-[#4caf78]" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
