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
  renderStatus,
} from "../server/presetRenders.ts";
import { JsonFileStore } from "../server/storage.ts";

test("every selected preset has a renderer", () => {
  for (const id of [
    "postmortem",
    "data-viz",
    "design-doc",
    "status",
    "architecture",
    "product-demo",
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
  assert.match(r.html, /Root cause — 5 Whys/);
  assert.match(r.html, /Why A\?/);
  assert.match(r.html, /class="whys"/);
  assert.match(r.html, /Immediate/);
  assert.match(r.html, /T-1/); // follow-up ticket
  assert.match(r.html, /Impact: Medium/);
});

test("dashboard renders headline, a bar chart, and a takeaway", () => {
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
  assert.match(r.html, /86 ms/);
  assert.match(r.html, /<svg/); // bars + sparkline
  assert.match(r.html, /faster now/);
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
  assert.match(r.html, /Problem \(no implementation leakage\)/);
  assert.match(r.html, /the problem/);
  assert.match(r.html, /Axis · where\?/);
  assert.match(r.html, /pill pick/); // the chosen option
  assert.match(r.html, /Open questions/);
});

test("status badge reflects state; in-flight renders progress bars", () => {
  const ok = renderStatus({ title: "wk", state: "on-track", inFlight: [{ item: "X", pct: 80 }] });
  assert.match(ok.html, /badge ok/);
  assert.match(ok.html, /width:80%/);
  const risk = renderStatus({ title: "wk", state: "off-track" });
  assert.match(risk.html, /badge danger/);
});

test("architecture auto-draws a pipeline from component names", () => {
  const r = renderArchitecture({
    title: "Pipe",
    components: [{ name: "A" }, { name: "B" }, { name: "C" }],
    dataFlow: ["step one"],
  });
  assert.match(r.html, /<svg/);
  assert.match(r.html, /marker-end="url\(#arrow\)"/); // pipeline arrows
  assert.match(r.html, /step one/);
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
  for (const sectionId of ["hook", "problem", "feature", "proof", "cta"]) {
    assert.match(r.html, new RegExp(`data-section="${sectionId}"`), `${sectionId} step`);
  }
  assert.match(r.html, /class="anim/);
});

test("agent strings are escaped; backtick/bold inline fmt is applied", () => {
  const r = renderStatus({
    title: "T",
    headline: "use `code` and **bold** and <script>x</script>",
  });
  assert.match(r.html, /<span class="mono">code<\/span>/);
  assert.match(r.html, /<b>bold<\/b>/);
  assert.match(r.html, /&lt;script&gt;/); // the tag is escaped, not live
  assert.doesNotMatch(r.html, /<script>x<\/script>/);
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
