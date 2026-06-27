// Explainer blueprints — the composition layer above themes and kits (see
// docs/themable-explainers.md). A blueprint is a named, declarative bundle of
// DEFAULTS: a theme (palette), a kit composition (the html part's vocabulary), a
// structure skeleton (named sections the agent authors against), and brand
// (logo / wordmark / font injected at render). It composes primitives that
// already ship — it never replaces the part model.
//
// Resolution is gap-filling: an explicit surface theme or part `kits` always
// beats the blueprint's. By the time a surface is stored it's an ordinary themed
// surface with resolved theme + kits; only the blueprint id rides along, so the
// brand can be re-resolved at render and the provenance is visible.
//
// Runtime-agnostic (no `node:` imports): the built-ins ship inline, and a board
// layers user-authored blueprints over them via registerBlueprints at boot
// (server/userConfig.ts). User id wins on collision — same pattern as
// themes.ts / kits.ts.

import { isKnownKit } from "./kits.ts";
import { isKnownTheme } from "./themes.ts";
import type { SurfaceBadge, SurfacePart } from "./types.ts";

// One named beat of a blueprint's structure. The agent fills each in order; the
// animate kit surfaces the matching `data-section` / `data-label` on a step.
export interface BlueprintSection {
  id: string;
  label: string;
  hint?: string; // one line on what belongs in this beat
  required?: boolean; // a product demo without this beat is incomplete
}

// Brand tokens injected into the rendered html head (see brandCss). Sourced from
// local config, so they're trusted input — still sanitized as defense-in-depth.
export interface BlueprintBrand {
  logoAssetId?: string; // exposed as --brand-logo: url(<origin>/a/<id>)
  wordmark?: string; // exposed as --brand-wordmark: "<text>"
  fontFamily?: string; // overrides --font-sans (and --font-brand) for the part
}

export interface BlueprintDefaults {
  badge?: SurfaceBadge; // fills the header chip when the publish set none
}

export interface Blueprint {
  id: string;
  label: string;
  summary: string; // one line for discovery (/api/blueprints, the guide listing)
  // Inherit another blueprint's fields, then override. Resolved at lookup
  // (blueprintById returns the merged result); one chain, cycle-guarded.
  extends?: string;
  theme?: string; // a theme id (built-in or user) the surface renders under
  kits?: string[]; // default kit composition for the html part(s)
  structure?: BlueprintSection[];
  brand?: BlueprintBrand;
  defaults?: BlueprintDefaults;
}

