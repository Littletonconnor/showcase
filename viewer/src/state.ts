// Shared state and the flows that mutate it. A single zustand store holds the
// whole board (sessions, the selected session's surfaces/comments, live status,
// theme) plus the version-update notice. SSE (/api/events)
// and the API helpers mutate it; components subscribe via selector hooks.
//
// Reconcile-by-id semantics from the Solid version are preserved by hand: list
// updates merge into existing rows so React keys stay stable across refetches
// (cards/iframes persist, drafts and focus survive).
import { create } from "zustand";
import { toast as sonnerToast } from "sonner";
import {
  api,
  appPath,
  isReadonly,
  publicReadMode,
  type Comment,
  type SessionRow,
  type Surface,
  type VersionInfo,
} from "./api.ts";
import { routeGet, routeNavigate, type Route, root } from "./host.ts";

// --- URL routing ---
// The viewer owns the URL via the History API; routes map onto /session/:id and
// /session/:id/s/:sid.
// /                       → redirect to last-viewed session (localStorage)
const LAST_SESSION_KEY = "showcase-last-session";

// A comment as the viewer renders it: server comments plus the optimistic
// local echo (pending until the POST confirms).
export type ViewComment = Comment & { pending?: boolean };

const DISMISSED_UPDATE_KEY = "showcase-dismissed-update";

interface BoardState {
  sessions: SessionRow[];
  selected: string | null;
  unread: ReadonlySet<string>;
  surfaces: Surface[];
  comments: ViewComment[];
  streamLoading: boolean;
  // True until the first session fetch resolves, so the sidebar can show
  // skeletons on cold load instead of flashing the empty/onboard state.
  sessionsLoading: boolean;
  live: boolean;
  // Surface id the next mounted card should scroll to (set for SSE arrivals
  // landing while the user is near the bottom, not the initial batch of a
  // session switch).
  scrollTarget: string | null;
  // Surface id the "new surface ↓" pill jumps to — set instead of scrolling
  // when the user is reading further up.
  pillTarget: string | null;
  // Update notice: shown when the server reports a newer release the user has
  // not dismissed. Dismissal stores the version, not a flag, so dismissing
  // 0.4.0 keeps it gone until 0.5.0 actually ships.
  versionInfo: VersionInfo | null;
  dismissedUpdate: string | null;
  // Theme: the active board theme id + the resolved OS light/dark preference.
  // Both drive iframe keys and string re-renders, so they live in the store.
  activeTheme: string;
  prefersDark: boolean;
  // Surfaces with an outstanding "agent is responding…" indicator: set when the
  // user sends to a card whose session is listening, cleared when the agent
  // replies (or on a timeout, so it never hangs).
  responding: Record<string, boolean>;
}

export const useBoard = create<BoardState>(() => ({
  sessions: [],
  selected: null,
  unread: new Set<string>(),
  surfaces: [],
  comments: [],
  streamLoading: false,
  sessionsLoading: true,
  live: false,
  scrollTarget: null,
  pillTarget: null,
  versionInfo: null,
  dismissedUpdate: localStorage.getItem(DISMISSED_UPDATE_KEY),
  activeTheme: "",
  prefersDark: false,
  responding: {},
}));

// Non-reactive snapshot accessors — mirror the Solid signal getters so the flow
// functions below read state the same way regardless of render context.
const get = useBoard.getState;
const set = useBoard.setState;
export const sessionsNow = () => get().sessions;
export const selectedNow = () => get().selected;
export const surfacesNow = () => get().surfaces;

export interface SessionGroup {
  label: string;
  sessions: SessionRow[];
}

