// Shared data model — no runtime imports, safe for any platform.

export interface Session {
  id: string;
  agent: string;
  title: string | null;
  cwd: string | null;
  createdAt: string;
  lastActiveAt: string;
  // The session's pinned PRESET — a default explainer blueprint and/or theme
  // every surface in the session inherits when it doesn't set its own (see
  // server/blueprints.ts, resolveBlueprint). This is what makes a session
  // "configurable": pick a format once (a design-doc session, a product-demo
  // session) and every surface comes out in that structure + look, no matter
  // what the user asks. The first publish that carries a blueprint/theme pins it;
  // a later explicit value re-pins. Unset → the board default.
  blueprint?: string;
  theme?: string;
  // Highest comment seq already delivered to the agent — lets responses to
  // agent writes piggyback comments the agent has not seen yet.
  agentSeq: number;
}

// A surface is an ordered list of parts. Each part declares its own kind;
// the surface itself is kind-agnostic. An `html` part is arbitrary agent
// markup (rendered sandboxed in an iframe); `diff`, `image`, `trace`,
// `markdown`, `terminal`, and `mermaid` parts are structured data rendered by
// the trusted viewer. A snippet is just a surface with one html part; a
// diagram-with-its-diff is `[html, diff]`.
export type SurfacePartKind =
  | "html"
  | "diff"
  | "image"
  | "trace"
  | "markdown"
  | "terminal"
  | "mermaid"
  | "json"
  | "code"
  | "chart";

export interface HtmlPart {
  kind: "html";
  html: string;
  // Opt-in style/behavior bundles (see kits.ts). The sandbox doc gets each
  // listed kit's CSS/JS injected after the base kit; omit for plain html.
  kits?: string[];
}

// A markdown part is prose the trusted viewer renders — explanations, plans,
// tradeoff write-ups. Unlike an html part it is NOT sandboxed: the viewer
// renders it to HTML in its own origin, so raw HTML embedded in the source is
// escaped, not executed (see MarkdownPart.tsx). Agents wanting live markup use
// an html part instead.
export interface MarkdownPart {
  kind: "markdown";
  markdown: string;
}

// A mermaid part is diagram source (flowchart, sequence, ERD, gantt, …) the
// trusted viewer renders to SVG with the mermaid library. Like markdown it is
// NOT sandboxed: mermaid renders in the viewer's own origin with
// securityLevel 'strict', sanitizing the SVG and disabling scripts/HTML labels
// (see MermaidPart.tsx). Agents wanting hand-drawn vector art use an html part
// with inline <svg> instead.
export interface MermaidPart {
  kind: "mermaid";
  mermaid: string;
}

export interface DiffFile {
  filename: string;
  before: string;
  after: string;
  // Shiki language id; inferred from the filename when omitted.
  language?: string;
}

export interface DiffPart {
  kind: "diff";
  // A unified/git patch (may span multiple files) and/or explicit before/after
  // file pairs. At least one must be present; the viewer prefers `patch`.
  patch?: string;
  files?: DiffFile[];
  layout?: "unified" | "split";
}

// An image part references an uploaded asset by id; the trusted viewer renders
// it as a plain <img> in its own chrome (no iframe). Agents can also embed the
// asset's URL inside an html part instead — both paths resolve to /a/:id.
export interface ImagePart {
  kind: "image";
  assetId: string;
  alt?: string;
  caption?: string;
}

// One step in an agent trace. `label` is the one-line summary; `detail` is the
// expandable body (tool output, args, reasoning). Everything else is optional.
export interface TraceStep {
  label: string;
  kind?: string;
  detail?: string;
  ts?: string;
}

// A trace part renders a step timeline the viewer shows beside the surface.
// `steps` travel inline (small, structured); `assetId` points at a larger
// uploaded trace file (JSON/JSONL), offered for download and rendered when it
// parses. At least one of the two is present.
export interface TracePart {
  kind: "trace";
  steps?: TraceStep[];
  assetId?: string;
  title?: string;
}

