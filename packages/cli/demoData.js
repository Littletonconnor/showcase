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
// follow-up. It lands in the surface's thread for the user to relay to the
// agent — the output → propose → revise loop.
const DRILLDOWN = `
<div style="font-family: var(--font-sans); color: var(--color-text-primary);">
  <p style="margin: 0 0 4px; line-height: 1.6;">The batched dequeue pulls up to <strong>50 jobs</strong> per poll instead of one, so a burst drains in a few round-trips instead of hundreds.</p>
  <p style="margin: 0 0 14px; color: var(--color-text-secondary); font-size: 13px;">Want to go deeper? Tap below — it proposes a follow-up you can send to the agent.</p>
  <button type="button" onclick="sendPrompt('Walk me through how the batched dequeue handles a partial failure partway through a batch — which jobs get retried?')"
    style="font: 500 13px var(--font-sans); display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--color-border-secondary); background: var(--color-background-secondary); color: var(--color-text-primary); cursor: pointer;">
    &#8627; Explain partial-failure handling
  </button>
</div>`;

const REVIEW_BUG_FLOW = `flowchart LR
  Client([Client]) --> read[read body]
  read --> size{>5MB?}
  size -- yes --> late[413 late]
  size -- no --> store[store]
  read -. OOM .-> heap[heap exhausted]`;

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

// Architecture sketch for the recommended option — a mermaid sequence diagram
// the viewer renders to an SVG.
const NOTIF_ARCH = `sequenceDiagram
  participant C as Browser
  participant S as API · /events
  participant B as Event bus
  C->>S: GET /events (text/event-stream)
  S-->>C: 200 · stream open
  B->>S: surface.updated
  S-->>C: data: { type, surfaceId, ... }
  Note over C,S: drop? auto-reconnect with Last-Event-ID
  B->>S: comment.created
  S-->>C: data: { type, comment, ... }`;

// The tradeoff matrix — a sandboxed HTML part. The recommended column is tinted
// and carries an `anno` callout (the annotation primitive) pointing it out.
const NOTIF_ROWS = [
  ["Direction", "half-duplex", "server → client", "full-duplex"],
  ["Auto-reconnect", "you build it", "built in (Last-Event-ID)", "you build it"],
  ["Transport", "plain HTTP", "plain HTTP", "upgrade + sticky conns"],
  ["Proxies / infra", "just works", "just works", "needs WS-aware infra"],
  ["Complexity", "low", "low", "medium–high"],
  ["Fits when", "occasional polls", "a server push feed", "true two-way"],
];
const NOTIF_MATRIX = `
<div style="font-family:var(--font-sans);color:var(--color-text-primary);padding:30px 2px 2px">
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead>
      <tr style="color:var(--color-text-secondary);text-align:left">
        <th style="padding:9px 12px;font-weight:500;width:28%"></th>
        <th style="padding:9px 12px;font-weight:500">Long-poll</th>
        <th style="padding:9px 12px;font-weight:600;color:var(--color-text-primary);position:relative;background:var(--color-background-info);border-radius:10px 10px 0 0">
          Server-Sent Events
          <span class="anno a-t a-ok">our pick for v1</span>
        </th>
        <th style="padding:9px 12px;font-weight:500">WebSocket</th>
      </tr>
    </thead>
    <tbody>
      ${NOTIF_ROWS.map(
        (r, i) => `<tr style="border-top:0.5px solid var(--color-border-tertiary)">
        <td style="padding:9px 12px;color:var(--color-text-secondary)">${r[0]}</td>
        <td style="padding:9px 12px">${r[1]}</td>
        <td style="padding:9px 12px;background:var(--color-background-info);font-weight:500;${i === NOTIF_ROWS.length - 1 ? "border-radius:0 0 10px 10px" : ""}">${r[2]}</td>
        <td style="padding:9px 12px">${r[3]}</td>
      </tr>`,
      ).join("")}
    </tbody>
  </table>
  <p style="color:var(--color-text-tertiary);font-size:12px;margin:12px 4px 2px">All three carry our payloads — SSE just buys the least to operate for a one-way feed.</p>
</div>`;

// A mockup composed from the `mockup` kit's classes — no inline palette. The
// SAME markup is seeded twice under different themes (brand + neutral) to show
// that theming, not restyling, is what keeps a set of mockups consistent.
const SETTINGS_MOCKUP = `
<div class="panel stack lg" style="max-width:560px">
  <div class="stack sm">
    <span class="eyebrow">Account · Notifications</span>
    <h2 style="margin:0;font:600 19px/1.3 var(--font-sans);color:var(--color-text-primary)">How should we reach you?</h2>
  </div>
  <div class="callout ok stack sm">
    <span class="label">Recommended</span>
    <p style="margin:0">Email digests keep noise low — one summary a day instead of a ping per event.</p>
  </div>
  <div class="stack sm">
    <label class="label">Email</label>
    <div class="input placeholder">you@example.com</div>
  </div>
  <div class="row" style="gap:8px">
    <span class="pill">Daily digest</span>
    <span class="pill">Mentions</span>
    <span class="pill">Security only</span>
  </div>
  <div class="row between">
    <div class="stack sm"><span class="label">Open rate</span><span class="metric">68%</span></div>
    <div class="row" style="gap:8px">
      <button class="btn ghost">Cancel</button>
      <button class="btn primary">Save changes</button>
    </div>
  </div>
</div>`;