// Bucket sessions by last-active recency (Today / Yesterday / Earlier) so the
// freshest work stays on top and a long history reads at a glance. Within a
// bucket, sessions with no surfaces yet sink to the bottom (and render dimmed)
// — present but out of the way. Empty buckets are omitted. `now` is injectable
// for tests; callers pass the real clock.
export function groupSessions(list: readonly SessionRow[], now: Date): SessionGroup[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const buckets: SessionGroup[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Earlier", sessions: [] },
  ];
  for (const s of list) {
    const t = Date.parse(s.lastActiveAt);
    const bucket = t >= startOfToday ? buckets[0] : t >= startOfYesterday ? buckets[1] : buckets[2];
    bucket.sessions.push(s);
  }
  for (const b of buckets) {
    b.sessions.sort((a, c) => {
      const ae = a.surfaceCount === 0;
      const ce = c.surfaceCount === 0;
      if (ae !== ce) return ae ? 1 : -1; // empties last
      return c.lastActiveAt.localeCompare(a.lastActiveAt); // newest first
    });
  }
  return buckets.filter((b) => b.sessions.length > 0);
}

// Reconcile a fetched session list into the store by id: reuse the existing row
// object when present (stable identity) and follow the incoming order, so React
// keys don't thrash across refetches.
function reconcileSessions(incoming: SessionRow[]) {
  set((s) => {
    const byId = new Map(s.sessions.map((row) => [row.id, row]));
    const next = incoming.map((row) => {
      const prev = byId.get(row.id);
      return prev ? Object.assign(prev, row) : row;
    });
    return { sessions: next };
  });
}

export function setScrollTarget(id: string | null) {
  set({ scrollTarget: id });
}

export function setPillTarget(id: string | null) {
  set({ pillTarget: id });
}

export function clearUnread(id: string) {
  set((s) => {
    if (!s.unread.has(id)) return s;
    const next = new Set(s.unread);
    next.delete(id);
    return { unread: next };
  });
}

// One toast helper for the whole app, now backed by shadcn Sonner. Call sites
// are unchanged (`toast("…")`); the rendering moved from the hand-rolled #toast
// div to the <Toaster/> mounted in App.
export function toast(text: string) {
  sonnerToast(text);
}

function markUnread(sessionId: string) {
  set((s) => ({ unread: new Set(s.unread).add(sessionId) }));
}

// --- Agent presence + responding state ---

// Live "agent is listening" flips the listening flag on the session row (the
// API seeds it; agent-presence SSE keeps it current). Reactive selector below.
function setListening(sessionId: string, listening: boolean) {
  set((s) => {
    const idx = s.sessions.findIndex((r) => r.id === sessionId);
    if (idx < 0 || !!s.sessions[idx].listening === listening) return s;
    const next = s.sessions.slice();
    next[idx] = { ...next[idx], listening };
    return { sessions: next };
  });
}

export const useSessionListening = () =>
  useBoard((s) => !!s.sessions.find((r) => r.id === s.selected)?.listening);

export const useResponding = (surfaceId: string | null) =>
  useBoard((s) => (surfaceId ? !!s.responding[surfaceId] : false));

// A responding indicator auto-clears after this long, so a missed reply (agent
// stopped listening mid-turn) never leaves a permanent "responding…" bubble.
const RESPONDING_TIMEOUT_MS = 90_000;
const respondingTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearResponding(surfaceId: string) {
  const t = respondingTimers.get(surfaceId);
  if (t) {
    clearTimeout(t);
    respondingTimers.delete(surfaceId);
  }
  set((s) => {
    if (!s.responding[surfaceId]) return s;
    const next = { ...s.responding };
    delete next[surfaceId];
    return { responding: next };
  });
}

function markResponding(surfaceId: string) {
  const prev = respondingTimers.get(surfaceId);
  if (prev) clearTimeout(prev);
  respondingTimers.set(
    surfaceId,
    setTimeout(() => clearResponding(surfaceId), RESPONDING_TIMEOUT_MS),
  );
  set((s) =>
    s.responding[surfaceId] ? s : { responding: { ...s.responding, [surfaceId]: true } },
  );
}

// A responding indicator is keyed by surfaceId for a card thread, or
// `session:<id>` for the session-level chat.
export const sessionRespondKey = (sessionId: string) => `session:${sessionId}`;

// Clear the responding indicator once the newest comment in the matching thread
// is an agent reply (author != user) — the reply we were waiting for has landed.
function clearRespondingIfAnswered(respondKey: string, match: (c: ViewComment) => boolean) {
  const newest = get()
    .comments.filter((c) => match(c) && !c.pending)
    .reduce<ViewComment | undefined>((a, b) => (b.seq >= (a?.seq ?? -1) ? b : a), undefined);
  if (newest && newest.author !== "user") clearResponding(respondKey);
}

