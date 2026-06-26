import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { decodeBase64 } from "./base64.ts";
import { EventBus } from "./events.ts";
import { kitSummaries } from "./kits.ts";
import { registerMcp } from "./mcpHttp.ts";
import { renderHtmlPage } from "./surfacePage.ts";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";
import {
  type Asset,
  type AssetKind,
  type Comment,
  type CommentAnchor,
  htmlPart,
  MAX_ASSET_BYTES,
  partsByteLength,
  type Store,
  type Surface,
  type SurfaceBadge,
  type SurfacePart,
} from "./types.ts";
import { coerceSurfaceBadge, validateSurfaceParts } from "./surfaceParts.ts";

const MAX_SURFACE_BYTES = 2 * 1024 * 1024;
const MAX_WAIT_SECONDS = 300;
// Hard ceiling on any request body, applied globally. Every write endpoint
// reads its body with an unbounded `c.req.json()` (and /mcp likewise), so
// without this a single oversize POST is an out-of-memory flood — and the local
// default ships with no auth token, so those endpoints are reachable
// unauthenticated. Sized to clear the largest legitimate body — a base64 asset
// uploaded over MCP, ~4/3 of the 5 MiB asset cap — while still bounding a flood.
// The /api/assets route's own 5 MiB streaming cap is stricter and still applies.
const MAX_BODY_BYTES = 16 * 1024 * 1024;
// A comment's text and a surface's title both ride the feedback channel back to
// the agent (feedbackView below), re-sent on every poll — so cap them at the
// edge to keep one oversize value from bloating the agent's context forever.
const MAX_COMMENT_TEXT = 8000;
const MAX_TITLE = 500;

// Feedback batching: a parked author=user wait normally wakes on the first
// comment, which means a second message the user is still typing misses the
// turn. Instead, once the first comment lands the wait stays open until the
// user goes quiet: no new comment for SETTLE_MS *and* no "composing" heartbeat
// from a focused viewer composer for COMPOSING_TTL_MS — bounded by MAX_BATCH_MS
// so a stuck heartbeat can't pin the agent forever. Tune these to taste.
const FEEDBACK_SETTLE_MS = 800;
const FEEDBACK_COMPOSING_TTL_MS = 3000;
const FEEDBACK_MAX_BATCH_MS = 25000;
const FEEDBACK_POLL_MS = 250;

// Asset serving policy: only raster images are served inline; everything else
// (incl. svg, json, text, the octet-stream catch-all) is an attachment, so a
// top-level open of /a/:id can never execute an uploaded document as a live
// same-origin script. <img>/fetch ignore Content-Disposition, so embedding and
// inline trace rendering keep working regardless.
const INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const ATTACH_SAFE_TYPES = new Set([
  "image/svg+xml",
  "application/json",
  "application/x-ndjson",
  "text/plain",
  "text/csv",
]);

function assetServeHeaders(asset: Asset): { contentType: string; disposition: string } {
  if (INLINE_IMAGE_TYPES.has(asset.contentType)) {
    return { contentType: asset.contentType, disposition: "inline" };
  }
  const contentType = ATTACH_SAFE_TYPES.has(asset.contentType)
    ? asset.contentType
    : "application/octet-stream";
  const name = (asset.filename || asset.id).replace(/[^\w.-]/g, "_");
  return { contentType, disposition: `attachment; filename="${name}"` };
}

// Pick an AssetKind when the caller didn't specify one.
function inferAssetKind(contentType: string): AssetKind {
  return contentType.startsWith("image/") ? "image" : "file";
}

const isAssetKind = (v: unknown): v is AssetKind => v === "image" || v === "trace" || v === "file";

// base64 -> bytes, runtime-agnostic (atob is a global in Node and Workers).
// Docs and onboarding snippets are written against the local default; serve
// them with the real origin so a deployed instance shows copy-pasteable URLs.
const LOCAL_ORIGIN = "http://localhost:8229";

export type AuthenticateHook = (
  request: Request,
) => boolean | Response | Promise<boolean | Response>;

export type BasePathHook = string | ((request: Request) => string | null | undefined);
export type PublicReadMode = "session" | "full";

export interface AppOptions {
  store: Store;
  viewerHtml: string;
  guideMarkdown: string;
  setupText: string;
  agentHowtoText?: string;
  // Dev-only live reload. When true, the served viewer HTML gets a tiny
  // reconnecting EventSource snippet and a GET /api/livereload endpoint that
  // streams this process's boot id. `npm run dev` rebuilds viewer/dist and
  // restarts the server on change; the new process has a new boot id, so
  // connected browsers see it on reconnect and refresh. Never set in production
  // (the route is unregistered and the snippet is not injected).
  dev?: boolean;
  // When set (cloud deployments), this hook authorizes requests before any
  // app route runs. Return true to allow, false to use the default 401, or a
  // Response for custom denials. This is intentionally lower-level than
  // authToken so hosts can validate edge-signed assertions without teaching
  // showcase about their session/token systems.
  authenticate?: AuthenticateHook;
  // When set (self-hosted Worker deployments), every route except /guide,
  // /setup, and /agent-howto requires it: Authorization bearer, ?key= query,
  // or the cookie it sets. Preserved for backwards compatibility.
  authToken?: string;
  // Public path prefix for deployments mounted below an origin root, e.g.
  // /u/:account in a hosted multi-tenant wrapper. The core still receives
  // stripped routes like /api/sessions and /s/:id?part=0; this prefix is only
  // used when the server/viewer generate browser-visible URLs.
  basePath?: BasePathHook;
  // When set, unauthenticated GET routes can be read without bypassing the
  // write token. "session" exposes only session-scoped reads; "full" exposes
  // every GET route.
  publicRead?: PublicReadMode;
  // Update notice: the running version and the upgrade hint that fits this
  // deployment (npm install vs redeploy). Without `version`, /api/version
  // reports nothing and the viewer shows no notice.
  version?: string;
  upgradeCommand?: string;
  // Test seam: replaces the npm-registry/GitHub lookup for the latest release.
  fetchLatestRelease?: () => Promise<LatestRelease | null>;
}

export interface LatestRelease {
  version: string;
  notes?: string;
}