// A terminal part renders monospace terminal output the viewer styles as a
// terminal window. `text` travels inline (like html) — raw output that may
// carry ANSI SGR escapes (colors/bold/italic); the viewer converts those to
// styled spans and HTML-escapes everything else. `cols` is an optional render
// width hint; `title` labels the window chrome. The renderer is intentionally
// SGR-only for now (cursor-addressing TUIs aren't resolved) — the wire shape
// is renderer-agnostic so a full VT emulator can replace it later.
export interface TerminalPart {
  kind: "terminal";
  text: string;
  cols?: number;
  title?: string;
}

// A json part is a pre-parsed JSON value the trusted viewer renders as a
// collapsible tree (objects/arrays expand and collapse; primitives show inline).
// Like image/trace it is DATA, not markup: the viewer renders it with Solid
// text nodes, which escape by construction — so agent-authored JSON can never
// execute in the trusted viewer origin, and no sandboxed iframe is needed.
// `data` is `unknown` (any JSON value, including null); the wire body already
// parsed it, so the viewer never needs to JSON.parse.
export interface JsonPart {
  kind: "json";
  data: unknown;
}

// A code part is source code the trusted viewer highlights with shiki (the
// same highlighter MarkdownPart uses for fenced code blocks) and renders in a
// sandboxed iframe. Like markdown/mermaid it is DATA, not markup: the viewer
// produces the HTML string via shiki, then SandboxedPart parses it inside an
// opaque-origin iframe. `language` is a shiki lang id (ts, js, python, rust,
// go, ...); omit or use "text" for plain monospace. `title` is an optional
// label (e.g. a filename) shown above the code.
export interface CodePart {
  kind: "code";
  code: string;
  language?: string;
  title?: string;
  // 1-based line number the displayed code starts at (e.g. 80 for "lines
  // 80-150 of x.ts"). The viewer renders line numbers starting here instead
  // of 1, so an agent can show an excerpt with its original line numbers.
  lineStart?: number;
}

// A chart part is structured numeric data the trusted viewer renders as an SVG
// chart with Recharts. Like image/json/trace it is DATA, not markup: Recharts
// emits the chart through React elements (every label becomes a text node), so
// it escapes by construction and needs no sandbox — agent-authored chart data
// can never execute in the trusted viewer origin. Axes/grid/tooltip colors come
// from the live theme tokens, so charts re-theme with the board.
//
// `data` is row-oriented (an array of objects). `x` names the category field
// (the x axis for bar/line/area, the slice label for pie); `y` names the numeric
// series — one field, or several to plot multiple series / a stacked chart.
//
// Two review-oriented forms carry a second visual dimension (§8): a `treemap`
// (area = `y` value, e.g. churn; `x` = the cell label) and a `scatter` (a
// confidence×coverage quadrant; `x`/`y` are the two numeric axis fields). Both
// read an optional per-row `tone` field ("sensitive"/"logic"/"mechanical" for a
// treemap; "danger"/"normal" for a scatter point) to color the cell/point from a
// fixed palette — no agent-supplied color, so nothing to sanitize.
export interface ChartPart {
  kind: "chart";
  chartType: "bar" | "line" | "area" | "pie" | "treemap" | "scatter";
  data: Array<Record<string, string | number | null>>;
  x: string;
  y: string | string[];
  // Stack bars/areas instead of grouping them (ignored for line/pie).
  stacked?: boolean;
  // Explicit series colors (per `y` series, or per slice for a pie), overriding
  // the default accent→palette cycle — e.g. green/red for added/removed churn.
  // Validated to safe CSS color tokens in surfaceParts.ts.
  colors?: string[];
  xLabel?: string;
  yLabel?: string;
  caption?: string;
}

export type SurfacePart =
  | HtmlPart
  | DiffPart
  | ImagePart
  | TracePart
  | MarkdownPart
  | TerminalPart
  | MermaidPart
  | JsonPart
  | CodePart
  | ChartPart;