export async function checkVersion() {
  set({ versionInfo: await api<VersionInfo>("/api/version").catch(() => null) });
}

export function dismissUpdate(version: string) {
  localStorage.setItem(DISMISSED_UPDATE_KEY, version);
  set({ dismissedUpdate: version });
}

// Derived: the update notice to show, or null. Pure over the two store fields so
// components can compute it from a selector.
export function updateNoticeFrom(
  versionInfo: VersionInfo | null,
  dismissedUpdate: string | null,
): VersionInfo | null {
  return versionInfo?.updateAvailable &&
    versionInfo.latest &&
    versionInfo.latest !== dismissedUpdate
    ? versionInfo
    : null;
}

export async function refreshSessionsQuiet() {
  if (isReadonly() && publicReadMode() === "session") return;
  reconcileSessions(await api<SessionRow[]>("/api/sessions"));
}

function syntheticSession(id: string): SessionRow {
  const now = new Date().toISOString();
  return {
    id,
    agent: "",
    title: null,
    cwd: null,
    createdAt: now,
    lastActiveAt: now,
    agentSeq: 0,
    surfaceCount: 0,
  };
}

export async function refreshSessions(targetSurfaceId?: string | null) {
  if (isReadonly() && publicReadMode() === "session") {
    set({ sessionsLoading: false });
    const route = routeGet();
    if (!route.sessionId) return;
    if (!sessionsNow().some((s) => s.id === route.sessionId)) {
      reconcileSessions([syntheticSession(route.sessionId)]);
    }
    await select(route.sessionId, {
      replace: true,
      initialSurfaceId: route.surfaceId ?? undefined,
    });
    return;
  }

  await refreshSessionsQuiet();
  set({ sessionsLoading: false });
  if (selectedNow() && !sessionsNow().some((s) => s.id === selectedNow())) set({ selected: null });
  if (targetSurfaceId) {
    const target = await api<Surface>(`/api/surfaces/${encodeURIComponent(targetSurfaceId)}`).catch(
      () => null,
    );
    if (target && sessionsNow().some((s) => s.id === target.sessionId)) {
      await select(target.sessionId, { replace: true, initialSurfaceId: target.id });
      return;
    }
  }

  if (!selectedNow() && sessionsNow().length > 0) {
    // Check the route first, then localStorage, then fall back to first session.
    const route = routeGet();
    const lastId = localStorage.getItem(LAST_SESSION_KEY);
    const list = sessionsNow();
    const target =
      (route.sessionId && list.some((s) => s.id === route.sessionId) && route.sessionId) ||
      (lastId && list.some((s) => s.id === lastId) && lastId) ||
      list[0].id;
    await select(target, {
      replace: true,
      initialSurfaceId: target === route.sessionId ? (route.surfaceId ?? undefined) : undefined,
    });
  }
}

export async function select(
  id: string,
  opts?: { fromPopState?: boolean; replace?: boolean; initialSurfaceId?: string },
) {
  set({ selected: id });
  if (opts?.fromPopState) {
    // The route already moved (back/forward); don't touch it.
  } else if (opts?.replace) {
    routeNavigate({ sessionId: id, surfaceId: opts.initialSurfaceId }, { replace: true });
  } else {
    routeNavigate({ sessionId: id });
  }
  localStorage.setItem(LAST_SESSION_KEY, id);
  clearUnread(id);
  set({
    scrollTarget: null,
    pillTarget: null,
    streamLoading: true,
    surfaces: [],
    comments: [],
  });
  const metas = await api<{ id: string }[]>(`/api/sessions/${id}/surfaces`).catch(() => []);
  const details = (
    await Promise.all(metas.map((m) => api<Surface>(`/api/surfaces/${m.id}`).catch(() => null)))
  ).filter((s): s is Surface => s !== null);
  if (selectedNow() !== id) return; // user switched away mid-load
  set({ surfaces: details });
  // Scroll to a specific surface if requested (deep link).
  if (opts?.initialSurfaceId && details.some((s) => s.id === opts.initialSurfaceId)) {
    set({ scrollTarget: opts.initialSurfaceId });
    routeNavigate({ sessionId: id, surfaceId: opts.initialSurfaceId }, { replace: true });
  }
  set({ streamLoading: false });
  const res = await api<{ comments: Comment[] }>(`/api/comments?session=${id}`).catch(() => null);
  if (!res || selectedNow() !== id) return;
  mergeComments(res.comments);
}

