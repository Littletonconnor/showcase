// Per-preset renderers — the typed form factors. Each preset exposes a tailored
// MCP tool (publish_postmortem, publish_dashboard, …) whose typed payload lands
// here and is turned into ONE html part with a fixed layout. The renderer owns
// the structure, so every postmortem / dashboard / design-doc looks identical no
// matter who (or which agent) produced it — the same guarantee publish_decisions
// gives a code review, applied to the rest of the presets.
//
// Runtime-agnostic (no `node:` imports): pure string building, like surfacePage.
// The publish flow (server/app.ts → publishPreset) attaches the preset's
// blueprint, which fills the theme + kits; these renderers only emit the body.
//
// Defensive by construction: payloads arrive as `unknown` JSON (the HTTP path
// doesn't deep-validate), so every read goes through the s()/arr()/obj() coercers
// and every agent string is escaped — a malformed field degrades to empty, never
// breaks the layout or the surrounding markup.

import { htmlPart, type ChartPart, type SurfaceBadge, type SurfacePart } from "./types.ts";

export interface RenderedPreset {
  title: string;
  // The surface parts to publish. Most presets are a single html part; data-viz
  // interleaves html scaffolding with native `chart` parts (Recharts, themed by
  // the viewer) so the dashboard's charts are real, interactive, and re-theme.
  parts: SurfacePart[];
  badge?: SurfaceBadge;
}

// A native chart part — rendered by the viewer, not as html, so it's interactive
// and re-themes with the board (server/types.ts ChartPart).
function chartPart(p: Omit<ChartPart, "kind">): ChartPart {
  return { kind: "chart", ...p };
}

// --- coercion + escaping ----------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const num = (v: unknown): number => (typeof v === "number" && isFinite(v) ? v : 0);