// A short, colored chip on a surface's header. Deliberately generic (not
// PR-specific), but the driver is review **finding cards**: `tone` picks the
// color, `label` is the word the user scans — "Bug" / "Nit" / "Question" /
// "Praise". Carried with the versioned content so a finding can change severity
// across revisions (e.g. an agent downgrades a bug to a nit after a fix).
export type SurfaceBadgeTone = "critical" | "warning" | "info" | "success" | "neutral";

export interface SurfaceBadge {
  tone: SurfaceBadgeTone;
  label: string;
}

export const SURFACE_BADGE_TONES: readonly SurfaceBadgeTone[] = [
  "critical",
  "warning",
  "info",
  "success",
  "neutral",
];

export interface SurfaceVersion {
  version: number;
  title: string;
  parts: SurfacePart[];
  badge?: SurfaceBadge;
  at: string;
}

export interface Surface {
  id: string;
  sessionId: string;
  title: string;
  parts: SurfacePart[];
  createdAt: string;
  updatedAt: string;
  version: number;
  history: SurfaceVersion[];
  // A scannable status chip in the header — review severity ("Bug"/"Nit"/…),
  // or any short label. Versioned content (see SurfaceBadge).
  badge?: SurfaceBadge;
  // Theme id this surface renders under (see server/themes.ts). Unset → the
  // board default. Lets one mockup pick the brand palette while another stays
  // neutral, without a global switch.
  theme?: string;
  // Explainer blueprint applied at publish (see server/blueprints.ts). The
  // blueprint's theme + kits are already baked into `theme`/parts above; the id
  // rides along so the brand can be re-resolved at render and the provenance is
  // visible. Unset → no blueprint.
  blueprint?: string;
}

// --- the agent-era review form factor (see docs/review-form-factor.md) ---
// A review is a plain-English Brief plus a risk-ranked queue of decisions the
// agent has triaged out of the diff for the human to adjudicate. The analysis is
// the `code-review` skill's; this is the rendering contract. Stored per session
// (one Review per review session), distinct from the card stream.

export type DecisionCall = "block" | "ship" | "decide";
export type DecisionScope = "changed-line" | "whole-file" | "codebase";
export type DecisionConfidence = "high" | "medium" | "low";

export interface Decision {
  // Short, stable, copy-pasteable ref (e.g. "d-7Qa…"). Stable across
  // re-publishes so local adjudication + the chat trail survive a revise, and so
  // the human can paste it into normal agent chat to scope a revision. The server
  // assigns one when the agent omits it (see coerceReview).
  id?: string;
  call: DecisionCall; // block | ship | decide — the recommendation
  kind: string; // bug | fix | capability | refactor | migration | risk
  scope: DecisionScope; // how far the reviewer must look to judge it
  assertion: string; // one sentence — the conclusion
  impact?: string; // why it matters — who hits it, how bad
  // The fuller explanation (markdown): the reasoning behind the call, edge cases,
  // how the code actually behaves. Rendered under the one-line assertion/impact
  // for anyone who wants the depth; the assertion stays the scannable headline.
  details?: string;
  confidence: DecisionConfidence; // how sure the agent is — the surfaced honesty signal
  pivot?: string; // conditional — "flips to ✅ if …"; omit unless there's a real fork
  evidence?: SurfacePart[]; // right-pane artifacts; absent → that decision is full-width
  // A concrete suggested change, rendered under the evidence as a before→after
  // diff ("Suggested change"). For block/decide decisions that propose a fix.
  proposal?: DecisionProposal;
}

export interface DecisionProposal {
  before: string;
  after: string;
  filename?: string; // labels the diff; defaults to a neutral name
  note?: string; // one line on why the change is better
}

// How a changed file is accounted for in the complete manifest. Every file in
// the diff carries one, so a file the agent triaged out can't silently vanish —
// the human can see and account for the whole change, not just the decisions.
//   - has-decision      → surfaced as a risk-ranked Decision (carries decisionId)
//   - reviewed-no-comment → the agent read it and had nothing to flag
//   - mechanical-skipped  → lockfile/generated/formatting churn it skimmed
export type FileDisposition = "has-decision" | "reviewed-no-comment" | "mechanical-skipped";