// Reflect the currently visible surface in the route (replace, so scrolling
// doesn't pollute history).
export function focusSurface(surfaceId: string) {
  const sid = selectedNow();
  if (sid) routeNavigate({ sessionId: sid, surfaceId }, { replace: true });
}

// Return to "home" — the session-less base route — and drop the current
// selection. Drives the clickable sidebar brand: a guaranteed way back to the
// empty board from anywhere.
export function goHome() {
  set({ selected: null });
  routeNavigate({ sessionId: null, surfaceId: null });
}

// Re-select the session when the route changes (back/forward).
export function applyRoute(route: Route) {
  if (route.sessionId && route.sessionId !== selectedNow()) {
    void select(route.sessionId, {
      fromPopState: true,
      initialSurfaceId: route.surfaceId ?? undefined,
    });
  }
}

// Switch to the session above (-1) or below (+1) the current one in the
// sidebar list, wrapping at the ends so repeated presses cycle. Drives the
// Cmd+Option+Up/Down shortcut. No-op with no sessions; jumps to the first
// when nothing is selected yet.
export async function selectAdjacent(delta: 1 | -1) {
  const list = sessionsNow();
  if (list.length === 0) return;
  const idx = list.findIndex((s) => s.id === selectedNow());
  if (idx < 0) {
    await select(list[0].id);
    return;
  }
  const next = (idx + delta + list.length) % list.length;
  await select(list[next].id);
}

// Fetch a surface and insert/update it in the open session's stream.
async function upsertSurface(id: string, { scroll = true } = {}) {
  const s = await api<Surface>(`/api/surfaces/${id}`).catch(() => null);
  if (!s || s.sessionId !== selectedNow()) return;
  const idx = surfacesNow().findIndex((x) => x.id === s.id);
  if (idx >= 0) {
    set((state) => {
      const next = state.surfaces.slice();
      next[idx] = s;
      return { surfaces: next };
    });
  } else {
    // Follow new surfaces only when the user is already at the bottom;
    // never yank them away from whatever they're reading mid-scroll.
    if (scroll) {
      if (nearBottom()) set({ scrollTarget: s.id });
      else set({ pillTarget: s.id });
    }
    set((state) => ({ surfaces: [...state.surfaces, s] }));
  }
}

export function nearBottom() {
  const m = root().querySelector("main");
  return !!m && m.scrollHeight - m.scrollTop - m.clientHeight < 200;
}

function mergeComments(list: Comment[]) {
  set((state) => {
    const seen = new Set(state.comments.map((c) => c.id));
    const fresh = list.filter((c) => !seen.has(c.id));
    return fresh.length > 0 ? { comments: [...state.comments, ...fresh] } : state;
  });
}

let localSeq = 0;

// Echo the comment immediately (pending until the POST confirms), and on
// failure report the error so the composer can put the text back — a user
// message must never be silently lost. Returns the error message, or null.
export async function sendComment(
  body: Record<string, unknown>,
  surfaceId: string | null,
  text: string,
  anchor?: { xPct: number; yPct: number },
): Promise<string | null> {
  const local: ViewComment = {
    id: `local-${++localSeq}`,
    seq: 0,
    sessionId: selectedNow() ?? "",
    surfaceId,
    surfaceTitle: null,
    author: "user",
    text,
    createdAt: new Date().toISOString(),
    pending: true,
    ...(anchor ? { anchor } : {}),
  };
  set((state) => ({ comments: [...state.comments, local] }));
  // If the agent is parked listening on this session, a reply is expected — show
  // the responding indicator on this thread until it lands (or times out). The
  // key is the surface, or `session:<id>` for a session-level message.
  const respondKey =
    surfaceId ?? (typeof body.session === "string" ? sessionRespondKey(body.session) : null);
  if (respondKey && !!get().sessions.find((r) => r.id === selectedNow())?.listening) {
    markResponding(respondKey);
  }
  try {
    const created = await api<Comment>("/api/comments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    set((state) => {
      // the SSE refetch may have rendered it already; keep one copy
      if (state.comments.some((c) => c.id === created.id))
        return { comments: state.comments.filter((c) => c.id !== local.id) };
      return { comments: state.comments.map((c) => (c.id === local.id ? created : c)) };
    });
    return null;
  } catch (err) {
    set((state) => ({ comments: state.comments.filter((c) => c.id !== local.id) }));
    return err instanceof Error && err.message ? err.message : "network error";
  }
}

