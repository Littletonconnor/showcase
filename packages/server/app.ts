import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { decodeBase64 } from "@showcase/core/base64";
import { type ConfigKind, CONFIG_KINDS, validateConfig } from "@showcase/core/configSchema";
import { EventBus } from "@showcase/core/events";
import { buildExportBundle, exportFilename, renderExportHtml } from "@showcase/core/export";
import {
  type Blueprint,
  blueprintById,
  blueprintSummaries,
  isKnownBlueprint,
  registerBlueprints,
  resolveBlueprint,
} from "@showcase/core/blueprints";
import { type Kit, kitSummaries, registerKits } from "@showcase/core/kits";
import { registerMcp } from "./mcpHttp.ts";
import { renderHtmlPage } from "@showcase/core/surfacePage";
import {
  addTheme,
  DEFAULT_THEME_ID,
  isKnownTheme,
  registerThemes,
  type Theme,
  themeById,
  themeIds,
} from "@showcase/core/themes";
import { deriveTheme, type ThemeSeed } from "@showcase/core/themeDerive";
import { PRESET_RENDERERS } from "./presetRenders.ts";
import {
  coerceBeat,
  coerceLesson,
  formatTelemetryComment,
  renderBeatParts,
  renderLessonSurfaces,
  renderSyllabusParts,
  SANDBOX_TELEMETRY_TYPES,
  type TelemetryEvent,
  validateTelemetryEvent,
} from "@showcase/core/lesson";
import type { MasteryStore } from "./masteryStore.ts";
import {
  type Asset,
  type AssetKind,
  type Comment,
  type CreateReviewInput,
  type Decision,
  type DecisionProposal,
  type ManifestFile,
  htmlPart,
  isAssetKind,
  isCheckpointKind,
  MAX_ASSET_BYTES,
  newId,
  partsByteLength,
  type Session,
  type SessionPresetInput,
  type Store,
  type Surface,
  type SurfaceBadge,
  type SurfacePart,
} from "@showcase/core/types";
import { coerceSurfaceBadge, validateSurfaceParts } from "@showcase/core/surfaceParts";

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
  // User-authored extensions layered over the built-in registries (brand
  // palettes, custom kits, explainer blueprints) — loaded from local config by
  // server/userConfig.ts and registered before any route runs. Omitted → just
  // the built-ins. See docs/themable-explainers.md.
  extraThemes?: Theme[];
  extraKits?: Kit[];
  extraBlueprints?: Blueprint[];
  // Board defaults applied to every NEW session that doesn't name its own preset
  // — so a repo (or user) can make all its sessions start in one format (a
  // design-doc board, a product-demo board). Resolved from layered config by
  // server/userConfig.ts (repo .showcase wins over user ~/.showcase). An unknown
  // id is ignored at use. See docs/themable-explainers.md.
  defaultBlueprint?: string;
  defaultTheme?: string;
  // Persist a runtime-authored brand theme (POST /api/themes ... persist:true) to
  // the user config dir so it survives a restart. Node-only (fs); injected by
  // index.ts to keep app.ts runtime-agnostic. Omitted → authored themes are
  // in-memory only (live for this process).
  persistTheme?: (theme: Theme) => Promise<void>;
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
  // Structured request logging: when set, emit one JSON line per /api (and /mcp)
  // request — method, path, status, duration. Off by default so the local board
  // stays quiet and the CLI's auto-start capture isn't polluted; `index.ts` wires
  // it from SHOWCASE_LOG. The /api/health probe is excluded so a polling monitor
  // doesn't flood the log with its own heartbeat.
  requestLog?: boolean;
  // Test seam: replaces the npm-registry/GitHub lookup for the latest release.
  fetchLatestRelease?: () => Promise<LatestRelease | null>;
  // Learner mastery persistence (the learn vertical's cross-session memory —
  // docs/learn-form-factor.md). Node-backed, so index.ts injects it like the
  // board store. Omitted (e.g. embedders that don't teach) → lessons still
  // publish and telemetry still flows; only mastery/review-due degrade to empty.
  masteryStore?: MasteryStore;
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
  ...(s.theme ? { theme: s.theme } : {}),
  ...(s.blueprint ? { blueprint: s.blueprint } : {}),
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
  if (path === "/api/blueprints") return true;
  if (path === "/api/themes") return true;
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
  ...(s.theme ? { theme: s.theme } : {}),
  ...(s.blueprint ? { blueprint: s.blueprint } : {}),
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
}

// A referenced session that doesn't exist is almost always a cached id that
// outlived the backend (restart, wiped data file, deleted session). Say so, and
// say the fix — omit the id to mint a fresh one — so a stale client self-heals
// instead of wedging. The stdio MCP matches this text to re-mint automatically.
const sessionNotFound = (id: string) =>
  `session "${id}" not found — it may predate a server restart or have been deleted; omit the session id to start a fresh one`;

// Lean comment shape attached to agent-facing responses.
const feedbackView = (c: Comment): Feedback => ({
  surfaceId: c.surfaceId,
  surfaceTitle: c.surfaceTitle,
  text: c.text,
  at: c.createdAt,
});

// Validate a published Review (the decision-queue form factor — see
// docs/review-form-factor.md). Returns the normalized input or an error string.
// `confidence` is the one honesty signal surfaced per decision; evidence reuses
// the surface-part validator, so right-pane artifacts meet the card bar.
const endWithNewline = (s: string) => (s.length && !s.endsWith("\n") ? s + "\n" : s);
const DECISION_CALLS = new Set(["block", "ship", "decide"]);
const DECISION_SCOPES = new Set(["changed-line", "whole-file", "codebase"]);
const DECISION_CONFIDENCE = new Set(["high", "medium", "low"]);
const FILE_DISPOSITIONS = new Set(["has-decision", "reviewed-no-comment", "mechanical-skipped"]);
const nonNegInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

