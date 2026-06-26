// Seed content for `showcase demo` — two example sessions that show what
// agents draw on the surface. Keep this file dependency-free like the CLI.

// An animated explainer built on the `animate` kit: steps reveal one at a time
// (play/pause + scrub injected by the kit), building up the concept. The kind of
// thing the "explain this on showcase" loop produces.
const HASHMAP_EXPLAINER = `
<div class="anim">
  <div class="step">
    <h2 style="margin:0 0 8px">How a hash map gets O(1)</h2>
    <p class="dim">Arrays find an item by scanning. A hash map jumps straight to it. Press play, or scrub.</p>
  </div>
  <div class="step"><p>You store a value under a <b>key</b> — say <code>"sky" → "#4a90d9"</code>.</p></div>
  <div class="step"><p>A <span class="cue">hash function</span> turns the key into a number, then mod the table size gives a <b>bucket index</b>: <code>hash("sky") % 8 = 3</code>.</p></div>
  <div class="step"><p>The value is dropped into <b>bucket 3</b>. No scanning — the key <i>computed</i> its own address.</p></div>
  <div class="step"><p>Looking it up re-runs the same hash on <code>"sky"</code> → bucket 3 → the value, in <b>one step</b>. That's the O(1).</p></div>
  <div class="step"><p>When two keys hash to the same bucket — a <span class="cue">collision</span> — they chain in a little list there. Rare, so lookups stay fast on average.</p></div>
</div>`;

const JWT_DIAGRAM = `
<svg width="100%" viewBox="0 0 680 320">
  <line class="leader" x1="110" y1="52" x2="110" y2="300"/>
  <line class="leader" x1="340" y1="52" x2="340" y2="300"/>
  <line class="leader" x1="570" y1="52" x2="570" y2="300"/>

  <rect class="box" x="35" y="10" width="150" height="40"/>
  <text class="th" x="110" y="35" text-anchor="middle">Client</text>
  <g class="c-blue"><rect class="box" x="265" y="10" width="150" height="40"/><text class="th" x="340" y="35" text-anchor="middle">/api (guarded)</text></g>
  <g class="c-amber"><rect class="box" x="495" y="10" width="150" height="40"/><text class="th" x="570" y="35" text-anchor="middle">/auth/refresh</text></g>

  <text class="ts" x="225" y="84" text-anchor="middle">request + expired JWT</text>
  <line class="arr" x1="110" y1="92" x2="334" y2="92" marker-end="url(#arrow)"/>

  <text class="ts c-red" x="225" y="120" text-anchor="middle">401 token_expired</text>
  <line class="arr c-red" x1="340" y1="128" x2="116" y2="128" marker-end="url(#arrow)"/>

  <text class="ts" x="340" y="172" text-anchor="middle">refresh token (httpOnly cookie)</text>
  <line class="arr" x1="110" y1="180" x2="564" y2="180" marker-end="url(#arrow)"/>

  <text class="ts c-green" x="340" y="208" text-anchor="middle">new JWT + rotated refresh token</text>
  <line class="arr c-green" x1="570" y1="216" x2="116" y2="216" marker-end="url(#arrow)"/>

  <text class="ts" x="225" y="260" text-anchor="middle">retry with new JWT</text>
  <line class="arr" x1="110" y1="268" x2="334" y2="268" marker-end="url(#arrow)"/>
</svg>`;

const JWT_EXPLAINER = `
<p style="font-family: var(--font-sans); color: var(--color-text-primary); line-height: 1.6; margin: 14px 6px 4px;">
  The access token lives in memory only (a JS variable) — never localStorage, so XSS
  can't exfiltrate a long-lived credential. The client never stores the refresh token
  in JS — it lives in an httpOnly cookie and only travels to
  <code style="font-family: var(--font-mono); font-size: 0.92em;">/auth/refresh</code>.
  Rotation means a stolen refresh token dies on first reuse.
</p>`;

