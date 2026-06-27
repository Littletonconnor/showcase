import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { decodeBase64 } from "./base64.ts";
import { EventBus } from "./events.ts";
import { buildExportBundle, exportFilename, renderExportHtml } from "./export.ts";
import { kitSummaries } from "./kits.ts";
import { registerMcp } from "./mcpHttp.ts";
import { escapeHtml, renderHtmlPage } from "./surfacePage.ts";
import { DEFAULT_THEME_ID, themeById } from "./themes.ts";
import {
  type Asset,
  type AssetKind,
  type Comment,
  type CommentAnchor,
  type CreateReviewInput,
  type Decision,
  type DecisionProposal,
  type ManifestFile,
  htmlPart,
  isAssetKind,
  MAX_ASSET_BYTES,
  newId,
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

// Review burndown: which badge labels are findings (R1's severity set), and what
// a user-posted resolution marker looks like (the viewer's Approve/Dismiss). A
// finding is "open" until it carries one. Kept in sync with the viewer's
// FINDING_LABELS / APPROVAL_MARK / DISMISS_MARK.
const FINDING_LABELS = new Set(["Bug", "Nit", "Question", "Praise"]);
const isResolutionText = (t: string) => t.startsWith("✓ Approved") || t.startsWith("⊘ Dismissed");

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
  playbookText?: string;
  // Dev-only live reload. When true, the served viewer HTML gets a tiny
  // reconnecting EventSource snippet and a GET /api/livereload endpoint that
  // streams this process's boot id. `npm run dev` rebuilds viewer/dist and
  // restarts the server on change; the new process has a new boot id, so
  // connected browsers see it on reconnect and refresh. Never set in production
  // (the route is unregistered and the snippet is not injected).
  dev?: boolean;
  // Extension seam for embedders fronting showcase with their own auth (e.g. a
  // reverse proxy). When set, this hook authorizes requests before any app
  // route runs. Return true to allow, false for the default 401, or a Response
  // for custom denials. Lower-level than authToken so a host can validate its
  // own signed assertions without teaching showcase its session/token system.
  authenticate?: AuthenticateHook;
  // When set, every route except /guide, /setup, and /playbook requires it:
  // Authorization bearer, ?key= query, or the cookie it sets. `index.ts` wires
  // this from SHOWCASE_TOKEN; the local default ships unset.
  authToken?: string;
  // Public path prefix for an embedder mounting showcase below an origin root,
  // e.g. /u/:account behind a multi-tenant wrapper. The core still receives
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
  // The LLM-age honesty signal (required on every real finding — § P3, §7 #2).
  // `confidence` is how sure the agent is; `coverage` is what it DID and did NOT
  // check ("reproduced with a unit test" / "did not run the migration"). The most
  // dangerous LLM output is a confident change in an unchecked area — these make
  // that gap impossible to hide.
  confidence?: string;
  coverage?: string;
  // Optional: did the agent actually run/reproduce this (a stronger claim than
  // confidence), and the scope tier it was found at — changed-lines (a bug in the
  // diff), whole-file (an inconsistency with the rest of the file), or codebase
  // (an architectural conflict with code outside the diff). The tier tells the
  // reviewer how far they must look to judge it.
  verified?: boolean;
  scope?: string;
  // Optional blast radius: a tiny call-graph ({nodes, edges}, same shape as the
  // change map) of what calls this / what this calls / which tests cover it.
  blastRadius?: ChangeMapInput;
}

const FINDING_CONFIDENCE: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};
const FINDING_SCOPE: Record<string, string> = {
  "changed-lines": "changed lines",
  "whole-file": "whole file",
  codebase: "codebase",
};

// A real finding (one that becomes a card) must carry the full structure — the
// same enforcement that makes title/problem required, extended to the honesty
// signal. Returns an error string, or null when the finding is complete. Empty
// placeholder entries (no title AND no problem) are not "real" and are filtered
// out before this runs.
export function validateFinding(f: FindingInput): string | null {
  if (!f.title?.trim() || !f.problem?.trim()) return '"title" and "problem" are required';
  if (!f.confidence || !Object.hasOwn(FINDING_CONFIDENCE, f.confidence)) {
    return '"confidence" is required and must be high | medium | low';
  }
  if (!f.coverage?.trim()) {
    return '"coverage" is required — state what you did and did NOT check';
  }
  return null;
}