export interface ManifestFile {
  path: string;
  disposition: FileDisposition;
  added: number; // lines added (churn; display only)
  removed: number; // lines removed
  decisionId?: string; // links to its Decision when disposition === "has-decision"
  note?: string; // one-line "what it is / why it was skipped"
}

export interface Review {
  sessionId: string;
  brief: string; // ≤4 sentences, plain English, no identifiers
  verdict: "block" | "approve" | "comment"; // the bottom line (a consequence of the decisions)
  decisions: Decision[]; // risk-ranked; decisions[0] is the lede
  // The complete changed-file manifest — EVERY file in the diff, each tagged with
  // its disposition, so nothing the agent triaged away is hidden. Optional on the
  // type for older stored reviews; required for new publishes (see coerceReview).
  manifest?: ManifestFile[];
  // A non-blocking, server-computed FORMAT warning about the Brief (e.g. it reads
  // like code, not plain English). Surfaced as a chip in the viewer and cleared on
  // the next clean re-publish; never rejects the publish. See coerceReview.
  briefWarning?: string;
  // Non-blocking, server-computed warnings about the DECISIONS' evidence — a code
  // decision with nothing to look at, or a diff whose patch won't render. They ride
  // back on the publish response so the agent self-corrects, and surface as viewer
  // chips. Never reject the publish. See coerceReview / reviewEvidenceWarnings.
  warnings?: string[];
  createdAt: string;
  updatedAt: string;
}

// What a publisher hands in (the server stamps sessionId + timestamps).
// `briefWarning`/`warnings` are the fields the publisher does NOT supply —
// coerceReview derives them from the review's shape and they ride through to the
// stored Review.
export interface CreateReviewInput {
  brief: string;
  verdict?: "block" | "approve" | "comment";
  decisions: Decision[];
  manifest?: ManifestFile[];
  briefWarning?: string;
  warnings?: string[];
}

export interface Comment {
  id: string;
  seq: number;
  sessionId: string;
  surfaceId: string | null;
  surfaceTitle: string | null;
  author: string;
  text: string;
  createdAt: string;
}

// An uploaded blob (image, trace file, arbitrary file) the agent pushes once and
// references by id. Stored apart from surfaces so binary never bloats the parts
// JSON or the 2 MB surface limit. `data` is raw bytes — base64 is an edge-only
// encoding (HTTP/MCP request bodies, JsonFileStore's on-disk JSON).
export type AssetKind = "image" | "trace" | "file";

export const isAssetKind = (v: unknown): v is AssetKind =>
  v === "image" || v === "trace" || v === "file";

export interface Asset {
  id: string;
  sessionId: string;
  kind: AssetKind;
  contentType: string;
  byteLength: number;
  filename: string | null;
  data: Uint8Array;
  createdAt: string;
  // Bumped on each serve; drives the reference-aware LRU eviction below.
  lastAccessedAt: string;
}

export interface CreateAssetInput {
  sessionId: string;
  kind: AssetKind;
  contentType: string;
  filename?: string;
  data: Uint8Array;
}

export interface CreateSessionInput {
  agent: string;
  title?: string;
  cwd?: string;
  // The preset to pin on the new session (see Session.blueprint/theme). The
  // publish flow passes the first publish's preset, or the board default when
  // none was given, so every session is born with a format.
  blueprint?: string;
  theme?: string;
}

// Pin or change a session's preset after creation (the MCP configure_session
// tool / PATCH /api/sessions/:id). `null` clears the field; `undefined` leaves
// it unchanged — same convention as UpdateSurfaceInput.
export interface SessionPresetInput {
  blueprint?: string | null;
  theme?: string | null;
}

export interface CreateSurfaceInput {
  sessionId: string;
  title?: string;
  parts: SurfacePart[];
  badge?: SurfaceBadge;
  theme?: string;
  blueprint?: string;
}