const BACKOFF = `
<div id="bk" style="font-family: var(--font-sans); color: var(--color-text-primary);">
  <div style="display: flex; align-items: center; gap: 12px;">
    <span style="font-weight: 500;">Base delay</span>
    <input type="range" id="base" min="50" max="1000" step="50" value="200" style="flex: 1;">
    <span id="baseVal" style="width: 64px; text-align: right; font-weight: 500;">200 ms</span>
  </div>
  <label style="display: flex; align-items: center; gap: 8px; margin: 10px 0 14px; color: var(--color-text-secondary); cursor: pointer;">
    <input type="checkbox" id="jitter">
    Full jitter — each client waits a random time within the window
  </label>
  <div id="rows"></div>
</div>
<script>
  var baseEl = document.getElementById("base");
  var jitterEl = document.getElementById("jitter");
  var ATTEMPTS = 5;

  function fmt(ms) {
    return ms < 1000 ? Math.round(ms) + " ms" : (Math.round(ms / 100) / 10) + " s";
  }

  function render() {
    var base = Number(baseEl.value);
    document.getElementById("baseVal").textContent = fmt(base);
    var max = base * Math.pow(2, ATTEMPTS - 1);
    var html = "";
    for (var i = 0; i < ATTEMPTS; i++) {
      var delay = base * Math.pow(2, i);
      var actual = jitterEl.checked ? Math.random() * delay : delay;
      html +=
        '<div style="display: flex; align-items: center; gap: 10px; margin: 7px 0;">' +
        '<span style="width: 72px; color: var(--color-text-secondary); font-size: 13px;">attempt ' + (i + 1) + "</span>" +
        '<span style="flex: 1; height: 10px; border-radius: 5px; background: var(--color-background-secondary); position: relative; overflow: hidden;">' +
        '<span style="position: absolute; inset: 0; width: ' + (delay / max) * 100 + '%; background: var(--color-background-info);"></span>' +
        '<span style="position: absolute; inset: 0; width: ' + (actual / max) * 100 + '%; background: var(--color-text-info); border-radius: 5px;"></span>' +
        "</span>" +
        '<span style="width: 64px; text-align: right; font-size: 13px;">' + fmt(actual) + "</span>" +
        "</div>";
    }
    document.getElementById("rows").innerHTML = html;
  }

  baseEl.oninput = render;
  jitterEl.onchange = render;
  render();
</script>`;

const QUEUE_METRICS = `
<div style="font-family: var(--font-sans); color: var(--color-text-primary);">
  <div style="display: flex; gap: 10px; margin-bottom: 16px;">
    <div style="flex: 1; border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 12px 14px;">
      <div style="font-size: 22px; font-weight: 500;">12 ms</div>
      <div style="font-size: 12px; color: var(--color-text-secondary);">p50 wait</div>
    </div>
    <div style="flex: 1; border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 12px 14px;">
      <div style="font-size: 22px; font-weight: 500;">86 ms</div>
      <div style="font-size: 12px; color: var(--color-text-secondary);">p95 wait</div>
    </div>
    <div style="flex: 1; border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 12px 14px;">
      <div style="font-size: 22px; font-weight: 500; color: var(--color-text-success);">−71%</div>
      <div style="font-size: 12px; color: var(--color-text-secondary);">p95 vs yesterday</div>
    </div>
    <div style="flex: 1; border: 0.5px solid var(--color-border-tertiary); border-radius: var(--border-radius-md); padding: 12px 14px;">
      <div style="font-size: 22px; font-weight: 500;">1.4k</div>
      <div style="font-size: 12px; color: var(--color-text-secondary);">jobs / min</div>
    </div>
  </div>
  <svg width="100%" viewBox="0 0 680 150" font-family="var(--font-sans)" font-size="11">
    <g id="bars"></g>
    <line x1="430" y1="8" x2="430" y2="120" stroke="var(--color-border-secondary)" stroke-dasharray="3 4"/>
    <text x="436" y="16" fill="var(--color-text-tertiary)">batched dequeue deployed</text>
    <text x="20" y="140" fill="var(--color-text-tertiary)">p95 queue wait, last 24h</text>
  </svg>
</div>
<script>
  var p95 = [
    270, 290, 310, 285, 300, 320, 295, 305, 330, 310, 290, 315,
    300, 295, 310, 88, 84, 90, 82, 86, 84, 88, 85, 86
  ];
  var W = 660 / p95.length;
  var g = document.getElementById("bars");
  var ns = "http://www.w3.org/2000/svg";
  for (var i = 0; i < p95.length; i++) {
    var h = (p95[i] / 340) * 112;
    var r = document.createElementNS(ns, "rect");
    r.setAttribute("x", 20 + i * W + 2);
    r.setAttribute("y", 120 - h);
    r.setAttribute("width", W - 4);
    r.setAttribute("height", h);
    r.setAttribute("rx", 2);
    r.setAttribute("fill", p95[i] < 150 ? "var(--color-text-success)" : "var(--color-text-info)");
    g.appendChild(r);
  }
</script>`;