// The two built-ins map the ends of the explainer axis: a rigid, branded product
// demo and a loose, neutral concept teacher. Everything past these is user config.
export const BLUEPRINTS: Blueprint[] = [
  {
    id: "product-demo",
    label: "Product demo",
    summary: "Branded walkthrough — fixed five-beat arc, product palette",
    theme: "brand",
    kits: ["animate", "mockup"],
    structure: [
      { id: "hook", label: "Hook", hint: "Lead with the outcome or the surprise" },
      { id: "problem", label: "Problem", hint: "The pain before the product" },
      { id: "feature", label: "Feature", hint: "Show the thing doing the thing" },
      { id: "proof", label: "Proof", hint: "A number, a before/after, a quote", required: true },
      { id: "cta", label: "Next step", hint: "What the viewer does now" },
    ],
    defaults: { badge: { tone: "info", label: "Demo" } },
  },
  {
    id: "concept",
    label: "Concept explainer",
    summary: "Teach an idea — neutral palette, charts welcome, free structure",
    theme: "neutral",
    kits: ["animate"],
    structure: [
      { id: "question", label: "Question", hint: "The thing that's confusing" },
      { id: "mechanism", label: "Mechanism", hint: "Reveal it beat by beat" },
      { id: "payoff", label: "Payoff", hint: "Why it now makes sense" },
    ],
    defaults: { badge: { tone: "info", label: "Explainer" } },
  },
  {
    // Design doc — an RFC/technical-design session. Every doc reads the same:
    // summary → context → goals → design → alternatives → risks → rollout. Mostly
    // markdown + mermaid parts; the mockup kit styles any html callouts/panels.
    id: "design-doc",
    label: "Design doc",
    summary:
      "Technical design / RFC — the detailed design-doc template (goal-as-problem, axes, trade-offs)",
    theme: "showcase",
    kits: ["mockup"],
    // The detailed design-doc template (the team convention). Two rules carry the
    // weight: the GOAL is a problem statement with no implementation leakage
    // ("reduce toil", not "build X"), and the SOLUTION SPACE is framed as AXES —
    // independent technical decisions — with candidates named by property and the
    // discarded ones explained.
    structure: [
      {
        id: "metadata",
        label: "Metadata",
        hint: "Title, author/reviewers, status (Draft → In review → Approved → Implemented), links: ticket / PRD / prior art",
      },
      {
        id: "summary",
        label: "Executive summary",
        hint: "If someone reads only this, what do they walk away with?",
        required: true,
      },
      {
        id: "goal",
        label: "Goal statement",
        hint: "A PROBLEM statement — no implementation leakage ('reduce errors', not 'build X'). Success metrics if any.",
        required: true,
      },
      {
        id: "invariants",
        label: "Invariants & constraints",
        hint: "True invariants (must-haves) vs preferences (nice-to-haves) vs assumptions. Challenge the over-constraining ones.",
      },
      {
        id: "background",
        label: "Background / research",
        hint: "Current system + pain points, prior art (internal + external), platform context",
      },
      {
        id: "solutionspace",
        label: "Solution space",
        hint: "Axes = the big INDEPENDENT decisions (technical, not product). Candidates named by property (build/buy, push/pull). Why some are discarded.",
        required: true,
      },
      {
        id: "proposed",
        label: "Proposed solution",
        hint: "Architecture / data model, APIs, failure modes + mitigations, observability, security / privacy",
        required: true,
      },
      {
        id: "scope",
        label: "Scope, sequencing, ownership",
        hint: "In vs out of scope, medium-grained milestones, parallelism & dependencies, known unknowns",
      },
      {
        id: "rollout",
        label: "Rollout plan",
        hint: "Feature flags, backfill / migration steps, rollback plan",
      },
      {
        id: "testing",
        label: "Testing & confidence",
        hint: "Unit / integration / e2e coverage; how you'll validate correctness",
      },
      {
        id: "openquestions",
        label: "Open questions",
        hint: "Questions for reviewers, decision deadlines — every open question needs an owner",
      },
    ],
    defaults: { badge: { tone: "info", label: "Design" } },
  },
  {
    // Product mockup — visualize a product IDEA fast. Not the branded marketing
    // walkthrough (product-demo) — this mocks the actual screens with the mockup
    // kit's UI primitives so you can SEE the idea: premise → screens → flow →
    // states → what to validate. Neutral palette reads as "sketch, not final".
    id: "product-mockup",
    label: "Product mockup",
    summary:
      "Visualize a product idea fast — mocked screens, the core flow, key states, what to test",
    theme: "neutral",
    kits: ["mockup"],
    structure: [
      {
        id: "premise",
        label: "Premise",
        hint: "The idea in one line — who it's for, what it does",
        required: true,
      },
      {
        id: "screens",
        label: "Screens",
        hint: "The 1–3 key screens, mocked with real-ish UI controls",
        required: true,
      },
      { id: "flow", label: "Core flow", hint: "The primary path, screen by screen" },
      {
        id: "states",
        label: "Key states",
        hint: "Empty / loading / error / success — what's easy to forget",
      },
      {
        id: "validate",
        label: "Validate",
        hint: "The riskiest assumption to test before building",
      },
    ],
    defaults: { badge: { tone: "neutral", label: "Mockup" } },
  },
  {
    // Architecture — diagram-forward system design. Lead with one system diagram,
    // then components, data flow, decisions, scale/failure. Cool, technical palette.
    id: "architecture",
    label: "Architecture",
    summary: "System design — diagram-led overview, components, data flow, decisions, scale",
    theme: "nord",
    kits: ["mockup", "issues"],
    structure: [
      {
        id: "overview",
        label: "Overview",
        hint: "One system diagram + a sentence",
        required: true,
      },
      { id: "components", label: "Components", hint: "Each box's responsibility and boundary" },
      { id: "dataflow", label: "Data flow", hint: "How a request/event moves through it" },
      { id: "decisions", label: "Key decisions", hint: "The load-bearing choices and tradeoffs" },
      { id: "scale", label: "Scale & failure", hint: "Limits, failure modes, what degrades" },
    ],
    defaults: { badge: { tone: "info", label: "Architecture" } },
  },
  {
    // Data viz / dashboard — metrics-forward. Headline number, the main chart, a
    // trend, a detail cut, and a takeaway. Charts are native parts that re-theme;
    // the mockup kit supplies stat callouts. Same dashboard shape for any data.
    id: "data-viz",
    label: "Data viz",
    summary: "Metrics dashboard — headline stat, main chart, trend, detail, takeaway",
    theme: "ocean",
    kits: ["mockup"],
    structure: [
      {
        id: "headline",
        label: "Headline",
        hint: "The one number/result that matters",
        required: true,
      },
      {
        id: "breakdown",
        label: "Breakdown",
        hint: "The main chart — the distribution or comparison",
        required: true,
      },
      { id: "trend", label: "Trend", hint: "How it's moving over time" },
      { id: "detail", label: "Detail", hint: "A table or finer cut for the curious" },
      { id: "takeaway", label: "Takeaway", hint: "So what — the decision or next step" },
    ],
    defaults: { badge: { tone: "info", label: "Metrics" } },
  },
  {
    // Postmortem — blameless incident review. Summary → timeline → impact → root
    // cause → remediation. Calm palette (gravity without alarm); the issues kit's
    // timeline/badges and mockup callouts carry the structure.
    id: "postmortem",
    label: "Postmortem",
    summary:
      "Blameless incident review — impact, timeline, 5 Whys to a systemic cause, tiered fixes, owned follow-ups",
    theme: "rose",
    kits: ["issues", "mockup"],
    // The team postmortem template. Blameless: assume everyone acted reasonably
    // with the info they had. The 5 Whys runs from the customer-visible failure to
    // a SYSTEMIC, fixable cause, then pressure-tests "why didn't tests / monitoring
    // catch it?". Fixes are tiered (immediate/necessary/additional); every
    // follow-up is owned, concrete, tracked, and time-bounded.
    structure: [
      {
        id: "summary",
        label: "Summary",
        hint: "One paragraph: what happened and what changed after",
        required: true,
      },
      {
        id: "impact",
        label: "Customer impact",
        hint: "Who was affected, the user experience, how long",
        required: true,
      },
      {
        id: "timeline",
        label: "Timeline (PT)",
        hint: "Timestamped signals, decisions, mitigations, deploys, comms — link evidence",
        required: true,
      },
      {
        id: "rootcause",
        label: "Root cause (5 Whys)",
        hint: "Ask why from the customer-visible failure to a systemic, fixable cause; pressure-test 'why didn't tests / monitoring catch it?'. Note contributing factors.",
        required: true,
      },
      {
        id: "fixes",
        label: "Fixes",
        hint: "Immediate (stabilize / rollback) · Necessary (prevent THIS root cause) · Additional (pay down reliability debt)",
        required: true,
      },
      {
        id: "wentwell",
        label: "What went well / painful",
        hint: "Reinforce good behaviors; surface process pain. Keep it short.",
      },
      {
        id: "followups",
        label: "Follow-ups & tracking",
        hint: "Action items — each Owned (one owner), Concrete, Tracked (link), Time-bounded",
        required: true,
      },
    ],
    defaults: { badge: { tone: "warning", label: "Postmortem" } },
  },
  {
    // Status report — recurring update. Headline (on track?), shipped, in flight,
    // blockers, next. The issues kit's badges/bars + mockup metrics keep every
    // weekly update identical in shape.
    id: "status",
    label: "Status report",
    summary: "Recurring update — headline, shipped, in flight, blockers, next up",
    theme: "forest",
    kits: ["issues", "mockup"],
    structure: [
      {
        id: "headline",
        label: "Headline",
        hint: "On track / at risk / off track, in one line",
        required: true,
      },
      { id: "shipped", label: "Shipped", hint: "What landed since the last update" },
      { id: "inflight", label: "In flight", hint: "What's in progress, with rough % or ETA" },
      { id: "blockers", label: "Blockers", hint: "What's stuck and what would unblock it" },
      { id: "next", label: "Next up", hint: "What's planned for the next window" },
    ],
    defaults: { badge: { tone: "success", label: "Status" } },
  },
];