const esc = (v: unknown): string =>
  s(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Escape, then re-introduce a tiny safe inline vocabulary: `code` → mono span,
// **bold** → <b>. Applied to escaped text, so the agent can emphasize without any
// markup injection path.
const fmt = (v: unknown): string =>
  esc(v)
    .replace(/`([^`]+)`/g, '<span class="mono">$1</span>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

const sec = (label: string) => `<span class="eyebrow">${esc(label)}</span>`;

// A bulleted list from string[] (each item gets light inline fmt). Empty → "".
const list = (items: unknown[]): string =>
  items.length ? `<ul>${items.map((i) => `<li>${fmt(i)}</li>`).join("")}</ul>` : "";

// Auto-draw a left-to-right pipeline from component names (architecture overview).
function pipelineSvg(names: string[]): string {
  const n = Math.min(names.length, 5);
  if (n === 0) return "";
  const ramp = ["c-blue", "c-teal", "c-amber", "c-coral", "c-green"];
  const w = 680;
  const gap = 28;
  const boxW = Math.floor((w - gap * (n - 1)) / n);
  const boxes = names.slice(0, n).map((name, i) => {
    const x = i * (boxW + gap);
    const cls = ramp[i % ramp.length];
    const arrow =
      i < n - 1
        ? `<line class="arr" x1="${x + boxW}" y1="34" x2="${x + boxW + gap}" y2="34" marker-end="url(#arrow)"/>`
        : "";
    return `<g class="${cls}"><rect class="box" x="${x}" y="14" width="${boxW}" height="40"/><text class="th" x="${x + boxW / 2}" y="38" text-anchor="middle">${esc(name)}</text></g>${arrow}`;
  });
  return `<svg width="100%" viewBox="0 0 ${w} 68">${boxes.join("")}</svg>`;
}

const TONE: Record<string, string> = { ok: "ok", warn: "warn", danger: "danger", info: "info" };
const dot = (tone: unknown) => `<span class="dot ${TONE[s(tone)] ?? ""}"></span>`;

// --- shared <style> blocks --------------------------------------------------

const WHYS_CSS = `<style>
.whys{counter-reset:w;list-style:none;margin:0;padding:0}
.whys li{position:relative;margin-left:11px;padding:0 0 13px 24px;border-left:2px solid var(--color-border-warning)}
.whys li:last-child{border-left-color:transparent;padding-bottom:0}
.whys li::before{counter-increment:w;content:counter(w);position:absolute;left:-12px;top:-2px;width:22px;height:22px;border-radius:999px;background:var(--color-background-warning);border:1px solid var(--color-border-warning);color:var(--color-text-warning);font:600 11px/22px var(--font-sans);text-align:center}
.tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.tl li{display:flex;gap:10px;align-items:baseline}
.tl .t{font:400 12px/1.5 var(--font-mono);color:var(--color-text-tertiary);min-width:118px;flex:none}
</style>`;

const AXIS_CSS = `<style>
.axis{border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:10px 12px;background:var(--color-background-primary)}
.pill.pick{border-color:var(--color-border-info);background:var(--color-background-info);color:var(--color-text-info)}
</style>`;

// --- postmortem -------------------------------------------------------------

export function renderPostmortem(input: unknown): RenderedPreset {
  const d = obj(input);
  const title = s(d.title) || "Incident postmortem";
  const impact = obj(d.impact);
  const timeline = arr(d.timeline)
    .map((e) => {
      const ev = obj(e);
      const m = s(ev.marker);
      return `<li><span class="t">${esc(ev.at)}</span><span>${m ? dot(m) + " " : ""}${fmt(ev.event)}</span></li>`;
    })
    .join("");
  const whys = arr(d.fiveWhys)
    .map((w) => {
      const o = obj(w);
      return `<li><b>${esc(o.why)}</b> <span class="dim">${fmt(o.because)}</span></li>`;
    })
    .join("");
  const fixes = obj(d.fixes);
  const fixBlock = (label: string, tone: string, items: unknown) => {
    const li = list(arr(items));
    return li
      ? `<div class="callout ${tone} stack sm"><span class="label">${label}</span>${li}</div>`
      : "";
  };
  const followups = arr(d.followups)
    .map((f) => {
      const o = obj(f);
      const status =
        s(o.status) === "done"
          ? `<span class="badge ok">done</span>`
          : `<span class="badge danger">open</span>`;
      const ticket = s(o.ticket) ? `<span class="chip">${esc(o.ticket)}</span>` : "";
      const meta = [s(o.owner), s(o.due)].filter(Boolean).map(esc).join(" · ");
      return `<li class="row">${status} ${fmt(o.item)} <span class="grow"></span>${ticket}${meta ? `<span class="faint">${meta}</span>` : ""}</li>`;
    })
    .join("");
  const contributing = s(d.contributingFactors)
    ? `<div class="box soft stack sm" style="margin-top:4px"><span class="label">Contributing factors (pressure-test)</span><p class="faint">${fmt(d.contributingFactors)}</p></div>`
    : "";
  const wentWell = s(d.wentWell)
    ? `<div class="callout ok grow stack sm"><span class="label">What went well</span><p class="faint">${fmt(d.wentWell)}</p></div>`
    : "";
  const wentPainful = s(d.wentPainful)
    ? `<div class="callout muted grow stack sm"><span class="label">What was painful</span><p class="faint">${fmt(d.wentPainful)}</p></div>`
    : "";
  const reminders = [
    s(d.impactLevel) && `Impact: ${esc(d.impactLevel)}`,
    s(d.reoccurrence) && `Reoccurrence: ${esc(d.reoccurrence)}`,
  ]
    .filter(Boolean)
    .map((t) => `<span class="pill">${t}</span>`)
    .join("");

  const html = `${WHYS_CSS}
<div class="panel stack lg">
  <div class="between">
    <div class="stack sm">${s(d.incidentId) ? `<span class="label">Postmortem · ${esc(d.incidentId)}</span>` : sec("Postmortem")}
      <span class="title" style="font-size:20px">${esc(title)}</span></div>
    <span class="badge warn">Blameless</span>
  </div>
  <div class="callout stack sm">${sec("Summary")}<p>${fmt(d.summary)}</p></div>
  <div class="row">${sec("Customer impact")}</div>
  <div class="row" style="align-items:stretch;gap:10px">
    ${s(impact.affected) ? `<div class="stack sm" style="min-width:130px"><span class="metric" style="font-size:24px">${esc(impact.affected)}</span><span class="dim">affected</span></div>` : ""}
    <div class="box grow stack sm"><span class="label">Experience</span><span class="faint">${fmt(impact.experience)}</span></div>
    ${s(impact.duration) ? `<div class="box stack sm"><span class="label">Duration</span><span class="metric" style="font-size:18px">${esc(impact.duration)}</span></div>` : ""}
  </div>
  ${timeline ? `<div class="stack sm">${sec("Timeline (PT)")}<ul class="tl">${timeline}</ul></div>` : ""}
  <div class="callout warn stack sm">${sec("Root cause — 5 Whys")}
    <ol class="whys">${whys}</ol>${contributing}
  </div>
  <div class="stack sm">${sec("Fixes")}
    ${fixBlock("Immediate", "danger", fixes.immediate)}
    ${fixBlock("Necessary", "warn", fixes.necessary)}
    ${fixBlock("Additional", "", fixes.additional)}
  </div>
  ${wentWell || wentPainful ? `<div class="row" style="align-items:stretch;gap:10px">${wentWell}${wentPainful}</div>` : ""}
  <div class="stack sm">${sec("Follow-ups & tracking")}
    <ul class="tree">${followups}</ul>
    ${reminders ? `<div class="row">${reminders}</div>` : ""}
  </div>
