import { useEffect, useMemo, useRef, useState } from "react";
import { AgentMark } from "./agentMarks.tsx";
import { api, isReadonly, layoutMode, relTime, sessionLabel, type SessionRow } from "./api.ts";
import { routeGet, routeSubscribe, root } from "./host.ts";
import { Card, cardEls, frameForSource } from "./Card.tsx";
import { cx } from "./cx.ts";
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
  setNavOpen,
  setPillTarget,
  toast,
  updateNoticeFrom,
  useBoard,
} from "./state.ts";

// Stream-only layout: no sidebar, session list, or session chrome — just the
// current session's stream. Driven by the self-hosted public-read "session"
// link (see api.ts `layoutMode`).
const streamMode = () => layoutMode() === "stream";

// The wordmark, doubling as a home link: clicking it clears the current session
// and returns to the empty board (goHome). A real <button> so it's keyboard- and
// screen-reader-reachable; it shares the .brand styling with the static header
// and aside wordmarks.
function Brand() {
  const live = useBoard((s) => s.live);
  return (
    <button className="brand" type="button" aria-label="showcase — home" onClick={() => goHome()}>
      <span className={cx("livedot", live && "on")}></span>showcase
    </button>
  );
}

export default function App() {
  const [connectOpen, setConnectOpen] = useState(false);
  const sessions = useBoard((s) => s.sessions);
  const unread = useBoard((s) => s.unread);
  const navOpen = useBoard((s) => s.navOpen);
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

  // the mobile drawer slides in via a class on <body> (see styles.css
  // `body.nav-open`)
  useEffect(() => {
    document.body.classList.toggle("nav-open", navOpen);
  }, [navOpen]);

  // sessions bucketed by recency for the sidebar; recomputes whenever the
  // session list changes (incl. the 45s quiet refresh, which keeps the
  // Today/Yesterday split fresh as the day rolls over)
  const sessionGroups = useMemo(() => groupSessions(sessions, new Date()), [sessions]);

  return (
    <>
      <div id="app">
        <header className="topbar">
          {!streamMode() ? (
            <button
              className="menu"
              id="menuBtn"
              aria-label="Show sessions"
              onClick={() => setNavOpen(!navOpen)}
            >
              ☰<span className={cx("dot", unread.size > 0 && "show")} id="menuDot"></span>
            </button>
          ) : null}
          <Brand />
        </header>
        {!streamMode() ? (
          <aside>
            <Brand />
            <UpdateBanner />
            <div id="sessionList">
              {sessionGroups.map((group, gi) => (
                <div key={group.label} style={{ display: "contents" }}>
                  <div
                    className={cx(
                      "px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.06em] text-faint",
                      gi === 0 ? "pt-1.5" : "pt-3",
                    )}
                  >
                    {group.label}
                  </div>
                  {group.sessions.map((s) => (
                    <SessionItem session={s} key={s.id} />
                  ))}
                </div>
              ))}
            </div>
            <div className="aside-foot">
              <a href="/guide" target="_blank">
                design guide
              </a>{" "}
              &nbsp;·&nbsp;{" "}
              <a href="/setup" target="_blank">
                agent setup
              </a>{" "}
              {!isReadonly() ? (
                <>
                  &nbsp;·&nbsp;{" "}
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
          </aside>
        ) : null}
        <main
          onScroll={() => {
            if (nearBottom()) setPillTarget(null);
          }}
        >
          {!streamMode() ? <Onboard onConnect={() => setConnectOpen(true)} /> : null}
          <SessionView />
        </main>
      </div>
      {!streamMode() ? <div id="scrim" onClick={() => setNavOpen(false)}></div> : null}
      {connectOpen ? <ConnectModal onClose={() => setConnectOpen(false)} /> : null}
      <div id="toast" role="status" aria-live="polite" className={cx(toastShow && "show")}>
        {toastText}
      </div>
      <button
        id="newPill"
        hidden={pillTarget === null}
        onClick={() => {
          if (pillTarget)
            cardEls.get(pillTarget)?.card.scrollIntoView({ behavior: "smooth", block: "start" });
          setPillTarget(null);
        }}
      >
        new surface ↓
      </button>
    </>
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
    <div className="update-banner" role="status">
      <div className="update-head">
        New version <strong>{v.latest}</strong>
        <button
          className="x"
          aria-label={`Dismiss update notice for ${v.latest}`}
          onClick={() => dismissUpdate(v.latest!)}
        >
          ✕
        </button>
      </div>
      {v.upgradeCommand ? (
        <button
          className="update-cmd"
          title="Copy upgrade command"
          onClick={() => {
            navigator.clipboard.writeText(v.upgradeCommand!);
            toast("Copied: " + v.upgradeCommand);
          }}
        >
          <code>{v.upgradeCommand}</code> ⧉
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
    <div className="card" id="whatsNew">
      <div className="card-head">
        <span className="card-title">What&rsquo;s new in {v.latest}</span>
        <span className="card-meta">update available</span>
        <span className="sp"></span>
        <button className="act del" onClick={() => dismissUpdate(v.latest!)}>
          dismiss
        </button>
      </div>
      <div
        className="update-notes"
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
  const label = sessionLabel(props.session);
  const isSel = props.session.id === selected;
  const isUnread = unread.has(props.session.id);
  const isVacant = props.session.surfaceCount === 0;
  return (
    <div
      className={cx(
        "group relative mb-0.5 cursor-pointer rounded-lg px-2.5 py-2 transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand",
        isSel ? "bg-brand-subtle shadow-[inset_2px_0_0_var(--color-brand)]" : "hover:bg-hover",
      )}
      data-id={props.session.id}
      role="button"
      tabIndex={0}
      aria-current={isSel ? "true" : undefined}
      onClick={() => select(props.session.id)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          select(props.session.id);
        }
      }}
    >
      <div
        className={cx(
          "truncate pr-5 text-[13px]",
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
      </div>
      <div
        className={cx(
          "mt-px flex items-center text-xs",
          isVacant && !isSel ? "text-faint/80" : "text-faint",
        )}
      >
        <AgentMark agent={props.session.agent} />
        {props.session.agent} · {relTime(props.session.lastActiveAt)}
      </div>
      {isUnread ? (
        <span className="absolute right-2.5 top-3 size-[7px] rounded-full bg-brand group-hover:hidden" />
      ) : null}
      {!isReadonly() ? (
        <button
          className="absolute right-1.5 top-2 rounded-[5px] px-1 py-0.5 text-[13px] text-faint opacity-0 transition group-hover:opacity-100 hover:bg-hover hover:text-foreground"
          title="Delete session"
          aria-label={`Delete session "${label}"`}
          onClick={async (e) => {
            e.stopPropagation();
            if (!confirm(`Delete "${label}" and its surfaces?`)) return;
            await api(`/api/sessions/${props.session.id}`, { method: "DELETE" });
          }}
        >
          ✕
        </button>
      ) : null}
    </div>
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
      <div className="session-head">
        <SessionTitle current={current} />
        <span className="meta" id="sessMeta">
          {current ? `${current.agent} · started ${relTime(current.createdAt)}` : ""}
        </span>
      </div>
      <div id="stream">
        <WhatsNewCard />
        {!streamLoading && surfaces.length === 0 ? (
          <div className="empty" id="streamEmpty">
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
    <div id="onboard" hidden={sessions.length > 0}>
      {!isReadonly() ? (
        <>
          <h1>The show hasn&rsquo;t started yet</h1>
          <p className="sub">
            showcase is a live surface where coding agents draw HTML snippets — diagrams, sketches,
            explainers — while they work in your terminal.
          </p>
          <h2>teach your agent about it</h2>
          <Snip text={SETUP_SNIP} />
          <h2>or try it yourself</h2>
          <Snip text={TRY_SNIP} />
          <h2>using claude code?</h2>
          <button className="connect-btn" onClick={props.onConnect}>
            Connect Claude Code →
          </button>
        </>
      ) : (
        <>
          <h1>Nothing here yet</h1>
          <p className="sub">This showcase board does not have any sessions yet.</p>
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
    <div className="modal-backdrop" onClick={props.onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Connect Claude Code"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Connect Claude Code</h2>
          <button className="x" aria-label="Close" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <p className="sub">
          Install the showcase plugin so your comments reach the agent on their own. A background
          monitor streams each comment to Claude Code as a notification — no copy-pasting, no
          re-arming a watcher.
        </p>
        <h3>1 · add the marketplace</h3>
        <Snip text={MARKETPLACE_CMD} />
        <h3>2 · install the plugin</h3>
        <Snip text={INSTALL_CMD} />
        <p className="note">
          Run both inside Claude Code. On install it asks for your <strong>Showcase URL</strong>{" "}
          (default <code>http://localhost:8229</code>, or your deployed instance) and an optional
          token.
        </p>
        <h3>what it runs</h3>
        <p className="note">
          The plugin connects the showcase MCP server and runs <code>showcase watch</code> against
          your board as a background process — unsandboxed, the same trust level as hooks, with no
          per-comment prompt. Comments are delivered to the agent exactly once.
        </p>
        <p className="caveat">
          Requires Claude Code ≥ 2.1.105. It&rsquo;s two commands, not a true one-click — Claude
          Code has no browser-to-terminal handoff yet.
        </p>
      </div>
    </div>
  );
}

function Snip(props: { text: string }) {
  const [label, setLabel] = useState("copy");
  return (
    <div className="snip">
      {props.text}
      <button
        className="copy"
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