export const isRealFinding = (f: FindingInput): boolean => !!f.title?.trim() && !!f.problem?.trim();

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
  // Head: the honesty signal — confidence · scope · verified — then a coverage
  // line (what the agent did and did NOT check). This rides above the problem so
  // the reviewer sees the trust signal before the claim.
  const meta: string[] = [];
  if (input.confidence && FINDING_CONFIDENCE[input.confidence]) {
    meta.push(FINDING_CONFIDENCE[input.confidence]);
  }
  if (input.scope && FINDING_SCOPE[input.scope]) meta.push(`scope: ${FINDING_SCOPE[input.scope]}`);
  if (input.verified) meta.push("✓ verified");
  const headLines: string[] = [];
  if (meta.length) headLines.push(`_${meta.join(" · ")}_`);
  if (input.coverage?.trim()) {
    headLines.push(`**Coverage** — ${normalizeProse(input.coverage)}`);
  }
  // Lead: the problem. When there's a suggestion diff, `fix` becomes the
  // rationale UNDER the change ("why it's better"); without one, it stays inline
  // as the textual fix so prose-only findings still carry a recommendation.
  const problemBlock =
    fix && !hasSuggestion
      ? `**Problem** — ${problem}\n\n**Fix** — ${fix}`
      : `**Problem** — ${problem}`;
  parts.push({ kind: "markdown", markdown: [...headLines, problemBlock].join("\n\n") });
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
  // Tail: the blast radius — a tiny call-graph of what this affects. Reuses the
  // change-map styling so callers/callees/tests read the same as the overview map.
  if (input.blastRadius) {
    const graph = buildChangeMap(input.blastRadius);
    if (graph) parts.push(graph);
  }
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
    confidence: str(raw?.confidence),
    coverage: str(raw?.coverage),
    verified: typeof raw?.verified === "boolean" ? raw.verified : undefined,
    scope: str(raw?.scope),
    blastRadius: coerceChangeMap(raw?.blastRadius),
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
      ? raw.edges.map((e: any) => ({
          from: str(e?.from),
          to: str(e?.to),
          label: str(e?.label),
          status: str(e?.status),
        }))
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
  edges?: Array<{ from?: string; to?: string; label?: string; status?: string }>;
}

// Edge status (§8.2) — color-codes the *interactions*, the half node status
// can't show: a `new` edge is coupling the PR introduces (scrutinize it), a
// `removed` edge is a call it severs (a dropped auth/validation hop is the most
// dangerous invisible change), `existing` is unchanged context. Shares the
// node-status palette so one legend covers both. mermaid styles edges by index.
// NB: every entry needs ≥2 comma-separated properties — mermaid's flowchart
// grammar rejects a lone `linkStyle N stroke:#color;` (it parses the color then
// expects more and throws a parse error), so `existing` carries an explicit
// stroke-width rather than `stroke:#9aa0a6` alone. Verified in a real browser
// (the viewer's mermaid) — a string-only assertion wouldn't catch the failure.
const EDGE_STATUS: Record<string, string> = {
  new: "stroke:#2f9e44,stroke-width:1.5px",
  removed: "stroke:#e03131,stroke-width:1.5px,stroke-dasharray:4 3",
  existing: "stroke:#9aa0a6,stroke-width:1px",
};

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
  // Track each rendered edge's status by its emission index — mermaid styles
  // edges by index, so the linkStyle lines must match the order edges appear.
  const edgeStyles: string[] = [];
  let edgeIndex = 0;
  for (const e of Array.isArray(map?.edges) ? map.edges! : []) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
    if (!id.has(e.from) || !id.has(e.to)) continue;
    const label = e.label?.trim() ? `|"${esc(e.label)}"|` : "";
    lines.push(`  ${id.get(e.from)} -->${label} ${id.get(e.to)}`);
    if (typeof e.status === "string" && Object.hasOwn(EDGE_STATUS, e.status)) {
      edgeStyles.push(`  linkStyle ${edgeIndex} ${EDGE_STATUS[e.status]};`);
    }
    edgeIndex++;
  }
  for (const s of used) lines.push(`  classDef ${s} ${CHANGE_STATUS[s]};`);
  for (const ls of edgeStyles) lines.push(ls);
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

// Risk-weighted treemap (§8.1): area = churn, color = the agent's priority tier
// (sensitive → hot red, logic → amber, mechanical → gray). The reviewer's eye is
// pulled to the big hot rectangle — attention routing as a visual reflex. Built
// from the SAME manifest the overview renders, so it's the file manifest made
// visual, and it supersedes the churn bar (§8.4). Skipped on a trivial review
// (fewer than two churned files), where a treemap adds nothing.
function buildRiskTreemap(manifest: ManifestRowInput[] | undefined): SurfacePart | undefined {
  const rows = (Array.isArray(manifest) ? manifest : [])
    .map((m) => ({
      file: typeof m?.file === "string" ? m.file.trim() : "",
      size:
        (Number.isFinite(m?.added) ? Math.max(0, Number(m?.added)) : 0) +
        (Number.isFinite(m?.removed) ? Math.max(0, Number(m?.removed)) : 0),
      tone:
        typeof m?.priority === "string" && Object.hasOwn(PRIORITY_RANK, m.priority)
          ? m.priority
          : "logic",
    }))
    .filter((r) => r.file && r.size > 0);
  if (rows.length < 2) return undefined;
  // Label by basename (the full path won't fit a cell); disambiguate collisions.
  const seen = new Map<string, number>();
  const data = rows.map((r) => {
    let name = r.file.split("/").pop() || r.file;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    return { name, size: r.size, tone: r.tone };
  });
  return {
    kind: "chart",
    chartType: "treemap",
    data,
    x: "name",
    y: "size",
    caption: "Risk-weighted — area = churn, color = sensitivity (red) → mechanical (gray)",
  };
}