// Seeded in order; the viewer sorts sessions by last activity, so the last
// session here ends up on top.
export const DEMO_SESSIONS = [
  {
    agent: "claude-code",
    title: "Mockups — one design, two themes",
    snippets: [
      {
        title: "Notifications settings · Brand",
        badge: { tone: "info", label: "Mockup" },
        theme: "brand",
        parts: [{ kind: "html", html: SETTINGS_MOCKUP, kits: ["mockup"] }],
      },
      {
        title: "Notifications settings · Neutral",
        badge: { tone: "neutral", label: "Wireframe" },
        theme: "neutral",
        parts: [{ kind: "html", html: SETTINGS_MOCKUP, kits: ["mockup"] }],
      },
    ],
  },
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
    review: {
      brief:
        "This change makes the app turn away oversized file uploads before it starts reading them, so one giant upload can't run the server out of memory and crash it. Nothing changes for people using the app — it only affects what happens behind the scenes. One uncovered case is flagged as a follow-up: uploads that don't declare their size up front still slip past.",
      verdict: "block",
      decisions: [
        {
          id: "d-upload-buffer",
          call: "block",
          kind: "bug",
          scope: "changed-line",
          assertion: "The upload handler buffers the whole request body before the size check.",
          impact:
            "A 2 GB upload allocates ~2 GB of heap and can OOM the server before the 413 returns. Local boards ship without an auth token, so any client on the network can trigger it.",
          details:
            "`uploadAsset` reads the entire body into memory via `c.req.arrayBuffer()`, then checks `MAX_ASSET_BYTES` — so the guard never runs for an oversized request. Reject on the `content-length` header before reading the body; a streaming cap can follow for chunked uploads that omit it.",
          confidence: "high",
          pivot: "flips to ship once the content-length guard lands",
          evidence: [
            { kind: "mermaid", mermaid: REVIEW_BUG_FLOW },
            { kind: "diff", patch: REVIEW_BUG_DIFF },
          ],
          proposal: {
            filename: "server/app.ts",
            before: "const buf = new Uint8Array(await c.req.arrayBuffer());",
            after:
              "const len = Number(c.req.header('content-length') ?? 0);\nif (len > MAX_ASSET_BYTES) return c.json({ error: 'too large' }, 413);\nconst buf = new Uint8Array(await c.req.arrayBuffer());",
            note: "reject before buffering the body",
          },
        },
        {
          id: "d-mime-dupe",
          call: "decide",
          kind: "refactor",
          scope: "whole-file",
          assertion: "The content-type to mime parse is copy-pasted across three handlers.",
          impact:
            "A future tweak (charset stripping, casing) has to be made in three places or they diverge.",
          details:
            "The split lives in `uploadAsset`, `publishSurface`, and the snippet handler. Extracting one `parseMime(c)` helper keeps the rules in a single place.",
          confidence: "medium",
          evidence: [
            {
              kind: "diff",
              files: [
                { filename: "server/app.ts", before: REVIEW_NIT_BEFORE, after: REVIEW_NIT_AFTER },
              ],
            },
          ],
          proposal: {
            filename: "server/mime.ts",
            before: REVIEW_NIT_BEFORE,
            after: REVIEW_NIT_AFTER,
            note: "extract a single parseMime helper",
          },
        },
      ],
      manifest: [
        {
          path: "server/app.ts",
          disposition: "has-decision",
          decisionId: "d-upload-buffer",
          added: 24,
          removed: 6,
          note: "upload path — unbounded buffer",
        },
        {
          path: "server/mime.ts",
          disposition: "has-decision",
          decisionId: "d-mime-dupe",
          added: 12,
          removed: 0,
          note: "new shared content-type parser",
        },
        {
          path: "test/assets.test.ts",
          disposition: "reviewed-no-comment",
          added: 18,
          removed: 0,
          note: "covers the new size guard",
        },
        {
          path: "package-lock.json",
          disposition: "mechanical-skipped",
          added: 210,
          removed: 90,
          note: "generated / vendored — glance only",
        },
      ],
    },
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
  {
    agent: "claude-code",
    title: "Realtime notifications — design options",
    snippets: [
      {
        title: "1 · Recommendation — SSE for v1",
        badge: { tone: "success", label: "Preferred" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "## Push notifications, the smallest way that works\n\nWe need the server to push three events to the open tab — `surface.updated`, `comment.created`, `presence` — with **no** client→server streaming. **Server-Sent Events** covers exactly that: a long-lived `text/event-stream` over plain HTTP, with **built-in reconnect** (`Last-Event-ID`) we'd otherwise hand-roll.\n\nWebSockets are the reflex, but full-duplex is capability we don't use yet — and it costs sticky connections and WS-aware infra. Start with SSE; the event shape is transport-agnostic, so upgrading later (if we add client→server streaming) is a swap, not a rewrite.",
          },
          { kind: "mermaid", mermaid: NOTIF_ARCH },
        ],
      },
      {
        title: "2 · Option A — Long-polling",
        badge: { tone: "info", label: "Option" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "**How** — the client requests `/events`; the server holds it open until an event lands (or a timeout), responds, and the client immediately re-requests.\n\n- ✅ Trivial — works through any proxy, no new transport.\n- ✅ Universal support, back to ancient browsers.\n- ⚠️ A reconnect per event; chatty under load.\n- ⚠️ You build your own catch-up / dedupe on reconnect.\n\n**Verdict** — the fallback if SSE is somehow blocked, not the primary.",
          },
        ],
      },
      {
        title: "3 · Option B — Server-Sent Events",
        badge: { tone: "info", label: "Option" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "**How** — one `GET /events` with `Content-Type: text/event-stream`, held open; the server writes `data:` frames as events occur.\n\n- ✅ One connection, server → client, over plain HTTP/2.\n- ✅ **Reconnect + replay is built in** via `Last-Event-ID`.\n- ✅ No new infra — it's just a long-lived response.\n- ⚠️ One-way only — fine, our client talks back over normal POSTs.\n\n**Verdict** — matches the shape of the problem with the least to operate. **Recommended.**",
          },
        ],
      },
      {
        title: "4 · Option C — WebSocket",
        badge: { tone: "info", label: "Option" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "**How** — HTTP `Upgrade` to a full-duplex socket; both sides stream frames.\n\n- ✅ True two-way — the right tool once the client needs to *stream* (cursors, live typing).\n- ⚠️ Sticky connections; load balancers and proxies must be WS-aware.\n- ⚠️ Reconnect, heartbeat, and backpressure are all yours to build.\n\n**Verdict** — revisit when we add a bidirectional feature; overkill for a push feed today.",
          },
        ],
      },
      {
        title: "5 · How they compare",
        badge: { tone: "success", label: "Direction" },
        parts: [{ kind: "html", html: NOTIF_MATRIX }],
      },
      {
        title: "6 · Open questions",
        badge: { tone: "warning", label: "Open" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "- **Proxy buffering** — some reverse proxies buffer `text/event-stream`; confirm ours flushes (or set `X-Accel-Buffering: no`).\n- **Connection cap** — browsers allow ~6 SSE connections per origin on HTTP/1.1. We're on HTTP/2 (multiplexed), but verify in prod.\n- **Auth on a long stream** — token expiry mid-stream: drop and let reconnect re-auth, or refresh in band?",
          },
        ],
      },
      {
        title: "7 · Rollout phasing",
        badge: { tone: "neutral", label: "Proposed" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "1. **Ship SSE** behind the existing `/events` route; long-poll stays as the fallback path.\n2. **Instrument** reconnect rate + stream lifetime for a week.\n3. **Drop long-poll** once SSE reconnects are boring.\n4. **Revisit WebSocket** only when a client→server streaming feature actually lands.",
          },
        ],
      },
      {
        title: "8 · Summary",
        badge: { tone: "success", label: "Summary" },
        parts: [
          {
            kind: "markdown",
            markdown:
              "**SSE for v1.** It's the only option whose shape matches the requirement — one-way server push — and it hands us reconnect for free over infra we already run. Long-poll is the fallback; WebSocket is a later upgrade gated on a real bidirectional need.\n\nComment on any card to push back, or **Approve** to lock the direction.",
          },
        ],
      },
    ],
  },
];