export interface UpdateSurfaceInput {
  title?: string;
  parts?: SurfacePart[];
  // `null` clears the badge; `undefined` leaves it unchanged.
  badge?: SurfaceBadge | null;
  // `null` resets to the board default; `undefined` leaves it unchanged.
  theme?: string | null;
  // `null` clears the blueprint; `undefined` leaves it unchanged.
  blueprint?: string | null;
}

export interface CreateCommentInput {
  sessionId: string;
  surfaceId?: string;
  author: string;
  text: string;
}

export interface CommentQuery {
  sessionId?: string;
  surfaceId?: string;
  afterSeq?: number;
}

// Storage interface — implemented by JsonFileStore (the only store in this
// local fork). Kept as an interface so the store-contract test can hold a
// future second implementation honest.
export interface Store {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session | null>;
  createSession(input: CreateSessionInput): Promise<Session>;
  renameSession(id: string, title: string): Promise<Session | null>;
  // Pin/change/clear the session's preset (blueprint + theme). Returns the
  // updated session, or null if it doesn't exist.
  setSessionPreset(id: string, preset: SessionPresetInput): Promise<Session | null>;
  removeSession(id: string): Promise<boolean>;
  // Advance the delivered-to-agent comment cursor (never moves backwards).
  markAgentSeen(sessionId: string, seq: number): Promise<void>;

  listSurfaces(sessionId?: string): Promise<Surface[]>;
  getSurface(id: string): Promise<Surface | null>;
  createSurface(input: CreateSurfaceInput): Promise<Surface | null>;
  updateSurface(id: string, patch: UpdateSurfaceInput): Promise<Surface | null>;
  removeSurface(id: string): Promise<boolean>;

  listComments(query: CommentQuery): Promise<Comment[]>;
  createComment(input: CreateCommentInput): Promise<Comment | null>;

  // The decision-queue review for a session (one per session; replaces it on
  // re-publish). putReview returns null only if the session is missing.
  getReview(sessionId: string): Promise<Review | null>;
  listReviews(): Promise<Review[]>;
  putReview(sessionId: string, input: CreateReviewInput): Promise<Review | null>;

  // Assets. putAsset evicts to stay under MAX_BOARD_ASSET_BYTES (see
  // selectEvictions) and returns null only if the session is missing.
  putAsset(input: CreateAssetInput): Promise<Asset | null>;
  getAsset(id: string): Promise<Asset | null>;
  // Bump lastAccessedAt (called when bytes are served), keeping live assets warm.
  touchAsset(id: string): Promise<void>;
  listAssets(sessionId: string): Promise<Asset[]>;
  removeAsset(id: string): Promise<boolean>;
  // Whether any live surface (current or historical version) references this
  // asset id. Drives the optimistic-read wait and reference-aware deletion.
  isAssetReferenced(id: string): Promise<boolean>;
}

export const HISTORY_LIMIT = 20;

// Per-asset upload cap (enforced at the HTTP/MCP edge → 413) and the board-wide
// budget the store evicts down to. The whole board lives in memory and is
// rewritten to one JSON file per mutation (see JsonFileStore), so the budget
// bounds resident size, not just disk.
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_BOARD_ASSET_BYTES = 2 * 1024 * 1024 * 1024;

// Short, unguessable id: 8 random bytes (64 bits) as 11 url-safe base64 chars —
// YouTube-video-id sized. These double as bearer capabilities: in publicRead
// mode `/s/:id` and `/api/{sessions,surfaces}/:id` are reachable without the
// board token, so the id IS the share secret and must resist enumeration. 64
// bits (~1.8e19) is far past sweepable; the old `randomUUID().split("-")[0]`
// kept only the first 32-bit segment (~4e9), brute-forceable in about an hour.
// (Assets use a separate content-hash id, not this.) btoa/crypto are Web
// platform globals — no `node:` import, per the runtime-agnostic invariant.
export const newId = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(8))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

