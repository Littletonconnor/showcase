import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  BookOpen,
  Copy,
  Download,
  GitPullRequest,
  Link2,
  MoreHorizontal,
  Pencil,
  Plug,
  Printer,
  Search,
  Settings2,
  Sparkles,
  Terminal,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  api,
  appPath,
  isReadonly,
  layoutMode,
  relTime,
  sessionKindLabel,
  sessionLabel,
  sessionLink,
  type SessionKind,
  type SessionRow,
  type Surface,
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
import { BADGE_DOT_CLASS, Card, cardEls } from "./Card.tsx";
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
import { ReviewInline } from "./review/ReviewInline.tsx";
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
  setPillTarget,
  toast,
  updateNoticeFrom,
  useBoard,
  useSessionActivity,
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
      {/* Branded app-icon tile: a warm terracotta gradient with a cream spark —
          the same surface/sparkle motif the agent marks and session titles use,
          scaled up as the hero mark so the chrome reads as one family. The live
          dot rides the corner as a presence badge (green = connected, faint =
          reconnecting) instead of floating loose beside the wordmark. */}
      <span className="relative flex size-7 flex-none items-center justify-center rounded-[9px] bg-gradient-to-br from-[#cf6d49] to-[#a8472b] shadow-sm ring-1 ring-black/10 ring-inset">
        <svg
          viewBox="0 0 24 24"
          className="size-[15px] text-[#fdf3ec]"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
        </svg>
        <span
          className={cx(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-panel transition-colors duration-300",
            live ? "bg-[#4caf78]" : "bg-faint",
          )}
          title={live ? "Live" : "Reconnecting…"}
        ></span>
      </span>
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
        aria-label="Search sessions"
        placeholder="Search sessions…"
        value={props.query}
        onChange={(e) => props.onQuery(e.target.value)}
        className="h-9 rounded-lg border-transparent bg-surface pr-7 pl-8 text-[13px] shadow-sm ring-1 ring-brand/25 focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-brand/40"
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
              Connect your agent
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
      {/* h-svh + overflow-hidden pins the shell to the viewport so the content
          column (the inner <main> below) is the scroll container — not the
          window. That's what the app's sticky session header and the TOC rail
          depend on; without it the whole page scrolls and nothing pins. Print
          overrides in index.css release this so PDF export still flows. */}
      <SidebarProvider defaultOpen={readSidebarCookie()} className="h-svh overflow-hidden">
        <Sidebar collapsible="icon">
          <SidebarHeader className="gap-2">
            <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
              <Brand className="min-w-0 flex-1" />
              <SidebarTrigger
                // A mouse click otherwise leaves the toggle focused, and its
                // brand focus ring then reads like a selected tab in the rail.
                // Preventing the default mousedown stops the button from taking
                // focus on a pointer press (the click still fires, so it still
                // toggles) — while keyboard Tab focus is untouched, so the focus
                // ring still shows for keyboard users who need it.
                onMouseDown={(e) => e.preventDefault()}
                className="size-7 flex-none rounded-md text-faint transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-brand/40"
              />
            </div>
            <SessionSearch query={query} onQuery={setQuery} />
            <UpdateBanner />
          </SidebarHeader>
          <SidebarContent
            id="sessionList"
            className="gap-0 px-1.5 group-data-[collapsible=icon]:px-0"
          >
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
            id="appScroll"
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

