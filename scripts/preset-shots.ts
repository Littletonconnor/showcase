// Preset gallery screenshots. For every preset that has a tailored renderer
// (server/presetRenders.ts), this feeds EXAMPLE TYPED DATA through the SAME
// renderer the MCP tools use, then rasterizes it via renderHtmlPage + Playwright
// — so the gallery proves the real publish_postmortem / publish_dashboard / …
// output, not hand-authored markup. Presets without a typed tool (concept,
// product-mockup) fall back to inline html.
//
// Run: node scripts/preset-shots.ts   (writes docs/images/presets/*.png)

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLUEPRINTS } from "../server/blueprints.ts";
import { PRESET_RENDERERS } from "../server/presetRenders.ts";
import { renderHtmlPage } from "../server/surfacePage.ts";
import type { Mode } from "../server/themes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "images", "presets");
const ORIGIN = "http://localhost:8229";

const sec = (label: string) => `<span class="eyebrow">${label}</span>`;

// Typed example payloads — exactly what an agent would pass to the tailored MCP
// tool. Rendered through PRESET_RENDERERS, so a change to a renderer shows here.
const DATA: Record<string, unknown> = {
  postmortem: {
    incidentId: "WEBOPS-10572",
    title: "Dividend sweep blocked for managed accounts",
    summary:
      "For 9 days, managed-investment clients couldn't sweep dividends to their trust cash accounts on Web. A code-generated API client serialized a missing query param as the literal string `undefined`, which the backend read as a real account request and filtered out the eligible accounts. Fixed by coercing it to `Option.none()`; the generated client now omits empty params entirely.",
    impact: {
      affected: "9",
      experience:
        "Dividends never swept to trust cash accounts on Web; balances looked stuck. No money lost.",
      duration: "9 days",
    },
    timeline: [
      {
        at: "Nov 24 · 3:42 PM",
        event: "Dividend sweeping ramped to 100% across managed accounts.",
      },
      { at: "Dec 3 · 11:21 AM", event: "Issue reported in `~dividend-sweeping`." },
      { at: "Dec 3 · 12:35 PM", event: "WEBOPS-10572 filed." },
      { at: "Dec 3 · 12:48 PM", event: "Backend query confirmed correct in isolation." },
      {
        at: "Dec 3 · 1:00 PM",
        event: "API response missing destination accounts → points at the API/request layer.",
      },
      { at: "Dec 3 · 1:15 PM", event: "Request carries `account_request_id=undefined`." },
      {
        at: "Dec 3 · 1:43 PM",
        event: "Code path for the undefined id identified — root cause confirmed.",
        marker: "danger",
      },
      { at: "Dec 3 · 3:30 PM", event: "PR raised to coerce undefined → `Option.none()`." },
      { at: "Dec 3 · 3:56 PM", event: "Fix deployed; sweeping confirmed working.", marker: "ok" },
    ],
    fiveWhys: [
      {
        why: "Why were clients blocked?",
        because: "The API returned no eligible destination accounts.",
      },
      {
        why: "Why no eligible accounts?",
        because: "The backend applied a funding-method filter that excluded trust cash accounts.",
      },
      {
        why: "Why was that filter applied?",
        because: "A behavior switch on `maybeAccountRequestFlexId.isDefined()` evaluated true.",
      },
      {
        why: "Why true when no account request existed?",
        because:
          'The API received `account_request_id=undefined` (a literal string) → `Option.some("undefined")`.',
      },
      {
        why: 'Why was "undefined" sent?',
        because:
          "The code-generated Web API client serialized undefined query params instead of omitting them.",
      },
    ],
    contributingFactors:
      "**Tests didn't catch it** — no integration test exercised the no-account-request path end to end. **Monitoring didn't catch it** — no alert on sweep success rate dropping to zero for a cohort.",
    fixes: {
      immediate: [
        "API: coerce an undefined `account_request_id` to `Option.none()`. (shipped Dec 3)",
      ],
      necessary: [
        "Web: the generated API client omits undefined/null query params instead of serializing them.",
      ],
      additional: [
        "Alert on per-cohort sweep success rate.",
        "Track the recommended service schedule on a shared calendar.",
      ],
    },
    wentWell:
      "Once reproduced, root cause to fix took ~3 hours — clean isolation from backend → API → client.",
    wentPainful: "9 days to first report — no automated signal; we found out from a client.",
    followups: [
      {
        status: "open",
        item: "Omit empty query params in the generated client",
        ticket: "WEB-4821",
        owner: "@a.rivera",
        due: "Dec 10",
      },
      {
        status: "open",
        item: "Integration test for the no-account-request path",
        ticket: "WEB-4822",
        owner: "@l.chen",
        due: "Dec 12",
      },
      {
        status: "open",
        item: "Alert on per-cohort sweep success rate",
        ticket: "SRE-991",
        owner: "@sre",
        due: "Dec 17",
      },
    ],
    impactLevel: "Medium",
    reoccurrence: "Low",
  },

  "data-viz": {
    title: "API latency — last 24 hours",
    headline: { value: "86 ms", label: "p95 · ▼ 71% vs yesterday" },
    stats: [
      { label: "p50", value: "12 ms" },
      { label: "error rate", value: "0.04%" },
      { label: "req/s", value: "9.4k" },
    ],
    bars: {
      caption: "p95 latency by endpoint (ms)",
      data: [
        { label: "/search", value: 132 },
        { label: "/feed", value: 96 },
        { label: "/user", value: 61 },
        { label: "/auth", value: 48 },
        { label: "/health", value: 9 },
      ],
    },
    trend: {
      caption: "p95 over 24h — deploy at 14:00",
      values: [180, 172, 168, 175, 160, 120, 70, 66, 72, 64, 60, 58],
    },
    detail: [
      { label: "slowest · /search", value: "132 ms" },
      { label: "fastest · /health", value: "9 ms" },
    ],
    takeaway:
      "The 14:00 batched-dequeue deploy cut p95 from ~170ms to ~62ms with no error-rate regression. Next: investigate `/search`, still 2× the median.",
  },

  "design-doc": {
    title: "Fair-share limiting for the public API",
    status: "In review",
    meta: {
      author: "a.rivera",
      reviewers: "platform, sre, api-eng",
      links: ["JIRA-2241", "PRD", "prior art"],
    },
    summary:
      "One tenant's traffic can starve everyone else on the shared request pool. We propose per-tenant fair-share admission at the edge so no single caller degrades others, with predictable back-pressure (`429` + `Retry-After`) and <1ms added p50.",
    goal: {
      problem:
        "A single tenant can consume a disproportionate share of shared capacity, degrading latency and availability for every other tenant. We want **per-tenant fairness under contention** with predictable, debuggable back-pressure.",
      metrics:
        "zero cross-tenant starvation incidents · p99 of unaffected tenants flat under a noisy-neighbor load test · <1ms added p50.",
    },
    invariants: {
      trueInvariants:
        "No new single point of failure · fail-open on limiter outage · works across N edge nodes.",
      preferences: "Burst tolerance · per-endpoint granularity (later) · self-serve overrides.",
      assumptions: "Tenant id known at the edge · traffic is bursty · Redis p99 < 2ms in-region.",
    },
    background:
      "3 incidents last quarter traced to one tenant's retry storm saturating the pool (FCFS, unbounded). Prior art: our gateway already does per-route concurrency caps; external RFCs favor token-bucket for bursty APIs.",
    solutionSpace: {
      note: "Axes are the independent technical decisions; candidates named by property.",
      axes: [
        {
          axis: "where do counters live?",
          options: [{ label: "shared store (Redis)", chosen: true }, { label: "in-process" }],
          rationale: "In-process can't coordinate across N edges → discarded.",
        },
        {
          axis: "admission algorithm?",
          options: [
            { label: "token bucket", chosen: true },
            { label: "leaky bucket" },
            { label: "fixed window" },
          ],
          rationale:
            "Leaky bucket has no burst; fixed window has edge bursts → token bucket fits bursty traffic.",
        },
        {
          axis: "failure posture?",
          options: [{ label: "fail-open", chosen: true }, { label: "fail-closed" }],
          rationale:
            "Fail-closed turns a limiter blip into an outage → fail-open, bounded by a budget.",
        },
      ],
    },
    proposed: {
      summary:
        "A Redis-backed token bucket keyed by tenant, checked in edge middleware before routing.",
      failureModes:
        "Redis stall → fail-open within a 50ms budget; hot-key on a huge tenant → shard the bucket.",
      observability:
        "Emit allowed/throttled per tenant; alert on bucket-check p99. Tenant id from the signed token, never client headers.",
    },
    scope: {
      inScope: "per-tenant global limit.",
      outScope: "per-endpoint limits, billing quotas (v2).",
      milestones: ["M1 counters @platform", "M2 middleware @api-eng", "M3 dashboards @sre"],
    },
    rollout:
      "Feature flag: shadow → 1% enforce → 100%. Rollback = flip the flag to shadow; no data migration.",
    testing:
      "Unit on the bucket math · integration with a Redis fake · a noisy-neighbor load test asserting unaffected-tenant p99 stays flat.",
    openQuestions: [
      {
        question: "Default per-tenant rate — one global default, or tier-based?",
        owner: "a.rivera · by Fri",
      },
      { question: "Do internal services share the tenant limiter or bypass?", owner: "sre" },
    ],
  },

  status: {
    title: "Payments squad — week of Jun 23",
    state: "on-track",
    headline:
      "Apple Pay shipped to 100%. Refund API in review. One blocker on the payout migration.",
    shipped: [
      { item: "Apple Pay rollout", note: "100% · +3.1% conversion" },
      { item: "Idempotency keys on charges", note: "#1204" },
    ],
    inFlight: [
      { item: "Refund API", pct: 80 },
      { item: "Payout ledger migration", pct: 45 },
    ],
    blockers:
      "Payout migration is waiting on a finance sign-off for the ledger schema. Unblocks if we get review by Thu; otherwise slips a week.",
    next: ["Refund API GA", "Dispute webhooks", "3DS2 step-up"],
  },

  architecture: {
    title: "Event ingest pipeline",
    components: [
      { name: "SDKs", role: "client libraries" },
      { name: "Gateway", role: "auth + schema validate" },
      { name: "Kafka", role: "durable buffer, 7d" },
      { name: "Enricher", role: "geo + identity join" },
      { name: "Warehouse", role: "columnar, dedup on id" },
    ],
    overview: "~120k events/s at peak; at-least-once into Kafka, exactly-once into the warehouse.",
    dataFlow: [
      "validate & stamp ingest ts",
      "partition by tenant",
      "enrich, drop PII",
      "upsert by event id",
    ],
    decisions:
      "**Kafka over direct write** — absorbs warehouse maintenance windows without data loss. **Dedup at write** over downstream — keeps queries simple at the cost of an index.",
    scale:
      "Enricher is the bottleneck (identity join). Degrades to raw passthrough under lag > 5 min; backfill enrichment from Kafka replay.",
  },

  "product-demo": {
    title: "Layer — a preview environment for every PR",
    hook: {
      headline: "Every pull request, running in a real environment — in 40 seconds.",
      sub: "Reviewing a diff tells you the code changed. Layer shows you the app still works — a live URL, a visual diff, and teardown on merge, for every PR.",
      stats: [
        { value: "40s", label: "to a live preview" },
        { value: "0", label: "infra to manage" },
        { value: "100%", label: "of PRs covered" },
      ],
    },
    problem: {
      text: "Reviewers approve code they never ran. Bugs that only show up in a running app — broken layouts, bad migrations, a dead API call — slip through to staging or prod.",
      stats: [
        { value: "38%", label: "of regressions found after merge" },
        { value: "2.3 days", label: "avg PR review time" },
      ],
    },
    featureTitle: "Open the PR. Click the URL. It's the whole app.",
    features: [
      {
        title: "Per-PR URL",
        body: "A real, isolated environment with seeded data — not a screenshot.",
      },
      {
        title: "Visual diff",
        body: "Every changed page screenshotted against main; pixel changes flagged.",
      },
      {
        title: "Auto teardown",
        body: "Merged or closed → the environment and its cost disappear.",
      },
    ],
    proof: {
      stats: [
        { value: "38% → 6%", label: "regressions escaping to prod" },
        { value: "2.3d → 7h", label: "review time" },
        { value: "1 PR", label: "setup" },
      ],
      quote:
        "We deleted our staging environment. Every PR is its own staging now — and reviewers actually click around before approving.",
      quoteBy: "From the team at Northwind",
    },
    cta: {
      headline: "Connect a repo — your next PR gets a preview.",
      body: "Install the GitHub app, no infra changes. Free for open source and your first 50 previews/mo.",
      actions: ["Connect GitHub repo", "Book a demo"],
      tags: ["Free · OSS + 50/mo", "Team · $20/seat", "SOC 2"],
    },
  },
};