// Newer-than for plain x.y.z strings; prerelease suffixes compare as their
// base version, and garbage compares as "not newer".
function versionGt(a: string, b: string): boolean {
  const pa = a.split("-")[0].split(".").map(Number);
  const pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

// Latest published version from npm, release notes from the matching GitHub
// release. Notes are garnish: if GitHub is unreachable the version alone
// still makes a usable notice.
async function fetchLatestFromRegistry(): Promise<LatestRelease | null> {
  const res = await fetch("https://registry.npmjs.org/showcase/latest");
  if (!res.ok) return null;
  const pkg = (await res.json()) as { version?: string };
  if (typeof pkg.version !== "string") return null;
  let notes: string | undefined;
  try {
    const gh = await fetch(
      `https://api.github.com/repos/modem-dev/showcase/releases/tags/v${pkg.version}`,
      { headers: { "user-agent": "showcase", accept: "application/vnd.github+json" } },
    );
    if (gh.ok) {
      const rel = (await gh.json()) as { body?: string };
      if (typeof rel.body === "string") notes = rel.body;
    }
  } catch {
    // ignore — see above
  }
  return { version: pkg.version, notes };
}

const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

// html parts carry arbitrary markup the viewer renders via a sandboxed iframe,
// so the card list never needs their bodies — strip them to a kind marker.
// diff parts are structured data the viewer renders inline, so keep them whole.
const stripParts = (parts: SurfacePart[]): SurfacePart[] =>
  parts.map((p) => (p.kind === "html" ? { kind: "html", html: "" } : p));

const surfaceMeta = (s: Surface) => ({
  id: s.id,
  sessionId: s.sessionId,
  title: s.title,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  version: s.version,
  parts: stripParts(s.parts),
  ...(s.badge ? { badge: s.badge } : {}),
  ...(s.pinned ? { pinned: true } : {}),
});

function isPublicReadAllowed(path: string, mode: PublicReadMode): boolean {
  if (mode === "full") return true;
  if (path.startsWith("/session/")) return true;
  if (path.startsWith("/s/")) return true;
  if (path.startsWith("/a/")) return true;
  if (path.startsWith("/api/sessions/")) return true;
  if (path.startsWith("/api/surfaces/")) return true;
  if (path.startsWith("/api/snippets/")) return true;
  if (path === "/api/comments") return true;
  if (path === "/api/events") return true;
  if (path === "/api/version") return true;
  if (path === "/api/kits") return true;
  return false;
}

// Response to an agent's own write: it already holds the parts it just sent,
// so echo only the identifiers (a diff patch can be large — never send it
// back). Reads (`surfaceMeta`, GET /api/surfaces/:id) still carry parts.
const writeResult = (s: Surface) => ({
  id: s.id,
  sessionId: s.sessionId,
  title: s.title,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  version: s.version,
  kinds: s.parts.map((p) => p.kind),
  ...(s.badge ? { badge: s.badge } : {}),
});

export interface CommentWait {
  sessionId?: string;
  surfaceId?: string;
  author?: string;
  afterSeq?: number;
  waitSeconds: number;
}

export interface Feedback {
  surfaceId: string | null;
  surfaceTitle: string | null;
  text: string;
  at: string;
  // Present when the user pinned the comment to a spot on the surface: a point
  // (0..1 fractions of the card) for a diagram/image, or a `line` number for a
  // diff line — so the agent knows exactly what they're pointing at.
  anchor?: CommentAnchor;
}

// Lean comment shape attached to agent-facing responses.
const feedbackView = (c: Comment): Feedback => ({
  surfaceId: c.surfaceId,
  surfaceTitle: c.surfaceTitle,
  text: c.text,
  at: c.createdAt,
  ...(c.anchor ? { anchor: c.anchor } : {}),
});

// Validate a comment anchor from request input: a point as 0..1 fractions of the
// card. Out-of-range values clamp; anything malformed yields undefined.
const LINE_TYPES = new Set(["context", "addition", "deletion"]);

// A comment anchor from request input → a validated point OR line anchor (see
// CommentAnchor). A line anchor (a clicked diff/code line) takes precedence; a
// point anchor falls back to xPct/yPct. Returns undefined when neither is valid.
function parseAnchor(raw: unknown): CommentAnchor | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as { xPct?: unknown; yPct?: unknown; line?: unknown; lineType?: unknown };
  const line = Number(a.line);
  if (Number.isInteger(line) && line > 0) {
    const lineType =
      typeof a.lineType === "string" && LINE_TYPES.has(a.lineType)
        ? (a.lineType as CommentAnchor["lineType"])
        : undefined;
    return { line, ...(lineType ? { lineType } : {}) };
  }
  const x = Number(a.xPct);
  const y = Number(a.yPct);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return { xPct: clamp(x), yPct: clamp(y) };
}

// review_finding: the structured review primitive. The agent passes plain
// fields and showcase COMPOSES the multimodal finding card — so producing a
// broken-down, visual review (severity badge + explanation + inline diff +
// optional diagram) is less effort than dumping one markdown wall, which is why
// reviews regressed to prose. `severity` picks the badge; `file`/`line` ride the
// title; `problem`/`fix` become a structured markdown part; `patch` renders as
// an inline diff and `diagram` as a mermaid.
const FINDING_SEVERITY: Record<string, SurfaceBadge> = {
  bug: { tone: "critical", label: "Bug" },
  nit: { tone: "warning", label: "Nit" },
  question: { tone: "info", label: "Question" },
  praise: { tone: "success", label: "Praise" },
  note: { tone: "neutral", label: "Note" },
};

// Agents routinely double-escape multi-paragraph prose, so a `summary`/`problem`
// arrives with the literal two characters "\n" where a newline was meant — which
// markdown then renders as visible "\n" text instead of a paragraph break. Turn
// those literal escapes back into real whitespace. Applied only to prose fields
// (never to a `patch`/`suggestion`, where a backslash-n may be real content).
function normalizeProse(s: string): string {
  return s
    .replace(/\\r\\n|\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .trim();
}

export interface FindingInput {
  severity?: string;
  title: string;
  file?: string;
  line?: number;
  problem: string;
  fix?: string;
  // A concrete fix as a before→after pair. The viewer computes the diff from the
  // two contents (parseDiffFromFile), so it ALWAYS renders the change — unlike a
  // hand-crafted `patch`, which shows an empty "−0 +0" diff whenever the agent
  // sends a bare hunk or malformed unified diff. Prefer this for fixes.
  suggestion?: { before: string; after: string };
  patch?: string;
  diagram?: string;
}

// A finding card reads top-to-bottom as one thought: what's wrong, the concrete
// change, why it's better, and (optionally) how it fits. The structure is fixed
// so every finding in every review looks the same — the reviewer can scan it
// without re-learning the layout per card.
function buildFinding(input: FindingInput): {
  title: string;
  badge: SurfaceBadge;
  parts: SurfacePart[];
} {
  const badge = FINDING_SEVERITY[input.severity ?? "note"] ?? FINDING_SEVERITY.note;
  const loc = input.file
    ? ` — ${input.file}${Number.isInteger(input.line) ? `:${input.line}` : ""}`
    : "";
  const title = `${input.title.trim()}${loc}`.slice(0, MAX_TITLE);
  const fix = input.fix ? normalizeProse(input.fix) : undefined;
  const problem = normalizeProse(input.problem);
  const s = input.suggestion;
  const hasSuggestion = !!s && (!!s.before?.trim() || !!s.after?.trim());

  const parts: SurfacePart[] = [];
  // Lead: the problem. When there's a suggestion diff, `fix` becomes the
  // rationale UNDER the change ("why it's better"); without one, it stays inline
  // as the textual fix so prose-only findings still carry a recommendation.
  parts.push({
    kind: "markdown",
    markdown:
      fix && !hasSuggestion
        ? `**Problem** — ${problem}\n\n**Fix** — ${fix}`
        : `**Problem** — ${problem}`,
  });
  if (hasSuggestion) {
    parts.push({
      kind: "diff",
      files: [
        {
          filename: input.file ?? "suggestion",
          before: s.before ?? "",
          after: s.after ?? "",
        },
      ],
    });
    if (fix) parts.push({ kind: "markdown", markdown: `**Why it's better** — ${fix}` });
  } else if (input.patch?.trim()) {
    // Fallback: a raw unified patch (e.g. the PR's actual change, in context).
    parts.push({ kind: "diff", patch: input.patch });
  }
  if (input.diagram?.trim()) parts.push({ kind: "mermaid", mermaid: input.diagram.trim() });
  return { title, badge, parts };
}

// Coerce loosely-typed request/tool args into a FindingInput — shared by the
// REST routes (findings + reviews) and both MCP transports so the finding shape
// is parsed in exactly one place.
export function coerceFinding(raw: any): FindingInput {
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const sg = raw?.suggestion;
  const suggestion =
    sg && (typeof sg.before === "string" || typeof sg.after === "string")
      ? {
          before: typeof sg.before === "string" ? sg.before : "",
          after: typeof sg.after === "string" ? sg.after : "",
        }
      : undefined;
  return {
    severity: str(raw?.severity),
    title: String(raw?.title ?? ""),
    file: str(raw?.file),
    line: typeof raw?.line === "number" ? raw.line : undefined,
    problem: String(raw?.problem ?? ""),
    fix: str(raw?.fix),
    suggestion,
    patch: str(raw?.patch),
    diagram: str(raw?.diagram),
  };
}

// Coerce a loosely-typed `churn` array ([{file, added, removed}]) — shared by
// the REST reviews route and both MCP transports. buildChurnChart does the
// heavier filtering, so this just narrows the field types.
export function coerceChurn(
  raw: any,
): Array<{ file?: string; added?: number; removed?: number }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((c) => ({
    file: typeof c?.file === "string" ? c.file : undefined,
    added: typeof c?.added === "number" ? c.added : undefined,
    removed: typeof c?.removed === "number" ? c.removed : undefined,
  }));
}

// Coerce a loosely-typed change map ({nodes, edges}) — shared by the REST
// reviews route and both MCP transports. buildChangeMap does the validation;
// this just narrows the field types.
export function coerceChangeMap(raw: any): ChangeMapInput | undefined {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.nodes)) return undefined;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    nodes: raw.nodes.map((n: any) => ({
      id: str(n?.id),
      label: str(n?.label),
      status: str(n?.status),
      kind: str(n?.kind),
    })),
    edges: Array.isArray(raw.edges)
      ? raw.edges.map((e: any) => ({ from: str(e?.from), to: str(e?.to), label: str(e?.label) }))
      : [],
  };
}