// A decision-queue review session chips its verdict and opens the review page.
const REVIEW_CHIP = {
  block: { label: "Block", cls: "bg-red-500/15 text-red-700 dark:text-red-300" },
  approve: { label: "Approve", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  comment: { label: "Review", cls: "bg-brand-subtle text-brand" },
} as const;

// The per-session glyph: a pull-request mark for a PR review, a workflow/diagram
// mark for a visualization or explainer. Replaces the old per-agent brand mark —
// a session reads as what it contains, not who authored it.
function SessionKindIcon(props: { kind?: SessionKind }) {
  const Icon = props.kind === "review" ? GitPullRequest : Workflow;
  return <Icon className="size-3.5" />;
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
  const reviewVerdict = props.session.reviewVerdict;
  const isReview = !!reviewVerdict;
  const isVacant = props.session.surfaceCount === 0 && !isReview;
  // On phones the offcanvas should close once you pick a session. A review
  // session selects like any other — its decision queue renders inline in the
  // main panel (see ReviewInline), not a separate page.
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
        <div className="flex h-auto items-center gap-2.5 rounded-lg px-2 py-1.5">
          <span className="flex size-6 flex-none items-center justify-center rounded-md bg-surface text-muted-foreground ring-1 ring-border/70">
            <SessionKindIcon kind={props.session.kind} />
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
          "h-auto items-start gap-2.5 rounded-lg py-1.5 pr-7 transition-colors duration-150 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:py-2",
          // The selected row lifts off the panel as a soft accent card —
          // brand-subtle tint, a faint brand ring, and a low shadow — so it
          // reads with the same depth as the surfaces on the right. Hover is a
          // calm gray wash. Weight never changes between states.
          isSel
            ? "bg-brand-subtle shadow-xs ring-1 ring-brand/15 hover:bg-brand-subtle data-[active=true]:bg-brand-subtle"
            : "hover:bg-hover data-[active=true]:bg-brand-subtle",
        )}
      >
        {/* The agent mark sits in a small tile — a white chip on the warm panel
            that echoes the card surfaces on the right and anchors each row.
            In the collapsed rail the tile drops away to a bare centered glyph. */}
        <span
          className={cx(
            "mt-px flex size-6 flex-none items-center justify-center rounded-md ring-1 group-data-[collapsible=icon]:mt-0 group-data-[collapsible=icon]:size-4 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:ring-0",
            isSel
              ? "bg-brand-subtle text-brand ring-brand/20"
              : "bg-surface text-muted-foreground ring-border/70",
          )}
        >
          <SessionKindIcon kind={props.session.kind} />
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
            {isReview ? (
              <span
                className={cx(
                  "flex-none rounded-full px-1.5 text-[10px] font-medium group-hover/menu-item:opacity-0",
                  REVIEW_CHIP[reviewVerdict].cls,
                )}
              >
                {REVIEW_CHIP[reviewVerdict].label}
              </span>
            ) : props.session.surfaceCount > 0 ? (
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
                title={working ? "Working" : "Listening for your feedback"}
              />
            ) : null}
            <span className="min-w-0 flex-1 truncate">
              {working ? "working…" : relTime(props.session.lastActiveAt)}
            </span>
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

  // The table-of-contents rail lives in the left reading gutter as an in-flow
  // sticky flex item (with a matching spacer on the right so the stream stays
  // centered). It only appears once a session has enough cards to be worth
  // navigating AND the row is wide enough to hold the rail without squeezing the
  // 860px stream — measured live, so it adapts to the sidebar collapsing.
  const rowRef = useRef<HTMLDivElement>(null);
  const [tocTop, setTocTop] = useState(120);
  const [tocRoom, setTocRoom] = useState(false);
  const tocEligible = !!selected && !streamLoading && !reading && surfaces.length >= 3;
  useEffect(() => {
    if (!tocEligible) {
      setTocRoom(false);
      return;
    }
    const row = rowRef.current;
    const header = document.querySelector<HTMLElement>("#sessionView [data-print-static]");
    if (!row) return;
    const NEEDED = 860 + 2 * (224 + 24); // stream + rail+gap on each side
    const measure = () => {
      setTocRoom(row.clientWidth >= NEEDED);
      if (header) setTocTop(header.offsetHeight + 12);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    if (header) ro.observe(header);
    return () => ro.disconnect();
  }, [tocEligible, surfaces.length]);
  const showToc = tocEligible && tocRoom;

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
                <SessionKindIcon kind={current.kind} />
              </span>
            ) : null}
            <SessionTitle current={current} />
            <span className="flex-1" />
            <WorkingPill sessionId={selected} />
          </div>
          <span className="pl-0.5 text-[12px] text-faint" id="sessMeta">
            {current
              ? `${sessionKindLabel(current.kind)} · started ${relTime(current.createdAt)}${
                  surfaceCount > 0
                    ? ` · ${surfaceCount} surface${surfaceCount === 1 ? "" : "s"}`
                    : ""
                }`
              : ""}
          </span>
          <ActivityTicker sessionId={selected} />
        </div>
      </div>
      {current?.kind === "review" && selected ? (
        // A review takes over the main panel with its own bounded-height scroll
        // container (the decision queue's scroll-snap + sticky evidence need it),
        // sitting under the sticky session header. A static export inlines the
        // review into the bundle, so it renders here too — read-only.
        <div className="h-[calc(100svh-4.5rem)]">
          <ReviewInline sessionId={selected} />
        </div>
      ) : (
        <div ref={rowRef} className="flex w-full justify-center gap-6">
          {showToc ? <SurfaceOutline surfaces={surfaces} top={tocTop} /> : null}
          <div
            id="stream"
            className="w-full min-w-0 max-w-[860px] px-7 pt-[22px] pb-[120px] max-[700px]:px-3.5 max-[700px]:pt-4 max-[700px]:pb-[120px]"
          >
            <WhatsNewCard />
            {streamLoading ? (
              <CardSkeletons />
            ) : surfaces.length === 0 ? (
              <EmptySession />
            ) : reading ? null : (
              surfaces.map((s) => <Card surface={s} key={s.id} />)
            )}
          </div>
          {/* Mirror the rail's width on the right so the stream stays centered. */}
          {showToc ? <div aria-hidden className="w-[224px] shrink-0" /> : null}
        </div>
      )}
    </div>
  );
}