</div>`;
  return { title, parts: [htmlPart(html)], badge: { tone: "warning", label: "Postmortem" } };
}

// --- data-viz / dashboard ---------------------------------------------------

export function renderDashboard(input: unknown): RenderedPreset {
  const d = obj(input);
  const title = s(d.title) || "Dashboard";
  const headline = obj(d.headline);
  const stats = arr(d.stats)
    .map((st) => {
      const o = obj(st);
      return `<div class="box stack sm"><span class="label">${esc(o.label)}</span><span class="metric" style="font-size:20px">${esc(o.value)}</span></div>`;
    })
    .join("");
  const delta = s(headline.delta) ? `<span class="dim"> · ${esc(headline.delta)}</span>` : "";

  // Headline + stat boxes (html). The charts below are NATIVE parts.
  const headHtml = `<div class="panel stack lg">
  <div class="stack sm">${sec("Metrics")}<span class="title" style="font-size:20px">${esc(title)}</span></div>
  <div class="row" style="gap:24px;align-items:flex-start">
    <div class="stack sm">${sec("Headline")}<span class="metric">${esc(headline.value)}</span><span class="dim">${esc(headline.label)}${delta}</span></div>
    ${stats}
  </div>
</div>`;

  const parts: SurfacePart[] = [htmlPart(headHtml)];

  // Breakdown — a real bar chart the viewer renders (themed, interactive).
  const bars = obj(d.bars);
  const barData = arr(bars.data)
    .map((r) => {
      const o = obj(r);
      return { label: s(o.label), value: num(o.value) };
    })
    .filter((r) => r.label);
  if (barData.length) {
    parts.push(
      chartPart({
        chartType: "bar",
        data: barData,
        x: "label",
        y: "value",
        caption: ["Breakdown", s(bars.caption)].filter(Boolean).join(" · "),
      }),
    );
  }

  // Trend — a real area chart over the supplied series.
  const trend = obj(d.trend);
  const trendVals = arr(trend.values).map(num);
  if (trendVals.length > 1) {
    parts.push(
      chartPart({
        chartType: "area",
        data: trendVals.map((v, i) => ({ t: i + 1, value: v })),
        x: "t",
        y: "value",
        xLabel: s(trend.xLabel) || undefined,
        caption: ["Trend", s(trend.caption)].filter(Boolean).join(" · "),
      }),
    );
  }

  // Detail + takeaway (html).
  const detail = arr(d.detail)
    .map((r) => {
      const o = obj(r);
      return `<li class="row"><span class="grow">${fmt(o.label)}</span><span class="mono num">${esc(o.value)}</span></li>`;
    })
    .join("");
  const tailHtml = `${detail ? `<div class="stack sm">${sec("Detail")}<ul class="tree">${detail}</ul></div>` : ""}${s(d.takeaway) ? `<div class="callout ok stack sm">${sec("Takeaway")}<p>${fmt(d.takeaway)}</p></div>` : ""}`;
  if (tailHtml) parts.push(htmlPart(tailHtml));

  return { title, parts, badge: { tone: "info", label: "Metrics" } };
}

// --- design-doc -------------------------------------------------------------

export function renderDesignDoc(input: unknown): RenderedPreset {
  const d = obj(input);
  const title = s(d.title) || "Design doc";
  const statuses = ["Draft", "In review", "Approved", "Implemented"];
  const cur = s(d.status);
  const statusPills = statuses
    .map((st) => `<span class="pill${st === cur ? " pick" : ""}">${st}</span>`)
    .join("");
  const meta = obj(d.meta);
  const links = arr(meta.links)
    .map((l) => `<span class="chip">${esc(l)}</span>`)
    .join("");
  const metaLine = [
    s(meta.author) && `Author: ${esc(meta.author)}`,
    s(meta.reviewers) && `Reviewers: ${esc(meta.reviewers)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const goal = obj(d.goal);
  const inv = obj(d.invariants);
  const invBox = (label: string, v: unknown) =>
    s(v)
      ? `<div class="box grow stack sm"><span class="label">${label}</span><p>${fmt(v)}</p></div>`
      : "";
  const sp = obj(d.solutionSpace);
  const axes = arr(sp.axes)
    .map((a) => {
      const o = obj(a);
      const opts = arr(o.options)
        .map((op) => {
          const oo = obj(op);
          return `<span class="pill${oo.chosen ? " pick" : ""}">${esc(oo.label)}</span>`;
        })
        .join("");
      return `<div class="axis stack sm"><span class="label">Axis · ${esc(o.axis)}</span><div class="row">${opts}</div>${s(o.rationale) ? `<span class="faint">${fmt(o.rationale)}</span>` : ""}</div>`;
    })
    .join("");
  const proposed = obj(d.proposed);
  const propBoxes = [
    s(proposed.failureModes) &&
      `<div class="callout warn grow stack sm"><span class="label">Failure modes</span><p>${fmt(proposed.failureModes)}</p></div>`,
    s(proposed.observability) &&
      `<div class="callout grow stack sm"><span class="label">Observability &amp; security</span><p>${fmt(proposed.observability)}</p></div>`,
  ]
    .filter(Boolean)
    .join("");
  const scope = obj(d.scope);
  const milestones = arr(scope.milestones)
    .map((m) => `<span class="pill">${esc(m)}</span>`)
    .join("");
  const openQ = arr(d.openQuestions)
    .map((q) => {
      const o = obj(q);
      return `<li>${fmt(o.question)}${s(o.owner) ? ` <span class="faint">owner: ${esc(o.owner)}</span>` : ""}</li>`;
    })
    .join("");

  const html = `${AXIS_CSS}
<div class="panel stack lg">
  <div class="stack sm">
    <span class="title" style="font-size:20px">${esc(title)}</span>
    <div class="row">${sec("Metadata")}</div>
    <div class="row">${statusPills}${links}</div>
    ${metaLine ? `<span class="dim">${metaLine}</span>` : ""}
  </div>
  <div class="callout stack sm">${sec("Executive summary")}<p>${fmt(d.summary)}</p></div>
  <div class="stack sm">${sec("Goal statement")}
    <div class="callout ok stack sm"><span class="label">Problem (no implementation leakage)</span><p>${fmt(goal.problem)}</p></div>
    ${s(goal.metrics) ? `<p class="dim"><b>Success metrics:</b> ${fmt(goal.metrics)}</p>` : ""}
  </div>
  ${invBox("True invariants", inv.trueInvariants) || invBox("Preferences", inv.preferences) || invBox("Assumptions", inv.assumptions) ? `<div class="row">${sec("Invariants & constraints")}</div><div class="row" style="align-items:stretch;gap:10px">${invBox("True invariants", inv.trueInvariants)}${invBox("Preferences", inv.preferences)}${invBox("Assumptions", inv.assumptions)}</div>` : ""}
  ${s(d.background) ? `<div class="stack sm">${sec("Background / research")}<p>${fmt(d.background)}</p></div>` : ""}
  ${axes ? `<div class="stack sm">${sec("Solution space")}${s(sp.note) ? `<span class="dim">${esc(sp.note)}</span>` : ""}${axes}</div>` : ""}
  <div class="stack sm">${sec("Proposed solution")}${s(proposed.summary) ? `<p>${fmt(proposed.summary)}</p>` : ""}${propBoxes ? `<div class="row" style="align-items:stretch;gap:10px">${propBoxes}</div>` : ""}</div>
  ${s(scope.inScope) || s(scope.outScope) || milestones ? `<div class="stack sm">${sec("Scope, sequencing, ownership")}${s(scope.inScope) || s(scope.outScope) ? `<p>${s(scope.inScope) ? `<b>In:</b> ${fmt(scope.inScope)} ` : ""}${s(scope.outScope) ? `<b>Out:</b> ${fmt(scope.outScope)}` : ""}</p>` : ""}${milestones ? `<div class="row">${milestones}</div>` : ""}</div>` : ""}
  ${s(d.rollout) || s(d.testing) ? `<div class="row" style="align-items:stretch;gap:10px">${s(d.rollout) ? `<div class="grow stack sm">${sec("Rollout plan")}<p class="faint">${fmt(d.rollout)}</p></div>` : ""}${s(d.testing) ? `<div class="grow stack sm">${sec("Testing & confidence")}<p class="faint">${fmt(d.testing)}</p></div>` : ""}</div>` : ""}
  ${openQ ? `<div class="callout muted stack sm">${sec("Open questions")}<ul>${openQ}</ul></div>` : ""}
</div>`;
  return { title, parts: [htmlPart(html)], badge: { tone: "info", label: "Design" } };
}