// publish_review: the WHOLE review in one call. The agent submits its verdict +
// a findings[] array; showcase explodes it into a verdict card plus one finding
// card per entry (each composed by buildFinding). One call, same effort as a
// markdown dump, but it physically cannot be a wall of text — the structure is
// the API, so this is the most enforcing path to a broken-down visual review.
const REVIEW_VERDICT: Record<string, SurfaceBadge> = {
  request_changes: { tone: "warning", label: "Request changes" },
  approve: { tone: "success", label: "Approve" },
  comment: { tone: "neutral", label: "Comments" },
};

// The `showcase review` scaffold seeds a placeholder card with this badge label;
// publish_review reuses that card as the verdict (revises it in place) so the
// scaffold EVOLVES into the verdict instead of leaving a duplicate above the
// review. Keep in sync with the badge `bin/showcase.js` review() sets.
const REVIEW_PLACEHOLDER_LABEL = "In review";

// The verdict card's body: the summary, a scannable findings table, and a
// coverage note — built from the same findings[] the cards are.
function buildVerdictMarkdown(input: {
  branch?: string;
  base?: string;
  summary?: string;
  coverage?: string;
  findings: FindingInput[];
}): string {
  const lines: string[] = [];
  if (input.branch) {
    lines.push(`Reviewing **\`${input.branch}\`**${input.base ? ` vs \`${input.base}\`` : ""}.`);
  }
  if (input.summary?.trim()) lines.push(normalizeProse(input.summary));
  const real = input.findings.filter((f) => f.title?.trim() && f.problem?.trim());
  // A table cell can't hold newlines or unescaped pipes, so collapse them.
  const cell = (s: string) =>
    normalizeProse(s)
      .replace(/\s*\n\s*/g, " ")
      .replace(/\|/g, "\\|");
  if (real.length > 0) {
    // A one-line severity tally above the table, so the weight of the review is
    // legible at a glance even when the findings list is long.
    const tally = new Map<string, number>();
    for (const f of real) {
      const label = FINDING_SEVERITY[f.severity ?? "note"]?.label ?? "Note";
      tally.set(label, (tally.get(label) ?? 0) + 1);
    }
    const order = ["Bug", "Nit", "Question", "Note", "Praise"];
    const parts = [...tally.entries()]
      .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
      .map(([label, n]) => `${n} ${label}${n > 1 && label !== "Praise" ? "s" : ""}`);
    lines.push("");
    lines.push(`**${real.length} finding${real.length > 1 ? "s" : ""}** — ${parts.join(" · ")}`);
    lines.push("");
    lines.push("| Severity | Finding | Location |");
    lines.push("| --- | --- | --- |");
    for (const f of real) {
      const sev = FINDING_SEVERITY[f.severity ?? "note"]?.label ?? "Note";
      const loc = f.file ? `\`${f.file}${Number.isInteger(f.line) ? `:${f.line}` : ""}\`` : "—";
      lines.push(`| ${sev} | ${cell(f.title)} | ${loc} |`);
    }
  }
  if (input.coverage?.trim()) {
    lines.push("");
    lines.push(`**Coverage** — ${normalizeProse(input.coverage)}`);
  }
  return lines.join("\n") || "_Review in progress._";
}

// The change map: the headline review visual — the changed pieces and how they
// interact. The agent passes structure (nodes tagged new/modified/touched/
// removed + labeled edges); showcase emits a styled mermaid so every map looks
// the same and reads at a glance. Status colors are stroke+text only (no baked
// fill) so they stay legible in both light and dark without re-theming.
const CHANGE_STATUS: Record<string, string> = {
  new: "stroke:#2f9e44,color:#2f9e44,stroke-width:1.5px",
  modified: "stroke:#d9870a,color:#d9870a,stroke-width:1.5px",
  touched: "stroke:#9aa0a6,color:#9aa0a6",
  removed: "stroke:#e03131,color:#e03131,stroke-width:1.5px,stroke-dasharray:4 3",
};

export interface ChangeMapInput {
  nodes: Array<{ id?: string; label?: string; status?: string; kind?: string }>;
  edges?: Array<{ from?: string; to?: string; label?: string }>;
}

function buildChangeMap(map: ChangeMapInput): SurfacePart | undefined {
  const nodes = Array.isArray(map?.nodes) ? map.nodes : [];
  const valid = nodes.filter(
    (n) => n && typeof n.id === "string" && n.id.trim() && n.label?.trim(),
  );
  if (valid.length === 0) return undefined;

  // Map agent ids → safe mermaid identifiers (n0, n1, …); labels carry the real
  // names, escaped so a quote/newline can't break the diagram syntax.
  const id = new Map<string, string>();
  valid.forEach((n, i) => id.set(n.id as string, `n${i}`));
  const esc = (s: string) =>
    s
      .replace(/["\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const shape = (kind: string | undefined, label: string) => {
    const t = esc(label);
    if (kind === "table" || kind === "store" || kind === "db") return `[("${t}")]`; // cylinder
    if (kind === "external" || kind === "actor" || kind === "service") return `(["${t}"])`; // stadium
    return `["${t}"]`; // rounded rect
  };

  const lines = ["flowchart LR"];
  const used = new Set<string>();
  for (const n of valid) {
    const status =
      typeof n.status === "string" && Object.hasOwn(CHANGE_STATUS, n.status) ? n.status : "touched";
    used.add(status);
    lines.push(`  ${id.get(n.id as string)}${shape(n.kind, n.label as string)}:::${status}`);
  }
  for (const e of Array.isArray(map?.edges) ? map.edges! : []) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
    if (!id.has(e.from) || !id.has(e.to)) continue;
    const label = e.label?.trim() ? `|"${esc(e.label)}"|` : "";
    lines.push(`  ${id.get(e.from)} -->${label} ${id.get(e.to)}`);
  }
  for (const s of used) lines.push(`  classDef ${s} ${CHANGE_STATUS[s]};`);
  return { kind: "mermaid", mermaid: lines.join("\n") };
}

// Churn added green / removed red — the diff convention, matched to the inline
// finding diffs.
const CHURN_ADDED = "#2f9e44";
const CHURN_REMOVED = "#e03131";

// Build a "churn by file" bar chart (added/removed lines per file) for the
// verdict card — the at-a-glance shape of the PR. Files are ranked by total
// churn and capped so the axis stays legible on a large PR; labels are the
// basename (truncated) since the full path won't fit an x tick.
function buildChurnChart(
  churn: Array<{ file?: string; added?: number; removed?: number }>,
): SurfacePart | undefined {
  const rows = churn
    .map((c) => ({
      file: typeof c?.file === "string" ? c.file : "",
      added: Number.isFinite(c?.added) ? Number(c?.added) : 0,
      removed: Number.isFinite(c?.removed) ? Number(c?.removed) : 0,
    }))
    .filter((c) => c.file && c.added + c.removed > 0)
    .sort((a, b) => b.added + b.removed - (a.added + a.removed));
  if (rows.length === 0) return undefined;

  const MAX_FILES = 10;
  const shown = rows.slice(0, MAX_FILES);
  const label = (path: string) => {
    const base = path.split("/").pop() || path;
    return base.length > 18 ? `…${base.slice(-17)}` : base;
  };
  // Disambiguate identical basenames so the x axis doesn't collapse two files.
  const seen = new Map<string, number>();
  const data = shown.map((r) => {
    let name = label(r.file);
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    return { file: name, added: r.added, removed: r.removed };
  });
  const extra = rows.length - shown.length;
  const total = rows.reduce((s, r) => s + r.added + r.removed, 0);
  const caption =
    `Churn by file — ${rows.length} file${rows.length > 1 ? "s" : ""}, ${total} lines` +
    (extra > 0 ? ` (top ${MAX_FILES} shown)` : "");
  return {
    kind: "chart",
    chartType: "bar",
    data,
    x: "file",
    y: ["added", "removed"],
    stacked: true,
    colors: [CHURN_ADDED, CHURN_REMOVED],
    yLabel: "lines",
    caption,
  };
}

