// Preset gallery screenshots. Renders a realistic example surface for every
// built-in preset (blueprint) through the SAME renderHtmlPage the server uses —
// theme tokens + kit CSS/JS injected exactly as in production — and rasterizes
// each in light and dark with Playwright. Output lands in docs/images/presets/,
// so the shots double as the README gallery.
//
// Run: node scripts/preset-shots.ts   (writes PNGs, prints the paths)
// The point is visual iteration: tweak a blueprint/theme/example, re-run, look.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BLUEPRINTS } from "../server/blueprints.ts";
import { renderHtmlPage } from "../server/surfacePage.ts";
import type { Mode } from "../server/themes.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "images", "presets");
const ORIGIN = "http://localhost:8229";

// A realistic example per preset: the body fragment an agent would publish, in
// the preset's structure, authored against the preset's kit vocabulary. `media`
// pins print for the animate/scrub presets so a static shot reveals every beat
// instead of just the first.
interface Example {
  title: string;
  html: string;
  media?: "screen" | "print";
}

// section eyebrow → matches a blueprint structure label, so the shot literally
// shows the fixed skeleton.
const sec = (label: string) => `<span class="eyebrow">${label}</span>`;

const EXAMPLES: Record<string, Example> = {
  "design-doc": {
    title: "Fair-share limiting for the public API",
    html: `
<style>
  .axis{border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:10px 12px;background:var(--color-background-primary)}
  .pill.pick{border-color:var(--color-border-info);background:var(--color-background-info);color:var(--color-text-info)}
</style>
<div class="panel stack lg">
  <div class="stack sm">
    <span class="title" style="font-size:20px">Fair-share limiting for the public API</span>
    <div class="row">${sec("Metadata")}</div>
    <div class="row"><span class="pill">Draft</span><span class="pill pick">In review</span><span class="pill">Approved</span>
      <span class="chip">JIRA-2241</span><span class="chip">PRD</span><span class="chip">prior art</span></div>
    <span class="dim">Author: a.rivera · Reviewers: platform, sre, api-eng</span>
  </div>
  <div class="callout stack sm">${sec("Executive summary")}
    <p>One tenant's traffic can starve everyone else on the shared request pool. We propose
    per-tenant fair-share admission at the edge so no single caller degrades others, with predictable
    back-pressure (<span class="mono">429</span> + <span class="mono">Retry-After</span>) and &lt;1ms added p50.</p>
  </div>
  <div class="stack sm">${sec("Goal statement")}
    <div class="callout ok stack sm"><span class="label">Problem (no implementation leakage)</span>
      <p>A single tenant can consume a disproportionate share of shared capacity, degrading latency and
      availability for every other tenant. We want <b>per-tenant fairness under contention</b> with
      predictable, debuggable back-pressure.</p></div>
    <p class="dim"><b>Success metrics:</b> zero cross-tenant starvation incidents · p99 of unaffected tenants
    flat under a noisy-neighbor load test · &lt;1ms added p50.</p>
  </div>
  <div class="row">${sec("Invariants & constraints")}</div>
  <div class="row" style="align-items:stretch;gap:10px">
    <div class="box grow stack sm"><span class="label">True invariants</span>
      <p>No new single point of failure · fail-open on limiter outage · works across N edge nodes.</p></div>
    <div class="box grow stack sm"><span class="label">Preferences</span>
      <p>Burst tolerance · per-endpoint granularity (later) · self-serve overrides.</p></div>
    <div class="box grow stack sm"><span class="label">Assumptions</span>
      <p>Tenant id known at the edge · traffic is bursty · Redis p99 &lt; 2ms in-region.</p></div>
  </div>
  <div class="stack sm">${sec("Background / research")}
    <p>3 incidents last quarter traced to one tenant's retry storm saturating the pool (FCFS, unbounded).
    Prior art: our gateway already does per-route concurrency caps; external RFCs favor token-bucket for
    bursty APIs. No per-tenant signal exists in the pool today.</p>
  </div>
  <div class="stack sm">${sec("Solution space")}
    <span class="dim">Axes are the independent technical decisions; candidates named by property.</span>
    <div class="axis stack sm"><span class="label">Axis · where do counters live?</span>
      <div class="row"><span class="pill pick">shared store (Redis)</span><span class="pill">in-process</span></div>
      <span class="faint">In-process can't coordinate across N edges → discarded.</span></div>
    <div class="axis stack sm"><span class="label">Axis · admission algorithm?</span>
      <div class="row"><span class="pill pick">token bucket</span><span class="pill">leaky bucket</span><span class="pill">fixed window</span></div>
      <span class="faint">Leaky bucket has no burst; fixed window has edge bursts → token bucket fits bursty traffic.</span></div>
    <div class="axis stack sm"><span class="label">Axis · failure posture?</span>
      <div class="row"><span class="pill pick">fail-open</span><span class="pill">fail-closed</span></div>
      <span class="faint">Fail-closed turns a limiter blip into an outage → fail-open, bounded by a budget.</span></div>
  </div>
  <div class="stack sm">${sec("Proposed solution")}
    <p>A Redis-backed token bucket keyed by tenant, checked in edge middleware before routing.</p>
    <svg width="100%" viewBox="0 0 680 130">
      <g class="c-blue"><rect class="box" x="6" y="14" width="120" height="40"/><text class="th" x="66" y="38" text-anchor="middle">Client</text></g>
      <g class="c-teal"><rect class="box" x="216" y="14" width="150" height="40"/><text class="th" x="291" y="38" text-anchor="middle">Edge limiter</text></g>
      <g class="c-blue"><rect class="box" x="456" y="14" width="120" height="40"/><text class="th" x="516" y="38" text-anchor="middle">API</text></g>
      <g class="c-amber"><rect class="box" x="216" y="86" width="150" height="40"/><text class="th" x="291" y="110" text-anchor="middle">Bucket (Redis)</text></g>
      <line class="arr" x1="126" y1="34" x2="210" y2="34" marker-end="url(#arrow)"/>
      <line class="arr" x1="366" y1="34" x2="450" y2="34" marker-end="url(#arrow)"/>
      <line class="arr" x1="291" y1="54" x2="291" y2="82" marker-end="url(#arrow)"/>
      <text class="ts" x="380" y="78">consume token</text>
    </svg>
    <div class="row" style="align-items:stretch;gap:10px">
      <div class="callout warn grow stack sm"><span class="label">Failure modes</span>
        <p>Redis stall → fail-open within a 50ms budget; hot-key on a huge tenant → shard the bucket.</p></div>
      <div class="callout grow stack sm"><span class="label">Observability & security</span>
        <p>Emit allowed/throttled per tenant; alert on bucket-check p99. Tenant id from the signed token,
        never client headers.</p></div>
    </div>
  </div>
  <div class="stack sm">${sec("Scope, sequencing, ownership")}
    <p><b>In:</b> per-tenant global limit. <b>Out:</b> per-endpoint limits, billing quotas (v2).</p>
    <div class="row"><span class="pill">M1 counters @platform</span><span class="pill">M2 middleware @api-eng</span>
      <span class="pill">M3 dashboards @sre</span></div>
  </div>
  <div class="row" style="align-items:stretch;gap:10px">
    <div class="grow stack sm">${sec("Rollout plan")}
      <div class="row"><span class="pill">flag: shadow</span><span class="pill">1% enforce</span><span class="pill">100%</span></div>
      <p class="faint">Rollback = flip the flag to shadow; no data migration.</p></div>
    <div class="grow stack sm">${sec("Testing & confidence")}
      <p class="faint">Unit on the bucket math · integration with a Redis fake · a noisy-neighbor load test
      asserting unaffected-tenant p99 stays flat.</p></div>
  </div>
  <div class="callout muted stack sm">${sec("Open questions")}
    <ul>
      <li>Default per-tenant rate — one global default, or tier-based? <span class="faint">owner: a.rivera · by Fri</span></li>
      <li>Do internal services share the tenant limiter or bypass? <span class="faint">owner: sre</span></li>
    </ul>
  </div>
</div>`,
  },

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

  architecture: {
    title: "Event ingest pipeline",
    html: `
<div class="panel stack lg">
  <div class="stack sm"><span class="label">Architecture</span>
    <span class="title" style="font-size:20px">Event ingest pipeline</span></div>
  <div class="stack sm">${sec("Overview")}
    <svg width="100%" viewBox="0 0 680 110">
      <g class="c-blue"><rect class="box" x="6" y="40" width="110" height="40"/><text class="th" x="61" y="64" text-anchor="middle">SDKs</text></g>
      <g class="c-teal"><rect class="box" x="156" y="40" width="120" height="40"/><text class="th" x="216" y="64" text-anchor="middle">Gateway</text></g>
      <g class="c-amber"><rect class="box" x="316" y="40" width="120" height="40"/><text class="th" x="376" y="64" text-anchor="middle">Kafka</text></g>
      <g class="c-coral"><rect class="box" x="476" y="14" width="120" height="40"/><text class="th" x="536" y="38" text-anchor="middle">Enricher</text></g>
      <g class="c-green"><rect class="box" x="476" y="66" width="120" height="40"/><text class="th" x="536" y="90" text-anchor="middle">Warehouse</text></g>
      <line class="arr" x1="116" y1="60" x2="150" y2="60" marker-end="url(#arrow)"/>
      <line class="arr" x1="276" y1="60" x2="310" y2="60" marker-end="url(#arrow)"/>
      <line class="arr" x1="436" y1="60" x2="470" y2="34" marker-end="url(#arrow)"/>
      <line class="arr" x1="436" y1="60" x2="470" y2="86" marker-end="url(#arrow)"/>
    </svg>
    <p class="dim">~120k events/s at peak; at-least-once into Kafka, exactly-once into the warehouse.</p>
  </div>
  <div class="row" style="align-items:stretch;gap:12px">
    <div class="grow stack sm">${sec("Components")}
      <ul class="tree">
        <li class="row"><span class="dot info"></span> Gateway <span class="faint">auth + schema validate</span></li>
        <li class="row"><span class="dot info"></span> Kafka <span class="faint">durable buffer, 7d</span></li>
        <li class="row"><span class="dot info"></span> Enricher <span class="faint">geo + identity join</span></li>
        <li class="row"><span class="dot info"></span> Warehouse <span class="faint">columnar, dedup on id</span></li>
      </ul></div>
    <div class="grow stack sm">${sec("Data flow")}
      <ul class="tree">
        <li class="row"><span class="chip">1</span> validate &amp; stamp ingest ts</li>
        <li class="row"><span class="chip">2</span> partition by tenant</li>
        <li class="row"><span class="chip">3</span> enrich, drop PII</li>
        <li class="row"><span class="chip">4</span> upsert by event id</li>
      </ul></div>
  </div>
  <div class="callout stack sm">${sec("Key decisions")}
    <p><b>Kafka over direct write</b> — absorbs warehouse maintenance windows without data loss.
    <b>Dedup at write</b> over downstream — keeps queries simple at the cost of an index.</p>
  </div>
  <div class="callout warn stack sm">${sec("Scale & failure")}
    <p>Enricher is the bottleneck (identity join). Degrades to raw passthrough under lag &gt; 5 min;
    backfill enrichment from Kafka replay.</p>
  </div>
</div>`,
  },

  "data-viz": {
    title: "API latency — last 24h",
    html: `
<div class="panel stack lg">
  <div class="stack sm"><span class="label">Metrics · API latency</span>
    <span class="title" style="font-size:20px">Last 24 hours</span></div>
  <div class="row" style="gap:24px">
    <div class="stack sm">${sec("Headline")}<span class="metric">86 ms</span>
      <span class="dim">p95 · <span style="color:var(--color-text-success)">▼ 71%</span> vs yesterday</span></div>
    <div class="box stack sm"><span class="label">p50</span><span class="metric" style="font-size:20px">12 ms</span></div>
    <div class="box stack sm"><span class="label">error rate</span><span class="metric" style="font-size:20px">0.04%</span></div>
    <div class="box stack sm"><span class="label">req/s</span><span class="metric" style="font-size:20px">9.4k</span></div>
  </div>
  <div class="stack sm">${sec("Breakdown")}<span class="dim">p95 latency by endpoint (ms)</span>
    <svg width="100%" viewBox="0 0 680 150">
      ${bars(
        [
          ["/search", 132],
          ["/feed", 96],
          ["/user", 61],
          ["/auth", 48],
          ["/health", 9],
        ],
        132,
      )}
    </svg>
  </div>
  <div class="stack sm">${sec("Trend")}<span class="dim">p95 over 24h — deploy at 14:00</span>
    ${sparkline([180, 172, 168, 175, 160, 120, 70, 66, 72, 64, 60, 58])}
  </div>
  <div class="callout ok stack sm">${sec("Takeaway")}
    <p>The 14:00 batched-dequeue deploy cut p95 from ~170ms to ~62ms with no error-rate regression.
    Next: investigate <span class="mono">/search</span>, still 2× the median.</p>
  </div>
</div>`,
  },

  postmortem: {
    title: "Dividend sweep blocked for managed accounts",
    html: `
<style>
  .whys{counter-reset:w;list-style:none;margin:0;padding:0}
  .whys li{position:relative;margin-left:11px;padding:0 0 13px 24px;border-left:2px solid var(--color-border-warning)}
  .whys li:last-child{border-left-color:transparent;padding-bottom:0}
  .whys li::before{counter-increment:w;content:counter(w);position:absolute;left:-12px;top:-2px;width:22px;height:22px;border-radius:999px;background:var(--color-background-warning);border:1px solid var(--color-border-warning);color:var(--color-text-warning);font:600 11px/22px var(--font-sans);text-align:center}
  .tl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
  .tl li{display:flex;gap:10px;align-items:baseline}
  .tl .t{font:400 12px/1.5 var(--font-mono);color:var(--color-text-tertiary);min-width:118px;flex:none}
</style>
<div class="panel stack lg">
  <div class="between">
    <div class="stack sm"><span class="label">Postmortem · WEBOPS-10572</span>
      <span class="title" style="font-size:20px">Dividend sweep blocked for managed accounts</span></div>
    <span class="badge warn">Blameless</span>
  </div>
  <div class="callout stack sm">${sec("Summary")}
    <p>For 9 days, managed-investment clients couldn't sweep dividends to their trust cash accounts on
    Web. A code-generated API client serialized a missing query param as the literal string
    <span class="mono">undefined</span>, which the backend read as a real account request and filtered out
    the eligible accounts. Fixed by coercing it to <span class="mono">Option.none()</span>; the generated
    client now omits empty params entirely.</p>
  </div>
  <div class="row" style="align-items:stretch;gap:10px">${sec("Customer impact")}</div>
  <div class="row" style="align-items:stretch;gap:10px">
    <div class="stack sm" style="min-width:130px"><span class="metric" style="font-size:24px">9</span><span class="dim">clients affected</span></div>
    <div class="box grow stack sm"><span class="label">Experience</span><span class="faint">Dividends never swept to trust cash accounts on Web; balances looked stuck. No money lost.</span></div>
    <div class="box stack sm"><span class="label">Duration</span><span class="metric" style="font-size:18px">9 days</span><span class="faint">Nov 24 – Dec 3</span></div>
  </div>
  <div class="stack sm">${sec("Timeline (PT)")}
    <ul class="tl">
      <li><span class="t">Nov 24 · 3:42 PM</span><span>Dividend sweeping ramped to 100% across managed accounts.</span></li>
      <li><span class="t">Dec 3 · 11:21 AM</span><span>Issue reported in <span class="mono">~dividend-sweeping</span>.</span></li>
      <li><span class="t">Dec 3 · 12:35 PM</span><span>WEBOPS-10572 filed.</span></li>
      <li><span class="t">Dec 3 · 12:48 PM</span><span>Backend query confirmed correct in isolation.</span></li>
      <li><span class="t">Dec 3 · 1:00 PM</span><span>API response missing destination accounts → points at the API/request layer.</span></li>
      <li><span class="t">Dec 3 · 1:15 PM</span><span>Request carries <span class="mono">account_request_id=undefined</span>.</span></li>
      <li><span class="t">Dec 3 · 1:43 PM</span><span><span class="dot danger"></span> Code path for the undefined id identified — root cause confirmed.</span></li>
      <li><span class="t">Dec 3 · 3:30 PM</span><span>PR raised to coerce undefined → <span class="mono">Option.none()</span>.</span></li>
      <li><span class="t">Dec 3 · 3:56 PM</span><span><span class="dot ok"></span> Fix deployed; sweeping confirmed working.</span></li>
    </ul>
  </div>
  <div class="callout warn stack sm">${sec("Root cause — 5 Whys")}
    <ol class="whys">
      <li><b>Why were clients blocked?</b> <span class="dim">The API returned no eligible destination accounts.</span></li>
      <li><b>Why no eligible accounts?</b> <span class="dim">The backend applied a funding-method filter that excluded trust cash accounts.</span></li>
      <li><b>Why was that filter applied?</b> <span class="dim">A behavior switch on <span class="mono">maybeAccountRequestFlexId.isDefined()</span> evaluated true.</span></li>
      <li><b>Why true when no account request existed?</b> <span class="dim">The API received <span class="mono">account_request_id=undefined</span> (a literal string) → <span class="mono">Option.some("undefined")</span>.</span></li>
      <li><b>Why was "undefined" sent?</b> <span class="dim">The code-generated Web API client serialized undefined query params instead of omitting them.</span></li>
    </ol>
    <div class="box soft stack sm" style="margin-top:4px"><span class="label">Contributing factors (pressure-test)</span>
      <p class="faint"><b>Tests didn't catch it</b> — no integration test exercised the no-account-request path end to end.
      <b>Monitoring didn't catch it</b> — no alert on sweep success rate dropping to zero for a cohort.</p></div>
  </div>
  <div class="stack sm">${sec("Fixes")}
    <div class="callout danger stack sm"><span class="label">Immediate</span>
      <p>API: coerce an undefined <span class="mono">account_request_id</span> to <span class="mono">Option.none()</span>. <span class="faint">(shipped Dec 3)</span></p></div>
    <div class="callout warn stack sm"><span class="label">Necessary</span>
      <p>Web: the generated API client omits undefined/null query params instead of serializing them.</p></div>
    <div class="callout stack sm"><span class="label">Additional</span>
      <p>Alert on per-cohort sweep success rate; track the recommended service schedule on a shared calendar.</p></div>
  </div>
  <div class="row" style="align-items:stretch;gap:10px">
    <div class="callout ok grow stack sm"><span class="label">What went well</span>
      <p class="faint">Once reproduced, root cause to fix took ~3 hours — clean isolation from backend → API → client.</p></div>
    <div class="callout muted grow stack sm"><span class="label">What was painful</span>
      <p class="faint">9 days to first report — no automated signal; we found out from a client.</p></div>
  </div>
  <div class="stack sm">${sec("Follow-ups & tracking")}
    <ul class="tree">
      <li class="row"><span class="badge danger">open</span> Omit empty query params in the generated client <span class="grow"></span><span class="chip">WEB-4821</span><span class="faint">@a.rivera · Dec 10</span></li>
      <li class="row"><span class="badge warn">open</span> Integration test for the no-account-request path <span class="grow"></span><span class="chip">WEB-4822</span><span class="faint">@l.chen · Dec 12</span></li>
      <li class="row"><span class="badge info">open</span> Alert on per-cohort sweep success rate <span class="grow"></span><span class="chip">SRE-991</span><span class="faint">@sre · Dec 17</span></li>
    </ul>
    <div class="row"><span class="pill">Impact: Medium</span><span class="pill">Reoccurrence: Low</span></div>
  </div>
</div>`,
  },

  status: {
    title: "Payments squad — week of Jun 23",
    html: `
<div class="panel stack lg">
  <div class="between">
    <div class="stack sm"><span class="label">Status · Payments squad</span>
      <span class="title" style="font-size:20px">Week of Jun 23</span></div>
    <span class="badge ok">On track</span>
  </div>
  <div class="callout ok stack sm">${sec("Headline")}
    <p>Apple Pay shipped to 100%. Refund API in review. One blocker on the payout migration.</p>
  </div>
  <div class="stack sm">${sec("Shipped")}
    <ul class="tree">
      <li class="row"><span class="dot ok"></span> Apple Pay rollout <span class="faint">100% · +3.1% conversion</span></li>
      <li class="row"><span class="dot ok"></span> Idempotency keys on charges <span class="faint">#1204</span></li>
    </ul>
  </div>
  <div class="stack sm">${sec("In flight")}
    <div class="stack sm">
      <div class="between"><span>Refund API</span><span class="faint num">80%</span></div>
      <div class="bar"><i style="width:80%"></i></div>
      <div class="between"><span>Payout ledger migration</span><span class="faint num">45%</span></div>
      <div class="bar"><i style="width:45%;background:var(--color-text-warning)"></i></div>
    </div>
  </div>
  <div class="callout warn stack sm">${sec("Blockers")}
    <p>Payout migration is waiting on a finance sign-off for the ledger schema. Unblocks if we get
    review by Thu; otherwise slips a week.</p>
  </div>
  <div class="stack sm">${sec("Next up")}
    <div class="row"><span class="pill">Refund API GA</span><span class="pill">Dispute webhooks</span>
    <span class="pill">3DS2 step-up</span></div>
  </div>
</div>`,
  },

  "product-demo": {
    title: "Layer — a preview environment for every PR",
    media: "print",
    html: `
<style>
  .browser{border:1px solid var(--color-border-secondary);border-radius:var(--border-radius-lg);overflow:hidden;background:var(--color-background-primary)}
  .browser .bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--color-background-secondary);border-bottom:1px solid var(--color-border-secondary)}
  .browser .bar i{width:9px;height:9px;border-radius:999px;background:var(--color-border-primary);flex:none}
  .browser .url{font:400 12px/1 var(--font-mono);color:var(--color-text-tertiary);margin-left:6px}
  .browser .body{padding:16px}
</style>
<div class="anim stack lg">
  <div class="step" data-section="hook" data-label="Hook">
    <div class="panel stack sm">
      <span class="eyebrow">Layer</span>
      <span class="title" style="font-size:24px">Every pull request, running in a real environment — in 40 seconds.</span>
      <p class="dim">Reviewing a diff tells you the code changed. Layer shows you the app still works — a
      live URL, a visual diff, and teardown on merge, for every PR.</p>
      <div class="row" style="gap:24px;margin-top:4px">
        <div class="stack sm"><span class="metric">40s</span><span class="faint">to a live preview</span></div>
        <div class="stack sm"><span class="metric">0</span><span class="faint">infra to manage</span></div>
        <div class="stack sm"><span class="metric">100%</span><span class="faint">of PRs covered</span></div>
      </div>
    </div>
  </div>

  <div class="step" data-section="problem" data-label="Problem">
    <div class="callout warn stack sm"><span class="eyebrow">Problem</span>
      <p>Reviewers approve code they never ran. Bugs that only show up in a running app — broken layouts,
      bad migrations, a dead API call — slip through to staging or prod.</p>
      <div class="row" style="gap:24px;margin-top:4px">
        <div class="stack sm"><span class="metric" style="font-size:22px">38%</span><span class="faint">of regressions found after merge</span></div>
        <div class="stack sm"><span class="metric" style="font-size:22px">2.3 days</span><span class="faint">avg PR review time</span></div>
      </div>
    </div>
  </div>

  <div class="step" data-section="feature" data-label="Feature">
    <div class="stack lg">
      <div class="stack sm"><span class="eyebrow">Feature</span>
        <span class="title">Open the PR. Click the URL. It's the whole app.</span></div>
      <div class="browser">
        <div class="bar"><i></i><i></i><i></i><span class="url">https://pr-2241.layer.app</span><span class="grow"></span><span class="badge ok">● ready · 38s</span></div>
        <div class="body stack sm">
          <div class="between"><span class="title">Checkout v2</span><span class="pill">branch: feat/checkout-redesign</span></div>
          <div class="row"><span class="chip">build ✓</span><span class="chip">migrate ✓</span><span class="chip">seed ✓</span><span class="chip">e2e ✓</span></div>
          <div class="box stack sm"><span class="label">Preview</span>
            <div class="row"><button class="btn primary">Pay $42.00</button><button class="btn ghost">Apply coupon</button></div>
          </div>
        </div>
      </div>
      <div class="row" style="align-items:stretch;gap:10px">
        <div class="box grow stack sm"><span class="label">Per-PR URL</span><span class="faint">A real, isolated environment with seeded data — not a screenshot.</span></div>
        <div class="box grow stack sm"><span class="label">Visual diff</span><span class="faint">Every changed page screenshotted against main; pixel changes flagged.</span></div>
        <div class="box grow stack sm"><span class="label">Auto teardown</span><span class="faint">Merged or closed → the environment and its cost disappear.</span></div>
      </div>
    </div>
  </div>

  <div class="step" data-section="proof" data-label="Proof">
    <div class="stack lg">
      <div class="stack sm"><span class="eyebrow">Proof</span>
        <span class="title">Teams catch more before merge, and review faster.</span></div>
      <div class="row" style="gap:24px">
        <div class="stack sm"><span class="metric">38% → 6%</span><span class="dim">regressions escaping to prod</span></div>
        <div class="box stack sm"><span class="label">review time</span><span class="metric" style="font-size:20px">2.3d → 7h</span></div>
        <div class="box stack sm"><span class="label">setup</span><span class="metric" style="font-size:20px">1 PR</span></div>
      </div>
      <div class="stack sm"><span class="dim">Escaped regressions per 100 PRs — before vs after Layer</span>
        <svg width="100%" viewBox="0 0 680 120">
          ${bars(
            [
              ["before", 38],
              ["after", 6],
            ],
            38,
          )}
        </svg>
      </div>
      <div class="callout ok stack sm"><span class="label">From the team at Northwind</span>
        <p>"We deleted our staging environment. Every PR is its own staging now — and reviewers actually
        click around before approving."</p></div>
    </div>
  </div>

  <div class="step" data-section="cta" data-label="Next step">
    <div class="panel stack sm"><span class="eyebrow">Next step</span>
      <span class="title">Connect a repo — your next PR gets a preview.</span>
      <p class="dim">Install the GitHub app, no infra changes. Free for open source and your first 50 previews/mo.</p>
      <div class="row"><button class="btn primary">Connect GitHub repo</button><button class="btn ghost">Book a demo</button></div>
      <div class="row"><span class="pill">Free · OSS + 50/mo</span><span class="pill">Team · $20/seat</span><span class="pill">SOC 2</span></div>
    </div>
  </div>
</div>`,
  },

  concept: {
    title: "How a hash map gets O(1)",
    media: "print",
    html: `
<div class="anim">
  <div class="step" data-section="question" data-label="Question">
    <span class="title" style="font-size:20px">How does a hash map find a value in one step?</span>
    <p class="dim">A list would scan every item. A hash map doesn't.</p>
  </div>
  <div class="step" data-section="mechanism" data-label="Mechanism">
    <p>You store a value under a <b>key</b>.</p>
  </div>
  <div class="step" data-section="mechanism" data-label="Mechanism">
    <p>A <span class="cue">hash function</span> turns the key into a <b>bucket index</b>.</p>
  </div>
  <div class="step" data-section="mechanism" data-label="Mechanism">
    <p>The value goes in that bucket — position computed, not searched.</p>
  </div>
  <div class="step" data-section="payoff" data-label="Payoff">
    <p>Lookup re-hashes the key → same bucket → the value, in <b>one step</b>. That's O(1).</p>
  </div>
</div>`,
  },
};

