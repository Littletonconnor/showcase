// Self-hosted routing + DOM access. The embed/shadow-root abstraction was
// removed from this fork: the viewer always renders into the whole document and
// reads its base path + route from window/location directly.
//
// URL shapes (preserved exactly from the pre-React viewer):
//   /                       → empty board
//   /session/:id            → a session
//   /session/:id/s/:sid     → a session deep-linked to a surface
//   ?surface=<id>           → cold-load surface deep link (resolves its session)

export type Route = { sessionId?: string | null; surfaceId?: string | null };

declare global {
  interface Window {
    __SHOWCASE_BASE_PATH__?: string;
  }
}

// Link/base prefix prepended to every path, e.g. "/u/alice" ("" at root). The
// server injects window.__SHOWCASE_BASE_PATH__ when serving under a prefix; we
// also recognize a /u/<slug> URL prefix as the pre-React viewer did.
export function basePath(): string {
  return window.__SHOWCASE_BASE_PATH__ ?? location.pathname.match(/^\/u\/[^/]+/)?.[0] ?? "";
}

// The DOM root the viewer queries/scopes to — always the document, now that the
// shadow-root embed path is gone. Kept as a function so call sites read the same
// as before.
export function root(): Document {
  return document;
}

const base = () => basePath();

export function routeGet(): Route {
  const b = base();
  const rest = location.pathname.startsWith(b)
    ? location.pathname.slice(b.length)
    : location.pathname;
  const qSurface = new URLSearchParams(location.search).get("surface") ?? undefined;
  const m = rest.match(/^\/session\/([^/]+)(?:\/s\/([^/]+))?/);
  if (m) return { sessionId: m[1], surfaceId: m[2] ?? qSurface };
  return { surfaceId: qSurface };
}

function urlFor(to: Route): string {
  const b = base();
  if (!to.sessionId) return b || "/";
  return to.surfaceId
    ? `${b}/session/${to.sessionId}/s/${to.surfaceId}`
    : `${b}/session/${to.sessionId}`;
}

export function routeNavigate(to: Route, opts?: { replace?: boolean }): void {
  // A static export is opened from disk (origin "null"), where history.*State to
  // a different path throws a SecurityError — and there's nothing to route to
  // anyway (one inlined session). Skip URL changes entirely in that mode.
  if (window.__SHOWCASE_EXPORT__) return;
  const target = urlFor(to);
  if (opts?.replace) {
    history.replaceState(null, "", target);
  } else if (location.pathname !== target) {
    history.pushState(null, "", target);
  }
}

// Subscribe to back/forward navigation (popstate). Returns an unsubscribe.
export function routeSubscribe(cb: (route: Route) => void): () => void {
  const handler = () => cb(routeGet());
  window.addEventListener("popstate", handler);
  return () => window.removeEventListener("popstate", handler);
}