export function createApp({
  store,
  viewerHtml,
  guideMarkdown,
  setupText,
  agentHowtoText = setupText,
  dev = false,
  authenticate,
  authToken,
  basePath,
  publicRead,
  version,
  upgradeCommand,
  fetchLatestRelease,
}: AppOptions) {
  const app = new Hono();
  const bus = new EventBus();

  // Agent presence: count of active wait_for_feedback waiters per session (an
  // author=user comment long-poll). A session is "listening" while a terminal
  // agent is parked waiting on it; the viewer shows this live. Transitions at
  // the 0↔1 boundary broadcast an agent-presence event.
  const waiters = new Map<string, number>();
  const isListening = (sessionId: string) => (waiters.get(sessionId) ?? 0) > 0;
  const addWaiter = (sessionId: string) => {
    const n = (waiters.get(sessionId) ?? 0) + 1;
    waiters.set(sessionId, n);
    if (n === 1) bus.broadcast({ type: "agent-presence", sessionId, listening: true });
  };
  const removeWaiter = (sessionId: string) => {
    const n = (waiters.get(sessionId) ?? 1) - 1;
    if (n <= 0) {
      waiters.delete(sessionId);
      bus.broadcast({ type: "agent-presence", sessionId, listening: false });
    } else {
      waiters.set(sessionId, n);
    }
  };

  // "User is composing" heartbeats per session: the viewer pings while a comment
  // composer is focused or being typed in, so a parked author=user wait can hold
  // its batch open until the user finishes queueing messages (see the batching
  // constants above and waitForComments below).
  const composingAt = new Map<string, number>();
  const markComposing = (sessionId: string) => composingAt.set(sessionId, Date.now());
  const isComposing = (sessionId: string, now: number) =>
    now - (composingAt.get(sessionId) ?? 0) < FEEDBACK_COMPOSING_TTL_MS;

  // Last-resort safety net: any handler that throws (rather than returning a
  // status) becomes a clean JSON 500 instead of leaking a stack or a bare crash.
  // Validation rejects bad input with 4xx before this, so reaching here means an
  // unexpected bug — log it so it isn't swallowed silently.
  app.onError((err, c) => {
    console.error("showcase: unhandled error", err);
    return c.json({ error: "internal error" }, 500);
  });

  const normalizeBasePath = (value: string | null | undefined): string => {
    if (!value || value === "/") return "";
    const withLeading = value.startsWith("/") ? value : `/${value}`;
    let end = withLeading.length;
    while (end > 0 && withLeading.charCodeAt(end - 1) === 47) end--;
    return withLeading.slice(0, end);
  };
  const requestBasePath = (request: Request): string =>
    normalizeBasePath(typeof basePath === "function" ? basePath(request) : basePath);

  // Cached, fail-silent update lookup: being offline or rate-limited must
  // cost nothing but the absence of the notice. Failures are cached too, so
  // a dead network doesn't retry on every viewer load.
  let updateCache: { at: number; value: LatestRelease | null } | null = null;
  async function latestRelease(): Promise<LatestRelease | null> {
    if (updateCache && Date.now() - updateCache.at < UPDATE_CHECK_TTL_MS) return updateCache.value;
    const value = await (fetchLatestRelease ?? fetchLatestFromRegistry)().catch(() => null);
    updateCache = { at: Date.now(), value };
    return value;
  }

  // --- shared flows (used by both the REST API and the MCP endpoint) ---

  // User comments the agent has not seen yet ride along on its next write, so
  // agents hear feedback without blocking on the long-poll. The cursor also
  // advances past the agent's own comments to keep reads cheap.
  async function collectFeedback(sessionId: string): Promise<Feedback[] | undefined> {
    const session = await store.getSession(sessionId);
    if (!session) return undefined;
    const fresh = await store.listComments({ sessionId, afterSeq: session.agentSeq });
    if (fresh.length === 0) return undefined;
    await store.markAgentSeen(sessionId, fresh[fresh.length - 1].seq);
    const feedback = fresh.filter((cm) => cm.author === "user");
    return feedback.length > 0 ? feedback.map(feedbackView) : undefined;
  }

  async function publishSurface(input: {
    parts: SurfacePart[];
    title?: string;
    badge?: SurfaceBadge;
    session?: string;
    sessionTitle?: string;
    agent?: string;
    cwd?: string;
  }): Promise<
    { surface: Surface; userFeedback?: Feedback[] } | { error: string; status: 400 | 404 | 413 }
  > {
    if (input.parts.length === 0) {
      return { error: "a surface needs at least one part", status: 400 };
    }
    if (partsByteLength(input.parts) > MAX_SURFACE_BYTES) {
      return { error: `surface exceeds ${MAX_SURFACE_BYTES} bytes`, status: 413 };
    }
    let sessionId = input.session;
    if (sessionId && !(await store.getSession(sessionId))) {
      return { error: `session "${sessionId}" not found`, status: 404 };
    }
    if (!sessionId) {
      // sessionTitle applies only here — an existing session keeps its title,
      // which the user may have set by renaming it in the viewer.
      const session = await store.createSession({
        agent: input.agent ?? "agent",
        title: input.sessionTitle?.slice(0, MAX_TITLE),
        cwd: input.cwd,
      });
      bus.broadcast({ type: "session-created", id: session.id });
      sessionId = session.id;
    }
    const surface = await store.createSurface({
      sessionId,
      parts: input.parts,
      title: input.title?.slice(0, MAX_TITLE),
      badge: input.badge,
    });
    if (!surface) return { error: "session not found", status: 404 };
    bus.broadcast({ type: "surface-created", id: surface.id, sessionId, version: 1 });
    return { surface, userFeedback: await collectFeedback(sessionId) };
  }

  // Compose + publish a structured review finding (see buildFinding). The agent
  // hands over fields; showcase builds the badge + explanation + inline diff +
  // diagram card and routes it through publishSurface.
  async function publishFinding(
    input: FindingInput & { session?: string; sessionTitle?: string; agent?: string; cwd?: string },
  ): Promise<
    { surface: Surface; userFeedback?: Feedback[] } | { error: string; status: 400 | 404 | 413 }
  > {
    if (!input.title?.trim() || !input.problem?.trim()) {
      return { error: '"title" and "problem" are required', status: 400 };
    }
    const { title, badge, parts } = buildFinding(input);
    return publishSurface({
      parts,
      title,
      badge,
      session: input.session,
      sessionTitle: input.sessionTitle,
      agent: input.agent,
      cwd: input.cwd,
    });
  }

  // Publish a whole structured review in one call: a verdict card + one finding
  // card per findings[] entry, all in one session. The most enforcing review
  // path — the structure is the API, so the output can't regress to prose.
  async function publishReview(input: {
    verdict?: string;
    branch?: string;
    base?: string;
    summary?: string;
    coverage?: string;
    architecture?: string;
    changeMap?: ChangeMapInput;
    churn?: Array<{ file?: string; added?: number; removed?: number }>;
    findings: FindingInput[];
    session?: string;
    sessionTitle?: string;
    agent?: string;
    cwd?: string;
  }): Promise<
    | { session: string; verdict: string; findings: string[] }
    | { error: string; status: 400 | 404 | 413 }
  > {
    if (!Array.isArray(input.findings)) {
      return { error: '"findings" must be an array', status: 400 };
    }
    const badge = REVIEW_VERDICT[input.verdict ?? "comment"] ?? REVIEW_VERDICT.comment;
    // The verdict card is the review's map: summary + tally + findings table,
    // then the change map (the changed pieces and how they interact). A raw
    // `architecture` mermaid is the escape hatch when no structured map is given.
    const verdictParts: SurfacePart[] = [
      { kind: "markdown", markdown: buildVerdictMarkdown(input) },
    ];
    const changeMapPart = input.changeMap ? buildChangeMap(input.changeMap) : undefined;
    if (changeMapPart) verdictParts.push(changeMapPart);
    else if (input.architecture?.trim()) {
      verdictParts.push({ kind: "mermaid", mermaid: input.architecture.trim() });
    }
    const churnChart = Array.isArray(input.churn) ? buildChurnChart(input.churn) : undefined;
    if (churnChart) verdictParts.push(churnChart);
    const verdictTitle = input.branch ? `Review — ${input.branch}` : "Review verdict";

    // If this session was scaffolded by `showcase review`, reuse its "In review"
    // placeholder as the verdict card (revise in place) so it evolves from
    // pending → verdict instead of leaving an orphan above the review.
    const placeholder = input.session
      ? (await store.listSurfaces(input.session)).find(
          (s) => s.badge?.label === REVIEW_PLACEHOLDER_LABEL,
        )
      : undefined;

    let verdictSurface: Surface;
    if (placeholder) {
      const revised = await reviseSurface(placeholder.id, {
        parts: verdictParts,
        title: verdictTitle,
        badge,
      });
      if ("error" in revised) return revised;
      verdictSurface = revised.surface;
    } else {
      const verdictResult = await publishSurface({
        parts: verdictParts,
        title: verdictTitle,
        badge,
        session: input.session,
        sessionTitle: input.sessionTitle ?? (input.branch ? `Review: ${input.branch}` : undefined),
        agent: input.agent,
        cwd: input.cwd,
      });
      if ("error" in verdictResult) return verdictResult;
      verdictSurface = verdictResult.surface;
    }

    const session = verdictSurface.sessionId;
    const findings: string[] = [];
    for (const f of input.findings) {
      if (!f?.title?.trim() || !f?.problem?.trim()) continue; // skip malformed entries
      const { title, badge: fbadge, parts } = buildFinding(f);
      const r = await publishSurface({ parts, title, badge: fbadge, session });
      if (!("error" in r)) findings.push(r.surface.id);
    }
    return { session, verdict: verdictSurface.id, findings };
  }

  // Store an uploaded blob. Like publishSurface, an explicit session is
  // validated and a missing one is auto-created so an upload can precede the
  // first publish. The asset's data is dropped from the result (it's bytes).
  async function uploadAsset(input: {
    data: Uint8Array;
    contentType: string;
    filename?: string;
    kind?: AssetKind;
    session?: string;
    agent?: string;
  }): Promise<{ asset: Omit<Asset, "data"> } | { error: string; status: 400 | 404 | 413 }> {
    if (input.data.byteLength === 0) return { error: "empty upload", status: 400 };
    if (input.data.byteLength > MAX_ASSET_BYTES) {
      return { error: `asset exceeds ${MAX_ASSET_BYTES} bytes`, status: 413 };
    }
    let sessionId = input.session;
    if (sessionId && !(await store.getSession(sessionId))) {
      return { error: `session "${sessionId}" not found`, status: 404 };
    }
    if (!sessionId) {
      const session = await store.createSession({ agent: input.agent ?? "agent" });
      bus.broadcast({ type: "session-created", id: session.id });
      sessionId = session.id;
    }
    const asset = await store.putAsset({
      sessionId,
      kind: input.kind ?? inferAssetKind(input.contentType),
      contentType: input.contentType || "application/octet-stream",
      filename: input.filename,
      data: input.data,
    });
    if (!asset) return { error: "session not found", status: 404 };
    const { data: _data, ...meta } = asset;
    return { asset: meta };
  }

  async function reviseSurface(
    id: string,
    patch: { parts?: SurfacePart[]; title?: string; badge?: SurfaceBadge | null },
  ): Promise<
    { surface: Surface; userFeedback?: Feedback[] } | { error: string; status: 400 | 404 | 413 }
  > {
    if (patch.parts) {
      if (patch.parts.length === 0) {
        return { error: "a surface needs at least one part", status: 400 };
      }
      if (partsByteLength(patch.parts) > MAX_SURFACE_BYTES) {
        return { error: `surface exceeds ${MAX_SURFACE_BYTES} bytes`, status: 413 };
      }
    }
    if (patch.title !== undefined) patch.title = patch.title.slice(0, MAX_TITLE);
    const surface = await store.updateSurface(id, patch);
    if (!surface) return { error: "surface not found", status: 404 };
    bus.broadcast({
      type: "surface-updated",
      id: surface.id,
      sessionId: surface.sessionId,
      version: surface.version,
    });
    return { surface, userFeedback: await collectFeedback(surface.sessionId) };
  }

  async function createComment(input: {
    text: string;
    surface?: string;
    session?: string;
    author: string;
    anchor?: CommentAnchor;
  }): Promise<
    { comment: Comment; userFeedback?: Feedback[] } | { error: string; status: 400 | 404 }
  > {
    // A comment attaches to a surface (a remark on that card) OR to the session
    // (a session-level chat message — `surfaceId` null). One of the two is
    // required; a surface id wins and resolves its session.
    let sessionId: string;
    let surfaceId: string | undefined;
    if (input.surface) {
      const surface = await store.getSurface(input.surface);
      if (!surface) return { error: "surface not found", status: 404 };
      sessionId = surface.sessionId;
      surfaceId = surface.id;
    } else if (input.session) {
      const session = await store.getSession(input.session);
      if (!session) return { error: "session not found", status: 404 };
      sessionId = session.id;
    } else {
      return { error: 'provide a "surface" or "session" id', status: 400 };
    }
    const comment = await store.createComment({
      sessionId,
      surfaceId,
      author: input.author,
      text: input.text.trim().slice(0, MAX_COMMENT_TEXT),
      // An anchor only makes sense pinned to a surface, never session-level.
      ...(input.anchor && surfaceId ? { anchor: input.anchor } : {}),
    });
    if (!comment) return { error: "session not found", status: 404 };
    bus.broadcast({
      type: "comment-created",
      id: comment.id,
      sessionId: comment.sessionId,
      surfaceId: comment.surfaceId,
      seq: comment.seq,
    });
    // agent replies are writes too — piggyback pending feedback on them, but
    // never on the user's own comments
    const userFeedback =
      input.author === "user" ? undefined : await collectFeedback(comment.sessionId);
    return { comment, userFeedback };
  }

  // Long-poll: resolves as soon as a matching comment lands, or at timeout.
  // `signal` (the request's abort signal) ends the wait early on disconnect, so
  // a dropped agent stops counting toward presence immediately.
  async function waitForComments(
    q: CommentWait,
    signal?: AbortSignal,
  ): Promise<{ comments: Comment[]; lastSeq: number }> {
    // An author=user session wait with no explicit cursor resumes from the
    // session's agentSeq — "where the agent left off" lives server-side so the
    // CLI, both MCP transports, and piggyback share one exactly-once stream.
    let afterSeq = q.afterSeq;
    if (afterSeq === undefined && q.author === "user" && q.sessionId) {
      afterSeq = (await store.getSession(q.sessionId))?.agentSeq;
    }
    const query = { sessionId: q.sessionId, surfaceId: q.surfaceId, afterSeq };
    const matches = (list: Comment[]) =>
      q.author ? list.filter((cm) => cm.author === q.author) : list;
    const wait = Math.min(Math.max(q.waitSeconds, 0), MAX_WAIT_SECONDS);

    let all = await store.listComments(query);
    let comments = matches(all);
    if (comments.length === 0 && wait > 0) {
      // A parked author=user session wait IS the agent listening — track it as
      // presence for the duration of the long-poll.
      const presenceSession = q.author === "user" && q.sessionId ? q.sessionId : null;
      if (presenceSession) addWaiter(presenceSession);
      try {
        // Block until either the overall timeout elapses with no comment, or a
        // batch of comments arrives and *settles*. Once the first comment lands
        // we keep the wait open through a short quiet window — extended while
        // the user is still composing — so several queued messages come back
        // together instead of waking the agent on the first.
        await new Promise<void>((resolve) => {
          const startMs = Date.now();
          const overallDeadline = startMs + wait * 1000;
          let firstCommentAt: number | null = null;
          let lastCommentAt = 0;
          const unsubscribe = bus.subscribe((event) => {
            if (event.type !== "comment-created") return;
            if (q.sessionId && event.sessionId !== q.sessionId) return;
            if (q.surfaceId && event.surfaceId !== q.surfaceId) return;
            const now = Date.now();
            if (firstCommentAt === null) firstCommentAt = now;
            lastCommentAt = now;
          });
          const poll = setInterval(check, FEEDBACK_POLL_MS);
          function check() {
            const now = Date.now();
            if (now >= overallDeadline) return done();
            // Nothing yet — keep waiting until the overall deadline.
            if (firstCommentAt === null) return;
            // Got at least one; return once the user goes quiet (no new comment
            // for SETTLE_MS and no composing heartbeat), or the batch cap hits.
            const quiet = now - lastCommentAt >= FEEDBACK_SETTLE_MS;
            const stillComposing = q.sessionId !== undefined && isComposing(q.sessionId, now);
            const capped = now - firstCommentAt >= FEEDBACK_MAX_BATCH_MS;
            if (capped || (quiet && !stillComposing)) done();
          }
          function done() {
            clearInterval(poll);
            unsubscribe();
            signal?.removeEventListener("abort", done);
            resolve();
          }
          signal?.addEventListener("abort", done, { once: true });
        });
      } finally {
        if (presenceSession) removeWaiter(presenceSession);
      }
      all = await store.listComments(query);
      comments = matches(all);
    }
    // The cursor advances past every comment in the window — not just the
    // filtered ones — so the next call doesn't re-read the agent's own
    // comments. collectFeedback already does this; mirror it here.
    const lastSeq = all.length > 0 ? all[all.length - 1].seq : (afterSeq ?? 0);
    // An author=user query is the agent listening (the viewer never filters by
    // author) — what it receives here should not be re-delivered as piggyback.
    if (q.author === "user" && q.sessionId && all.length > 0) {
      await store.markAgentSeen(q.sessionId, lastSeq);
    }
    return { comments, lastSeq };
  }

  // --- auth ---

  const isAuthenticated = (c: Context): boolean => {
    if (!authToken) return true;
    if (c.req.header("authorization") === `Bearer ${authToken}`) return true;
    if (getCookie(c, "showcase_key") === authToken) return true;
    return c.req.query("key") === authToken;
  };

  const isUnauthenticatedSessionRead = (c: Context): boolean =>
    publicRead === "session" && !isAuthenticated(c);

  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;

    if (authenticate) {
      const result = await authenticate(c.req.raw);
      if (result === true) return next();
      if (result instanceof Response) return result;
      if (path.startsWith("/api") || path === "/mcp") {
        return c.json({ error: "unauthorized" }, 401);
      }
      return c.text("unauthorized", 401);
    }

    if (!authToken) return next();
    if (path === "/guide" || path === "/setup" || path === "/agent-howto") return next();

    const key = c.req.query("key");
    if (key === authToken) {
      setCookie(c, "showcase_key", authToken, {
        httpOnly: true,
        sameSite: "Lax",
        secure: new URL(c.req.url).protocol === "https:",
        maxAge: 60 * 60 * 24 * 90,
        path: "/",
      });
      return next();
    }
    if (publicRead && c.req.method === "GET" && isPublicReadAllowed(path, publicRead)) {
      return next();
    }
    if (isAuthenticated(c)) return next();
    if (path.startsWith("/api") || path === "/mcp") {
      return c.json({ error: "unauthorized — send Authorization: Bearer <token>" }, 401);
    }
    return c.text("unauthorized — open this page as /?key=<your token>", 401);
  });

  // Cap every request body. Runs after auth, so an unauthenticated request on a
  // token-protected board is rejected (401) before its body is ever read; on a
  // no-token board it still bounds the body. bodyLimit short-circuits on an
  // oversize Content-Length and otherwise streams-and-aborts at the cap, so a
  // chunked body (no Content-Length) can't slip past either. /api/assets is
  // exempt here because it applies its own, stricter cap (limitAssetBody below).
  const limitBody = bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "request body too large" }, 413),
  });
  app.use("*", (c, next) => (c.req.path === "/api/assets" ? next() : limitBody(c, next)));

  // The asset route's own (tighter) body cap. Keeps the asset limit and its
  // wording, and bounds the upload before it is read — bodyLimit refuses an
  // oversize Content-Length outright and aborts a chunked stream at the cap.
  const limitAssetBody = bodyLimit({
    maxSize: MAX_ASSET_BYTES,
    onError: (c) => c.json({ error: `asset exceeds ${MAX_ASSET_BYTES} bytes` }, 413),
  });

  // --- pages and docs ---

  const withOrigin = (text: string, c: { req: { url: string } }) =>
    text.replaceAll(LOCAL_ORIGIN, new URL(c.req.url).origin);

  const withViewerConfig = (text: string, request: Request, isReadonly: boolean) => {
    const config = [
      `window.__SHOWCASE_BASE_PATH__=${JSON.stringify(requestBasePath(request))};`,
      isReadonly ? "window.__SHOWCASE_READONLY__=true;" : "",
      isReadonly && publicRead
        ? `window.__SHOWCASE_PUBLIC_READ__=${JSON.stringify(publicRead)};`
        : "",
    ].join("");
    const script = `<script>${config}</script>`;
    const headClose = text.lastIndexOf("</head>");
    return headClose >= 0
      ? `${text.slice(0, headClose)}${script}${text.slice(headClose)}`
      : `${script}${text}`;
  };

  // Dev live-reload snippet: a reconnecting EventSource that reloads the page
  // when the server's boot id changes (i.e. after a restart). Injected only when
  // `dev`; a no-op string otherwise.
  const liveReloadSnippet =
    `<script>(function(){var b=null;function open(){var es=new EventSource("/api/livereload");` +
    `es.addEventListener("boot",function(e){if(b===null){b=e.data;}else if(e.data!==b){location.reload();}});}open();})();</script>`;
  const withLiveReload = (html: string) => {
    const i = html.lastIndexOf("</body>");
    return i >= 0 ? html.slice(0, i) + liveReloadSnippet + html.slice(i) : html + liveReloadSnippet;
  };

  const configuredViewerHtml = (c: Context) => {
    const base = withViewerConfig(
      withOrigin(viewerHtml, { req: { url: c.req.url } }),
      c.req.raw,
      !!publicRead && !isAuthenticated(c),
    );
    return dev ? withLiveReload(base) : base;
  };
  app.get("/", (c) => c.html(configuredViewerHtml(c)));
  app.get("/session/:id", async (c) => {
    if (isUnauthenticatedSessionRead(c) && !(await store.getSession(c.req.param("id")))) {
      return c.text("Session not found", 404);
    }
    return c.html(configuredViewerHtml(c));
  });
  app.get("/session/:id/s/:surfaceId", async (c) => {
    if (isUnauthenticatedSessionRead(c)) {
      const session = await store.getSession(c.req.param("id"));
      const surface = await store.getSurface(c.req.param("surfaceId"));
      if (!session || !surface || surface.sessionId !== session.id) {
        return c.text("Session or surface not found", 404);
      }
    }
    return c.html(configuredViewerHtml(c));
  });
  app.get("/guide", (c) => c.text(withOrigin(guideMarkdown, c)));
  app.get("/setup", (c) => c.text(withOrigin(setupText, c)));
  app.get("/agent-howto", (c) => c.text(withOrigin(agentHowtoText, c)));

  if (dev) {
    // Hold the SSE open and re-emit this process's boot id. A restart (node
    // --watch-path on the rebuilt viewer/dist) drops the stream; the browser
    // reconnects to the new process, sees a different boot id, and reloads.
    const bootId = crypto.randomUUID();
    app.get("/api/livereload", (c) =>
      streamSSE(c, async (stream) => {
        let open = true;
        stream.onAbort(() => {
          open = false;
        });
        while (open) {
          await stream.writeSSE({ event: "boot", data: bootId });
          await stream.sleep(10_000);
        }
      }),
    );
  }

  // Opt-in html kits available on this board (id, label, summary, classes) —
  // for discovery (`showcase kits`); the CSS/JS payloads are server-only.
  app.get("/api/kits", (c) => c.json(kitSummaries()));

  // --- sessions ---

  app.get("/api/sessions", async (c) => {
    const [sessions, surfaces] = await Promise.all([store.listSessions(), store.listSurfaces()]);
    const counts = new Map<string, number>();
    for (const s of surfaces) counts.set(s.sessionId, (counts.get(s.sessionId) ?? 0) + 1);
    return c.json(
      sessions.map((s) => ({
        ...s,
        surfaceCount: counts.get(s.id) ?? 0,
        // Current agent presence so a freshly-loaded viewer shows the right
        // listening state without waiting for the next transition event.
        listening: isListening(s.id),
      })),
    );
  });

  app.post("/api/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const session = await store.createSession({
      agent: typeof body.agent === "string" ? body.agent : "agent",
      title: typeof body.title === "string" ? body.title.slice(0, MAX_TITLE) : undefined,
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    });
    bus.broadcast({ type: "session-created", id: session.id });
    return c.json(session, 201);
  });

  app.patch("/api/sessions/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.title !== "string") {
      return c.json({ error: 'body must include "title" string' }, 400);
    }
    const session = await store.renameSession(c.req.param("id"), body.title.slice(0, MAX_TITLE));
    if (!session) return c.json({ error: "session not found" }, 404);
    bus.broadcast({ type: "session-updated", id: session.id });
    return c.json(session);
  });

  app.delete("/api/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!(await store.removeSession(id))) return c.json({ error: "session not found" }, 404);
    bus.broadcast({ type: "session-deleted", id });
    return c.json({ ok: true });
  });

  const listSessionSurfaces = async (c: any) => {
    const session = await store.getSession(c.req.param("id"));
    if (!session) return c.json({ error: "session not found" }, 404);
    const surfaces = await store.listSurfaces(session.id);
    return c.json(surfaces.map(surfaceMeta));
  };
  app.get("/api/sessions/:id/surfaces", listSessionSurfaces);
  app.get("/api/sessions/:id/snippets", listSessionSurfaces); // legacy alias

  // --- surfaces ---

  const getSurface = async (c: any) => {
    const surface = await store.getSurface(c.req.param("id"));
    if (!surface) return c.json({ error: "surface not found" }, 404);
    return c.json(surface);
  };
  app.get("/api/surfaces/:id", getSurface);
  app.get("/api/snippets/:id", getSurface); // legacy alias

  // Accepts either an existing session id, or agent/cwd fields to
  // auto-create a session — so a bare `curl` one-liner works with no ceremony.
  app.post("/api/surfaces", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.parts)) {
      return c.json({ error: 'body must include a "parts" array' }, 400);
    }
    const parsed = validateSurfaceParts(body.parts);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return publish(c, body, parsed.parts);
  });

  // Structured review finding — showcase composes the multimodal card from
  // fields (see buildFinding). The shared entry for the review_finding MCP tool
  // (stdio transport + CLI) and any HTTP caller.
  app.post("/api/findings", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.title !== "string" || typeof body.problem !== "string") {
      return c.json({ error: '"title" and "problem" strings are required' }, 400);
    }
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const result = await publishFinding({
      ...coerceFinding(body),
      session: str(body.session),
      sessionTitle: str(body.sessionTitle),
      agent: str(body.agent),
      cwd: str(body.cwd),
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(
      {
        ...writeResult(result.surface),
        ...(result.userFeedback && { userFeedback: result.userFeedback }),
      },
      201,
    );
  });

  // Whole structured review in one call — a verdict card + a card per finding.
  // The shared entry for the publish_review MCP tool (stdio) and the CLI.
  app.post("/api/reviews", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.findings)) {
      return c.json({ error: '"findings" array is required' }, 400);
    }
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const findings = body.findings.map(coerceFinding);
    const result = await publishReview({
      verdict: str(body.verdict),
      branch: str(body.branch),
      base: str(body.base),
      summary: str(body.summary),
      coverage: str(body.coverage),
      architecture: str(body.architecture),
      changeMap: coerceChangeMap(body.changeMap),
      churn: coerceChurn(body.churn),
      findings,
      session: str(body.session),
      sessionTitle: str(body.sessionTitle),
      agent: str(body.agent),
      cwd: str(body.cwd),
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result, 201);
  });

  // Legacy html-only entry — sugar for a single html part. An optional `kits`
  // array opts the part into style/behavior bundles; it's validated (strict)
  // like any html part so an unknown kit id is a clean 400.
  app.post("/api/snippets", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.html !== "string" || !body.html.trim()) {
      return c.json({ error: 'body must include non-empty "html" string' }, 400);
    }
    const parsed = validateSurfaceParts([htmlPart(body.html, body.kits)]);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    return publish(c, body, parsed.parts);
  });

  async function publish(c: any, body: any, parts: SurfacePart[]) {
    const badge = coerceSurfaceBadge(body.badge);
    const result = await publishSurface({
      parts,
      title: typeof body.title === "string" ? body.title : undefined,
      badge: badge ?? undefined,
      session: typeof body.session === "string" ? body.session : undefined,
      sessionTitle: typeof body.sessionTitle === "string" ? body.sessionTitle : undefined,
      agent: typeof body.agent === "string" ? body.agent : undefined,
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(
      {
        ...writeResult(result.surface),
        ...(result.userFeedback && { userFeedback: result.userFeedback }),
      },
      201,
    );
  }

  const revise = async (c: any) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    // surfaces: a `parts` array; snippets: an `html` string (single html part).
    let parts: SurfacePart[] | undefined;
    if (body.parts !== undefined) {
      if (!Array.isArray(body.parts)) return c.json({ error: '"parts" must be an array' }, 400);
      const parsed = validateSurfaceParts(body.parts);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      parts = parsed.parts;
    } else if (typeof body.html === "string") {
      const parsed = validateSurfaceParts([htmlPart(body.html, body.kits)]);
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      parts = parsed.parts;
    }
    const result = await reviseSurface(c.req.param("id"), {
      parts,
      title: typeof body.title === "string" ? body.title : undefined,
      // `null` clears the badge; absent/malformed leaves it unchanged.
      badge: "badge" in body ? coerceSurfaceBadge(body.badge) : undefined,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...writeResult(result.surface),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  };
  app.put("/api/surfaces/:id", revise);
  app.put("/api/snippets/:id", revise); // legacy alias

  // Pin/unpin a surface to the cross-session Library. Doesn't bump the version
  // (it's not a content edit); broadcasts surface-updated so an open Library
  // view refreshes.
  app.put("/api/surfaces/:id/pin", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const pinned = body?.pinned !== false; // default to pinning
    const surface = await store.setPinned(c.req.param("id"), pinned);
    if (!surface) return c.json({ error: "surface not found" }, 404);
    bus.broadcast({
      type: "surface-updated",
      id: surface.id,
      sessionId: surface.sessionId,
      version: surface.version,
    });
    return c.json(surface);
  });

  // The Library: every pinned surface across sessions, newest first (metas).
  app.get("/api/library", async (c) => {
    if (isUnauthenticatedSessionRead(c)) return c.json({ error: "unauthorized" }, 401);
    const all = await store.listSurfaces();
    const pinned = all
      .filter((s) => s.pinned)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return c.json(pinned.map(surfaceMeta));
  });

  const remove = async (c: any) => {
    const surface = await store.getSurface(c.req.param("id"));
    if (!surface) return c.json({ error: "surface not found" }, 404);
    await store.removeSurface(surface.id);
    bus.broadcast({ type: "surface-deleted", id: surface.id, sessionId: surface.sessionId });
    return c.json({ ok: true });
  };
  app.delete("/api/surfaces/:id", remove);
  app.delete("/api/snippets/:id", remove); // legacy alias

  // --- comments ---

  app.post("/api/comments", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return c.json({ error: 'body must include non-empty "text" string' }, 400);
    }
    const surface = typeof body.surface === "string" ? body.surface : body.snippet;
    const result = await createComment({
      text: body.text,
      surface: typeof surface === "string" ? surface : undefined,
      session: typeof body.session === "string" ? body.session : undefined,
      author: typeof body.author === "string" ? body.author : "user",
      anchor: parseAnchor(body.anchor),
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(
      { ...result.comment, ...(result.userFeedback && { userFeedback: result.userFeedback }) },
      201,
    );
  });

  // "I'm still composing" heartbeat: the viewer pings this while a comment
  // composer is focused or being typed in, so a parked agent wait holds its
  // batch open until the user is done queueing messages (see waitForComments).
  // Cheap and idempotent — accepts a session id, or a surface id we resolve to
  // its session. Always 204 so a stray ping never surfaces an error.
  app.post("/api/composing", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    let sessionId = typeof body?.session === "string" ? body.session : undefined;
    if (!sessionId && typeof body?.surface === "string") {
      sessionId = (await store.getSurface(body.surface))?.sessionId;
    }
    if (sessionId) markComposing(sessionId);
    return c.body(null, 204);
  });

  // The viewer's update notice: running version vs latest published release.
  app.get("/api/version", async (c) => {
    if (!version) return c.json({ current: null, latest: null, updateAvailable: false });
    const latest = await latestRelease();
    const updateAvailable = latest !== null && versionGt(latest.version, version);
    return c.json({
      current: version,
      latest: latest?.version ?? null,
      updateAvailable,
      upgradeCommand: updateAvailable ? (upgradeCommand ?? null) : null,
      notes: updateAvailable ? (latest?.notes ?? null) : null,
    });
  });

  // Long-poll friendly: ?wait=N holds the request open up to N seconds until
  // a matching comment arrives. This is how terminal agents block on feedback.
  app.get("/api/comments", async (c) => {
    const sessionId = c.req.query("session");
    const surfaceId = c.req.query("surface") ?? c.req.query("snippet");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId && !surfaceId) return c.json({ error: "session or surface required" }, 401);
      if (sessionId && !(await store.getSession(sessionId))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (surfaceId) {
        const surface = await store.getSurface(surfaceId);
        if (!surface || (sessionId && surface.sessionId !== sessionId)) {
          return c.json({ error: "surface not found" }, 404);
        }
      }
    }
    const result = await waitForComments(
      {
        sessionId,
        surfaceId,
        author: c.req.query("author"),
        afterSeq: c.req.query("after") ? Number(c.req.query("after")) : undefined,
        waitSeconds: Number(c.req.query("wait") ?? 0) || 0,
      },
      c.req.raw.signal,
    );
    return c.json(result);
  });

  // --- rendering ---

  // Serves one html part of a surface as a themed, sandboxed document. The
  // viewer points an iframe here per html part; diff parts render natively in
  // the viewer (they are data, not arbitrary markup) and never reach here.
  app.get("/s/:id", async (c) => {
    const surface = await store.getSurface(c.req.param("id"));
    if (!surface) return c.text("Surface not found", 404);
    const ver = c.req.query("ver");
    let title = surface.title;
    let parts = surface.parts;
    if (ver && Number(ver) !== surface.version) {
      const old = surface.history.find((h) => h.version === Number(ver));
      if (!old) return c.text(`Version ${ver} not available`, 404);
      title = old.title;
      parts = old.parts;
    }
    const partParam = c.req.query("part");
    const publicBasePath = requestBasePath(c.req.raw);
    const idx = Number(partParam ?? 0);
    const part = parts[idx];
    // A bare /s/:id (no ?part=) is a human opening the link directly — the
    // viewer's own embeds always pass ?part=N. Send them to the full viewer
    // (all parts + the comment thread) rather than a single part in isolation
    // when this is a deployed board, or whenever part 0 isn't a renderable html
    // part — otherwise the link dead-ends on "No html part at that index". A
    // lone html part still renders standalone (direct embeds, og previews).
    if (partParam == null && (publicBasePath || part?.kind !== "html")) {
      return c.redirect(`${publicBasePath}/?surface=${encodeURIComponent(surface.id)}`, 302);
    }
    if (!part || part.kind !== "html") return c.text("No html part at that index", 404);
    c.header("X-Content-Type-Options", "nosniff");
    // Theme: an explicit ?theme= (the viewer keys iframe srcs by it so a switch
    // reloads the frame) wins; otherwise the persisted board theme; else default.
    const themeId = c.req.query("theme") ?? DEFAULT_THEME_ID;
    // Scheme: the viewer passes the light/dark mode it resolved so the iframe is
    // pinned to it rather than re-deriving from the OS (which can diverge from
    // the chrome across the frame boundary). Absent/invalid → follow the OS.
    const modeParam = c.req.query("mode");
    const mode = modeParam === "light" || modeParam === "dark" ? modeParam : undefined;
    return c.html(
      renderHtmlPage({
        title,
        html: part.html,
        origin: new URL(c.req.url).origin,
        theme: themeById(themeId),
        mode,
        kits: part.kits,
      }),
    );
  });

  // --- assets (agent-uploaded images, traces, files) ---

  // Accepts raw bytes (the asset's own Content-Type, metadata via query) or a
  // JSON envelope { data: base64, contentType, ... } — so curl --data-binary
  // and a JSON client both work, and MCP can ride base64. The body is read once
  // and only treated as an envelope when it is application/json carrying a
  // base64 `data` string; a raw JSON asset (no top-level `data`) stays raw.
  app.post("/api/assets", limitAssetBody, async (c) => {
    const mime = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // limitAssetBody has already bounded the body to MAX_ASSET_BYTES, so this
    // read is safe. The post-decode cap in uploadAsset still applies (a base64
    // envelope decodes to ~3/4), enforcing the true asset limit on the bytes.
    const buf = new Uint8Array(await c.req.arrayBuffer());
    let envelope: any = null;
    if (mime === "application/json") {
      try {
        const j = JSON.parse(new TextDecoder().decode(buf));
        if (j && typeof j.data === "string") envelope = j;
      } catch {
        // not an envelope — fall through to the raw path
      }
    }
    const kindQ = c.req.query("kind");
    let body;
    try {
      body = envelope
        ? {
            data: decodeBase64(envelope.data),
            contentType:
              typeof envelope.contentType === "string"
                ? envelope.contentType
                : "application/octet-stream",
            filename: typeof envelope.filename === "string" ? envelope.filename : undefined,
            kind: isAssetKind(envelope.kind) ? envelope.kind : undefined,
            session: typeof envelope.session === "string" ? envelope.session : undefined,
            agent: typeof envelope.agent === "string" ? envelope.agent : undefined,
          }
        : {
            data: buf,
            contentType: mime || "application/octet-stream",
            filename: c.req.query("filename"),
            kind: isAssetKind(kindQ) ? kindQ : undefined,
            session: c.req.query("session"),
            agent: c.req.query("agent"),
          };
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "invalid upload" }, 400);
    }
    const result = await uploadAsset(body);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    const origin = new URL(c.req.url).origin;
    return c.json({ ...result.asset, url: `${origin}/a/${result.asset.id}` }, 201);
  });

  app.get("/a/:id", async (c) => {
    const id = c.req.param("id");
    let asset = await store.getAsset(id);
    // Optimistic uploads: an agent can derive an asset's URL from its content
    // hash and publish a surface referencing it before (or while) the bytes are
    // uploaded. Rather than 404 in that window, briefly wait for the bytes —
    // but only when a live surface actually points at this id, so unknown ids
    // still fail fast.
    if (!asset && (await store.isAssetReferenced(id))) {
      for (let i = 0; i < 20 && !asset; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        asset = await store.getAsset(id);
      }
    }
    if (!asset) return c.text("Asset not found", 404);
    await store.touchAsset(asset.id);
    const { contentType, disposition } = assetServeHeaders(asset);
    c.header("Content-Type", contentType);
    c.header("Content-Disposition", disposition);
    c.header("X-Content-Type-Options", "nosniff");
    // Short revalidating cache (not immutable) so touch-on-serve keeps firing
    // and the LRU clock reflects real views; asset ids are unique anyway.
    c.header("Cache-Control", "private, max-age=60");
    return c.body(asset.data as unknown as ArrayBuffer);
  });

  // --- live feed ---

  app.get("/api/events", async (c) => {
    const sessionId = c.req.query("session");
    if (isUnauthenticatedSessionRead(c)) {
      if (!sessionId) return c.json({ error: "session required" }, 401);
      if (!(await store.getSession(sessionId))) return c.json({ error: "session not found" }, 404);
    }
    const eventSessionId = (event: Parameters<Parameters<EventBus["subscribe"]>[0]>[0]) => {
      if ("sessionId" in event) return event.sessionId;
      if (event.type.startsWith("session-")) return event.id;
      return undefined;
    };
    return streamSSE(c, async (stream) => {
      const queue: Parameters<Parameters<EventBus["subscribe"]>[0]>[0][] = [];
      let wake: (() => void) | null = null;
      const unsubscribe = bus.subscribe((event) => {
        if (sessionId && eventSessionId(event) !== sessionId) return;
        queue.push(event);
        wake?.();
      });
      let open = true;
      const close = () => {
        open = false;
        unsubscribe();
        wake?.();
      };
      stream.onAbort(close);
      c.req.raw.signal.addEventListener("abort", close, { once: true });
      await stream.writeSSE({ event: "hello", data: "{}" });
      // Send the current agent presence immediately so a freshly-opened viewer
      // reflects the listening state without waiting for the next transition.
      if (sessionId) {
        await stream.writeSSE({
          data: JSON.stringify({
            type: "agent-presence",
            sessionId,
            listening: isListening(sessionId),
          }),
        });
      }
      while (open) {
        while (queue.length > 0) {
          await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
        }
        let pingTimer: ReturnType<typeof setTimeout> | null = null;
        await Promise.race([
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
          new Promise<void>((resolve) => {
            pingTimer = setTimeout(resolve, 15000);
          }),
        ]);
        wake = null;
        if (pingTimer) clearTimeout(pingTimer);
        if (open && queue.length === 0) {
          await stream.writeSSE({ event: "ping", data: "{}" });
        }
      }
    });
  });

  // --- MCP over streamable HTTP (works locally and deployed) ---

  registerMcp(app, {
    store,
    basePath: requestBasePath,
    publishSurface,
    publishFinding,
    publishReview,
    reviseSurface,
    createComment,
    waitForComments,
    uploadAsset,
    guide: guideMarkdown,
  });

  return app;
}