// A native chart part (Recharts) — a grouped bar chart contrasting queue-wait
// percentiles before and after the batched-dequeue change. Two series exercise
// the accent-led palette; `yLabel`/`caption` round out the framing.
const QUEUE_LATENCY_CHART = {
  kind: "chart",
  chartType: "bar",
  x: "pctl",
  y: ["before", "after"],
  data: [
    { pctl: "p50", before: 41, after: 12 },
    { pctl: "p95", before: 300, after: 86 },
    { pctl: "p99", before: 540, after: 140 },
  ],
  yLabel: "ms",
  caption: "Queue wait by percentile — before vs after batched dequeue",
};

// A drill-down html part: a button calls sendPrompt() to propose a deeper
// follow-up. It surfaces as a "Suggested by this surface" chip the user relays
// to the agent with one tap — the output → tap → revise loop.
const DRILLDOWN = `
<div style="font-family: var(--font-sans); color: var(--color-text-primary);">
  <p style="margin: 0 0 4px; line-height: 1.6;">The batched dequeue pulls up to <strong>50 jobs</strong> per poll instead of one, so a burst drains in a few round-trips instead of hundreds.</p>
  <p style="margin: 0 0 14px; color: var(--color-text-secondary); font-size: 13px;">Want to go deeper? Tap below — it proposes a follow-up you can send to the agent.</p>
  <button type="button" onclick="sendPrompt('Walk me through how the batched dequeue handles a partial failure partway through a batch — which jobs get retried?')"
    style="font: 500 13px var(--font-sans); display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--color-border-secondary); background: var(--color-background-secondary); color: var(--color-text-primary); cursor: pointer;">
    &#8627; Explain partial-failure handling
  </button>
</div>`;

// A review finding card — the flagship "visual PR review" composition: a tone
// badge ("Bug") + prose naming the problem + a mermaid control-flow of the buggy
// path + the fix diff, all in one surface. This is the screenshot, reproduced.
const REVIEW_BUG_PROSE = `_High confidence · scope: changed lines · ✓ verified_

**Coverage** — reproduced the OOM with a 2 GB upload against a local board; did not test chunked uploads that omit content-length.

**What** — \`uploadAsset\` (server/app.ts:747) calls \`c.req.arrayBuffer()\` to buffer the **entire request body into memory** before the \`MAX_ASSET_BYTES\` check on line 759.

**Why it matters** — the size guard never runs for an oversized request: a 2 GB upload allocates ~2 GB of heap and can OOM \`showcase serve\` before the 413 is ever returned. Local boards ship with no auth token, so any client on the network can trigger it.

**Fix** — reject on the \`content-length\` header before reading the body (below). A streaming cap can follow for chunked uploads that omit the header.`;

const REVIEW_BUG_FLOW = `flowchart LR
  Client([Client]) --> read[read body]
  read --> size{>5MB?}
  size -- yes --> late[413 late]
  size -- no --> store[store]
  read -. OOM .-> heap[heap exhausted]`;