// Confidence × coverage quadrant (§8.3): each finding placed by how sure the
// agent was (x) vs how much it verified (y). The bottom-right — high confidence,
// low coverage — is the danger zone (a confident change in unchecked code, the
// single most dangerous LLM output). x is the confidence level; y is derived
// from `verified` + the coverage note (an explicit "did not"/"untested" reads as
// low coverage), so the quadrant needs no field the finding doesn't already
// carry. Points jitter deterministically so coincident findings don't hide.
const CONFIDENCE_LEVEL: Record<string, number> = { high: 3, medium: 2, low: 1 };
const COVERAGE_GAP_RE =
  /\bdid\s?n['’]?t\b|\bdid not\b|\bnot\b|\bun(?:verified|tested|checked)\b|\bcould\s?n['’]?t\b|\bno tests?\b|\bwithout\b|\bhaven['’]?t\b|\bunable\b/i;
function coverageLevelOf(f: FindingInput): number {
  if (f.verified === true) return 3;
  if (f.coverage && COVERAGE_GAP_RE.test(f.coverage)) return 1;
  return 2;
}
function buildQuadrant(findings: FindingInput[]): SurfacePart | undefined {
  const real = findings.filter(isRealFinding);
  if (real.length < 2) return undefined;
  const data = real.map((f, i) => {
    const conf = CONFIDENCE_LEVEL[f.confidence ?? ""] ?? 2;
    const cov = coverageLevelOf(f);
    const jx = ((i % 5) - 2) * 0.05;
    const jy = ((Math.floor(i / 5) % 5) - 2) * 0.05;
    return {
      conf: conf + jx,
      cov: cov + jy,
      label: f.title.trim().slice(0, 80),
      tone: conf === 3 && cov === 1 ? "danger" : "normal",
    };
  });
  return {
    kind: "chart",
    chartType: "scatter",
    data,
    x: "conf",
    y: "cov",
    xLabel: "confidence",
    yLabel: "coverage",
    caption: "Confidence × coverage — bottom-right (sure but unverified) is the danger zone",
  };
}

// The opinionated overview (§ P1/P2): the agent declares intent, a composite
// risk band over four sub-signals, a review budget, and a priority-ranked file
// manifest; showcase renders them the same way every time as a single `review`-
// kit html part. Risk and priority are AGENT-AUTHORED (the agent has the
// semantic context a path regex never will) — the server's job is consistent
// rendering, not second-guessing. This part is sandboxed (renderHtmlPage at
// /s/:id), so agent strings are escaped for correct structure, not trusted.
const RISK_BANDS: Record<string, string> = { low: "Low", elevated: "Elevated", high: "High" };
const PRIORITY_RANK: Record<string, number> = { sensitive: 0, logic: 1, mechanical: 2 };
const SIGNAL_LABELS: Array<{ key: keyof RiskInput; label: string }> = [
  { key: "size", label: "Size" },
  { key: "surfaceArea", label: "Surface" },
  { key: "sensitivity", label: "Sensitivity" },
  { key: "testDelta", label: "Tests" },
];

export interface RiskInput {
  size?: number;
  surfaceArea?: number;
  sensitivity?: number;
  testDelta?: number;
  band?: string;
}

export interface ManifestRowInput {
  file?: string;
  added?: number;
  removed?: number;
  priority?: string;
  note?: string;
}

export interface OverviewInput {
  intent?: string;
  risk?: RiskInput;
  budget?: string;
  manifest?: ManifestRowInput[];
}

// A 0–3 agent weight → a labeled sub-bar. Width is the weight as a fraction of
// 3 (a floor so a 0 still shows the track); tone reddens as the weight climbs so
// the heaviest axis is the one the eye lands on.
function signalBar(label: string, raw: number | undefined): string {
  const w = Math.max(0, Math.min(3, Math.round(Number.isFinite(raw) ? Number(raw) : 0)));
  const pct = Math.max(6, Math.round((w / 3) * 100));
  const tone = w >= 3 ? "hot" : w === 2 ? "warm" : "cool";
  return (
    `<span class="sig-label">${escapeHtml(label)}<span class="num">${w}/3</span></span>` +
    `<div class="signal ${tone}"><i style="width:${pct}%"></i></div>`
  );
}

// One manifest row: priority dot · file · two-tone churn spark · +/− counts ·
// "why it matters" note · reviewed checkbox. The spark widths are the added /
// removed split of the row's churn (an empty track when the row has none).
function manifestRow(r: {
  file: string;
  added: number;
  removed: number;
  priority: string;
  note: string;
}): string {
  const total = r.added + r.removed;
  const addPct = total > 0 ? Math.round((r.added / total) * 100) : 0;
  const delPct = total > 0 ? 100 - addPct : 0;
  const spark =
    total > 0
      ? `<span class="spark"><span class="add" style="width:${addPct}%"></span><span class="del" style="width:${delPct}%"></span></span>`
      : `<span class="spark"></span>`;
  const note = r.note
    ? `<span class="note">${escapeHtml(r.note)}</span>`
    : `<span class="note"></span>`;
  return (
    `<li class="manifest-row ${r.priority}">` +
    `<span class="pri"></span>` +
    `<span class="file">${escapeHtml(r.file)}</span>` +
    spark +
    `<span class="churn">+${r.added} −${r.removed}</span>` +
    note +
    `<input class="rev" type="checkbox" aria-label="Mark ${escapeHtml(r.file)} reviewed">` +
    `</li>`
  );
}

function buildOverview(input: OverviewInput): SurfacePart | undefined {
  const intent = input.intent?.trim();
  const budget = input.budget?.trim();
  const risk = input.risk;
  const hasRisk =
    !!risk &&
    (risk.band !== undefined ||
      [risk.size, risk.surfaceArea, risk.sensitivity, risk.testDelta].some((v) =>
        Number.isFinite(v),
      ));
  const rows = (Array.isArray(input.manifest) ? input.manifest : [])
    .map((m) => ({
      file: typeof m?.file === "string" ? m.file.trim() : "",
      added: Number.isFinite(m?.added) ? Math.max(0, Number(m?.added)) : 0,
      removed: Number.isFinite(m?.removed) ? Math.max(0, Number(m?.removed)) : 0,
      priority:
        typeof m?.priority === "string" && Object.hasOwn(PRIORITY_RANK, m.priority)
          ? m.priority
          : "logic",
      note: typeof m?.note === "string" ? m.note.trim() : "",
    }))
    .filter((m) => m.file);
  // Nothing structured to show → let buildVerdictMarkdown carry the review.
  if (!intent && !budget && !hasRisk && rows.length === 0) return undefined;

  // Priority order (sensitive → logic → mechanical), stable within a tier so the
  // agent's order is the churn-or-judgement tiebreak. Mechanical rows collapse
  // into the low-attention bucket the reviewer confirms in one glance.
  const ranked = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => PRIORITY_RANK[a.r.priority] - PRIORITY_RANK[b.r.priority] || a.i - b.i)
    .map((x) => x.r);
  const hot = ranked.filter((r) => r.priority !== "mechanical");
  const cold = ranked.filter((r) => r.priority === "mechanical");

  const blocks: string[] = [];
  if (intent) blocks.push(`<p class="title">${escapeHtml(intent)}</p>`);

  if (hasRisk || budget) {
    const bandKey =
      typeof risk?.band === "string" && Object.hasOwn(RISK_BANDS, risk.band) ? risk.band : "";
    const bandLabel = bandKey ? RISK_BANDS[bandKey] : "—";
    const signals = hasRisk
      ? `<div class="signals">${SIGNAL_LABELS.map((s) => signalBar(s.label, risk?.[s.key] as number | undefined)).join("")}</div>`
      : "";
    const budgetLine = budget ? `<div class="budget">${escapeHtml(budget)}</div>` : "";
    blocks.push(
      `<div class="risk">` +
        `<div class="between"><span class="risk-band ${bandKey}"><span class="lvl"></span>Risk: ${escapeHtml(bandLabel)}</span>` +
        `<span class="review-progress"></span></div>` +
        signals +
        budgetLine +
        `</div>`,
    );
  }

  if (hot.length > 0) blocks.push(`<ul class="manifest">${hot.map(manifestRow).join("")}</ul>`);
  if (cold.length > 0) {
    blocks.push(
      `<button class="cold-toggle" aria-expanded="false" type="button">` +
        `<span class="caret">▸</span> ${cold.length} mechanical file${cold.length > 1 ? "s" : ""} (low attention)</button>` +
        `<div class="cold-bucket" hidden><ul class="manifest">${cold.map(manifestRow).join("")}</ul></div>`,
    );
  }

  return htmlPart(`<div class="stack lg">${blocks.join("")}</div>`, ["review"]);
}

