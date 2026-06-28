import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../server/app.ts";
import {
  PRESET_RENDERERS,
  renderArchitecture,
  renderDashboard,
  renderDesignDoc,
  renderPostmortem,
  renderProductDemo,
  renderProductDirection,
  renderStatus,
} from "../server/presetRenders.ts";
import { JsonFileStore } from "../server/storage.ts";
import type { RenderedPreset } from "../server/presetRenders.ts";
import type { ChartPart } from "../server/types.ts";

// Concatenated html-part bodies of a rendered preset (most are a single html part).
const htmlOf = (r: RenderedPreset): string =>
  r.parts
    .filter((p): p is { kind: "html"; html: string } => p.kind === "html")
    .map((p) => p.html)
    .join("\n");
const chartsOf = (r: RenderedPreset): ChartPart[] =>
  r.parts.filter((p): p is ChartPart => p.kind === "chart");

test("every selected preset has a renderer", () => {
  for (const id of [
    "postmortem",
    "data-viz",
    "design-doc",
    "status",
    "architecture",
    "product-demo",
    "wealthfront-product",
  ]) {
    assert.equal(typeof PRESET_RENDERERS[id], "function", `${id} renderer`);
  }
});

test("postmortem renders the template from typed data", () => {
  const r = renderPostmortem({
    title: "Checkout outage",
    summary: "Brief.",
    impact: { affected: "9", experience: "stuck", duration: "9 days" },
    timeline: [{ at: "1:00", event: "alert", marker: "danger" }],
    fiveWhys: [
      { why: "Why A?", because: "B." },
      { why: "Why B?", because: "C." },
    ],
    contributingFactors: "no test",
    fixes: { immediate: ["roll back"], necessary: ["add guard"], additional: ["alert"] },
    followups: [{ item: "do X", ticket: "T-1", owner: "@me", due: "Fri", status: "open" }],
    impactLevel: "Medium",
    reoccurrence: "Low",
  });
  assert.equal(r.title, "Checkout outage");
  assert.deepEqual(r.badge, { tone: "warning", label: "Postmortem" });
  const html = htmlOf(r);
  assert.match(html, /Root cause — 5 Whys/);
  assert.match(html, /Why A\?/);
  assert.match(html, /class="whys"/);
  assert.match(html, /Immediate/);
  assert.match(html, /T-1/); // follow-up ticket
  assert.match(html, /Impact: Medium/);
});

test("dashboard emits native chart parts (bar + area) around html scaffolding", () => {
  const r = renderDashboard({
    title: "Latency",
    headline: { value: "86 ms", label: "p95" },
    stats: [{ label: "p50", value: "12 ms" }],
    bars: {
      caption: "by endpoint",
      data: [
        { label: "/a", value: 10 },
        { label: "/b", value: 5 },
      ],
    },
    trend: { values: [3, 2, 1] },
    takeaway: "faster now",
  });
  // Headline + takeaway live in html parts...
  assert.match(htmlOf(r), /86 ms/);
  assert.match(htmlOf(r), /faster now/);
  // ...and the breakdown + trend are REAL chart parts, not inline SVG.
  const charts = chartsOf(r);
  assert.equal(charts.length, 2);
  const bar = charts.find((c) => c.chartType === "bar");
  assert.ok(bar, "bar chart part");
  assert.equal(bar.x, "label");
  assert.equal(bar.y, "value");
  assert.deepEqual(bar.data, [
    { label: "/a", value: 10 },
    { label: "/b", value: 5 },
  ]);
  assert.match(String(bar.caption), /Breakdown/);
  assert.ok(
    charts.find((c) => c.chartType === "area"),
    "area trend part",
  );
  assert.doesNotMatch(htmlOf(r), /<svg/); // no inline chart svg anymore
});

test("design-doc renders goal-as-problem and the axes solution space", () => {
  const r = renderDesignDoc({
    title: "RFC",
    status: "In review",
    summary: "summary",
    goal: { problem: "the problem", metrics: "the metric" },
    solutionSpace: {
      axes: [
        {
          axis: "where?",
          options: [{ label: "here", chosen: true }, { label: "there" }],
          rationale: "because",
        },
      ],
    },
    openQuestions: [{ question: "Q1?", owner: "me" }],
  });
  const html = htmlOf(r);
  assert.match(html, /Problem \(no implementation leakage\)/);
  assert.match(html, /the problem/);
  assert.match(html, /Axis · where\?/);
  assert.match(html, /pill pick/); // the chosen option
  assert.match(html, /Open questions/);
});

test("status badge reflects state; in-flight renders progress bars", () => {
  const ok = renderStatus({ title: "wk", state: "on-track", inFlight: [{ item: "X", pct: 80 }] });
  assert.match(htmlOf(ok), /badge ok/);
  assert.match(htmlOf(ok), /width:80%/);
  const risk = renderStatus({ title: "wk", state: "off-track" });
  assert.match(htmlOf(risk), /badge danger/);
});

test("architecture auto-draws a pipeline from component names", () => {
  const r = renderArchitecture({
    title: "Pipe",
    components: [{ name: "A" }, { name: "B" }, { name: "C" }],
    dataFlow: ["step one"],
  });
  const html = htmlOf(r);
  assert.match(html, /<svg/);
  assert.match(html, /marker-end="url\(#arrow\)"/); // pipeline arrows
  assert.match(html, /step one/);
});