// The opinionated overview (the review-kit html part buildOverview emits):
// intent + a composite risk band over four signal sub-bars + a review budget +
// a priority-ranked manifest (sensitive first; the mechanical row collapses).
// Hand-built here to match the server's output so the demo shows the real shape.
const REVIEW_OVERVIEW = `<div class="stack lg">
  <p class="title">Stream-cap asset uploads so an oversized request is rejected before the whole body is buffered into memory.</p>
  <div class="risk">
    <div class="between"><span class="risk-band elevated"><span class="lvl"></span>Risk: Elevated</span><span class="review-progress"></span></div>
    <div class="signals">
      <span class="sig-label">Size<span class="num">1/3</span></span><div class="signal cool"><i style="width:33%"></i></div>
      <span class="sig-label">Surface<span class="num">1/3</span></span><div class="signal cool"><i style="width:33%"></i></div>
      <span class="sig-label">Sensitivity<span class="num">3/3</span></span><div class="signal hot"><i style="width:100%"></i></div>
      <span class="sig-label">Tests<span class="num">2/3</span></span><div class="signal warm"><i style="width:67%"></i></div>
    </div>
    <div class="budget">~6 min · <b>1 file</b> needs real eyes · 1 mechanical</div>
  </div>
  <ul class="manifest">
    <li class="manifest-row sensitive"><span class="pri"></span><span class="file">server/app.ts</span><span class="spark"><span class="add" style="width:80%"></span><span class="del" style="width:20%"></span></span><span class="churn">+24 −6</span><span class="note">upload path — unbounded buffer</span><input class="rev" type="checkbox" aria-label="Mark server/app.ts reviewed"></li>
    <li class="manifest-row logic"><span class="pri"></span><span class="file">test/assets.test.ts</span><span class="spark"><span class="add" style="width:100%"></span><span class="del" style="width:0%"></span></span><span class="churn">+18 −0</span><span class="note">covers the new size guard</span><input class="rev" type="checkbox" aria-label="Mark test/assets.test.ts reviewed"></li>
  </ul>
  <button class="cold-toggle" aria-expanded="false" type="button"><span class="caret">▸</span> 1 mechanical file (low attention)</button>
  <div class="cold-bucket" hidden><ul class="manifest"><li class="manifest-row mechanical"><span class="pri"></span><span class="file">package-lock.json</span><span class="spark"><span class="add" style="width:70%"></span><span class="del" style="width:30%"></span></span><span class="churn">+210 −90</span><span class="note">generated / vendored — glance only</span><input class="rev" type="checkbox" aria-label="Mark package-lock.json reviewed"></li></ul></div>
</div>`;

// The verdict card's change map: the changed pieces and how they interact,
// color-coded new/modified/touched (the shape buildChangeMap emits server-side).
// Edges carry status too (§8.2): the size-guard + parseMime edges are NEW
// coupling (green), the client call is unchanged context (gray).
const REVIEW_CHANGEMAP = `flowchart LR
  n0(["Client"]):::touched
  n1["uploadAsset"]:::modified
  n2["size guard"]:::new
  n3["parseMime"]:::new
  n4["publishSurface"]:::touched
  n0 -->|"POST /api/assets"| n1
  n1 -->|"checks"| n2
  n3 -->|"used by"| n1
  n3 -->|"used by"| n4
  classDef new stroke:#2f9e44,color:#2f9e44,stroke-width:1.5px;
  classDef modified stroke:#d9870a,color:#d9870a,stroke-width:1.5px;
  classDef touched stroke:#9aa0a6,color:#9aa0a6;
  linkStyle 0 stroke:#9aa0a6,stroke-width:1px;
  linkStyle 1 stroke:#2f9e44,stroke-width:1.5px;
  linkStyle 2 stroke:#2f9e44,stroke-width:1.5px;
  linkStyle 3 stroke:#2f9e44,stroke-width:1.5px;`;

// A nit's suggested fix as a before→after pair — the viewer computes the diff.
const REVIEW_NIT_BEFORE = `const mime = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();`;
const REVIEW_NIT_AFTER = `const mime = parseMime(c);`;

const REVIEW_BUG_DIFF = `diff --git a/server/app.ts b/server/app.ts
--- a/server/app.ts
+++ b/server/app.ts
@@ -747,6 +747,11 @@ app.post('/api/assets', async (c) => {
   const mime = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
+  // Reject oversize uploads before buffering the body into memory.
+  const len = Number(c.req.header('content-length') ?? 0);
+  if (len > MAX_ASSET_BYTES) {
+    return c.json({ error: \`asset exceeds \${MAX_ASSET_BYTES} bytes\` }, 413);
+  }
   const buf = new Uint8Array(await c.req.arrayBuffer());
   let envelope: any = null;`;

