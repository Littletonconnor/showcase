// Thin client over the REST API, typed against the server's data model.
import type {
  ChartPart,
  Comment,
  CodePart,
  DiffPart,
  HtmlPart,
  ImagePart,
  JsonPart,
  MarkdownPart,
  MermaidPart,
  Session,
  Surface,
  SurfaceBadge,
  SurfacePart,
  TerminalPart,
  TracePart,
  TraceStep,
} from "../../server/types.ts";
import type { ExportBundle } from "../../server/export.ts";
import { basePath } from "./host.ts";

export type {
  ChartPart,
  Comment,
  CodePart,
  DiffPart,
  HtmlPart,
  ImagePart,
  JsonPart,
  MarkdownPart,
  MermaidPart,
  Session,
  Surface,
  SurfaceBadge,
  SurfacePart,
  TerminalPart,
  TracePart,
  TraceStep,
};

export type PublicReadMode = "session" | "full";

// What a session contains, computed server-side: a PR "review" (a decision-queue
// review) or a "visual" (a diagram / explainer / chart / sketch — everything
// else). Names and icons the row.
export type SessionKind = "review" | "visual";

// GET /api/sessions decorates each session with its surface count and whether
// an agent is currently parked in wait_for_feedback on it (live presence).
export interface SessionRow extends Session {
  surfaceCount: number;
  listening?: boolean;
  // Whether this session is a PR review or a visualization/explainer.
  kind?: SessionKind;
  // Set when the session carries a decision-queue review — the row chips the
  // verdict and links to /?review=<id> instead of the (empty) board view.
  reviewVerdict?: "block" | "approve" | "comment";
}

// GET /api/version — upgradeCommand and notes are set only when an update
// is actually available.
export interface VersionInfo {
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  upgradeCommand?: string | null;
  notes?: string | null;
}

declare global {
  interface Window {
    // __SHOWCASE_BASE_PATH__ lives in host.ts (the default host reads it).
    __SHOWCASE_READONLY__?: boolean;
    __SHOWCASE_PUBLIC_READ__?: PublicReadMode;
    // Set by a static export: the whole session inlined, so the viewer renders
    // with no server (see server/export.ts). Implies read-only.
    __SHOWCASE_EXPORT__?: ExportBundle;
    // Set by the PDF export (`?flatten=1`): render rich parts inline in document
    // flow instead of in srcdoc iframes, so they split across print page breaks.
    __SHOWCASE_FLATTEN__?: boolean;
  }
}

// A static export inlines the session; when present the viewer reads it in place
// of the network and never opens an SSE/long-poll.
export function exportBundle(): ExportBundle | undefined {
  return window.__SHOWCASE_EXPORT__;
}

// The URL for an uploaded asset's bytes. In an export the bytes are inlined as a
// `data:` URI; live, they stream from `/a/:id`.
export function assetUrl(id: string): string {
  return window.__SHOWCASE_EXPORT__?.assets[id] ?? `/a/${id}`;
}

// Rewrite `/a/:id` references inside agent HTML to inlined `data:` URIs for an
// export (so an `<img src="/a/…">` in an html part renders with no server). A
// no-op when live. An id with no inlined asset is left as-is.
export function inlineAssetRefs(html: string): string {
  const b = window.__SHOWCASE_EXPORT__;
  if (!b) return html;
  return html.replace(/\/a\/([A-Za-z0-9_-]+)/g, (m, id) => b.assets[id] ?? m);
}

// Resolve a GET against the inlined export bundle, or undefined if this path
// isn't one the export serves (callers then fall through to the network, which
// in an opened file simply yields no data). Mirrors the `/api/*` shapes.
function resolveFromExport(b: ExportBundle, path: string): unknown {
  const clean = path.split("?")[0];
  if (clean === "/api/sessions") return b.sessions;
  if (/^\/api\/sessions\/[^/]+\/(surfaces|snippets)$/.test(clean)) return b.surfaces;
  const surf = clean.match(/^\/api\/(?:surfaces|snippets)\/([^/]+)$/);
  if (surf) {
    const found = b.surfaces.find((s) => s.id === decodeURIComponent(surf[1]));
    if (!found) throw new Error("404");
    return found;
  }
  if (/^\/api\/sessions\/[^/]+\/review$/.test(clean)) {
    if (!b.review) throw new Error("404");
    return b.review;
  }
  if (clean === "/api/comments") return { comments: b.comments };
  if (clean === "/api/version") return { current: null, latest: null, updateAvailable: false };
  return undefined;
}

// The base path comes from the hosted-wrapper global / URL prefix, matching the
// pre-React viewer.
export function appBasePath(): string {
  return basePath();
}

export function appPath(path: string): string {
  return `${appBasePath()}${path}`;
}

export function isReadonly(): boolean {
  return !!window.__SHOWCASE_READONLY__;
}

// The PDF export path: rich parts (markdown, code, diff, mermaid, terminal)
// render inline in the document instead of in srcdoc iframes. An iframe can't be
// fragmented across a print page break, so a tall part would otherwise be
// stranded or clipped; inline content flows and paginates. Only the trusted,
// library-built part HTML is inlined this way — raw `html` parts stay sandboxed.
export function isFlatten(): boolean {
  return !!window.__SHOWCASE_FLATTEN__;
}

export function publicReadMode(): PublicReadMode | undefined {
  return window.__SHOWCASE_PUBLIC_READ__;
}

// The viewer's layout. "full" shows the sidebar + stream; "stream" shows only
// the current session's stream (no sidebar/session list). The self-hosted
// public-read "session" link maps to "stream".
export function layoutMode(): "full" | "stream" {
  return publicReadMode() === "session" ? "stream" : "full";
}

export function surfaceLink(id: string): string {
  return `${location.origin}${appPath(`/s/${encodeURIComponent(id)}`)}`;
}

// Viewer deep link to a session (the human-facing route, /session/:id) — what
// the overflow menu's "Copy link" puts on the clipboard.
export function sessionLink(id: string): string {
  return `${location.origin}${appPath(`/session/${encodeURIComponent(id)}`)}`;
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const bundle = window.__SHOWCASE_EXPORT__;
  if (bundle && (!init || (init.method ?? "GET") === "GET")) {
    const hit = resolveFromExport(bundle, path);
    if (hit !== undefined) return hit as T;
  }
  const res = await fetch(
    appPath(path),
    init ? { headers: { "content-type": "application/json" }, ...init } : undefined,
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || String(res.status));
  }
  return res.json() as Promise<T>;
}

// A session's display name for its kind, used when the agent didn't set a title.
export const sessionKindLabel = (kind: SessionKind | undefined) =>
  kind === "review" ? "PR Review" : "Visualization";

// Name a session by what it is: the agent-set title, else its kind — never the
// agent that authored it.
export const sessionLabel = (s: Session & { kind?: SessionKind }) =>
  s.title || sessionKindLabel(s.kind);

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