// Coerce a loosely-typed overview ({intent, risk, budget, manifest}) — shared by
// the REST reviews route and both MCP transports; buildOverview validates.
export function coerceOverview(raw: any): OverviewInput {
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const r = raw?.risk;
  const risk: RiskInput | undefined =
    r && typeof r === "object"
      ? {
          size: num(r.size),
          surfaceArea: num(r.surfaceArea),
          sensitivity: num(r.sensitivity),
          testDelta: num(r.testDelta),
          band: str(r.band),
        }
      : undefined;
  const manifest = Array.isArray(raw?.manifest)
    ? raw.manifest.map((m: any) => ({
        file: str(m?.file),
        added: num(m?.added),
        removed: num(m?.removed),
        priority: str(m?.priority),
        note: str(m?.note),
      }))
    : undefined;
  return { intent: str(raw?.intent), risk, budget: str(raw?.budget), manifest };
}

// Validate a published Review (the decision-queue form factor — see
// docs/review-form-factor.md). Returns the normalized input or an error string.
// `coverage` is required on every decision — the honesty ledger is the API, the
// same discipline that makes confidence/coverage required on a finding. Evidence
// reuses the surface-part validator, so right-pane artifacts meet the card bar.
const endWithNewline = (s: string) => (s.length && !s.endsWith("\n") ? s + "\n" : s);
const DECISION_CALLS = new Set(["block", "ship", "decide"]);
const DECISION_SCOPES = new Set(["changed-line", "whole-file", "codebase"]);
const DECISION_CONFIDENCE = new Set(["high", "medium", "low"]);
const FILE_DISPOSITIONS = new Set(["has-decision", "reviewed-no-comment", "mechanical-skipped"]);
const nonNegInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function coerceReview(raw: any): { review: CreateReviewInput } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "body must be an object" };
  if (typeof raw.brief !== "string" || !raw.brief.trim()) return { error: '"brief" is required' };
  if (!Array.isArray(raw.decisions) || raw.decisions.length === 0) {
    return { error: '"decisions" must be a non-empty array' };
  }
  const verdict = raw.verdict === "block" || raw.verdict === "approve" ? raw.verdict : "comment";
  const decisions: Decision[] = [];
  // Stable ids double as the manifest's link target and the human's copy-paste
  // ref, so they must be unique within a review. Honor an agent-supplied id (the
  // skill keeps it stable across re-publishes); mint one when it's omitted.
  const decisionIds = new Set<string>();
  for (let i = 0; i < raw.decisions.length; i++) {
    const d = raw.decisions[i];
    if (!d || typeof d !== "object") return { error: `decision ${i}: must be an object` };
    let id: string;
    if (d.id != null) {
      if (typeof d.id !== "string" || !d.id.trim())
        return { error: `decision ${i}: "id" must be a non-empty string when present` };
      id = d.id.trim();
      if (decisionIds.has(id)) return { error: `decision ${i}: duplicate id "${id}"` };
    } else {
      do {
        id = `d-${newId()}`;
      } while (decisionIds.has(id));
    }
    decisionIds.add(id);
    if (!DECISION_CALLS.has(d.call))
      return { error: `decision ${i}: "call" must be block|ship|decide` };
    if (!DECISION_SCOPES.has(d.scope)) {
      return { error: `decision ${i}: "scope" must be changed-line|whole-file|codebase` };
    }
    if (!DECISION_CONFIDENCE.has(d.confidence)) {
      return { error: `decision ${i}: "confidence" must be high|medium|low` };
    }
    if (typeof d.kind !== "string" || !d.kind.trim())
      return { error: `decision ${i}: "kind" is required` };
    if (typeof d.assertion !== "string" || !d.assertion.trim()) {
      return { error: `decision ${i}: "assertion" is required` };
    }
    if (typeof d.coverage !== "string" || !d.coverage.trim()) {
      return { error: `decision ${i}: "coverage" is required (the honesty ledger)` };
    }
    let evidence: SurfacePart[] | undefined;
    if (d.evidence != null) {
      const parsed = validateSurfaceParts(d.evidence);
      if (!parsed.ok) return { error: `decision ${i} evidence: ${parsed.error}` };
      // A diff whose before/after doesn't end in a newline renders a "No newline
      // at end of file" marker — pure noise in a review. Normalize it away.
      for (const p of parsed.parts) {
        if (p.kind === "diff" && Array.isArray(p.files)) {
          for (const f of p.files) {
            f.before = endWithNewline(f.before);
            f.after = endWithNewline(f.after);
          }
        }
      }
      evidence = parsed.parts;
    }
    let proposal: DecisionProposal | undefined;
    if (
      d.proposal &&
      typeof d.proposal === "object" &&
      typeof d.proposal.before === "string" &&
      typeof d.proposal.after === "string"
    ) {
      proposal = {
        before: endWithNewline(d.proposal.before),
        after: endWithNewline(d.proposal.after),
        ...(typeof d.proposal.filename === "string" && d.proposal.filename.trim()
          ? { filename: d.proposal.filename }
          : {}),
        ...(typeof d.proposal.note === "string" && d.proposal.note.trim()
          ? { note: d.proposal.note }
          : {}),
      };
    }
    const gaps = Array.isArray(d.gaps)
      ? d.gaps
          .filter((g: any) => g && typeof g.what === "string" && g.what.trim())
          .map((g: any) => ({
            what: g.what,
            ...(typeof g.proveScope === "string" ? { proveScope: g.proveScope } : {}),
          }))
      : undefined;
    decisions.push({
      id,
      call: d.call,
      kind: d.kind,
      scope: d.scope,
      assertion: d.assertion,
      ...(typeof d.impact === "string" && d.impact.trim() ? { impact: d.impact } : {}),
      ...(typeof d.details === "string" && d.details.trim() ? { details: d.details } : {}),
      confidence: d.confidence,
      coverage: d.coverage,
      ...(gaps && gaps.length ? { gaps } : {}),
      ...(typeof d.pivot === "string" && d.pivot.trim() ? { pivot: d.pivot } : {}),
      ...(evidence ? { evidence } : {}),
      ...(proposal ? { proposal } : {}),
    });
  }

  // The complete changed-file manifest is the Phase-1 trust backbone: every file
  // in the diff must be accounted for, and the manifest must agree with the
  // decisions both ways (no decision points at a file that isn't listed; no
  // file claims a decision that doesn't exist). See docs/review-form-factor.md.
  if (!Array.isArray(raw.manifest) || raw.manifest.length === 0) {
    return { error: '"manifest" must be a non-empty array (every changed file, no omissions)' };
  }
  const manifest: ManifestFile[] = [];
  const referencedDecisions = new Set<string>();
  for (let i = 0; i < raw.manifest.length; i++) {
    const f = raw.manifest[i];
    if (!f || typeof f !== "object") return { error: `manifest ${i}: must be an object` };
    if (typeof f.path !== "string" || !f.path.trim())
      return { error: `manifest ${i}: "path" is required` };
    if (!FILE_DISPOSITIONS.has(f.disposition)) {
      return {
        error: `manifest ${i}: "disposition" must be has-decision|reviewed-no-comment|mechanical-skipped`,
      };
    }
    let decisionId: string | undefined;
    if (f.disposition === "has-decision") {
      if (typeof f.decisionId !== "string" || !f.decisionId.trim())
        return { error: `manifest ${i} (${f.path}): "has-decision" requires a "decisionId"` };
      const ref: string = f.decisionId.trim();
      if (!decisionIds.has(ref)) {
        return { error: `manifest ${i} (${f.path}): decisionId "${ref}" matches no decision` };
      }
      referencedDecisions.add(ref);
      decisionId = ref;
    }
    manifest.push({
      path: f.path,
      disposition: f.disposition,
      added: nonNegInt(f.added),
      removed: nonNegInt(f.removed),
      ...(decisionId ? { decisionId } : {}),
      ...(typeof f.note === "string" && f.note.trim() ? { note: f.note } : {}),
    });
  }
  // Inverse integrity: a decision no manifest file claims is an ungrounded
  // decision — the manifest would no longer be the whole truth of the change.
  for (const dec of decisions) {
    if (dec.id && !referencedDecisions.has(dec.id)) {
      return {
        error: `decision "${dec.id}" (${dec.assertion}) is not linked from any manifest file; add a "has-decision" file for it`,
      };
    }
  }
  return { review: { brief: raw.brief, verdict, decisions, manifest } };
}