// Presets without a tailored typed tool — still hand-authored html.
const HAND: Record<string, { title: string; html: string }> = {
  "product-mockup": {
    title: "Renew — cancels subscriptions for you",
    html: `
<div class="stack lg">
  <div class="stack sm">${sec("Premise")}
    <span class="title" style="font-size:20px">Renew — find and cancel the subscriptions you forgot</span>
    <p class="dim">For people who lose ~$200/yr to subscriptions they don't use. Connect a card, see
    everything recurring, cancel in one tap.</p>
  </div>
  <div class="stack sm">${sec("Screens")}
    <div class="row" style="align-items:flex-start;gap:14px">
      <div class="panel stack sm" style="width:300px">
        <div class="between"><span class="label">Your subscriptions</span><span class="badge warn">6 active</span></div>
        <div class="box between"><span class="stack sm"><b>Netflix</b><span class="faint">$15.49 · monthly</span></span><span class="pill">used 2d ago</span></div>
        <div class="box between"><span class="stack sm"><b>Adobe CC</b><span class="faint">$54.99 · monthly</span></span><span class="badge danger">unused 3mo</span></div>
        <div class="box between"><span class="stack sm"><b>NYT</b><span class="faint">$4.25 · weekly</span></span><span class="badge danger">unused 5mo</span></div>
        <button class="btn primary" style="width:100%">Cancel 2 unused · save $59/mo</button>
      </div>
      <div class="panel stack sm" style="width:300px">
        <span class="label">Cancel Adobe CC?</span>
        <div class="metric">$659<span style="font-size:13px" class="faint"> /yr saved</span></div>
        <div class="callout ok stack sm"><span class="label">We'll handle it</span>
          <p>Renew cancels on your behalf and confirms by email. No login dance.</p></div>
        <div class="row"><button class="btn primary">Confirm cancel</button><button class="btn ghost">Keep it</button></div>
      </div>
    </div>
  </div>
  <div class="stack sm">${sec("Core flow")}
    <div class="row"><span class="pill">1 · connect card</span><span class="pill">2 · detect recurring</span>
      <span class="pill">3 · flag unused</span><span class="pill">4 · one-tap cancel</span><span class="pill">5 · confirm + track savings</span></div>
  </div>
  <div class="row">${sec("Key states")}</div>
  <div class="row" style="align-items:stretch;gap:10px">
    <div class="box grow stack sm"><span class="label">Empty</span><span class="faint">No card linked — show the value prop + connect CTA.</span></div>
    <div class="box grow stack sm"><span class="label">Loading</span><span class="faint">Scanning transactions — skeleton rows, ~5s.</span></div>
    <div class="box grow stack sm"><span class="label">Error</span><span class="faint">Cancel failed — fall back to a guided manual link.</span></div>
  </div>
  <div class="callout warn stack sm">${sec("Validate")}
    <p>Riskiest assumption: that we can <b>actually cancel</b> on the user's behalf across merchants
    without a fragile per-merchant integration. Test with the top 10 by volume before building.</p>
  </div>
</div>`,
  },
  concept: {
    title: "How a hash map gets O(1)",
    html: `
<div class="anim">
  <div class="step" data-section="question" data-label="Question">
    <span class="title" style="font-size:20px">How does a hash map find a value in one step?</span>
    <p class="dim">A list would scan every item. A hash map doesn't.</p>
  </div>
  <div class="step" data-section="mechanism" data-label="Mechanism"><p>You store a value under a <b>key</b>.</p></div>
  <div class="step" data-section="mechanism" data-label="Mechanism"><p>A <span class="cue">hash function</span> turns the key into a <b>bucket index</b>.</p></div>
  <div class="step" data-section="mechanism" data-label="Mechanism"><p>The value goes in that bucket — position computed, not searched.</p></div>
  <div class="step" data-section="payoff" data-label="Payoff"><p>Lookup re-hashes the key → same bucket → the value, in <b>one step</b>. That's O(1).</p></div>
</div>`,
  },
};