// A live table of contents for a card-heavy session: every surface as a jump
// link in the left reading gutter, so a long stream stays navigable. It's an
// in-flow sticky flex item (self-start so it can pin) bound to the same scroll
// container as the session header, so it stays put as the stream scrolls. The
// SessionView gates whether it renders and passes the sticky offset that clears
// the variable-height header.
function SurfaceOutline(props: { surfaces: Surface[]; top: number }) {
  const [activeId, setActiveId] = useState<string | null>(() => routeGet().surfaceId ?? null);

  // Scroll-spy: the active entry is the lowest card whose top has scrolled up to
  // the line just below the sticky header — i.e. the one you're reading. We scan
  // the registered card elements on each (rAF-throttled) scroll of the content
  // container; a coarse 50%-threshold route signal wasn't precise enough and
  // never moved on a click. The button's onClick also sets it optimistically so
  // the highlight follows the click instantly.
  useEffect(() => {
    const scroller = document.getElementById("appScroll");
    if (!scroller) return;
    const ids = props.surfaces.map((s) => s.id);
    let raf = 0;
    const pick = () => {
      raf = 0;
      let best = ids[0] ?? null;
      for (const id of ids) {
        const el = cardEls.get(id)?.card;
        if (el && el.getBoundingClientRect().top - props.top <= 8) best = id;
      }
      if (best) setActiveId(best);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(pick);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    pick();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [props.surfaces, props.top]);

  return (
    <nav
      aria-label="Surface contents"
      className="sticky h-fit w-[224px] shrink-0 self-start overflow-y-auto pb-6"
      style={{ top: props.top, maxHeight: `calc(100dvh - ${props.top + 24}px)` }}
    >
      <div className="mb-1.5 px-2 text-[10px] font-medium tracking-[0.09em] text-faint/70 uppercase">
        Contents
      </div>
      <ul className="flex flex-col gap-px" role="list">
        {props.surfaces.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveId(s.id);
                  cardEls.get(s.id)?.card.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                title={s.title}
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex w-full items-center gap-2 rounded-md py-[5px] pr-2 pl-2 text-left text-[12px] leading-snug",
                  active
                    ? "bg-brand-subtle text-brand"
                    : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                {/* A tone dot mirrors the card's status badge so the rail reads
                    as the same artifact; a plain marker when the card has none. */}
                <span
                  className={cx(
                    "size-1.5 flex-none rounded-full",
                    s.badge ? BADGE_DOT_CLASS[s.badge.tone] : active ? "bg-brand" : "bg-faint/45",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
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
      title="Actively publishing to this session right now."
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