// Built-in ids, frozen at import (the MCP `blueprint` description lists these).
export const BLUEPRINT_IDS = BLUEPRINTS.map((b) => b.id);

// --- user-extensible layer ---------------------------------------------------
let extraBlueprints: Blueprint[] = [];

// Replace the user blueprint set (idempotent — see registerThemes).
export function registerBlueprints(blueprints: Blueprint[]): void {
  extraBlueprints = blueprints.slice();
}

// Built-ins ⊕ user blueprints, user first so a user id shadows a built-in.
function rawList(): Blueprint[] {
  return extraBlueprints.length === 0 ? BLUEPRINTS : [...extraBlueprints, ...BLUEPRINTS];
}
const rawById = (id: string): Blueprint | undefined => rawList().find((b) => b.id === id);

export const isKnownBlueprint = (id: unknown): id is string =>
  typeof id === "string" && rawById(id) !== undefined;

// Merge a blueprint's `extends` chain (parent fields first, child overrides;
// brand/defaults shallow-merge). `seen` guards a cycle. Returns a flat blueprint
// with no `extends`.
function resolveExtends(bp: Blueprint, seen: Set<string>): Blueprint {
  const parentId = bp.extends;
  if (!parentId || seen.has(bp.id)) return { ...bp, extends: undefined };
  seen.add(bp.id);
  const parentRaw = rawById(parentId);
  if (!parentRaw) return { ...bp, extends: undefined };
  const base = resolveExtends(parentRaw, seen);
  return {
    ...base,
    ...bp,
    id: bp.id,
    label: bp.label,
    summary: bp.summary,
    extends: undefined,
    brand: base.brand || bp.brand ? { ...base.brand, ...bp.brand } : undefined,
    defaults: base.defaults || bp.defaults ? { ...base.defaults, ...bp.defaults } : undefined,
  };
}