// --- learn-mode demo lessons ---------------------------------------------------
// Three lessons published through the REAL pipeline (POST /api/lessons) by
// `showcase demo` — the acceptance bar for the teach skill's output shape:
// every beat element (hook, model, worked example, gated explorable,
// misconception-tagged checkpoints, recap) appears in each lesson.

export const DEMO_LESSONS = [
  {
    topic: "Redis eviction policies",
    learnerLevel: "novice",
    sessionTitle: "Learn: Redis eviction",
    conceptGraph: {
      concepts: [
        {
          id: "maxmemory",
          label: "maxmemory + noeviction",
          misconceptions: [
            "Redis evicts old keys by default",
            "maxmemory bounds only the dataset, not overhead",
          ],
        },
        {
          id: "policies",
          label: "Eviction policies",
          misconceptions: ["allkeys-lru and volatile-lru differ only in speed"],
        },
        {
          id: "approx-lru",
          label: "Approximated LRU",
          misconceptions: ["Redis tracks a true LRU list", "eviction is FIFO"],
        },
      ],
      edges: [
        ["maxmemory", "policies"],
        ["policies", "approx-lru"],
      ],
    },
    beats: [
      {
        conceptId: "maxmemory",
        hook: {
          id: "redis-hook",
          conceptId: "maxmemory",
          kind: "predict",
          prompt:
            "A Redis instance has `maxmemory 100mb` and NO eviction policy configured. Memory is full. What happens on the next `SET`?",
          options: [
            { id: "a", label: "The oldest key is evicted to make room", misconception: "Redis evicts old keys by default" },
            { id: "b", label: "The write fails with an OOM error", correct: true },
            { id: "c", label: "Redis swaps cold keys to disk" },
          ],
          askConfidence: true,
          reveal:
            "The write FAILS: the default policy is `noeviction`. Redis never silently drops data unless you opt in — eviction is a cache behavior you must choose.",
        },
        model: [
          {
            kind: "markdown",
            markdown:
              "`maxmemory` is the ceiling; `maxmemory-policy` decides what happens at the ceiling. The default, `noeviction`, returns errors on writes rather than dropping data — Redis-as-database semantics. Every other policy turns Redis into a cache that sheds keys.",
          },
          {
            kind: "mermaid",
            mermaid:
              'flowchart LR\n  W["write"] --> F{"memory full?"}\n  F -- no --> OK["stored"]\n  F -- yes --> P{"maxmemory-policy"}\n  P -- noeviction --> E["OOM error"]\n  P -- anything else --> V["evict a victim, then store"]',
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "text",
            title: "redis-cli",
            code: "127.0.0.1:6379> CONFIG SET maxmemory 100mb\nOK\n127.0.0.1:6379> CONFIG GET maxmemory-policy\n1) \"maxmemory-policy\"\n2) \"noeviction\"\n127.0.0.1:6379> SET big:1 <payload>   # once memory is full:\n(error) OOM command not allowed when used memory > 'maxmemory'.",
          },
        ],
        checkpoints: [
          {
            id: "redis-cp-1",
            conceptId: "maxmemory",
            kind: "mcq",
            prompt: "Your cache-aside service starts throwing OOM errors from Redis. What is the FIRST config to check?",
            options: [
              { id: "a", label: "`maxmemory-policy` — it is probably still `noeviction`", correct: true },
              { id: "b", label: "`maxmemory-samples` — sampling is too small", misconception: "sampling causes OOM" },
              { id: "c", label: "`appendonly` — AOF is filling memory" },
            ],
            reveal:
              "A cache that OOMs on writes is almost always running the database default: `noeviction`. Pick an eviction policy that matches how you use keys.",
          },
        ],
        recap: "maxmemory sets the ceiling; the policy chooses error-at-the-edge (default) or evict-at-the-edge.",
      },
      {
        conceptId: "policies",
        model: [
          {
            kind: "markdown",
            markdown:
              "Policies differ on two axes: **which keys are candidates** (`allkeys-*` = every key; `volatile-*` = only keys WITH a TTL) and **how the victim is picked** (`lru`, `lfu`, `random`, `ttl`). So `volatile-lru` on a dataset with no TTLs has zero candidates — and behaves like `noeviction`.",
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "text",
            title: "choosing a policy",
            code: "# session cache, every key has a TTL, hot set matters:\nCONFIG SET maxmemory-policy volatile-lru\n\n# pure cache, no TTLs, recency matters:\nCONFIG SET maxmemory-policy allkeys-lru\n\n# pure cache, frequency beats recency (scan-resistant):\nCONFIG SET maxmemory-policy allkeys-lfu",
          },
        ],
        checkpoints: [
          {
            id: "redis-cp-2",
            conceptId: "policies",
            kind: "mcq",
            prompt: "You set `volatile-lru` but NONE of your keys have TTLs. Memory fills. What happens on the next write?",
            options: [
              { id: "a", label: "The least-recently-used key is evicted anyway" },
              {
                id: "b",
                label: "The write fails — no key is an eviction candidate",
                correct: true,
              },
              { id: "c", label: "Redis assigns a default TTL and evicts", misconception: "allkeys-lru and volatile-lru differ only in speed" },
            ],
            reveal:
              "`volatile-*` policies can only evict keys that carry a TTL. With none, the candidate set is empty and writes fail exactly like `noeviction`.",
          },
          {
            id: "redis-cp-3",
            conceptId: "policies",
            kind: "explain",
            prompt: "In your own words: when would you pick `allkeys-lfu` over `allkeys-lru`?",
            askConfidence: true,
            reveal:
              "Model answer: LFU keeps FREQUENTLY used keys, LRU keeps RECENTLY used ones. A one-off bulk scan touches everything once and, under LRU, flushes your genuinely hot keys; LFU is scan-resistant because a single touch doesn't outrank sustained frequency.",
          },
        ],
        recap: "Candidates (allkeys vs volatile) x selector (lru/lfu/random/ttl). volatile-* with no TTLs = noeviction.",
      },
      {
        conceptId: "approx-lru",
        model: [
          {
            kind: "markdown",
            markdown:
              "Redis does NOT keep a true LRU list — a doubly-linked list over millions of keys costs memory and cache misses. Instead each key stores a 24-bit clock; at eviction time Redis SAMPLES `maxmemory-samples` keys (default 5) and evicts the best candidate from the sample. More samples = closer to true LRU, more CPU.",
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "text",
            title: "tuning the approximation",
            code: "CONFIG SET maxmemory-samples 10   # closer to true LRU, more CPU per eviction\nCONFIG SET maxmemory-samples 3    # cheaper, sloppier",
          },
        ],
        explorable: {
          gate: {
            id: "redis-gate",
            conceptId: "approx-lru",
            kind: "predict",
            prompt: "Before you play: with sample size 5 out of 1000 keys, can the GLOBALLY oldest key survive an eviction round?",
            options: [
              { id: "a", label: "No — LRU always finds the oldest", misconception: "Redis tracks a true LRU list" },
              { id: "b", label: "Yes — it survives whenever it is not in the sample", correct: true },
            ],
            reveal: "Yes. Eviction only sees the sample. Now drag the sample size below and watch the odds change.",
          },
          html: '<div class="panel stack lg"><span class="eyebrow">Sampled eviction</span><p class="dim">Drag the sample size. The bar shows the chance the true oldest key is picked this round (sample/keyspace, 1000 keys).</p><label class="row" style="gap:10px">samples <input id="s" type="range" min="1" max="100" value="5" style="flex:1"> <b id="v">5</b></label><div class="bar" style="margin-top:8px"><i id="p" style="width:0.5%"></i></div><p class="dim" id="t">0.5% chance the global oldest is even seen.</p><script>var s=document.getElementById("s"),v=document.getElementById("v"),p=document.getElementById("p"),t=document.getElementById("t");s.addEventListener("input",function(){var n=+s.value;v.textContent=n;var pct=(n/1000*100).toFixed(1);p.style.width=pct+"%";t.textContent=pct+"% chance the global oldest is even seen.";if(window.showcase)showcase.emit({v:1,type:"explorable_interaction",name:"samples",value:String(n)});});</script></div>',
        },
        checkpoints: [
          {
            id: "redis-cp-4",
            conceptId: "approx-lru",
            kind: "trace",
            prompt:
              "Keys A(idle 90s), B(idle 10s), C(idle 400s), D(idle 30s). The sampler draws {A, B, D} under `allkeys-lru`. Which key is evicted? (one letter)",
            expected: "A",
            reveal:
              "A — the oldest IN THE SAMPLE. C, the true oldest, was never drawn, so it survives. That is the whole approximation in one round.",
          },
        ],
        recap: "Eviction picks the best of a small random sample, not the global optimum — cheap, and close enough.",
      },
    ],
  },
  {
    topic: "Effect-TS error model",
    learnerLevel: "intermediate",
    sessionTitle: "Learn: Effect-TS errors",
    conceptGraph: {
      concepts: [
        {
          id: "typed-errors",
          label: "Errors in the type",
          misconceptions: ["Effect errors are just typed exceptions that still unwind"],
        },
        {
          id: "defects",
          label: "Failures vs defects",
          misconceptions: ["catchAll also catches defects"],
        },
        {
          id: "recovery",
          label: "Typed recovery",
          misconceptions: ["handling one error still leaves the channel dirty"],
        },
      ],
      edges: [
        ["typed-errors", "defects"],
        ["typed-errors", "recovery"],
      ],
    },
    beats: [
      {
        conceptId: "typed-errors",
        hook: {
          id: "fx-hook",
          conceptId: "typed-errors",
          kind: "predict",
          prompt:
            "An `Effect<User, DbError | NotFound>` flows through `Effect.map`. You handle `NotFound` with `catchTag`. What is the error type now?",
          options: [
            { id: "a", label: "Still `DbError | NotFound` — handling does not narrow", misconception: "handling one error still leaves the channel dirty" },
            { id: "b", label: "`DbError` — the handled case is REMOVED from the type", correct: true },
          ],
          reveal:
            "`DbError`. The error channel is an ordinary type parameter: handling a case subtracts it. The compiler now proves NotFound cannot escape.",
        },
        model: [
          {
            kind: "markdown",
            markdown:
              "`Effect<A, E, R>` carries its failure mode in `E`, the same way it carries its success in `A`. Nothing unwinds invisibly: an error is a VALUE routed through the error channel, and every combinator states what it does to that channel. `throw` tells you nothing at the type level; `E` tells you everything.",
          },
          {
            kind: "code",
            language: "ts",
            title: "the error is in the signature",
            code: 'class DbError extends Data.TaggedError("DbError")<{ cause: unknown }> {}\nclass NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}\n\nconst getUser = (id: string): Effect.Effect<User, DbError | NotFound> =>\n  Effect.gen(function* () {\n    const row = yield* query(id);        // can fail: DbError\n    if (!row) return yield* new NotFound({ id });\n    return row;\n  });',
          },
        ],
        checkpoints: [
          {
            id: "fx-cp-1",
            conceptId: "typed-errors",
            kind: "mcq",
            prompt: "What is the closest plain-TypeScript analog to the `E` in `Effect<A, E>`?",
            options: [
              { id: "a", label: "A `throws` clause that actually type-checks", correct: true },
              { id: "b", label: "A try/catch that rethrows", misconception: "Effect errors are just typed exceptions that still unwind" },
              { id: "c", label: "`Promise.reject`" },
            ],
            reveal:
              "It is the checked-exceptions idea done right: the possible failures ride the signature, and the compiler enforces that you either handle them or pass them on.",
          },
        ],
        recap: "The error channel is a type parameter: failures are values, and handling subtracts from the type.",
      },
      {
        conceptId: "defects",
        model: [
          {
            kind: "markdown",
            markdown:
              "Effect splits the world in two: **failures** (expected, typed, in `E` — the domain saying no) and **defects** (bugs: a thrown TypeError, a failed invariant — `Effect.die`). Failure combinators (`catchAll`, `catchTag`, `either`) see ONLY failures. Defects bypass them and crash the fiber, because retrying a bug is not a strategy.",
          },
          {
            kind: "mermaid",
            mermaid:
              'flowchart TD\n  E["effect fails"] --> K{"expected?"}\n  K -- "yes: typed failure" --> F["error channel E"] --> C["catchTag / catchAll / either"]\n  K -- "no: defect (die)" --> D["fiber death"] --> X["exit / cause inspection only"]',
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "ts",
            title: "failure vs defect",
            code: 'const failure = Effect.fail(new NotFound({ id: "1" })); // E = NotFound\nconst defect  = Effect.die(new Error("impossible state")); // E = never!\n\n// catchAll clears failures — but the defect sails through it:\nconst handled = defect.pipe(Effect.catchAll(() => Effect.succeed("nope")));\n// handled still dies. Only Exit/Cause-level tools (e.g. Effect.exit,\n// Effect.catchAllCause) can even OBSERVE it.',
          },
        ],
        checkpoints: [
          {
            id: "fx-cp-2",
            conceptId: "defects",
            kind: "mcq",
            prompt: "`Effect.die(new Error(\"boom\")).pipe(Effect.catchAll(() => Effect.succeed(1)))` — what runs?",
            options: [
              { id: "a", label: "Succeeds with 1 — catchAll caught it", misconception: "catchAll also catches defects" },
              { id: "b", label: "The fiber still dies — defects bypass failure handlers", correct: true },
            ],
            reveal:
              "The fiber dies. `catchAll` sees the typed error channel only, and `die` never enters it — that is the point: bugs should crash loudly, not be silently retried.",
          },
          {
            id: "fx-cp-3",
            conceptId: "defects",
            kind: "explain",
            prompt: "Explain back: why does Effect route defects AROUND catchAll instead of through it?",
            reveal:
              "Model answer: failures are part of the domain contract and deserve typed handling; defects are broken invariants. If catchAll saw both, every recovery path would silently swallow bugs, and the type E would stop meaning anything.",
          },
        ],
        recap: "E is for expected failures; defects (die) bypass failure handlers and kill the fiber.",
      },
      {
        conceptId: "recovery",
        model: [
          {
            kind: "markdown",
            markdown:
              "Recovery combinators are set operations on `E`: `catchTag(\"NotFound\", ...)` subtracts one member; `catchAll` empties the channel (`E = never`); `either` moves the failure into the success value as `Either<E, A>`. Read any pipeline's honesty off its final `E`.",
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "ts",
            title: "subtracting errors",
            code: 'const safe: Effect.Effect<User | Anonymous, DbError> = getUser(id).pipe(\n  Effect.catchTag("NotFound", () => Effect.succeed(Anonymous)),\n);\n// NotFound is GONE from the type. Only DbError remains to answer for.',
          },
        ],
        explorable: {
          gate: {
            id: "fx-gate",
            conceptId: "recovery",
            kind: "predict",
            prompt: "Predict: after `either`, what is the error type of the resulting effect?",
            options: [
              { id: "a", label: "Unchanged — either only wraps the success" },
              { id: "b", label: "`never` — the failure moved into the success value", correct: true },
            ],
            reveal: "`never`. The failure is now DATA in the success channel. Try the combinators below.",
          },
          html: '<div class="panel stack lg"><span class="eyebrow">The error channel as a set</span><p class="dim">Start: <span class="mono">E = DbError | NotFound | Timeout</span>. Click a combinator; watch E shrink.</p><div class="row" style="gap:8px;flex-wrap:wrap"><button data-op="catchTag(&quot;NotFound&quot;)" data-rm="NotFound">catchTag("NotFound")</button><button data-op="catchTag(&quot;Timeout&quot;)" data-rm="Timeout">catchTag("Timeout")</button><button data-op="catchAll" data-rm="*">catchAll(...)</button><button data-op="reset" data-rm="reset">reset</button></div><p style="margin-top:10px">E = <b id="e" class="mono">DbError | NotFound | Timeout</b></p><script>var all=["DbError","NotFound","Timeout"],cur=all.slice(),el=document.getElementById("e");function render(){el.textContent=cur.length?cur.join(" | "):"never";}document.querySelectorAll("button[data-rm]").forEach(function(b){b.addEventListener("click",function(){var rm=b.getAttribute("data-rm");if(rm==="reset"){cur=all.slice();}else if(rm==="*"){cur=[];}else{cur=cur.filter(function(x){return x!==rm});}render();if(window.showcase)showcase.emit({v:1,type:"explorable_interaction",name:"combinator",value:b.getAttribute("data-op")});});});</script></div>',
        },
        checkpoints: [
          {
            id: "fx-cp-4",
            conceptId: "recovery",
            kind: "apply",
            prompt:
              "You have `Effect<Config, ParseError | IOError>`. Requirement: a ParseError falls back to defaults; an IOError must still be visible to the caller. Which combinator, and what is the final type? (one line)",
            reveal:
              "Model answer: `Effect.catchTag(\"ParseError\", () => Effect.succeed(defaults))` giving `Effect<Config, IOError>` — subtract exactly the handled case, leave the rest honest.",
          },
        ],
        recap: "Recovery = set subtraction on E. The final E is the function's honest failure contract.",
      },
    ],
  },
  {
    topic: "showcase codebase tour",
    learnerLevel: "intermediate",
    sessionTitle: "Learn: the showcase codebase",
    conceptGraph: {
      concepts: [
        {
          id: "workspace",
          label: "Workspace boundaries",
          misconceptions: [
            "the CLI imports the server",
            "core can use node APIs since everything runs on node",
          ],
        },
        {
          id: "sandbox",
          label: "The sandbox invariant",
          misconceptions: ["markdown parts render as innerHTML in the viewer"],
        },
        {
          id: "feedback",
          label: "The exactly-once feedback pipe",
          misconceptions: ["each delivery channel keeps its own cursor"],
        },
      ],
      edges: [
        ["workspace", "sandbox"],
        ["workspace", "feedback"],
      ],
    },
    beats: [
      {
        conceptId: "workspace",
        hook: {
          id: "tour-hook",
          conceptId: "workspace",
          kind: "predict",
          prompt: "How does the `showcase` CLI talk to the server — direct import, shared store file, or HTTP?",
          options: [
            { id: "a", label: "It imports the server package and calls flows directly", misconception: "the CLI imports the server" },
            { id: "b", label: "HTTP only — the CLI is a thin API client", correct: true },
            { id: "c", label: "Both read the same JSON store file" },
          ],
          askConfidence: true,
          reveal:
            "HTTP only (packages/cli/http.ts). The CLI never imports the server tree — that boundary is what lets it stay zero-dependency and target a remote board via SHOWCASE_URL.",
        },
        model: [
          {
            kind: "markdown",
            markdown:
              "Five packages, enforced boundaries: `core` (runtime-agnostic data model + renderers — NO `node:` imports, CI-checked) is imported by everyone; `server` is the Node runtime; `cli` talks to `server` over HTTP, never by import; `mcp` is a stdio client over the same HTTP API; `viewer` is the one Vite-built package, whose dist the server reads at boot.",
          },
          {
            kind: "mermaid",
            mermaid:
              'flowchart TD\n  core["@showcase/core"] --> server["@showcase/server"]\n  core --> cli["@showcase/cli"]\n  core --> mcp["@showcase/mcp"]\n  core --> viewer["@showcase/viewer"]\n  cli -. "HTTP" .-> server\n  mcp -. "HTTP" .-> server\n  viewer -. "dist/index.html read at boot" .-> server',
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "js",
            title: "scripts/check-core-boundary.mjs (the CI gate)",
            code: '// Fails the lint gate on any `node:` import inside packages/core —\n// the check that keeps core portable to any runtime:\nconst matches = source.matchAll(/from\\s+["\']node:/g);',
          },
        ],
        checkpoints: [
          {
            id: "tour-cp-1",
            conceptId: "workspace",
            kind: "mcq",
            prompt: "Where must a new `readFile` call live?",
            options: [
              { id: "a", label: "Anywhere — it all runs on Node anyway", misconception: "core can use node APIs since everything runs on node" },
              { id: "b", label: "server/cli/mcp — never core (CI enforces it)", correct: true },
            ],
            reveal:
              "core stays runtime-agnostic; scripts/check-core-boundary.mjs fails lint on any node: import there. Node wiring belongs to the server (index.ts, storage.ts) or the CLI.",
          },
        ],
        recap: "core is imported by all and imports no runtime; cli/mcp reach the server only over HTTP.",
      },
      {
        conceptId: "sandbox",
        model: [
          {
            kind: "markdown",
            markdown:
              "The one untouchable invariant: agent-authored content that becomes HTML renders ONLY inside sandboxed, opaque-origin iframes — never as innerHTML in the trusted viewer origin, which shares its origin with the authenticated API. Two paths exist: html parts load `/s/:id` server-rendered docs; rich parts (markdown/mermaid/diff/code) are built as STRINGS in the viewer and handed to a `srcdoc` sandbox. Data parts (json, chart, trace, checkpoint) render as React text nodes — escaping by construction.",
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "tsx",
            title: "packages/viewer/src/SandboxedPart.tsx",
            code: '<iframe\n  key={doc}\n  className={props.class ?? "partframe"}\n  sandbox="allow-scripts"      // no allow-same-origin: opaque origin\n  srcDoc={doc}                 // string in, live DOM only inside\n/>',
          },
        ],
        checkpoints: [
          {
            id: "tour-cp-2",
            conceptId: "sandbox",
            kind: "mcq",
            prompt: "A markdown part's rendered HTML ends up where?",
            options: [
              { id: "a", label: "innerHTML in the viewer (markdown-it sanitizes it)", misconception: "markdown parts render as innerHTML in the viewer" },
              { id: "b", label: "A srcdoc sandbox iframe — string-built in the viewer, DOM only inside", correct: true },
            ],
            reveal:
              "Even library-rendered markup goes into the sandbox: a sanitizer regression then lands in an opaque origin with a no-connect CSP instead of the trusted board.",
          },
          {
            id: "tour-cp-3",
            conceptId: "sandbox",
            kind: "trace",
            prompt: "An html part wants to fetch('https://evil.example'). The CSP directive that blocks it falls back from which missing directive? (name it)",
            expected: "connect-src",
            reveal:
              "`connect-src` is deliberately omitted, so it falls back to `default-src 'none'` — all fetch/XHR/WebSocket from a sandboxed part is blocked (core/surfacePage.ts buildCsp).",
          },
        ],
        recap: "String-build in the trusted origin, become DOM only inside an opaque-origin sandbox. No third way.",
      },
      {
        conceptId: "feedback",
        model: [
          {
            kind: "markdown",
            markdown:
              "User comments reach the agent exactly once through THREE channels sharing ONE server-side cursor (`session.agentSeq`): piggyback (unseen comments ride every agent write), the blocking wait (`wait_for_feedback` long-poll with settle batching), and the CLI watch stream. The read+advance critical section is serialized per session (`withCursorLock`) so overlapping readers cannot double-deliver. Learn-mode telemetry rides this same pipe as fixed-format `[checkpoint]` comments.",
          },
        ],
        workedExample: [
          {
            kind: "code",
            language: "ts",
            title: "packages/server/app.ts — the cursor lock",
            code: "// Two overlapping readers that both read before either marks would\n// deliver the same comments twice, so the read+mark critical section\n// is serialized per session:\nfunction withCursorLock<T>(sessionId: string, fn: () => Promise<T>) {\n  const prev = cursorLocks.get(sessionId) ?? Promise.resolve();\n  const run = prev.then(fn);\n  ...",
          },
        ],
        explorable: {
          gate: {
            id: "tour-gate",
            conceptId: "feedback",
            kind: "predict",
            prompt: "Predict: piggyback delivers a batch, then a wait_for_feedback wakes for the SAME session. What does the wait see?",
            options: [
              { id: "a", label: "The same batch again — each channel has its own cursor", misconception: "each delivery channel keeps its own cursor" },
              { id: "b", label: "Nothing — one shared cursor already advanced past it", correct: true },
            ],
            reveal: "One cursor, shared by all channels — that IS the exactly-once guarantee. Step through it below.",
          },
          html: '<div class="panel stack lg"><span class="eyebrow">One cursor, three channels</span><p class="dim">Click to deliver the next pending comment through a random channel; the cursor advances for ALL of them.</p><div class="row" style="gap:8px"><button id="add">user comments</button><button id="deliver">agent reads (any channel)</button></div><p style="margin-top:8px" class="mono" id="log">pending: 0 · agentSeq: 0</p><script>var pend=0,seq=0,log=document.getElementById("log");function r(){log.textContent="pending: "+pend+" · agentSeq: "+seq;}document.getElementById("add").addEventListener("click",function(){pend++;r();});document.getElementById("deliver").addEventListener("click",function(){var ch=["piggyback","wait","watch"][Math.floor(Math.random()*3)];seq+=pend;var n=pend;pend=0;r();if(window.showcase)showcase.emit({v:1,type:"explorable_interaction",name:"delivered",value:n+" via "+ch});});</script></div>',
        },
        checkpoints: [
          {
            id: "tour-cp-4",
            conceptId: "feedback",
            kind: "apply",
            prompt:
              "Design question: you are adding learn-mode telemetry. Why is 'persist each event as a comment' the right call here, versus a new /api/telemetry store + stream? (2-3 sentences)",
            reveal:
              "Model answer: the comment pipe already guarantees exactly-once delivery across piggyback/wait/watch via the shared agentSeq cursor. A second channel would need its own cursor, locking, and batching — and would inevitably be weaker. Riding comments makes telemetry inherit every guarantee for free (C6).",
          },
        ],
        recap: "Three delivery channels, one agentSeq cursor, one lock — telemetry rides the same rails.",
      },
    ],
  },
];