interface FeedEvent {
  type: string;
  id?: string;
  sessionId?: string;
  surfaceId?: string | null;
  listening?: boolean;
}

export function connect() {
  const route = routeGet();
  const sessionId = route.sessionId ?? selectedNow();
  const eventsPath =
    isReadonly() && publicReadMode() === "session" && sessionId
      ? `/api/events?session=${encodeURIComponent(sessionId)}`
      : "/api/events";
  const es = new EventSource(appPath(eventsPath));
  let everConnected = false;
  es.onopen = async () => {
    set({ live: true });
    // events that fired during a gap are gone for good — refetch so the
    // board can't silently go stale while still looking live
    if (everConnected) await resyncSelected();
    everConnected = true;
  };
  es.onerror = () => set({ live: false });
  es.onmessage = async (ev) => {
    const e = JSON.parse(ev.data) as FeedEvent;
    // activity the user isn't looking at — other session or hidden tab —
    // marks the session unread, which also badges the tab title
    const away = e.sessionId != null && (e.sessionId !== selectedNow() || document.hidden);
    if (e.type.startsWith("session-")) {
      await refreshSessions();
    } else if (e.type === "surface-created" || e.type === "surface-updated") {
      if (away && e.sessionId) markUnread(e.sessionId);
      if (e.id && e.sessionId === selectedNow()) await upsertSurface(e.id);
      await refreshSessionsQuiet();
    } else if (e.type === "surface-deleted") {
      set((state) => {
        const idx = state.surfaces.findIndex((s) => s.id === e.id);
        if (idx < 0) return state;
        const next = state.surfaces.slice();
        next.splice(idx, 1);
        return { surfaces: next };
      });
      await refreshSessionsQuiet();
    } else if (e.type === "comment-created") {
      if (away && e.sessionId) markUnread(e.sessionId);
      if (e.sessionId === selectedNow()) {
        const query = e.surfaceId ? `surface=${e.surfaceId}` : `session=${e.sessionId}`;
        const res = await api<{ comments: Comment[] }>(`/api/comments?${query}`);
        mergeComments(res.comments);
        if (e.surfaceId) {
          clearRespondingIfAnswered(e.surfaceId, (c) => c.surfaceId === e.surfaceId);
        } else if (e.sessionId) {
          const sid = e.sessionId;
          clearRespondingIfAnswered(
            sessionRespondKey(sid),
            (c) => c.surfaceId == null && c.sessionId === sid,
          );
        }
      }
    } else if (e.type === "agent-presence") {
      if (e.sessionId) setListening(e.sessionId, !!e.listening);
    }
  };
}

// Re-fetch the selected session's surfaces and comments after an SSE
// reconnect; surfaces reconcile by id and comments dedupe by id.
async function resyncSelected() {
  const before = selectedNow();
  await refreshSessions();
  if (!before || selectedNow() !== before) return; // select() rebuilt the stream
  const metas = await api<{ id: string }[]>(`/api/sessions/${before}/surfaces`).catch(() => []);
  const ids = new Set(metas.map((m) => m.id));
  set((state) => ({ surfaces: state.surfaces.filter((s) => ids.has(s.id)) }));
  for (const meta of metas) await upsertSurface(meta.id, { scroll: false });
  const res = await api<{ comments: Comment[] }>(`/api/comments?session=${before}`).catch(
    () => null,
  );
  if (res && selectedNow() === before) mergeComments(res.comments);
}
