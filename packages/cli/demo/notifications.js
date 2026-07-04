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

export const notificationsSession = {
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
};