// --- status report ----------------------------------------------------------

const STATUS_BADGE: Record<string, { tone: string; label: string }> = {
  "on-track": { tone: "ok", label: "On track" },
  "at-risk": { tone: "warn", label: "At risk" },
  "off-track": { tone: "danger", label: "Off track" },
};

export function renderStatus(input: unknown): RenderedPreset {
  const d = obj(input);
  const title = s(d.title) || "Status report";
  const state = STATUS_BADGE[s(d.state)] ?? STATUS_BADGE["on-track"];
  const shipped = arr(d.shipped)
    .map((x) => {
      const o = obj(x);
      return `<li class="row"><span class="dot ok"></span> ${fmt(o.item)}${s(o.note) ? ` <span class="faint">${esc(o.note)}</span>` : ""}</li>`;
    })
    .join("");
  const inflight = arr(d.inFlight)
    .map((x) => {
      const o = obj(x);
      const pct = Math.max(0, Math.min(100, num(o.pct)));
      const warn = pct < 50 ? ";background:var(--color-text-warning)" : "";
      return `<div class="between"><span>${fmt(o.item)}</span><span class="faint num">${pct}%</span></div><div class="bar"><i style="width:${pct}%${warn}"></i></div>`;
    })
    .join("");
  const next = arr(d.next)
    .map((x) => `<span class="pill">${esc(x)}</span>`)
    .join("");

  const html = `<div class="panel stack lg">
  <div class="between">
    <div class="stack sm">${sec("Status")}<span class="title" style="font-size:20px">${esc(title)}</span></div>
    <span class="badge ${state.tone}">${state.label}</span>
  </div>
  ${s(d.headline) ? `<div class="callout ${state.tone === "ok" ? "ok" : state.tone === "warn" ? "warn" : "danger"} stack sm">${sec("Headline")}<p>${fmt(d.headline)}</p></div>` : ""}
  ${shipped ? `<div class="stack sm">${sec("Shipped")}<ul class="tree">${shipped}</ul></div>` : ""}
  ${inflight ? `<div class="stack sm">${sec("In flight")}<div class="stack sm">${inflight}</div></div>` : ""}
  ${s(d.blockers) ? `<div class="callout warn stack sm">${sec("Blockers")}<p>${fmt(d.blockers)}</p></div>` : ""}
  ${next ? `<div class="stack sm">${sec("Next up")}<div class="row">${next}</div></div>` : ""}
</div>`;
  return { title, parts: [htmlPart(html)], badge: { tone: "success", label: "Status" } };
}

