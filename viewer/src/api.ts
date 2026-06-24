// Thin client over the REST API, typed against the server's data model.
import type {
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
  SurfacePart,
  TerminalPart,
  TracePart,
  TraceStep,
} from "../../server/types.ts";
import { basePath } from "./host.ts";

export type {
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
  SurfacePart,
  TerminalPart,
  TracePart,
  TraceStep,
};

export type PublicReadMode = "session" | "full";

// GET /api/sessions decorates each session with its surface count.
export interface SessionRow extends Session {
  surfaceCount: number;
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
  }
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

export const sessionLabel = (s: Session) => s.title || s.agent + " session";

export function relTime(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