// animate-kit presets need print media so a static shot reveals every step.
const PRINT = new Set(["product-demo", "concept"]);

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium
    .launch({ executablePath: process.env.PW_EXECUTABLE_PATH || undefined })
    .catch(() =>
      chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }),
    );
  const modes: Mode[] = ["light", "dark"];
  const written: string[] = [];
  for (const bp of BLUEPRINTS) {
    const renderer = PRESET_RENDERERS[bp.id];
    const example = renderer && DATA[bp.id] ? renderer(DATA[bp.id]) : HAND[bp.id];
    if (!example) continue;
    for (const mode of modes) {
      const doc = renderHtmlPage({
        title: example.title,
        html: example.html,
        origin: ORIGIN,
        theme: bp.theme,
        mode,
        kits: bp.kits,
      });
      const page = await browser.newPage({
        viewport: { width: 792, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: mode,
      });
      if (PRINT.has(bp.id)) await page.emulateMedia({ media: "print" });
      await page.setContent(doc, { waitUntil: "networkidle" });
      await page.waitForTimeout(250);
      const file = join(OUT, `${bp.id}-${mode}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await page.close();
      written.push(file);
      console.log(`wrote ${file}`);
    }
  }
  await browser.close();
  await writeFile(
    join(OUT, "README.md"),
    `# Preset gallery\n\nGenerated by \`scripts/preset-shots.ts\`. Presets with a tailored typed tool are rendered through that tool's renderer (server/presetRenders.ts).\n\n${BLUEPRINTS.filter(
      (b) => PRESET_RENDERERS[b.id] || HAND[b.id],
    )
      .map(
        (b) =>
          `## ${b.label}\n\n${b.summary}\n\n![${b.label} light](./${b.id}-light.png)\n![${b.label} dark](./${b.id}-dark.png)`,
      )
      .join("\n\n")}\n`,
    "utf8",
  );
  console.log(`\n${written.length} screenshots in ${OUT}`);
}

await main();
