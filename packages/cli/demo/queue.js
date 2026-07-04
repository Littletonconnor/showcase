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

export const queueSession = {
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
};
