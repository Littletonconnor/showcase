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

export const mockupsSession = {
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
};
