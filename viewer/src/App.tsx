import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  BookOpen,
  Copy,
  Download,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plug,
  Printer,
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
  appPath,
  isReadonly,
  layoutMode,
  relTime,
  sessionLabel,
  sessionLink,
  type SessionRow,
} from "./api.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { onBridgeMessage } from "./bridge.ts";
import { routeGet, routeSubscribe, root } from "./host.ts";
import { Card, cardEls } from "./Card.tsx";
import { Thread } from "./Thread.tsx";
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
import { renderNotes } from "./notes.ts";
import { ConnectModal, Onboard } from "./Onboarding.tsx";
import { ReadingView } from "./ReadingView.tsx";
import { ReviewSummary } from "./ReviewSummary.tsx";
import { initTheme } from "./theme.ts";
import {
  applyRoute,
  checkVersion,
  clearUnread,
  connect,
  dismissUpdate,
  goHome,
  groupSessions,
  nearBottom,
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
  useSessionActivity,
  useSessionListening,
  useSessionWorking,
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
          {/* Phone widths: a slim top bar with the offcanvas trigger + wordmark.
              It also surfaces at print's narrow page width, so hide it there. */}
          <header
            data-print-hide
            className="flex flex-none items-center gap-1 border-b-[0.5px] border-border bg-panel px-2 py-2 md:hidden"
          >
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
            <SessionView onConnect={() => setConnectOpen(true)} />
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

function SessionItem(props: { session: SessionRow }) {
  const selected = useBoard((s) => s.selected);
  const unread = useBoard((s) => s.unread);
  const { setOpenMobile } = useSidebar();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const working = useSessionWorking(props.session.id);
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
  // Save the session as a PDF via the browser's own print-to-PDF (the @media
  // print rules strip the chrome). Make sure this session is the one on screen
  // before printing, then give the stream + sandboxed iframes a beat to lay out.
  const saveAsPdf = async () => {
    if (selectedNow() !== props.session.id) {
      await select(props.session.id);
      await new Promise((r) => setTimeout(r, 600));
    }
    // Wait for this menu to actually close, or the open dropdown gets captured
    // in the print snapshot.
    await new Promise((r) => setTimeout(r, 200));
    window.print();
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
            {/* A working session shows a green pulse + "working…" — the live
                "this one is busy" signal; otherwise the listening dot (parked,
                waiting on you) if present. Working takes the slot since it's the
                more dynamic state. */}
            {working || props.session.listening ? (
              <span
                className="inline-block size-1.5 flex-none animate-pulse rounded-full bg-[#4caf78] motion-reduce:animate-none"
                title={working ? "Agent is working" : "Agent is listening"}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">
              {working
                ? `${props.session.agent} · working…`
                : `${props.session.agent} · ${relTime(props.session.lastActiveAt)}`}
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
            <DropdownMenuItem asChild>
              {/* The export route sets a download disposition, so a plain link
                  downloads the self-contained HTML — no JS fetch needed. */}
              <a href={appPath(`/api/sessions/${props.session.id}/export`)} download>
                <Download />
                Download HTML
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={saveAsPdf}>
              <Printer />
              Save as PDF
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

function SessionView(props: { onConnect?: () => void }) {
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
      <div
        data-print-static
        className="sticky top-0 z-[5] border-b-[0.5px] border-border bg-background/85 px-7 pt-3 pb-2.5 backdrop-blur-md max-[700px]:px-4 max-[700px]:pt-3 max-[700px]:pb-2.5"
      >
        <div className="mx-auto flex max-w-[860px] flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {current ? (
              <span className="flex-none text-muted-foreground">
                <AgentMark agent={current.agent} />
              </span>
            ) : null}
            <SessionTitle current={current} />
            <span className="flex-1" />
            <WorkingPill sessionId={selected} />
            {current && !isReadonly() ? (
              <AgentPresence agent={current.agent} onConnect={props.onConnect} />
            ) : null}
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
          <ActivityTicker sessionId={selected} />
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
        {selected && !streamLoading && !isReadonly() ? (
          <div data-print-hide>
            <SessionChat sessionId={selected} onConnect={props.onConnect} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// The session-level chat: talk to your agent about the whole session, not a
// specific card. Posts surfaceless comments; the agent replies session-level
// (reply_to_user with no surfaceId). Reuses the card Thread with surfaceId=null.
function SessionChat(props: { sessionId: string; onConnect?: () => void }) {
  const listening = useSessionListening();
  return (
    <div className="mt-4 overflow-hidden rounded-xl border-[0.5px] border-border bg-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <MessageSquare className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold text-foreground">Chat with your agent</span>
        <span className="flex-1" />
        {listening ? (
          <span className="text-[11px] font-medium text-[#2e7d54] dark:text-[#5fd699]">
            agent will see this
          </span>
        ) : (
          // Carry the fix at the moment of friction: messages queue, and the way
          // to make them land automatically is one click away.
          <button
            type="button"
            onClick={() => props.onConnect?.()}
            className="text-[11px] text-faint underline-offset-2 transition-colors hover:text-foreground hover:underline"
            title="Comments queue until your agent checks. Click to turn on auto-replies so they land automatically."
          >
            queued — turn on auto-replies
          </button>
        )}
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

// The single most important status in the app: will my next comment actually
// reach the agent? Framed as a setting the user owns — "Auto-replies on" (green)
// while the agent is connected (parked in a feedback wait, or kept there by the
// `showcase watch` plugin), or a clickable "Auto-replies off" that opens Connect
// — the durable fix — instead of leaving the user to hand-nudge their terminal.
function AgentPresence(props: { agent: string; onConnect?: () => void }) {
  const listening = useSessionListening();
  const label = props.agent || "your agent";
  if (listening) {
    return (
      <span
        className="flex-none inline-flex items-center gap-1.5 rounded-full bg-[#4caf78]/12 px-2 py-0.5 text-[11px] font-medium text-[#2e7d54] dark:text-[#5fd699]"
        title={`Auto-replies are on — ${label} is connected, so your comments reach it right away.`}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-[#4caf78] motion-reduce:animate-none" />
        Auto-replies on
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => props.onConnect?.()}
      className="flex-none inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-faint transition-colors hover:bg-hover hover:text-foreground"
      title={`Auto-replies are off — ${label} isn't connected, so comments queue until it checks. Click to turn them on.`}
    >
      <span className="size-1.5 rounded-full bg-faint" />
      Auto-replies off
      <Plug className="size-3 opacity-70" />
    </button>
  );
}

// Live "agent is working" pill for the session header — the signal that the
// agent is actively producing output (surfaces, replies), as opposed to
// AgentPresence which says whether it's connected/parked waiting on you. Driven
// by activity events and decays a few seconds after the agent goes quiet, so it
// reads as motion while work lands and quietly disappears when it stops.
function WorkingPill(props: { sessionId: string | null }) {
  const working = useSessionWorking(props.sessionId);
  if (!working) return null;
  return (
    <span
      className="flex-none inline-flex items-center gap-1.5 rounded-full bg-[#4caf78]/12 px-2 py-0.5 text-[11px] font-medium text-[#2e7d54] dark:text-[#5fd699]"
      title="Your agent is actively publishing to this session right now."
    >
      <span className="size-1.5 animate-pulse rounded-full bg-[#4caf78] motion-reduce:animate-none" />
      Working…
    </span>
  );
}

// One-line feed of the agent's latest action, sitting just under the session
// meta line. Re-keyed on each new label so it re-animates (a soft slide) as work
// lands — the running sense of "things are getting done". Holds the last action
// after the agent goes quiet rather than vanishing, so you can see what just
// happened; the leading dot dims once it's no longer working.
function ActivityTicker(props: { sessionId: string | null }) {
  const working = useSessionWorking(props.sessionId);
  const activity = useSessionActivity(props.sessionId);
  if (!activity) return null;
  return (
    <div
      key={activity.at}
      className="flex animate-in items-center gap-1.5 pl-0.5 text-[12px] text-faint fade-in-0 slide-in-from-left-1 duration-300 motion-reduce:animate-none"
    >
      <Sparkles className={cx("size-3 flex-none", working ? "text-[#4caf78]" : "text-faint/70")} />
      <span className="min-w-0 truncate">
        <span className={working ? "text-muted-foreground" : undefined}>{activity.label}</span>
        <span className="text-faint/80"> · {relTime(new Date(activity.at).toISOString())}</span>
      </span>
    </div>
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