// Content-addressed asset id: the lowercase hex SHA-256 of the bytes. Because
// it depends only on the content, an agent can derive `/a/:id` from the bytes
// alone — no upload round-trip — and write the URL into a surface before (or
// while) the upload lands. Identical uploads collapse to one stored blob.
// Uses Web Crypto (a platform global, no `node:` import) to stay runtime-agnostic.
export async function hashAssetId(data: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer-backed view: digest wants a definite
  // ArrayBuffer, and this also avoids the SharedArrayBuffer-backed lib type.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A snippet is sugar for a single html part; this bridges the legacy
// `{ html }` shape (CLI `publish`, `POST /api/snippets`) to the parts model.
// An optional `kits` list opts the part into style/behavior bundles (kits.ts).
export const htmlPart = (html: string, kits?: unknown): HtmlPart => ({
  kind: "html",
  html,
  ...(Array.isArray(kits) && kits.length > 0
    ? { kits: kits.filter((k) => typeof k === "string") }
    : {}),
});

// The combined byte weight of a surface's parts, for size limits. image/trace
// parts are tiny (refs + inline steps) — the asset bytes they point at are
// bounded separately by MAX_ASSET_BYTES, not this surface cap.
export function partsByteLength(parts: SurfacePart[]): number {
  let n = 0;
  for (const p of parts) {
    if (p.kind === "html") n += p.html.length;
    else if (p.kind === "diff") {
      n += p.patch?.length ?? 0;
      for (const f of p.files ?? []) n += f.before.length + f.after.length;
    } else if (p.kind === "image") {
      n += p.assetId.length + (p.alt?.length ?? 0) + (p.caption?.length ?? 0);
    } else if (p.kind === "markdown") {
      n += p.markdown.length;
    } else if (p.kind === "terminal") {
      n += p.text.length + (p.title?.length ?? 0);
    } else if (p.kind === "mermaid") {
      n += p.mermaid.length;
    } else if (p.kind === "json") {
      n += JSON.stringify(p.data).length;
    } else if (p.kind === "code") {
      n +=
        p.code.length + (p.language?.length ?? 0) + (p.title?.length ?? 0) + (p.lineStart ? 4 : 0);
    } else if (p.kind === "chart") {
      n +=
        JSON.stringify(p.data).length +
        p.x.length +
        (Array.isArray(p.y) ? p.y.join("").length : p.y.length) +
        (p.xLabel?.length ?? 0) +
        (p.yLabel?.length ?? 0) +
        (p.caption?.length ?? 0);
    } else {
      n += (p.assetId?.length ?? 0) + (p.title?.length ?? 0);
      for (const s of p.steps ?? []) {
        n += s.label.length + (s.kind?.length ?? 0) + (s.detail?.length ?? 0);
      }
    }
  }
  return n;
}

// Collect the asset ids an ordered parts list references (image/trace parts).
// Used to keep referenced assets out of eviction's first wave. Note: assets
// embedded by raw URL inside html markup are invisible here — touch-on-serve
// keeps those warm instead.
export function collectAssetIds(parts: SurfacePart[], out: Set<string>): void {
  for (const p of parts) {
    if (p.kind === "image") out.add(p.assetId);
    else if (p.kind === "trace" && p.assetId) out.add(p.assetId);
  }
}

export interface EvictionCandidate {
  id: string;
  byteLength: number;
  lastAccessedAt: string;
  referenced: boolean;
}

// Pick the assets to evict so `incomingBytes` fits under `budget`. Oldest
// (lastAccessedAt) first, but unreferenced assets go before referenced ones —
// a live embed is only evicted as a last resort, once unreferenced candidates
// are exhausted. Returns the ids to remove (possibly empty).
export function selectEvictions(
  candidates: EvictionCandidate[],
  incomingBytes: number,
  budget: number,
): string[] {
  let total = candidates.reduce((sum, c) => sum + c.byteLength, 0);
  if (total + incomingBytes <= budget) return [];
  const order = [...candidates].sort((a, b) => {
    if (a.referenced !== b.referenced) return a.referenced ? 1 : -1;
    return a.lastAccessedAt.localeCompare(b.lastAccessedAt);
  });
  const evict: string[] = [];
  for (const c of order) {
    if (total + incomingBytes <= budget) break;
    evict.push(c.id);
    total -= c.byteLength;
  }
  return evict;
}