// Seeded in order; the viewer sorts sessions by last activity, so the last
// session here ends up on top.
export const DEMO_SESSIONS = [
  {
    agent: "claude-code",
    title: "Explainers",
    snippets: [
      {
        title: "How a hash map gets O(1)",
        badge: { tone: "info", label: "Explainer" },
        parts: [{ kind: "html", html: HASHMAP_EXPLAINER, kits: ["animate"] }],
      },
    ],
  },
  {
    agent: "claude-code",
    title: "Review: streaming asset uploads",
    snippets: [
      {
        title: "Verdict — 1 blocker, 1 nit",
        badge: { tone: "warning", label: "Request changes" },
        parts: [
          // The opinionated overview LEADS (intent + risk + budget + manifest),
          // then the verdict markdown, then the change map — the standardized
          // template the server composes from a publish_review call.
          { kind: "html", html: REVIEW_OVERVIEW, kits: ["review"] },
          {
            kind: "markdown",
            markdown:
              "## Review summary\n\n**2 findings** · 1 bug · 1 nit — **request changes**\n\n| # | Severity | Finding | Location |\n|---|----------|---------|----------|\n| 1 | 🔴 Bug | Unbounded asset upload buffers the whole body before the size check | `server/app.ts:747` |\n| 2 | 🟡 Nit | `mime` parse duplicated across three handlers | `server/app.ts:182` |\n\n**Coverage** — read the asset upload + auth paths and the comment long-poll; did not exercise the SQL migration or the e2e suite.\n\nThe blocker (#1) is below. Tap **Approve** on a card once it's addressed.",
          },
          { kind: "mermaid", mermaid: REVIEW_CHANGEMAP },
        ],
      },
      {
        title: "Bug: unbounded asset upload — server/app.ts:747",
        badge: { tone: "critical", label: "Bug" },
        parts: [
          { kind: "markdown", markdown: REVIEW_BUG_PROSE },
          { kind: "mermaid", mermaid: REVIEW_BUG_FLOW },
          { kind: "diff", patch: REVIEW_BUG_DIFF },
        ],
      },
      {
        title: "Nit: duplicated content-type parse — server/app.ts:182",
        badge: { tone: "warning", label: "Nit" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "_Medium confidence · scope: whole file_\n\n**Coverage** — grepped for the split across the three handlers; did not check callers outside server/app.ts.\n\n**Problem** — the `content-type` → mime split is copy-pasted in `uploadAsset`, `publishSurface`, and the snippet handler. Three copies drift: a future tweak (charset stripping, casing) has to be made in three places or they diverge.",
          },
          {
            kind: "diff",
            files: [
              {
                filename: "server/app.ts",
                before: REVIEW_NIT_BEFORE,
                after: REVIEW_NIT_AFTER,
              },
            ],
          },
          {
            kind: "markdown",
            markdown:
              "**Why it's better** — one `parseMime(c)` helper means charset/casing rules live in a single place; the three call sites can't diverge.",
          },
        ],
      },
    ],
  },
  {
    agent: "pi",
    title: "Queue profiling",
    snippets: [
      {
        title: "Queue latency after batched dequeue",
        html: QUEUE_METRICS,
      },
      {
        title: "Latency percentiles, before vs after",
        parts: [QUEUE_LATENCY_CHART],
      },
      {
        title: "Why the tail blew up",
        parts: [
          {
            kind: "markdown",
            markdown:
              "## Little's Law\n\nQueue wait isn't linear in load. For the M/M/1 model the expected wait is\n\n$$W = \\frac{1}{\\mu - \\lambda}$$\n\nwhere $\\lambda$ is the arrival rate and $\\mu$ the service rate. As $\\lambda \\to \\mu$ the utilization $\\rho = \\frac{\\lambda}{\\mu} \\to 1$ and the wait $W \\to \\infty$ — which is why the p99 tail exploded before the batched dequeue lifted $\\mu$.",
          },
        ],
      },
      {
        title: "Drill down: batched dequeue",
        parts: [{ kind: "html", html: DRILLDOWN }],
      },
    ],
  },
  {
    agent: "claude-code",
    title: "Auth refactor",
    snippets: [
      {
        title: "JWT refresh flow",
        html: JWT_DIAGRAM,
        followups: [
          { comment: { author: "user", text: "Where does the access token live client-side?" } },
          { update: { html: JWT_DIAGRAM + JWT_EXPLAINER } },
          {
            comment: {
              author: "claude-code",
              text: "In memory only — never localStorage. Updated the diagram to show it.",
            },
          },
        ],
      },
      {
        title: "Exponential backoff, intuitively",
        html: BACKOFF,
      },
    ],
  },
];
