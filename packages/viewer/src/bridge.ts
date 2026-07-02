import { api, isReadonly, layoutMode } from "./api.ts";
import { SANDBOX_TELEMETRY_TYPES, validateTelemetryEvent } from "@showcase/core/telemetry";
import { frameForSource } from "./Card.tsx";
import { root } from "./host.ts";
import { postSandboxTelemetry } from "./learn.ts";
import { applyFrameHeight } from "./SandboxedPart.tsx";
import { selectAdjacent, toast } from "./state.ts";

// Messages from sandboxed surface iframes (see server/surfacePage.ts bridge).
export async function onBridgeMessage(ev: MessageEvent) {
  const d = ev.data as {
    __showcase?: boolean;
    type?: string;
    height?: number;
    text?: unknown;
    url?: string;
    key?: string;
    file?: string;
    done?: number;
    total?: number;
  } | null;
  if (!d || !d.__showcase) return;
  // Every host-affecting message must come from a frame the viewer actually
  // embedded — never an unexpected/nested frame. send-prompt and resize prove
  // this implicitly (frameForSource resolves the exact html frame); the
  // remaining types reach the host UI directly, so gate them on isOwnFrame.
  // (frameForSource only knows html-part frames; switch-session is sent only by
  // those, but open-link is sent by rich-part frames too, so use the broader
  // check that recognizes any embedded iframe.)
  if (d.type === "switch-session") {
    if (!isOwnFrame(ev.source)) return;
    if (layoutMode() === "stream") return;
    // A surface iframe forwarded the session-switch shortcut because focus was
    // inside it (see server/surfacePage.ts). Mirror the parent keydown handler.
    void selectAdjacent(d.key === "ArrowUp" ? -1 : 1);
    return;
  }
  // Resolve the source surface + iframe by contentWindow — a surface may own
  // several html-part iframes, so resize must target the exact one.
  const src = frameForSource(ev.source);
  if (d.type === "resize" && src) {
    applyFrameHeight(src.iframe, d.height);
  } else if (d.type === "send-prompt" && src) {
    if (isReadonly()) return;
    // sendPrompt is surface-originated: a script inside the sandbox can fire it
    // (or post this message directly) with no user involvement. It must NEVER
    // become an author:"user" comment — that label is reserved for the composer
    // (genuine keystrokes in this trusted origin), so untrusted content rendered
    // in a surface can't impersonate the user to the agent. We stamp it
    // author:"surface": it shows in the surface's thread, but the feedback
    // channel only delivers "user" comments, so it never reaches the agent on
    // its own. The user can relay it deliberately if they choose.
    await api("/api/comments", {
      method: "POST",
      body: JSON.stringify({ surface: src.id, text: String(d.text), author: "surface" }),
    });
    toast("Added to this surface’s thread");
  } else if (d.type === "telemetry" && src) {
    // Learn-mode telemetry from a sandboxed explorable (showcase.emit). This is
    // agent-authored script talking, so the gate is strict: the event must
    // parse against the closed TelemetryEvent union AND be one of the sandbox-
    // allowlisted types (today: explorable_interaction only). Everything else
    // drops silently — checkpoint attempts can never be forged from a sandbox.
    // The server re-validates with sandbox:true, so this check can't be the
    // only line of defense either.
    if (isReadonly()) return;
    const event = validateTelemetryEvent((d as { event?: unknown }).event);
    if (!event || !SANDBOX_TELEMETRY_TYPES.includes(event.type)) return;
    postSandboxTelemetry(src.id, event);
  } else if (d.type === "open-link" && isOwnFrame(ev.source)) {
    // Only ever open real external links. The in-frame click handler forwards
    // just http(s) hrefs, but a surface can call openLink() directly (or post
    // this message raw) with any scheme — javascript:, data:, file: — so
    // re-check host-side, where it can't be bypassed. Parse once and act on the
    // parsed result: validate `protocol` and open the normalized `href` from the
    // same parse, so there's no gap between what we check and what window.open
    // re-parses (and a malformed string is rejected outright).
    let link: URL;
    try {
      link = new URL(String(d.url));
    } catch {
      return;
    }
    if (link.protocol !== "http:" && link.protocol !== "https:") return;
    if (confirm(`Open external link?\n\n${link.href}`))
      window.open(link.href, "_blank", "noopener");
  } else if (d.type === "copy" && isOwnFrame(ev.source)) {
    void navigator.clipboard?.writeText(String(d.text)).catch(() => {});
  } else if (d.type === "review-reviewed" && isOwnFrame(ev.source)) {
    // The overview kit ticked a manifest file reviewed (driven by the 'x' key);
    // confirm it with the running file burn-down count.
    const file = typeof d.file === "string" && d.file.trim() ? d.file.trim() : "file";
    toast(`Marked ${file} reviewed — ${d.done ?? 0}/${d.total ?? 0} files`);
  }
}

// True when `source` is the contentWindow of an iframe the viewer embedded
// (html or rich part). frameForSource only tracks html-part frames; this is the
// broader gate for messages rich-part frames also send (open-link). Identity
// comparison works across the opaque-origin boundary even though the frame's
// document is unreadable.
function isOwnFrame(source: unknown): boolean {
  for (const f of root().querySelectorAll("iframe")) {
    if (f.contentWindow === source) return true;
  }
  return false;
}