// Resolve a blueprint id to its fully-merged definition, or null for
// unset/unknown — so a stale `blueprint` reference never throws, it just no-ops.
export function blueprintById(id: string | null | undefined): Blueprint | null {
  if (typeof id !== "string") return null;
  const raw = rawById(id);
  return raw ? resolveExtends(raw, new Set()) : null;
}

// Discovery payload (no brand internals beyond what the agent authors against):
// id, label, summary, and the section skeleton. Built-in + user, extends merged.
export function blueprintSummaries() {
  return rawList().map((b) => {
    const r = resolveExtends(b, new Set());
    return {
      id: r.id,
      label: r.label,
      summary: r.summary,
      theme: r.theme,
      kits: r.kits ?? [],
      structure: r.structure ?? [],
    };
  });
}

export interface ResolvedBlueprint {
  // The applied blueprint's id, stored on the surface (undefined when none/unknown).
  blueprintId?: string;
  // Resolved theme id: an explicit surface theme wins, else the blueprint's.
  theme?: string;
  // Parts with html-part kits gap-filled from the blueprint's composition.
  parts: SurfacePart[];
  // The blueprint's default badge, for the publish flow to fill an unset chip.
  defaultBadge?: SurfaceBadge;
}

// Expand a blueprint into the surface fields it defaults. Pure: an explicit
// `theme` or a part's own `kits` always wins; the blueprint only fills gaps.
export function resolveBlueprint(input: {
  blueprint?: string;
  theme?: string;
  parts: SurfacePart[];
}): ResolvedBlueprint {
  const bp = blueprintById(input.blueprint);
  const explicitTheme = isKnownTheme(input.theme) ? input.theme : undefined;
  const blueprintTheme = bp && isKnownTheme(bp.theme) ? bp.theme : undefined;
  // Only valid kit ids ride in — a user blueprint's typo drops silently rather
  // than poisoning a stored part with an id the renderer ignores anyway.
  const bpKits = bp?.kits?.filter(isKnownKit) ?? [];
  const parts =
    bpKits.length > 0
      ? input.parts.map((p) =>
          p.kind === "html" && (!p.kits || p.kits.length === 0) ? { ...p, kits: bpKits } : p,
        )
      : input.parts;
  return {
    blueprintId: bp?.id,
    theme: explicitTheme ?? blueprintTheme,
    parts,
    defaultBadge: bp?.defaults?.badge,
  };
}

// Strip CSS-breaking characters from a token value before it lands in a `:root`
// declaration. The values come from local config (trusted), but this keeps a
// stray `}` or `</style>` from ever escaping the rule — cheap defense-in-depth.
const cssSafe = (s: string): string => s.replace(/[<>{};"\\]/g, "").trim();

// Build the `:root` brand-token block injected into a rendered html part. Font
// overrides --font-sans so every text node picks up the brand font with zero
// author effort; logo/wordmark are exposed as vars an author or kit opts into.
export function brandCss(brand: BlueprintBrand | undefined, origin: string): string {
  if (!brand) return "";
  const decls: string[] = [];
  const font = brand.fontFamily ? cssSafe(brand.fontFamily) : "";
  if (font) decls.push(`--font-sans:${font}`, `--font-brand:${font}`);
  if (brand.logoAssetId && /^[A-Za-z0-9_-]+$/.test(brand.logoAssetId)) {
    decls.push(`--brand-logo:url("${origin}/a/${brand.logoAssetId}")`);
  }
  const wordmark = brand.wordmark ? cssSafe(brand.wordmark) : "";
  if (wordmark) decls.push(`--brand-wordmark:"${wordmark}"`);
  return decls.length > 0 ? `:root{${decls.join(";")}}` : "";
}