// Pure FORMAT validation for the Brief — warn-only, never a reject (a mid-loop
// rejection would break the publish→render→revise loop). It checks shape, never
// quality: too many sentences, or code where plain English belongs (fenced/inline
// backticks, file:line refs, fn() calls, snake_case / CamelCase identifiers).
// Ordinary domain nouns and SHOUTY_ENV vars are allowed. Returns a short reason
// for the viewer's chip, or undefined when the Brief is clean.
export function checkBriefFormat(brief: string): string | undefined {
  const reasons: string[] = [];
  const sentences = brief
    .trim()
    .split(/[.!?]+(?:\s|$)/)
    .filter((s) => s.trim().length > 0);
  if (sentences.length > 4) reasons.push(`${sentences.length} sentences (aim for ≤4)`);
  if (/`/.test(brief)) reasons.push("backtick code");
  if (/[\w/.-]+\.[a-z]{1,6}:\d+/i.test(brief)) reasons.push("a file:line reference");
  if (/\b[A-Za-z_]\w*\(\)/.test(brief)) reasons.push("a function() call");
  // snake_case but NOT all-caps SHOUTY_ENV (SHOWCASE_TOKEN is an allowed token).
  if (/\b[a-z]\w*_\w+\b/.test(brief)) reasons.push("snake_case identifiers");
  // camelCase / PascalCase — an internal capital (someFn, ReviewView). A single
  // Capitalized word (sentence start, a proper noun) is fine.
  if (/\b[A-Za-z][a-z0-9]*[A-Z]\w*/.test(brief)) reasons.push("CamelCase identifiers");
  if (reasons.length === 0) return undefined;
  return `Brief reads like code, not plain English — contains ${reasons.join(", ")}.`;
}

// A real unified/git diff hunk header carries line ranges (`@@ -12,3 +12,4 @@`); a
// hand-authored pseudo-patch with prose markers (`@@ writer (this PR) @@`) does not,
// so @pierre/diffs parses it into empty hunks and the diff renders blank.
const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;

// Warn-only checks on each decision's EVIDENCE — never a reject (same reasoning as
// checkBriefFormat: a mid-loop rejection breaks the publish→render→revise loop).
// Surfaces the two evidence failures dogfooding caught: a code decision with nothing
// to look at, and a diff whose patch won't render.
export function reviewEvidenceWarnings(decisions: Decision[]): string[] {
  const out: string[] = [];
  for (const d of decisions) {
    const evidence = d.evidence ?? [];
    const ref = d.id ? `"${d.id}"` : `"${d.assertion.slice(0, 40)}…"`;
    // Points at specific code (changed-line / whole-file) but shows the reviewer
    // nothing — no evidence diff, no suggested-fix. Codebase-scope calls can be
    // legitimately prose-only, so they're exempt.
    if (
      evidence.length === 0 &&
      !d.proposal &&
      (d.scope === "changed-line" || d.scope === "whole-file")
    ) {
      out.push(
        `Decision ${ref} (scope: ${d.scope}) has no evidence — attach a diff so the reviewer can see the code it judges.`,
      );
    }
    for (const p of evidence) {
      if (p.kind === "diff" && typeof p.patch === "string" && !HUNK_HEADER_RE.test(p.patch)) {
        out.push(
          `Decision ${ref}: evidence patch has no valid diff hunk header and won't render — use files:[{before,after}] or real \`git diff\` output.`,
        );
      }
    }
  }
  return out;
}

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
    decisions.push({
      id,
      call: d.call,
      kind: d.kind,
      scope: d.scope,
      assertion: d.assertion,
      ...(typeof d.impact === "string" && d.impact.trim() ? { impact: d.impact } : {}),
      ...(typeof d.details === "string" && d.details.trim() ? { details: d.details } : {}),
      confidence: d.confidence,
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
  const briefWarning = checkBriefFormat(raw.brief);
  const warnings = reviewEvidenceWarnings(decisions);
  return {
    review: {
      brief: raw.brief,
      verdict,
      decisions,
      manifest,
      ...(briefWarning ? { briefWarning } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    },
  };
}

export function createApp({
  store,
  viewerHtml,
  guideMarkdown,
  setupText,
  playbookText = setupText,
  extraThemes,
  extraKits,
  extraBlueprints,
  defaultBlueprint,
  defaultTheme,
  persistTheme,
  dev = false,
  authenticate,
  authToken,
  basePath,
  publicRead,
  version,
  upgradeCommand,
  requestLog,
  fetchLatestRelease,
  masteryStore,
}: AppOptions) {
  // Layer user config over the built-in registries before any route resolves a
  // theme/kit/blueprint. Each register* call REPLACES its extras, so building a
  // fresh app (e.g. per test) resets cleanly rather than accumulating.
  registerThemes(extraThemes ?? []);
  registerKits(extraKits ?? []);
  registerBlueprints(extraBlueprints ?? []);

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

  // When this app was created — the basis for /api/health's uptime. Close enough
  // to process start: index.ts builds the app immediately before listen().
  const startedAt = Date.now();
  // The most recent unhandled error, surfaced (message + when) by /api/health so
  // a glance at the board status shows whether something has been crashing. The
  // stack stays server-side (console.error below); only a short message leaks.
  let lastError: { message: string; at: string } | null = null;

  // Last-resort safety net: any handler that throws (rather than returning a
  // status) becomes a clean JSON 500 instead of leaking a stack or a bare crash.
  // Validation rejects bad input with 4xx before this, so reaching here means an
  // unexpected bug — log it so it isn't swallowed silently.
  app.onError((err, c) => {
    console.error("showcase: unhandled error", err);
    lastError = {
      message: err instanceof Error ? err.message : String(err),
      at: new Date().toISOString(),
    };
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

  // Preset helpers. Keep only KNOWN ids — an unknown blueprint/theme is ignored
  // rather than pinned or stored (resolveBlueprint validates the same way for
  // rendering). Board defaults come from layered config (repo/user) via index.ts.
  const pickBlueprint = (id: string | null | undefined): string | undefined =>
    isKnownBlueprint(id) ? id : undefined;
  const pickTheme = (id: string | null | undefined): string | undefined =>
    isKnownTheme(id) ? id : undefined;
  const boardDefaultBlueprint = (): string | undefined => pickBlueprint(defaultBlueprint);
  const boardDefaultTheme = (): string | undefined => pickTheme(defaultTheme);

  // --- shared flows (used by both the REST API and the MCP endpoint) ---

  // Pin/change a session's preset without publishing — the MCP configure_session
  // tool and PATCH /api/sessions/:id. Lets a user set "this is a design-doc
  // session" up front, then ask anything. Only known ids stick; `null` clears.
  async function configureSession(
    sessionId: string,
    preset: SessionPresetInput,
  ): Promise<{ session: Session } | { error: string; status: 404 }> {
    const sanitized: SessionPresetInput = {};
    if (preset.blueprint !== undefined) {
      sanitized.blueprint =
        preset.blueprint === null ? null : (pickBlueprint(preset.blueprint) ?? null);
    }
    if (preset.theme !== undefined) {
      sanitized.theme = preset.theme === null ? null : (pickTheme(preset.theme) ?? null);
    }
    const session = await store.setSessionPreset(sessionId, sanitized);
    if (!session) return { error: "session not found", status: 404 };
    bus.broadcast({ type: "session-updated", id: session.id });
    return { session };
  }

  // The agent cursor (agentSeq) is read-then-advanced by both piggyback
  // (collectFeedback) and the long-poll (waitForComments). Two overlapping
  // readers that both read before either marks would deliver the same comments
  // twice, so the read+mark critical section is serialized per session — that's
  // what makes the exactly-once guarantee hold under concurrent waits.
  const cursorLocks = new Map<string, Promise<unknown>>();
  function withCursorLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = cursorLocks.get(sessionId) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.catch(() => {});
    cursorLocks.set(sessionId, tail);
    void tail.then(() => {
      if (cursorLocks.get(sessionId) === tail) cursorLocks.delete(sessionId);
    });
    return run;
  }

  // User comments the agent has not seen yet ride along on its next write, so
  // agents hear feedback without blocking on the long-poll. The cursor also
  // advances past the agent's own comments to keep reads cheap.
  async function collectFeedback(sessionId: string): Promise<Feedback[] | undefined> {
    const session = await store.getSession(sessionId);
    if (!session) return undefined;
    return withCursorLock(sessionId, async () => {
      const cur = await store.getSession(sessionId);
      if (!cur) return undefined;
      const fresh = await store.listComments({ sessionId, afterSeq: cur.agentSeq });
      if (fresh.length === 0) return undefined;
      await store.markAgentSeen(sessionId, fresh[fresh.length - 1].seq);
      const feedback = fresh.filter((cm) => cm.author === "user");
      return feedback.length > 0 ? feedback.map(feedbackView) : undefined;
    });
  }

  async function publishSurface(input: {
    parts: SurfacePart[];
    title?: string;
    badge?: SurfaceBadge;
    theme?: string;
    blueprint?: string;
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
    let session = sessionId ? await store.getSession(sessionId) : null;
    if (sessionId && !session) {
      return { error: sessionNotFound(sessionId), status: 404 };
    }
    if (!session) {
      // First publish pins the session's PRESET: the preset this publish names,
      // else the board default (a repo/user default — boardDefault* below). Every
      // later surface in the session inherits it, which is what makes a session
      // "a design-doc session" / "a product-demo session" regardless of the ask.
      // sessionTitle applies only here — an existing session keeps its title.
      session = await store.createSession({
        agent: input.agent ?? "agent",
        title: input.sessionTitle?.slice(0, MAX_TITLE),
        cwd: input.cwd,
        blueprint: pickBlueprint(input.blueprint) ?? boardDefaultBlueprint(),
        theme: pickTheme(input.theme) ?? boardDefaultTheme(),
      });
      bus.broadcast({ type: "session-created", id: session.id });
      sessionId = session.id;
    } else {
      // An explicit, KNOWN preset on a later publish re-pins the session so it
      // carries forward ("switch this session to design-doc from here").
      const repin: SessionPresetInput = {};
      if (pickBlueprint(input.blueprint)) repin.blueprint = input.blueprint;
      if (pickTheme(input.theme)) repin.theme = input.theme;
      if (repin.blueprint !== undefined || repin.theme !== undefined) {
        session = (await store.setSessionPreset(session.id, repin)) ?? session;
      }
    }
    // Effective preset = what this publish named, else the session's pin. A
    // blueprint fills gaps only: an explicit theme/part-kits/badge always wins,
    // and its theme + kits are baked into the stored surface here so everything
    // downstream sees an ordinary themed surface (see server/blueprints.ts).
    const resolved = resolveBlueprint({
      blueprint: input.blueprint ?? session.blueprint,
      theme: input.theme ?? session.theme,
      parts: input.parts,
    });
    const surface = await store.createSurface({
      sessionId: session.id,
      parts: resolved.parts,
      title: input.title?.slice(0, MAX_TITLE),
      badge: input.badge ?? resolved.defaultBadge,
      theme: resolved.theme,
      blueprint: resolved.blueprintId,
    });
    if (!surface) return { error: "session not found", status: 404 };
    bus.broadcast({ type: "surface-created", id: surface.id, sessionId: session.id, version: 1 });
    return { surface, userFeedback: await collectFeedback(session.id) };
  }

  // Publish a tailored PRESET surface — the typed form factors (postmortem,
  // data-viz, design-doc, status, architecture, product-demo). The preset's
  // renderer (server/presetRenders.ts) owns the layout: typed data in → one html
  // part with a fixed structure out, so every instance looks identical. The
  // matching blueprint is pinned, so the session's theme/kits resolve as usual
  // and the preset pins to the session like any other (configurable, consistent).
  async function publishPreset(input: {
    preset: string;
    data: unknown;
    session?: string;
    sessionTitle?: string;
    agent?: string;
    cwd?: string;
  }): Promise<
    { surface: Surface; userFeedback?: Feedback[] } | { error: string; status: 400 | 404 | 413 }
  > {
    const render = PRESET_RENDERERS[input.preset];
    if (!render) return { error: `unknown preset "${input.preset}"`, status: 400 };
    const rendered = render(input.data);
    return publishSurface({
      parts: rendered.parts,
      title: rendered.title,
      badge: rendered.badge,
      blueprint: input.preset,
      session: input.session,
      sessionTitle: input.sessionTitle,
      agent: input.agent,
      cwd: input.cwd,
    });
  }

  // Publish a decision-queue review (the agent-era form factor — see
  // docs/review-form-factor.md). Like publishSurface, an explicit session is
  // validated and a missing one auto-created. The Review is validated and stored
  // per session; the viewer renders it at /?review=<sessionId>.
  async function publishDecisions(input: {
    brief?: string;
    verdict?: string;
    decisions?: unknown;
    manifest?: unknown;
    session?: string;
    sessionTitle?: string;
    agent?: string;
    cwd?: string;
  }): Promise<
    | { sessionId: string; decisions: number; briefWarning?: string; warnings?: string[] }
    | { error: string; status: 400 | 404 }
  > {
    const parsed = coerceReview({
      brief: input.brief,
      verdict: input.verdict,
      decisions: input.decisions,
      manifest: input.manifest,
    });
    if ("error" in parsed) return { error: parsed.error, status: 400 };

    let sessionId = input.session;
    if (sessionId && !(await store.getSession(sessionId))) {
      return { error: sessionNotFound(sessionId), status: 404 };
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
    return {
      sessionId,
      decisions: review.decisions.length,
      ...(review.briefWarning ? { briefWarning: review.briefWarning } : {}),
      ...(review.warnings && review.warnings.length > 0 ? { warnings: review.warnings } : {}),
    };
  }

  // --- learn mode (docs/learn-form-factor.md) ---

  // Re-render a topic's syllabus card from current mastery states, in place.
  // Deliberately NOT reviseSurface: that flow piggybacks pending user feedback
  // onto its response, and this refresh runs inside the telemetry ingest — it
  // would consume the just-landed telemetry comment before the agent's wait
  // ever saw it. Direct store update + broadcast only.
  async function refreshSyllabus(topic: string): Promise<void> {
    if (!masteryStore) return;
    const t = await masteryStore.getTopic(topic);
    if (!t?.syllabusSurfaceId) return;
    const states = await masteryStore.statesForTopic(topic);
    const surface = await store.updateSurface(t.syllabusSurfaceId, {
      parts: renderSyllabusParts(topic, t.conceptGraph, states),
    });
    if (surface) {
      bus.broadcast({
        type: "surface-updated",
        id: surface.id,
        sessionId: surface.sessionId,
        version: surface.version,
      });
    }
  }

  // Publish a full lesson: a syllabus card plus one card per concept beat, all
  // pinned to the `learn` blueprint. The renderer (core/lesson.ts) owns every
  // layout decision (C8); this flow owns session plumbing and mastery wiring.
  async function publishLesson(input: {
    lesson: unknown;
    session?: string;
    sessionTitle?: string;
    agent?: string;
    cwd?: string;
  }): Promise<
    | {
        sessionId: string;
        syllabusId: string;
        beats: { surfaceId: string; conceptId: string }[];
        userFeedback?: Feedback[];
      }
    | { error: string; status: 400 | 404 | 413 }
  > {
    const parsed = coerceLesson(input.lesson);
    if ("error" in parsed) return { error: parsed.error, status: 400 };
    const { lesson } = parsed;
    const states = masteryStore ? await masteryStore.statesForTopic(lesson.topic) : {};
    const rendered = renderLessonSurfaces(lesson, states);

    let sessionId = input.session;
    let syllabusId = "";
    const beats: { surfaceId: string; conceptId: string }[] = [];
    let userFeedback: Feedback[] | undefined;
    for (let i = 0; i < rendered.length; i++) {
      const r = rendered[i];
      const result = await publishSurface({
        parts: r.parts,
        title: r.title,
        badge: r.badge,
        blueprint: "learn",
        session: sessionId,
        sessionTitle: input.sessionTitle ?? `Learn: ${lesson.topic}`,
        agent: input.agent,
        cwd: input.cwd,
      });
      if ("error" in result) return result;
      sessionId = result.surface.sessionId;
      if (i === 0) syllabusId = result.surface.id;
      else beats.push({ surfaceId: result.surface.id, conceptId: lesson.beats[i - 1].conceptId });
      if (result.userFeedback) userFeedback = result.userFeedback;
    }
    if (masteryStore) {
      await masteryStore.upsertTopic(
        lesson.topic,
        {
          concepts: lesson.conceptGraph.concepts.map((c) => ({ id: c.id, label: c.label })),
          edges: lesson.conceptGraph.edges,
        },
        { sessionId, syllabusSurfaceId: syllabusId },
      );
    }
    return {
      sessionId: sessionId!,
      syllabusId,
      beats,
      ...(userFeedback ? { userFeedback } : {}),
    };
  }

  // Revise a beat card in place (remediation, fading), or append a new one to
  // the lesson session when no surfaceId is given (an inserted remediation
  // card). Mirrors update_surface semantics but through the lesson renderer,
  // so the beat layout stays owned server-side.
  async function updateLessonBeat(input: {
    surfaceId?: string;
    session?: string;
    beat: unknown;
    title?: string;
  }): Promise<
    { surface: Surface; userFeedback?: Feedback[] } | { error: string; status: 400 | 404 | 413 }
  > {
    // Concept ids come from the stored topic graph when we can find one;
    // otherwise fall back to the ids the beat itself claims — update must not
    // require a mastery store to function.
    let sessionId = input.session;
    if (input.surfaceId && !sessionId) {
      sessionId = (await store.getSurface(input.surfaceId))?.sessionId;
    }
    let conceptIds: Set<string> | null = null;
    if (masteryStore && sessionId) {
      const topic = await masteryStore.topicForSession(sessionId);
      if (topic) conceptIds = new Set(topic.conceptGraph.concepts.map((c) => c.id));
    }
    if (!conceptIds) {
      const raw = input.beat as Record<string, unknown> | null;
      conceptIds = new Set<string>();
      if (raw && typeof raw === "object") {
        if (typeof raw.conceptId === "string") conceptIds.add(raw.conceptId);
        for (const list of [raw.checkpoints, [raw.hook], [(raw.explorable as any)?.gate]]) {
          if (!Array.isArray(list)) continue;
          for (const cp of list) {
            if (cp && typeof cp === "object" && typeof (cp as any).conceptId === "string") {
              conceptIds.add((cp as any).conceptId);
            }
          }
        }
      }
    }
    const parsed = coerceBeat(input.beat, "beat", conceptIds, new Set());
    if ("error" in parsed) return { error: parsed.error, status: 400 };
    const parts = renderBeatParts(parsed.beat);
    if (input.surfaceId) {
      return reviseSurface(input.surfaceId, {
        parts,
        ...(input.title !== undefined ? { title: input.title } : {}),
      });
    }
    if (!sessionId) return { error: 'provide a "surfaceId" or a "session"', status: 400 };
    return publishSurface({
      parts,
      title: input.title ?? "Remediation",
      badge: { tone: "warning", label: "Remediation" },
      blueprint: "learn",
      session: sessionId,
    });
  }

  // Ingest one learner-interaction event. Every event becomes a fixed-format
  // comment (core/lesson.ts formatTelemetryComment) so it rides the SAME
  // exactly-once delivery channels as typed feedback — piggyback, the blocking
  // wait, the watch stream (C6). Graded checkpoint attempts additionally move
  // mastery and refresh the syllabus card. `sandbox: true` marks events the
  // viewer forwarded from a sandboxed iframe: only the allowlisted
  // explorable_interaction shape is accepted from that path (C1) — anything
  // else is dropped without error, matching the bridge's own policy.
  async function recordTelemetry(input: {
    surfaceId?: string;
    session?: string;
    event: unknown;
    sandbox?: boolean;
  }): Promise<
    { stored: boolean; event?: TelemetryEvent } | { error: string; status: 400 | 404 }
  > {
    const event = validateTelemetryEvent(input.event);
    if (!event) return { stored: false };
    if (input.sandbox && !SANDBOX_TELEMETRY_TYPES.includes(event.type)) {
      return { stored: false };
    }
    const result = await createComment({
      text: formatTelemetryComment(event),
      surface: input.surfaceId,
      session: input.session,
      author: "user",
    });
    if ("error" in result) return result;
    if (
      masteryStore &&
      event.type === "checkpoint_attempt" &&
      event.correct !== undefined
    ) {
      const topic = await masteryStore.topicForSession(result.comment.sessionId);
      if (topic) {
        await masteryStore.recordAttempt(topic.topic, event.conceptId, {
          checkpointKind: event.kind,
          correct: event.correct,
          ...(event.misconception ? { misconception: event.misconception } : {}),
        });
        await refreshSyllabus(topic.topic);
      }
    }
    return { stored: true, event };
  }

  // Record an agent-graded attempt (explain/completion/apply and free-text
  // predict answers are graded by the agent, not the client — P6). The graded
  // outcome is what moves mastery; the substantive feedback itself goes back
  // as an ordinary reply comment.
  async function gradeAttempt(input: {
    topic?: string;
    session?: string;
    conceptId?: string;
    kind?: string;
    correct?: unknown;
    misconception?: string;
  }): Promise<{ record: unknown } | { error: string; status: 400 | 404 }> {
    if (!masteryStore) return { error: "mastery is not enabled on this board", status: 400 };
    let topic = input.topic;
    if (!topic && input.session) {
      topic = (await masteryStore.topicForSession(input.session))?.topic;
    }
    if (!topic) return { error: 'provide a "topic" or a lesson "session"', status: 400 };
    if (typeof input.conceptId !== "string" || !input.conceptId.trim()) {
      return { error: '"conceptId" is required', status: 400 };
    }
    if (!isCheckpointKind(input.kind)) {
      return { error: '"kind" must be predict|mcq|completion|explain|trace|apply', status: 400 };
    }
    if (typeof input.correct !== "boolean") {
      return { error: '"correct" must be a boolean', status: 400 };
    }
    const record = await masteryStore.recordAttempt(topic, input.conceptId, {
      checkpointKind: input.kind,
      correct: input.correct,
      ...(typeof input.misconception === "string" && input.misconception.trim()
        ? { misconception: input.misconception.trim() }
        : {}),
    });
    if (!record) return { error: `unknown topic/concept: ${topic}/${input.conceptId}`, status: 404 };
    await refreshSyllabus(topic);
    return { record };
  }

  // The learner's cross-session state: per-topic mastery records plus the
  // interleaved due-for-review queue — what the teach skill reads before
  // opening a session (P12: start from reality).
  async function learnerState(input: { topic?: string; now?: Date }): Promise<{
    topics: unknown[];
    due: unknown[];
  }> {
    if (!masteryStore) return { topics: [], due: [] };
    const topics = input.topic
      ? await masteryStore.getTopic(input.topic).then((t) => (t ? [t] : []))
      : await masteryStore.listTopics();
    const due = await masteryStore.due(input.now);
    return {
      topics: topics.map((t) => ({
        topic: t.topic,
        updatedAt: t.updatedAt,
        concepts: t.conceptGraph.concepts.map((c) => {
          const r = t.records[c.id];
          return {
            id: c.id,
            label: c.label,
            state: r?.state ?? "untouched",
            ...(r
              ? {
                  attempts: r.attempts.length,
                  lastAttemptAt: r.attempts[r.attempts.length - 1]?.at,
                  dueAt: r.dueAt,
                  misconceptions: [
                    ...new Set(
                      r.attempts.flatMap((a) => (a.misconception ? [a.misconception] : [])),
                    ),
                  ],
                }
              : {}),
          };
        }),
      })),
      due: input.topic ? (due as { topic: string }[]).filter((d) => d.topic === input.topic) : due,
    };
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
      return { error: sessionNotFound(sessionId), status: 404 };
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
    patch: {
      parts?: SurfacePart[];
      title?: string;
      badge?: SurfaceBadge | null;
      theme?: string | null;
      blueprint?: string | null;
    },
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
    // Blueprint: null clears it; a known id (re-)applies its theme + kit defaults
    // to the replacement parts (gap-fill — an explicit theme/part-kits still
    // wins); an unknown id is ignored. undefined leaves it unchanged.
    if (typeof patch.blueprint === "string") {
      if (!isKnownBlueprint(patch.blueprint)) delete patch.blueprint;
      else if (patch.parts) {
        const resolved = resolveBlueprint({
          blueprint: patch.blueprint,
          theme: typeof patch.theme === "string" ? patch.theme : undefined,
          parts: patch.parts,
        });
        patch.parts = resolved.parts;
        patch.blueprint = resolved.blueprintId;
        if (patch.theme === undefined && resolved.theme) patch.theme = resolved.theme;
      }
    }
    // null clears the theme; a valid id sets it; an unknown id is ignored.
    if (typeof patch.theme === "string" && !isKnownTheme(patch.theme)) delete patch.theme;
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
    const usesSessionCursor = q.afterSeq === undefined && q.author === "user" && !!q.sessionId;
    let afterSeq = q.afterSeq;
    const matches = (list: Comment[]) =>
      q.author ? list.filter((cm) => cm.author === q.author) : list;
    const wait = Math.min(Math.max(q.waitSeconds, 0), MAX_WAIT_SECONDS);

    // Read the window and, for a session-cursor wait, advance the cursor in the
    // same locked section — a wake-up must re-resolve agentSeq (piggyback may
    // have consumed the batch while this wait was parked) and no other reader
    // may interleave between the read and the mark, or comments deliver twice.
    const readWindow = async () => {
      if (usesSessionCursor) afterSeq = (await store.getSession(q.sessionId!))?.agentSeq;
      const all = await store.listComments({
        sessionId: q.sessionId,
        surfaceId: q.surfaceId,
        afterSeq,
      });
      // The cursor advances past every comment in the window — not just the
      // filtered ones — so the next call doesn't re-read the agent's own
      // comments. collectFeedback already does this; mirror it here.
      if (q.author === "user" && q.sessionId && all.length > 0) {
        await store.markAgentSeen(q.sessionId, all[all.length - 1].seq);
      }
      return all;
    };
    const claimWindow = () =>
      q.author === "user" && q.sessionId ? withCursorLock(q.sessionId, readWindow) : readWindow();

    let all = await claimWindow();
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
      all = await claimWindow();
      comments = matches(all);
    }
    const lastSeq = all.length > 0 ? all[all.length - 1].seq : (afterSeq ?? 0);
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

  // Structured request log (opt-in via requestLog). Outermost so it times the
  // whole request — auth, body cap, handler — and records the final status even
  // for a 401/413. One JSON line per /api (and /mcp) request; everything else
  // (the viewer html, /s/:id renders) is skipped to keep it about the API. The
  // /api/health probe is excluded so a polling monitor doesn't log its own
  // heartbeat on every tick.
  if (requestLog) {
    app.use("*", async (c, next) => {
      const path = new URL(c.req.url).pathname;
      const logged = (path.startsWith("/api") || path === "/mcp") && path !== "/api/health";
      if (!logged) return next();
      const start = Date.now();
      await next();
      console.log(
        JSON.stringify({
          t: new Date().toISOString(),
          method: c.req.method,
          path,
          status: c.res.status,
          ms: Date.now() - start,
        }),
      );
    });
  }

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
  // Append a live blueprint listing so an agent fetching the design contract
  // sees the presets this board actually offers — built-ins plus any user config.
  const blueprintGuideMd = (): string => {
    const bps = blueprintSummaries();
    if (bps.length === 0) return "";
    const rows = bps.map((b) => {
      const arc = b.structure.map((s) => s.label).join(" → ") || "(free)";
      const kits = b.kits.length > 0 ? b.kits.join(", ") : "—";
      return `- **${b.id}** — ${b.summary}\n  theme \`${b.theme ?? "board default"}\` · kits \`${kits}\` · structure: ${arc}`;
    });
    return (
      `\n\n## Explainer blueprints on this board\n\n` +
      `Pass \`blueprint: "<id>"\` to publish_surface / publish_snippet for a named preset ` +
      `(theme + kit composition + a section skeleton). It fills gaps only — an explicit ` +
      `theme or part \`kits\` still wins. Author your \`.anim\` \`.step\`s to follow the ` +
      `structure, tagging each \`data-section="<id>"\` so the animate kit labels the beat.\n\n` +
      `${rows.join("\n")}\n`
    );
  };
  app.get("/guide", (c) => c.text(withOrigin(guideMarkdown + blueprintGuideMd(), c)));
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

  // Explainer blueprints available on this board (built-in + user config) — id,
  // label, summary, the theme/kits they apply, and the section skeleton the
  // agent authors against. For discovery (`showcase blueprints`).
  app.get("/api/blueprints", (c) => c.json(blueprintSummaries()));

  // Themes available on this board (built-in + user brand palettes) — just the
  // ids, for discovery. The full palettes are server/viewer internals.
  app.get("/api/themes", (c) => c.json(themeIds()));

  // Board size + orphaned-asset tally (drives `showcase gc`'s status line and
  // its --dry-run preview). Owner-scoped — not in the publicRead allowlist.
  app.get("/api/board", async (c) => c.json(await store.boardStats()));

  // Liveness + at-a-glance health: uptime, running version, the board tally, and
  // the last unhandled error (if any). Powers `showcase health` — showcase
  // dogfooding its own monitoring. Owner-scoped (board counts), so a service
  // manager probing it carries the token like any other read.
  app.get("/api/health", async (c) =>
    c.json({
      status: lastError ? "degraded" : "ok",
      uptimeMs: Date.now() - startedAt,
      version: version || null,
      board: await store.boardStats(),
      lastError,
    }),
  );

  // Reclaim orphaned assets — those no live or historical surface references.
  // Eager upload eviction only fires under budget pressure, so this is the
  // on-demand sweep. Returns { removed, bytesFreed, stats } (post-sweep tally).
  app.post("/api/board/gc", async (c) => c.json(await store.gcAssets()));

  // Validate one parsed config object (theme/kit/blueprint/config) against its
  // schema — the server-side half of `showcase validate`. Stateless: the CLI
  // reads each local config file and posts its content here, so the same schema
  // that gates boot loading powers the preflight. Returns { ok } or
  // { ok: false, issues: [{ path, message }] }.
  app.post("/api/config/validate", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || !CONFIG_KINDS.includes(body.kind)) {
      return c.json({ error: `kind must be one of: ${CONFIG_KINDS.join(", ")}` }, 400);
    }
    return c.json(validateConfig(body.kind as ConfigKind, body.value));
  });

  // Author a brand theme at runtime from a few SEED colors (the "match my
  // product" path — an agent reads a screenshot, names the brand color(s), and
  // the engine derives a full contrast-checked light+dark palette; see
  // server/themeDerive.ts). `seed` derives; `theme` registers a full palette as
  // given. Registers it live for immediate html-part preview; `persist:true`
  // writes it to user config (via persistTheme) so it survives a restart — only
  // then does the viewer chrome / picker pick it up (they read the bundled set).
  app.post("/api/themes", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid body" }, 400);
    let theme: Theme;
    if (body.seed && typeof body.seed === "object") {
      const seed = body.seed as ThemeSeed;
      if (!seed.id || !seed.label || !seed.accent) {
        return c.json({ error: "seed needs id, label, accent" }, 400);
      }
      theme = deriveTheme(seed);
    } else if (body.theme && typeof body.theme === "object" && body.theme.id) {
      // A malformed full theme must not register: themeById would return it and
      // every /s/:id render that resolves this id (including a shadowed default)
      // would then 500 until restart. Same gate as boot config loading.
      const check = validateConfig("theme", body.theme);
      if (!check.ok) return c.json({ error: "invalid theme", issues: check.issues }, 400);
      theme = body.theme as Theme;
    } else {
      return c.json({ error: 'pass a "seed" {id,label,accent,...} or a full "theme"' }, 400);
    }
    addTheme(theme);
    let persisted = false;
    if (body.persist && persistTheme) {
      await persistTheme(theme);
      persisted = true;
    }
    return c.json({ id: theme.id, persisted, theme }, 201);
  });

  // Publish a tailored preset surface from typed data (the form factors behind
  // publish_postmortem / publish_dashboard / …). The stdio MCP server posts here;
  // the HTTP MCP calls publishPreset in-process. Body = the preset's typed fields
  // plus session/sessionTitle/agent.
  app.post("/api/presets/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await publishPreset({
      preset: c.req.param("id"),
      data: body,
      session: typeof body.session === "string" ? body.session : undefined,
      sessionTitle: typeof body.sessionTitle === "string" ? body.sessionTitle : undefined,
      agent: typeof body.agent === "string" ? body.agent : undefined,
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(
      {
        id: result.surface.id,
        sessionId: result.surface.sessionId,
        version: result.surface.version,
        ...(result.userFeedback ? { userFeedback: result.userFeedback } : {}),
      },
      201,
    );
  });

  // --- learn mode routes ---

  // Publish a lesson (syllabus + beat cards) from its typed payload. The stdio
  // MCP posts here; the HTTP MCP calls publishLesson in-process.
  app.post("/api/lessons", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);
    const result = await publishLesson({
      lesson: body,
      session: typeof body.session === "string" ? body.session : undefined,
      sessionTitle: typeof body.sessionTitle === "string" ? body.sessionTitle : undefined,
      agent: typeof body.agent === "string" ? body.agent : undefined,
      cwd: typeof body.cwd === "string" ? body.cwd : undefined,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result, 201);
  });

  // Revise a beat card in place (surfaceId set) or append a remediation card
  // to the lesson session (surfaceId absent, session set).
  app.post("/api/lessons/beats", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || !body.beat) {
      return c.json({ error: 'body must include a "beat"' }, 400);
    }
    const result = await updateLessonBeat({
      surfaceId: typeof body.surfaceId === "string" ? body.surfaceId : undefined,
      session: typeof body.session === "string" ? body.session : undefined,
      beat: body.beat,
      title: typeof body.title === "string" ? body.title : undefined,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json({
      ...writeResult(result.surface),
      ...(result.userFeedback && { userFeedback: result.userFeedback }),
    });
  });

  // Learner-interaction telemetry ingest. Trusted checkpoint components post
  // here directly; the sandbox bridge forwards explorable events with
  // sandbox:true so the allowlist applies (see recordTelemetry). Invalid or
  // disallowed events return { stored: false } (200) — dropping is policy, not
  // an error the viewer should surface.
  app.post("/api/telemetry", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);
    const result = await recordTelemetry({
      surfaceId: typeof body.surface === "string" ? body.surface : undefined,
      session: typeof body.session === "string" ? body.session : undefined,
      event: body.event,
      sandbox: body.sandbox === true,
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result, result.stored ? 201 : 200);
  });

  // Mastery state — plainly inspectable JSON (C5). ?now= lets tests and the
  // CLI time-travel the due computation without faking the system clock.
  const parseNow = (raw: string | undefined): Date | undefined => {
    if (!raw) return undefined;
    const t = Date.parse(raw);
    return Number.isFinite(t) ? new Date(t) : undefined;
  };
  app.get("/api/mastery", async (c) => {
    const state = await learnerState({
      topic: c.req.query("topic"),
      now: parseNow(c.req.query("now")),
    });
    return c.json(state);
  });
  app.post("/api/mastery/attempt", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "invalid JSON body" }, 400);
    const result = await gradeAttempt(body);
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result, 201);
  });
  app.delete("/api/mastery/:topic", async (c) => {
    if (!masteryStore) return c.json({ error: "mastery is not enabled on this board" }, 400);
    const topic = decodeURIComponent(c.req.param("topic"));
    if (!(await masteryStore.reset(topic))) return c.json({ error: "unknown topic" }, 404);
    return c.json({ ok: true });
  });

  // The interleaved cross-topic review queue (P2/P11) — what `showcase
  // review-due` and the teach skill's review sessions read.
  app.get("/api/review-due", async (c) => {
    if (!masteryStore) return c.json({ due: [] });
    return c.json({ due: await masteryStore.due(parseNow(c.req.query("now"))) });
  });

  // --- sessions ---

  app.get("/api/sessions", async (c) => {
    const [sessions, surfaces, reviews] = await Promise.all([
      store.listSessions(),
      store.listSurfaces(),
      store.listReviews(),
    ]);
    // A decision-queue review session has no surfaces — carry its verdict so the
    // row can chip it, mark it as a review, and link to /?review=<id>.
    const reviewVerdict = new Map(reviews.map((r) => [r.sessionId, r.verdict]));
    const counts = new Map<string, number>();
    for (const s of surfaces) counts.set(s.sessionId, (counts.get(s.sessionId) ?? 0) + 1);
    return c.json(
      sessions.map((s) => ({
        ...s,
        surfaceCount: counts.get(s.id) ?? 0,
        kind: reviewVerdict.has(s.id) ? "review" : "visual",
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

  // Rename and/or re-pin the session preset (blueprint/theme). A bare title patch
  // keeps the old behavior; passing blueprint/theme (string to set, null to
  // clear) configures the session's format. At least one field is required.
  app.patch("/api/sessions/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    const id = c.req.param("id");
    const hasTitle = body && typeof body.title === "string";
    const hasPreset = body && ("blueprint" in body || "theme" in body);
    if (!hasTitle && !hasPreset) {
      return c.json({ error: 'body must include "title", "blueprint", or "theme"' }, 400);
    }
    let session = hasTitle ? await store.renameSession(id, body.title.slice(0, MAX_TITLE)) : null;
    if (hasTitle && !session) return c.json({ error: "session not found" }, 404);
    if (hasPreset) {
      const presetField = (v: unknown): string | null | undefined =>
        v === null ? null : typeof v === "string" ? v : undefined;
      const result = await configureSession(id, {
        blueprint: "blueprint" in body ? presetField(body.blueprint) : undefined,
        theme: "theme" in body ? presetField(body.theme) : undefined,
      });
      if ("error" in result) return c.json({ error: result.error }, result.status);
      session = result.session;
    } else if (session) {
      bus.broadcast({ type: "session-updated", id: session.id });
    }
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

  // Asset METADATA for a session (never the bytes — those serve at /a/:id). Backs
  // the stdio MCP asset-resource listing, which can't reach the store directly.
  // Owner-scoped (asset data), like /api/board — the /api/sessions/ prefix is
  // otherwise public-readable in `session` mode, so guard explicitly.
  app.get("/api/sessions/:id/assets", async (c) => {
    if (isUnauthenticatedSessionRead(c)) return c.json({ error: "unauthorized" }, 401);
    const assets = await store.listAssets(c.req.param("id"));
    return c.json(
      assets.map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        kind: a.kind,
        contentType: a.contentType,
        byteLength: a.byteLength,
        filename: a.filename,
        createdAt: a.createdAt,
      })),
    );
  });

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
    // ?flatten=1 (the --pdf path) renders rich parts inline so they paginate.
    const flatten = c.req.query("flatten") != null;
    return c.body(renderExportHtml(viewerHtml, bundle, flatten), 200, {
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
      theme: typeof body.theme === "string" ? body.theme : undefined,
      blueprint: typeof body.blueprint === "string" ? body.blueprint : undefined,
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
      // `null` resets to the default theme; a string sets it (validated in
      // reviseSurface); absent leaves it unchanged.
      theme:
        "theme" in body
          ? body.theme === null
            ? null
            : typeof body.theme === "string"
              ? body.theme
              : undefined
          : undefined,
      // `null` clears the blueprint; a string (re-)applies it; absent leaves it.
      blueprint:
        "blueprint" in body
          ? body.blueprint === null
            ? null
            : typeof body.blueprint === "string"
              ? body.blueprint
              : undefined
          : undefined,
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
        return c.json({ error: sessionNotFound(sessionId) }, 404);
      }
      if (surfaceId) {
        const surface = await store.getSurface(surfaceId);
        if (!surface || (sessionId && surface.sessionId !== sessionId)) {
          return c.json({ error: "surface not found" }, 404);
        }
      }
    }
    // A malformed cursor must not become NaN: `seq > NaN` filters out every
    // comment and `NaN ?? 0` serializes as null, silently corrupting the
    // client's cursor — reject it instead.
    const afterRaw = c.req.query("after");
    const afterSeq = afterRaw ? Number(afterRaw) : undefined;
    if (afterSeq !== undefined && !Number.isFinite(afterSeq)) {
      return c.json({ error: "after must be a number" }, 400);
    }
    const result = await waitForComments(
      {
        sessionId,
        surfaceId,
        author: c.req.query("author"),
        afterSeq,
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
    // reloads the frame) wins; otherwise the surface's own persisted theme; else
    // the default. So opening a brand-themed mockup's link renders it in brand.
    const themeId = c.req.query("theme") ?? surface.theme ?? DEFAULT_THEME_ID;
    // Scheme: the viewer passes the light/dark mode it resolved so the iframe is
    // pinned to it rather than re-deriving from the OS (which can diverge from
    // the chrome across the frame boundary). Absent/invalid → follow the OS.
    const modeParam = c.req.query("mode");
    const mode = modeParam === "light" || modeParam === "dark" ? modeParam : undefined;
    // Brand rides on the surface's blueprint and is resolved at render (not baked
    // in), so editing a blueprint's logo/font re-skins every surface using it.
    const brand = blueprintById(surface.blueprint)?.brand;
    return c.html(
      renderHtmlPage({
        title,
        html: part.html,
        origin: new URL(c.req.url).origin,
        theme: themeById(themeId),
        mode,
        kits: part.kits,
        brand,
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
    publishDecisions,
    publishPreset,
    publishLesson,
    updateLessonBeat,
    gradeAttempt,
    learnerState,
    reviseSurface,
    deleteSurface,
    configureSession,
    createComment,
    waitForComments,
    uploadAsset,
    guide: guideMarkdown,
  });

  return app;
}