// --- architecture -----------------------------------------------------------

export function renderArchitecture(input: unknown): RenderedPreset {
  const d = obj(input);
  const title = s(d.title) || "Architecture";
  const components = arr(d.components).map((c) => obj(c));
  const overviewSvg = pipelineSvg(components.map((c) => s(c.name)));
  const compTree = components
    .map(
      (c) =>
        `<li class="row"><span class="dot info"></span> ${fmt(c.name)}${s(c.role) ? ` <span class="faint">${esc(c.role)}</span>` : ""}</li>`,
    )
    .join("");
  const flow = arr(d.dataFlow)
    .map((step, i) => `<li class="row"><span class="chip">${i + 1}</span> ${fmt(step)}</li>`)
    .join("");

  const html = `<div class="panel stack lg">
  <div class="stack sm">${sec("Architecture")}<span class="title" style="font-size:20px">${esc(title)}</span></div>
  <div class="stack sm">${sec("Overview")}${overviewSvg}${s(d.overview) ? `<p class="dim">${fmt(d.overview)}</p>` : ""}</div>
  ${
    compTree || flow
      ? `<div class="row" style="align-items:stretch;gap:10px">
    ${compTree ? `<div class="grow stack sm">${sec("Components")}<ul class="tree">${compTree}</ul></div>` : ""}
    ${flow ? `<div class="grow stack sm">${sec("Data flow")}<ul class="tree">${flow}</ul></div>` : ""}
  </div>`
      : ""
  }
  ${s(d.decisions) ? `<div class="callout stack sm">${sec("Key decisions")}<p>${fmt(d.decisions)}</p></div>` : ""}
  ${s(d.scale) ? `<div class="callout warn stack sm">${sec("Scale & failure")}<p>${fmt(d.scale)}</p></div>` : ""}
</div>`;
  return { title, parts: [htmlPart(html)], badge: { tone: "info", label: "Architecture" } };
}