export function createApp({
  store,
  viewerHtml,
  guideMarkdown,
  setupText,
  playbookText = setupText,
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
    const invalid = validateFinding(input);
    if (invalid) return { error: invalid, status: 400 };
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
    intent?: string;
    risk?: RiskInput;
    budget?: string;
    manifest?: ManifestRowInput[];
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
    // Validate every real finding's honesty signal up front — before publishing
    // the verdict card — so a missing confidence/coverage rejects cleanly instead
    // of leaving an orphan verdict above a half-published review (§7 #2).
    for (const f of input.findings) {
      if (!isRealFinding(f)) continue;
      const invalid = validateFinding(f);
      if (invalid) return { error: `finding "${f.title.trim()}": ${invalid}`, status: 400 };
    }
    const badge = REVIEW_VERDICT[input.verdict ?? "comment"] ?? REVIEW_VERDICT.comment;
    // The verdict card is the review's map. It LEADS with the opinionated
    // overview (intent + risk + budget + priority manifest) when the agent
    // supplied structure, then the verdict markdown (summary + tally + findings
    // table + coverage), then the change map (the changed pieces and how they
    // interact). A raw `architecture` mermaid is the escape hatch when no
    // structured map is given.
    const verdictParts: SurfacePart[] = [];
    const overviewPart = buildOverview(input);
    if (overviewPart) verdictParts.push(overviewPart);
    verdictParts.push({ kind: "markdown", markdown: buildVerdictMarkdown(input) });
    // Where to look: the risk treemap (the manifest made visual). It supersedes
    // the churn bar (§8.4), so the bar only renders when there's no treemap.
    const treemap = buildRiskTreemap(input.manifest);
    if (treemap) verdictParts.push(treemap);
    // Can I trust it: the confidence × coverage quadrant over the findings.
    const quadrant = buildQuadrant(input.findings);
    if (quadrant) verdictParts.push(quadrant);
    // How it's wired: the change map (or a raw architecture mermaid escape hatch).
    const changeMapPart = input.changeMap ? buildChangeMap(input.changeMap) : undefined;
    if (changeMapPart) verdictParts.push(changeMapPart);
    else if (input.architecture?.trim()) {
      verdictParts.push({ kind: "mermaid", mermaid: input.architecture.trim() });
    }
    const churnChart =
      !treemap && Array.isArray(input.churn) ? buildChurnChart(input.churn) : undefined;
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
    // Real findings (title + problem) become cards; empty placeholder entries are
    // skipped. The honesty signal was already validated up front.
    for (const f of input.findings) {
      if (!isRealFinding(f)) continue;
      const { title, badge: fbadge, parts } = buildFinding(f);
      const r = await publishSurface({ parts, title, badge: fbadge, session });
      if (!("error" in r)) findings.push(r.surface.id);
    }
    return { session, verdict: verdictSurface.id, findings };
  }

  // Publish a decision-queue review (the agent-era form factor — see
  // docs/review-form-factor.md). Like publishSurface, an explicit session is
  // validated and a missing one auto-created. The Review is validated (the
  // honesty-ledger `coverage` is required on every decision) and stored per
  // session; the viewer renders it at /?review=<sessionId>.
  async function publishDecisions(input: {
    brief?: string;
    verdict?: string;
    decisions?: unknown;
    manifest?: unknown;
    session?: string;
    sessionTitle?: string;
    agent?: string;
    cwd?: string;
  }): Promise<{ sessionId: string; decisions: number } | { error: string; status: 400 | 404 }> {
    const parsed = coerceReview({
      brief: input.brief,
      verdict: input.verdict,
      decisions: input.decisions,
      manifest: input.manifest,
    });
    if ("error" in parsed) return { error: parsed.error, status: 400 };

    let sessionId = input.session;
    if (sessionId && !(await store.getSession(sessionId))) {
      return { error: `session "${sessionId}" not found`, status: 404 };
    }
    if (!sessionId) {
      const session = await store.createSession({
        agent: input.agent ?? "agent",
        title: input.sessionTitle?.slice(0, MAX_TITLE),
        cwd: input.cwd,
      });
      bus.broadcast({ type: "session-created", id: session.id });
      sessionId = session.id;
    }
    const review = await store.putReview(sessionId, parsed.review);
    if (!review) return { error: "session not found", status: 404 };
    // Push the (re-)published review to any open review page so a Prove-it /
    // Challenge revise updates the decision in place (docs/review-form-factor.md).
    bus.broadcast({ type: "review-updated", sessionId });
    return { sessionId, decisions: review.decisions.length };
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

  // Delete a whole surface (the card and all its versions). The shared flow
  // behind DELETE /api/surfaces/:id and the delete_surface MCP tool, so the
  // store removal and the surface-deleted broadcast happen in exactly one place.
  // Lets an agent clean up a stale or superseded card while iterating; prefer
  // reviseSurface to revise in place.
  async function deleteSurface(
    id: string,
  ): Promise<{ surface: Surface } | { error: string; status: 404 }> {
    const surface = await store.getSurface(id);
    if (!surface) return { error: "surface not found", status: 404 };
    await store.removeSurface(surface.id);
    bus.broadcast({ type: "surface-deleted", id: surface.id, sessionId: surface.sessionId });
    return { surface };
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
      author: comment.author,
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

  // CSRF / forged-feedback guard. The token-less local default authorizes every
  // request, so a malicious web page the user happens to also have open could
  // POST writes to localhost (a "simple" cross-origin request needs no preflight)
  // — forging the reserved author:"user" feedback signal to the agent, injecting,
  // or deleting surfaces. Block any state-changing /api or /mcp request whose
  // Origin is cross-origin. Browsers always send Origin on these; the CLI/MCP
  // clients send none (not a browser, no CSRF surface), and the viewer is
  // same-origin — so only the cross-origin attacker is turned away.
  const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  app.use("*", async (c, next) => {
    if (!STATE_CHANGING.has(c.req.method)) return next();
    const path = new URL(c.req.url).pathname;
    if (!path.startsWith("/api") && path !== "/mcp") return next();
    const origin = c.req.header("origin");
    if (!origin) return next(); // non-browser client (CLI / MCP) — no CSRF surface
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* malformed Origin → treat as cross-origin below */
    }
    if (originHost !== c.req.header("host")) {
      return c.json({ error: "cross-origin request blocked" }, 403);
    }
    return next();
  });

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
    if (path === "/guide" || path === "/setup" || path === "/playbook" || path === "/agent-howto")
      return next();

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
  app.get("/playbook", (c) => c.text(withOrigin(playbookText, c)));
  // Back-compat alias: older installed skill bootstraps fetch /agent-howto.
  app.get("/agent-howto", (c) => c.text(withOrigin(playbookText, c)));

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
    const [sessions, surfaces, comments, reviews] = await Promise.all([
      store.listSessions(),
      store.listSurfaces(),
      store.listComments({}),
      store.listReviews(),
    ]);
    // A decision-queue review session has no surfaces — without this it shows as
    // a blank row with no way back to the review. Carry its verdict so the row
    // can chip it and link to /?review=<id>.
    const reviewVerdict = new Map(reviews.map((r) => [r.sessionId, r.verdict]));
    const counts = new Map<string, number>();
    for (const s of surfaces) counts.set(s.sessionId, (counts.get(s.sessionId) ?? 0) + 1);
    // Open findings per session: a finding card (severity badge) with no
    // Approve/Dismiss marker comment. Drives the sidebar's resume count.
    const resolved = new Set<string>();
    for (const cm of comments) {
      if (cm.surfaceId && cm.author === "user" && isResolutionText(cm.text))
        resolved.add(cm.surfaceId);
    }
    const open = new Map<string, number>();
    // A session is a "review" if it carries any review-shaped card — a finding
    // (Bug/Nit/…), a verdict, or the `showcase review` placeholder — or a stored
    // decision-queue review. Everything else is a visualization/explainer. Drives
    // the sidebar's per-session icon and name, so sessions read as what they are.
    const reviewLabels = new Set<string>([
      ...FINDING_LABELS,
      ...Object.values(REVIEW_VERDICT).map((b) => b.label),
      REVIEW_PLACEHOLDER_LABEL,
    ]);
    const review = new Set<string>(reviewVerdict.keys());
    for (const s of surfaces) {
      if (s.badge && FINDING_LABELS.has(s.badge.label) && !resolved.has(s.id)) {
        open.set(s.sessionId, (open.get(s.sessionId) ?? 0) + 1);
      }
      if (s.badge && reviewLabels.has(s.badge.label)) review.add(s.sessionId);
    }
    return c.json(
      sessions.map((s) => ({
        ...s,
        surfaceCount: counts.get(s.id) ?? 0,
        openFindings: open.get(s.id) ?? 0,
        kind: review.has(s.id) ? "review" : "visual",
        ...(reviewVerdict.has(s.id) ? { reviewVerdict: reviewVerdict.get(s.id) } : {}),
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

  // Static export: a self-contained read-only .html of a whole session (surfaces
  // + comments + assets inlined) that renders with no server. The viewer reads
  // the inlined bundle in place of `/api/*` and runs read-only — so this is how
  // you share a review, not a GitHub round-trip. Behind auth like any session
  // read; the served file carries the session's data.
  app.get("/api/sessions/:id/export", async (c) => {
    const id = c.req.param("id");
    const bundle = await buildExportBundle(store, id);
    if (!bundle) return c.json({ error: "session not found" }, 404);
    const filename = exportFilename(
      bundle.sessions[0] ? (bundle.sessions[0] as any).title : null,
      id,
    );
    return c.body(renderExportHtml(viewerHtml, bundle), 200, {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    });
  });

  // The decision-queue review for a session (the agent-era form factor).
  app.get("/api/sessions/:id/review", async (c) => {
    const review = await store.getReview(c.req.param("id"));
    if (!review) return c.json({ error: "no review for this session" }, 404);
    return c.json(review);
  });
  app.post("/api/sessions/:id/review", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    // Delegate to the shared flow so validation + the review-updated broadcast
    // (the live half of the interaction loop) happen in exactly one place.
    const result = await publishDecisions({
      brief: body?.brief,
      verdict: body?.verdict,
      decisions: body?.decisions,
      manifest: body?.manifest,
      session: id,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(await store.getReview(id), 201);
  });

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
    const overview = coerceOverview(body);
    const result = await publishReview({
      verdict: str(body.verdict),
      branch: str(body.branch),
      base: str(body.base),
      summary: str(body.summary),
      coverage: str(body.coverage),
      architecture: str(body.architecture),
      intent: overview.intent,
      risk: overview.risk,
      budget: overview.budget,
      manifest: overview.manifest,
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

  const remove = async (c: any) => {
    const result = await deleteSurface(c.req.param("id"));
    if ("error" in result) return c.json({ error: result.error }, result.status);
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
    publishDecisions,
    reviseSurface,
    deleteSurface,
    createComment,
    waitForComments,
    uploadAsset,
    guide: guideMarkdown,
  });

  return app;
}
