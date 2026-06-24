import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, Link2, Pencil, Search, Trash2, X } from "lucide-react";
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
} from "./api.ts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { routeGet, routeSubscribe, root } from "./host.ts";
import { Card, cardEls, frameForSource } from "./Card.tsx";
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
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { applyFrameHeight } from "./SandboxedPart.tsx";
import { renderNotes } from "./notes.ts";
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
  "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[15px] font-medium tracking-[0.01em] text-inherit transition-colors hover:text-brand focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand";

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
          "size-[7px] flex-none rounded-full transition-colors duration-300",
          live ? "bg-[#4caf78]" : "bg-faint",
        )}
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
        className="h-8 rounded-lg border-transparent bg-card pr-7 pl-8 text-[13px] shadow-none focus-visible:border-brand focus-visible:ring-0"
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

export default function App() {
  const [connectOpen, setConnectOpen] = useState(false);
  const [query, setQuery] = useState("");
  const sessions = useBoard((s) => s.sessions);
  const unread = useBoard((s) => s.unread);
  const pillTarget = useBoard((s) => s.pillTarget);
  const toastShow = useBoard((s) => s.toastShow);
  const toastText = useBoard((s) => s.toastText);

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
        <Toast show={toastShow} text={toastText} />
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
              <SidebarTrigger className="size-7 flex-none text-muted-foreground hover:text-foreground" />
            </div>
            <SessionSearch query={query} onQuery={setQuery} />
            <UpdateBanner />
          </SidebarHeader>
          <SidebarContent id="sessionList" className="px-1.5">
            {visibleGroups.map((group) => (
              <SidebarGroup key={group.label} className="py-1.5">
                <SidebarGroupLabel className="px-2 text-[10.5px] font-medium tracking-[0.06em] text-faint uppercase">
                  {group.label}
                </SidebarGroupLabel>
                <SidebarMenu>
                  {group.sessions.map((s) => (
                    <SessionItem session={s} key={s.id} />
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))}
            {noMatches ? (
              <div className="px-3 py-8 text-center text-[12.5px] text-faint group-data-[collapsible=icon]:hidden">
                No chats match “{query.trim()}”.
              </div>
            ) : null}
          </SidebarContent>
          <SidebarFooter className="border-t-[0.5px] border-border px-3 py-3 text-xs text-faint group-data-[collapsible=icon]:hidden [&_a]:text-muted-foreground [&_a]:no-underline [&_a:hover]:text-foreground">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <a href="/guide" target="_blank">
                design guide
              </a>
              <span className="text-faint/60">·</span>
              <a href="/setup" target="_blank">
                agent setup
              </a>
              {!isReadonly() ? (
                <>
                  <span className="text-faint/60">·</span>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setConnectOpen(true);
                    }}
                  >
                    connect Claude Code
                  </a>
                </>
              ) : null}
            </div>
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
      <Toast show={toastShow} text={toastText} />
      <NewSurfacePill target={pillTarget} />
    </>
  );
}

// The global status toast — pinned bottom-center, fades in. Shared by both
// layouts (stream and full board).
function Toast(props: { show: boolean; text: string }) {
  return (
    <div
      id="toast"
      role="status"
      aria-live="polite"
      className={cx(
        "pointer-events-none fixed bottom-[26px] left-1/2 z-50 max-w-[600px] -translate-x-1/2 translate-y-2 rounded-[10px] border-[0.5px] border-[var(--border-2)] bg-card px-3.5 py-[9px] text-[13px] opacity-0 shadow-[0_6px_20px_rgba(0,0,0,0.14)] transition-[opacity,transform] duration-200",
        props.show && "pointer-events-auto translate-y-0 opacity-100",
      )}
    >
      {props.text}
    </div>
  );
}