test("product-demo renders the five animate beats with data-section tags", () => {
  const r = renderProductDemo({
    title: "Demo",
    hook: { headline: "Big", stats: [{ value: "40s", label: "fast" }] },
    problem: { text: "pain" },
    features: [{ title: "F1", body: "does X" }],
    proof: { stats: [{ value: "9x", label: "better" }], quote: "love it" },
    cta: { headline: "Start", actions: ["Go"] },
  });
  const html = htmlOf(r);
  for (const sectionId of ["hook", "problem", "feature", "proof", "cta"]) {
    assert.match(html, new RegExp(`data-section="${sectionId}"`), `${sectionId} step`);
  }
  assert.match(html, /class="anim/);
});

test("product-direction renders the wf spine: direction, alternatives, leaning", () => {
  const r = renderProductDirection({
    title: "Memory UX",
    direction: "Manage memories in the Memory tab",
    heading: "What I remember about you",
    alternatives: [
      {
        key: "A",
        title: "Inline breadcrumb",
        tag: { label: "future", kind: "future" },
        pro: "edit in place",
        con: "needs support",
        lean: true,
      },
      { title: "Approve first", tag: { label: "interrupts", kind: "interrupts" } },
    ],
    leaning: {
      verdict: "Recommend the tab",
      recommendation: "Use the Memory tab",
      why: "ships first",
    },
  });
  const html = htmlOf(r);
  // the fixed spine + section anchors
  assert.match(html, /class="wf"/);
  for (const sectionId of ["direction", "alternatives"]) {
    assert.match(html, new RegExp(`data-section="${sectionId}"`), `${sectionId} section`);
  }
  assert.match(html, /class="pchip">Direction</);
  // tag-kind → kit class mapping (non-blocking→flow, interrupts/shortcut→intr)
  assert.match(html, /class="tag future"/);
  assert.match(html, /class="tag intr"/);
  // the recommended option is marked, pro/con render, and the leaning is the payoff
  assert.match(html, /class="opt lean"/);
  assert.match(html, /class="pc"/);
  assert.match(html, /class="lean"/);
  assert.match(html, /class="verdict"/);
  assert.equal(r.badge?.label, "Direction");
});

test("product-direction passes the bespoke view html through raw; winner column tagged", () => {
  const r = renderProductDirection({
    title: "T",
    view: '<div class="frame"><main class="main">mock</main></div>',
    comparison: {
      headers: ["Dim", "Option A", "Option B"],
      rows: [{ label: "Ships first", cells: ["Yes", "No"] }],
      winner: 1,
    },
    leaning: { recommendation: "Go with A" },
  });
  const html = htmlOf(r);
  // view is a freehand slot — its markup is NOT escaped
  assert.match(html, /<div class="frame"><main class="main">mock<\/main><\/div>/);
  // winner=1 highlights the first option column (header + the matching cell)
  assert.match(html, /<th class="win">Option A<\/th>/);
  assert.match(html, /<td class="win">Yes<\/td>/);
  assert.doesNotMatch(html, /<td class="win">No<\/td>/);
});

test("product-direction escapes agent text but keeps the view passthrough", () => {
  const r = renderProductDirection({
    title: "T",
    heading: "<script>x</script> and **bold**",
    leaning: { recommendation: "safe `code`" },
  });
  const html = htmlOf(r);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /<span class="mono">code<\/span>/);
});

test("agent strings are escaped; backtick/bold inline fmt is applied", () => {
  const r = renderStatus({
    title: "T",
    headline: "use `code` and **bold** and <script>x</script>",
  });
  const html = htmlOf(r);
  assert.match(html, /<span class="mono">code<\/span>/);
  assert.match(html, /<b>bold<\/b>/);
  assert.match(html, /&lt;script&gt;/); // the tag is escaped, not live
  assert.doesNotMatch(html, /<script>x<\/script>/);
});

// --- the publish flow (HTTP) ------------------------------------------------

function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "showcase-preset-tool-"));
  const store = new JsonFileStore(join(dir, "data.json"));
  const app = createApp({
    store,
    viewerHtml: "<html>v</html>",
    guideMarkdown: "# g",
    setupText: "# s",
    playbookText: "# p",
  });
  return { app, store };
}

test("POST /api/presets/:id renders, publishes, and pins the preset to the session", async () => {
  const { app, store } = makeApp();
  const res = await app.request("/api/presets/postmortem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Outage",
      summary: "x",
      fiveWhys: [{ why: "a", because: "b" }],
    }),
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as any;
  assert.ok(body.id);
  // The session is now a postmortem session (preset pinned, theme resolved).
  const session = await store.getSession(body.sessionId);
  assert.equal(session?.blueprint, "postmortem");
  const surf = await store.getSurface(body.id);
  assert.ok(surf);
  assert.equal(surf.theme, "rose");
  assert.match((surf.parts[0] as any).html, /Root cause — 5 Whys/);
});

test("POST /api/presets/:id rejects an unknown preset", async () => {
  const { app } = makeApp();
  const res = await app.request("/api/presets/nope", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "x" }),
  });
  assert.equal(res.status, 400);
});