// A simple themed bar chart (inline SVG) for the data-viz example — values in the
// row, sized to `max`, colored by the theme accent.
function bars(rows: [string, number][], max: number): string {
  const w = 680;
  const labelW = 90;
  const barMax = w - labelW - 60;
  const rowH = 26;
  return rows
    .map(([label, v], i) => {
      const y = i * rowH + 6;
      const bw = Math.round((v / max) * barMax);
      return `<text class="ts" x="0" y="${y + 14}">${label}</text>
<rect x="${labelW}" y="${y + 4}" width="${bw}" height="14" rx="4" fill="var(--color-text-info)"/>
<text class="ts num" x="${labelW + bw + 8}" y="${y + 15}">${v}</text>`;
    })
    .join("\n");
}

// A themed sparkline (inline SVG polyline) for the trend section.
function sparkline(values: number[]): string {
  const w = 680;
  const h = 60;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const step = w / (values.length - 1);
  const pts = values
    .map(
      (v, i) =>
        `${Math.round(i * step)},${Math.round(h - ((v - min) / (max - min)) * (h - 8) - 4)}`,
    )
    .join(" ");
  return `<svg width="100%" viewBox="0 0 ${w} ${h}">
<polyline points="${pts}" fill="none" stroke="var(--color-text-info)" stroke-width="2"/>
</svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium
    .launch({
      executablePath: process.env.PW_EXECUTABLE_PATH || undefined,
    })
    .catch(() =>
      chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }),
    );
  const modes: Mode[] = ["light", "dark"];
  const written: string[] = [];
  for (const bp of BLUEPRINTS) {
    const ex = EXAMPLES[bp.id];
    if (!ex) continue;
    for (const mode of modes) {
      const doc = renderHtmlPage({
        title: ex.title,
        html: ex.html,
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
      if (ex.media === "print") await page.emulateMedia({ media: "print" });
      await page.setContent(doc, { waitUntil: "networkidle" });
      // Give kit JS (animate/slides) a tick to wire up before the shot.
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
    `# Preset gallery\n\nGenerated by \`scripts/preset-shots.ts\`. Each built-in preset, rendered light + dark.\n\n${BLUEPRINTS.filter(
      (b) => EXAMPLES[b.id],
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
