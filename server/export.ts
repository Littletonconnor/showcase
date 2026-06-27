// Static export: bake a whole session into one self-contained, read-only HTML
// file you can send anyone — no server, no network. The trick is that the viewer
// is a normal SPA that fetches `/api/*` and renders sandboxed parts as `srcdoc`
// iframes (already offline-capable). So an export is just: inline the session's
// data + assets into a copy of the viewer HTML and flip it into read-only mode.
// The viewer's `api()` layer reads `window.__SHOWCASE_EXPORT__` instead of the
// network when present (see viewer/src/api.ts), and `__SHOWCASE_READONLY__`
// disables the comment/Approve machinery — so the file is live-bits-free.
//
// Runtime-agnostic (no node imports): asset bytes → base64 via `encodeBase64`
// (the `btoa` global). Wired from server/app.ts.

import { encodeBase64 } from "./base64.ts";
import { collectAssetIds, type Comment, type Store, type Surface } from "./types.ts";

// Kept in sync with app.ts FINDING_LABELS / isResolutionText (and the viewer's),
// so an exported session shows the same sidebar open-count it had live.
const FINDING_LABELS = new Set(["Bug", "Nit", "Question", "Praise"]);
const isResolutionText = (t: string) => t.startsWith("✓ Approved") || t.startsWith("⊘ Dismissed");
// Review-shaped badge labels (findings + verdicts + the `showcase review`
// placeholder) — a session carrying any of them is a PR review, else a
// visualization. Kept in sync with app.ts so an export labels sessions the same.
const REVIEW_BADGE_LABELS = new Set([
  ...FINDING_LABELS,
  "Request changes",
  "Approve",
  "Comments",
  "In review",
]);

// A shared export shouldn't reveal which model/tool produced it. The agent's
// identity lives in `session.agent` (rendered in the header + sidebar + agent
// mark) and as the `author` on its own comments — so we genericize both, in the
// bundle itself, so it leaks from neither the UI nor the raw HTML source. The
// `user`/`surface` authors are preserved so the viewer still tells them apart.
const REDACTED_AGENT = "agent";
const redactAuthor = (author: string) =>
  author === "user" || author === "surface" ? author : REDACTED_AGENT;

// The inlined payload the viewer reads in place of the network. Shapes mirror the
// `/api/*` responses the viewer expects (see viewer/src/api.ts interception).
export interface ExportBundle {
  sessionId: string;
  // GET /api/sessions — the one decorated session row.
  sessions: unknown[];
  // GET /api/sessions/:id/surfaces and /api/surfaces/:id both resolve from here.
  surfaces: Surface[];
  // GET /api/comments?session=… → { comments }.
  comments: Comment[];
  // assetId → a `data:` URI, so `/a/:id` references render with no server.
  assets: Record<string, string>;
}

// Collect every asset id any version of any surface references, resolve each to
// a `data:` URI. A surface can reference an asset owned by another session
// (content-addressed dedup), so we resolve by id via the store, not by owner.
async function inlineAssets(store: Store, surfaces: Surface[]): Promise<Record<string, string>> {
  const ids = new Set<string>();
  for (const s of surfaces) {
    collectAssetIds(s.parts, ids);
    for (const h of s.history) collectAssetIds(h.parts, ids);
  }
  const assets: Record<string, string> = {};
  for (const id of ids) {
    const asset = await store.getAsset(id);
    if (asset) assets[id] = `data:${asset.contentType};base64,${encodeBase64(asset.data)}`;
  }
  return assets;
}

// Build the inlined bundle for a session, or null if the session is unknown.
export async function buildExportBundle(
  store: Store,
  sessionId: string,
): Promise<ExportBundle | null> {
  const session = await store.getSession(sessionId);
  if (!session) return null;
  const surfaces = await store.listSurfaces(sessionId);
  const comments = await store.listComments({ sessionId });
  const assets = await inlineAssets(store, surfaces);

  const resolved = new Set<string>();
  for (const cm of comments) {
    if (cm.surfaceId && cm.author === "user" && isResolutionText(cm.text))
      resolved.add(cm.surfaceId);
  }
  const openFindings = surfaces.filter(
    (s) => s.badge && FINDING_LABELS.has(s.badge.label) && !resolved.has(s.id),
  ).length;
  const kind = surfaces.some((s) => s.badge && REVIEW_BADGE_LABELS.has(s.badge.label))
    ? "review"
    : "visual";

  return {
    sessionId,
    sessions: [
      {
        ...session,
        agent: REDACTED_AGENT,
        surfaceCount: surfaces.length,
        openFindings,
        kind,
        listening: false,
      },
    ],
    surfaces,
    comments: comments.map((c) => ({ ...c, author: redactAuthor(c.author) })),
    assets,
  };
}

// Embed an object as a JS literal inside a <script>. JSON is valid JS, so we just
// neutralize what could break out of the script element or a JS string: `<` (→
// `</script>`, `<!--`) and the two raw line separators U+2028 / U+2029. The regex
// is built from char codes so this source file stays pure ASCII.
const SCRIPT_UNSAFE = new RegExp("[<" + String.fromCharCode(0x2028, 0x2029) + "]", "g");
function toScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

// Inject the bundle + read-only flag into the viewer HTML, before </head> so it
// runs before the app script (mirrors app.ts withViewerConfig). Base path is
// forced to "" so the file works opened from disk at any path. `flatten` is the
// PDF path: it sets __SHOWCASE_FLATTEN__ so the viewer renders rich parts inline
// (in document flow) instead of in srcdoc iframes — iframes can't be split
// across print page breaks, so flattening is what lets a long diff/markdown
// paginate cleanly when the file is printed to PDF (see SandboxedPart).
export function renderExportHtml(
  viewerHtml: string,
  bundle: ExportBundle,
  flatten = false,
): string {
  const script =
    `<script>window.__SHOWCASE_BASE_PATH__="";` +
    `window.__SHOWCASE_READONLY__=true;` +
    (flatten ? `window.__SHOWCASE_FLATTEN__=true;` : ``) +
    `window.__SHOWCASE_EXPORT__=${toScriptLiteral(bundle)};</script>`;
  const headClose = viewerHtml.lastIndexOf("</head>");
  return headClose >= 0
    ? `${viewerHtml.slice(0, headClose)}${script}${viewerHtml.slice(headClose)}`
    : `${script}${viewerHtml}`;
}

// A filesystem-safe filename for a session's export.
export function exportFilename(title: string | null | undefined, sessionId: string): string {
  const slug = (title ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `showcase-${slug || sessionId}.html`;
}