// --- product demo (stepped, animate kit) ------------------------------------

export function renderProductDemo(input: unknown): RenderedPreset {
  const d = obj(input);
  const title = s(d.title) || "Product demo";
  const hook = obj(d.hook);
  const hookStats = arr(hook.stats)
    .map((st) => {
      const o = obj(st);
      return `<div class="stack sm"><span class="metric">${esc(o.value)}</span><span class="faint">${esc(o.label)}</span></div>`;
    })
    .join("");
  const problem = obj(d.problem);
  const probStats = arr(problem.stats)
    .map((st) => {
      const o = obj(st);
      return `<div class="stack sm"><span class="metric" style="font-size:22px">${esc(o.value)}</span><span class="faint">${esc(o.label)}</span></div>`;
    })
    .join("");
  const features = arr(d.features)
    .map((f) => {
      const o = obj(f);
      return `<div class="box grow stack sm"><span class="label">${esc(o.title)}</span><span class="faint">${fmt(o.body)}</span></div>`;
    })
    .join("");
  const proof = obj(d.proof);
  const proofStats = arr(proof.stats)
    .map((st, i) => {
      const o = obj(st);
      return i === 0
        ? `<div class="stack sm"><span class="metric">${esc(o.value)}</span><span class="dim">${esc(o.label)}</span></div>`
        : `<div class="box stack sm"><span class="label">${esc(o.label)}</span><span class="metric" style="font-size:20px">${esc(o.value)}</span></div>`;
    })
    .join("");
  const cta = obj(d.cta);
  const actions = arr(cta.actions)
    .map((a, i) => `<button class="btn ${i === 0 ? "primary" : "ghost"}">${esc(a)}</button>`)
    .join("");
  const tags = arr(cta.tags)
    .map((t) => `<span class="pill">${esc(t)}</span>`)
    .join("");

  const html = `<div class="anim stack lg">
  <div class="step" data-section="hook" data-label="Hook">
    <div class="panel stack sm">${sec("Hook")}
      <span class="title" style="font-size:24px">${fmt(hook.headline)}</span>
      ${s(hook.sub) ? `<p class="dim">${fmt(hook.sub)}</p>` : ""}
      ${hookStats ? `<div class="row" style="gap:24px;margin-top:4px">${hookStats}</div>` : ""}
    </div>
  </div>
  <div class="step" data-section="problem" data-label="Problem">
    <div class="callout warn stack sm">${sec("Problem")}<p>${fmt(problem.text)}</p>${probStats ? `<div class="row" style="gap:24px;margin-top:4px">${probStats}</div>` : ""}</div>
  </div>
  <div class="step" data-section="feature" data-label="Feature">
    <div class="stack sm">${sec("Feature")}${s(d.featureTitle) ? `<span class="title">${fmt(d.featureTitle)}</span>` : ""}
      ${features ? `<div class="row" style="align-items:stretch;gap:10px">${features}</div>` : ""}
    </div>
  </div>
  <div class="step" data-section="proof" data-label="Proof">
    <div class="stack sm">${sec("Proof")}${proofStats ? `<div class="row" style="gap:24px">${proofStats}</div>` : ""}
      ${s(proof.quote) ? `<div class="callout ok stack sm"><span class="label">${esc(proof.quoteBy) || "From a customer"}</span><p>${fmt(proof.quote)}</p></div>` : ""}
    </div>
  </div>
  <div class="step" data-section="cta" data-label="Next step">
    <div class="panel stack sm">${sec("Next step")}<span class="title">${fmt(cta.headline)}</span>
      ${s(cta.body) ? `<p class="dim">${fmt(cta.body)}</p>` : ""}
      ${actions ? `<div class="row">${actions}</div>` : ""}${tags ? `<div class="row">${tags}</div>` : ""}
    </div>
  </div>
</div>`;
  return { title, parts: [htmlPart(html)], badge: { tone: "info", label: "Demo" } };
}

// Preset id → renderer. The publish flow (app.ts) pins the matching blueprint,
// which supplies the theme + kits; the renderer only emits the body.
export const PRESET_RENDERERS: Record<string, (input: unknown) => RenderedPreset> = {
  postmortem: renderPostmortem,
  "data-viz": renderDashboard,
  "design-doc": renderDesignDoc,
  status: renderStatus,
  architecture: renderArchitecture,
  "product-demo": renderProductDemo,
};