// "new surface ↓" pill — appears when a surface arrives off-screen and jumps to
// it on click. Shared by both layouts.
function NewSurfacePill(props: { target: string | null }) {
  return (
    <button
      id="newPill"
      className="fixed bottom-16 left-1/2 z-40 -translate-x-1/2 cursor-pointer rounded-full border-[0.5px] border-brand bg-brand-subtle px-3.5 py-1.5 text-[12.5px] text-brand shadow-[0_4px_14px_rgba(0,0,0,0.12)] transition hover:bg-brand hover:text-primary-foreground"
      hidden={props.target === null}
      onClick={() => {
        if (props.target)
          cardEls.get(props.target)?.card.scrollIntoView({ behavior: "smooth", block: "start" });
        setPillTarget(null);
      }}
    >
      new surface ↓
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
      className="mx-3 mt-0 mb-2 rounded-[10px] border-[0.5px] border-border bg-brand-subtle px-[11px] py-[9px] text-[12.5px]"
      role="status"
    >
      <div className="flex items-center gap-1">
        New version <strong>{v.latest}</strong>
        <button
          className="ml-auto cursor-pointer rounded-[5px] px-1 py-0.5 text-xs text-muted-foreground hover:bg-hover hover:text-foreground"
          aria-label={`Dismiss update notice for ${v.latest}`}
          onClick={() => dismissUpdate(v.latest!)}
        >
          ✕
        </button>
      </div>
      {v.upgradeCommand ? (
        <button
          className="mt-1.5 block w-full cursor-pointer rounded-md border-[0.5px] border-border bg-card px-[7px] py-1 text-left text-[11.5px] text-muted-foreground hover:border-[var(--border-2)] hover:text-foreground"
          title="Copy upgrade command"
          onClick={() => {
            navigator.clipboard.writeText(v.upgradeCommand!);
            toast("Copied: " + v.upgradeCommand);
          }}
        >
          <code className="font-mono">{v.upgradeCommand}</code> ⧉
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
      className="card group mb-5 overflow-hidden rounded-xl border-[0.5px] border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_2px_6px_rgba(0,0,0,0.05)] transition-[box-shadow,border-color] duration-[0.18s] ease-in-out hover:shadow-[0_1px_2px_rgba(0,0,0,0.05),0_6px_16px_rgba(0,0,0,0.07)]"
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
        className="px-4 pt-1.5 pb-3 text-[13.5px]/[1.55] [&_a]:text-brand [&_code]:rounded [&_code]:bg-hover [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-xs [&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-[13px] [&_h4]:font-medium [&_li]:my-[3px] [&_ul]:my-1 [&_ul]:pl-5"
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
          "h-auto items-start gap-2 rounded-lg py-2 pr-7 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:py-2",
          isSel &&
            "bg-brand-subtle shadow-[inset_2px_0_0_var(--color-brand)] hover:bg-brand-subtle",
        )}
      >
        {/* The agent mark anchors the row at the icon-rail width too. */}
        <span className="mt-0.5 flex-none group-data-[collapsible=icon]:mt-0">
          <AgentMark agent={props.session.agent} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
          <span
            className={cx(
              "truncate text-[13px] leading-tight",
              isSel
                ? "font-semibold text-brand"
                : isVacant
                  ? "font-normal text-muted-foreground"
                  : "font-medium text-foreground",
            )}
          >
            {label}
            {props.session.surfaceCount > 0 ? (
              <span className={cx("font-normal", isSel ? "text-brand/70" : "text-faint")}>
                {" "}
                ({props.session.surfaceCount})
              </span>
            ) : null}
          </span>
          <span
            className={cx(
              "truncate text-[11.5px] leading-tight",
              isVacant && !isSel ? "text-faint/80" : "text-faint",
            )}
          >
            {props.session.agent} · {relTime(props.session.lastActiveAt)}
          </span>
        </span>
      </SidebarMenuButton>
      {/* The unread dot hides once the row is hovered or its menu is open, so it
          never collides with the ⋯ action. */}
      {isUnread ? (
        <span
          className={cx(
            "pointer-events-none absolute top-1/2 right-2.5 size-[7px] -translate-y-1/2 rounded-full bg-brand group-data-[collapsible=icon]:hidden group-hover/menu-item:hidden",
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

function SessionView() {
  const sessions = useBoard((s) => s.sessions);
  const selected = useBoard((s) => s.selected);
  const surfaces = useBoard((s) => s.surfaces);
  const streamLoading = useBoard((s) => s.streamLoading);
  const current = sessions.find((x) => x.id === selected);
  return (
    <div id="sessionView" hidden={sessions.length === 0}>
      <div className="sticky top-0 z-[5] flex items-baseline gap-2.5 border-b-[0.5px] border-border bg-background px-7 pt-3.5 pb-2.5 max-[700px]:px-4 max-[700px]:pt-3 max-[700px]:pb-2.5">
        <SessionTitle current={current} />
        <span className="text-[12.5px] text-faint" id="sessMeta">
          {current ? `${current.agent} · started ${relTime(current.createdAt)}` : ""}
        </span>
      </div>
      <div
        id="stream"
        className="mx-auto max-w-[860px] px-7 pt-[22px] pb-[120px] max-[700px]:px-3.5 max-[700px]:pt-4 max-[700px]:pb-[120px]"
      >
        <WhatsNewCard />
        {!streamLoading && surfaces.length === 0 ? (
          <div className="px-6 py-[90px] text-center text-faint" id="streamEmpty">
            No surfaces in this session yet.
          </div>
        ) : null}
        {surfaces.map((s) => (
          <Card surface={s} key={s.id} />
        ))}
      </div>
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
      className="min-w-10 rounded-md px-1 text-base font-medium outline-none hover:bg-hover focus:bg-card focus:shadow-[0_0_0_0.5px_var(--border-2)]"
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
          <p className="mb-8 text-[14.5px] text-muted-foreground">
            showcase is a live surface where coding agents draw HTML snippets — diagrams, sketches,
            explainers — while they work in your terminal.
          </p>
          <h2>teach your agent about it</h2>
          <Snip text={SETUP_SNIP} />
          <h2>or try it yourself</h2>
          <Snip text={TRY_SNIP} />
          <h2>using claude code?</h2>
          <button
            className="cursor-pointer rounded-lg border-[0.5px] border-border bg-card px-3.5 py-2 text-[13px] text-foreground hover:border-muted-foreground"
            onClick={props.onConnect}
          >
            Connect Claude Code →
          </button>
        </>
      ) : (
        <>
          <h1>Nothing here yet</h1>
          <p className="mb-8 text-[14.5px] text-muted-foreground">
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
            className="cursor-pointer px-1.5 py-0.5 text-sm text-faint hover:text-foreground"
            aria-label="Close"
            onClick={props.onClose}
          >
            ✕
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
  const [label, setLabel] = useState("copy");
  return (
    <div className="relative rounded-[10px] border-[0.5px] border-border bg-card py-3 pr-11 pl-3.5 font-mono text-[12.5px]/[1.6] break-all whitespace-pre-wrap text-foreground">
      {props.text}
      <button
        className="absolute top-2 right-2 cursor-pointer rounded-md border-[0.5px] border-border bg-background px-2 py-[3px] font-sans text-[11.5px] text-faint hover:text-foreground"
        onClick={() => {
          navigator.clipboard.writeText(props.text);
          setLabel("copied");
          setTimeout(() => setLabel("copy"), 1500);
        }}
      >
        {label}
      </button>
    </div>
  );
}
