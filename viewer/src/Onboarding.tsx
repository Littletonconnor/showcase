import { type ReactNode, useState } from "react";
import { ArrowRight, Check, Copy, X } from "lucide-react";
import { isReadonly } from "./api.ts";
import { useBoard } from "./state.ts";

const SETUP_SNIP = "curl -s http://localhost:8229/setup >> AGENTS.md";
const TRY_SNIP =
  "curl -s -X POST http://localhost:8229/api/snippets -H 'content-type: application/json' " +
  `-d '{"agent": "me", "title": "Hello", "html": "<h2>It works</h2>"}'`;

export function Onboard(props: { onConnect: () => void }) {
  const sessions = useBoard((s) => s.sessions);
  return (
    <div
      id="onboard"
      className="mx-auto max-w-[660px] px-7 py-[72px] max-[700px]:px-[18px] max-[700px]:py-10 [&_h1]:mt-0 [&_h1]:mb-1.5 [&_h1]:text-[21px] [&_h1]:font-medium [&_h2]:mt-[26px] [&_h2]:mb-2 [&_h2]:text-[13px] [&_h2]:font-medium [&_h2]:tracking-[0.02em] [&_h2]:text-muted-foreground [&_h2]:lowercase"
      hidden={sessions.length > 0}
    >
      {!isReadonly() ? (
        <>
          <h1>The show hasn&rsquo;t started yet</h1>
          <p className="mb-8 text-[14px] text-muted-foreground">
            showcase is a live surface where your coding agent draws diagrams, sketches, and code
            reviews while it works in your terminal — and your comments flow straight back to it.
          </p>
          {/* The hero is closing the loop: connect once so comments reach the
              agent automatically. The snippets below are the manual fallback. */}
          <h2>turn on auto-replies</h2>
          <p className="mb-3 text-[13px]/[1.55] text-muted-foreground">
            Install the showcase plugin once so your comments reach your agent on their own — no
            copy-pasting into your terminal, no re-arming a watcher.
          </p>
          <button
            className="group inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
            onClick={props.onConnect}
          >
            Connect Claude Code
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </button>
          <h2>or teach any agent</h2>
          <Snip text={SETUP_SNIP} />
          <h2>or try it yourself</h2>
          <Snip text={TRY_SNIP} />
        </>
      ) : (
        <>
          <h1>Nothing here yet</h1>
          <p className="mb-8 text-[14px] text-muted-foreground">
            This showcase board does not have any sessions yet.
          </p>
        </>
      )}
    </div>
  );
}

// Install instructions for the Claude Code plugin: a background monitor that
// streams the user's comments to the agent as notifications, plus the showcase
// MCP server. There is no browser→terminal handoff, so "connect" is two
// copy-paste commands, stated honestly.
const MARKETPLACE_CMD = "/plugin marketplace add modem-dev/showcase";
const INSTALL_CMD = "/plugin install showcase@showcase";

export function ConnectModal(props: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/[0.42] px-5 pt-[7vh] pb-5"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-[14px] border-[0.5px] border-border bg-background px-6 pt-[22px] pb-[26px] shadow-[0_16px_48px_rgba(0,0,0,0.35)] [&_code]:rounded [&_code]:bg-card [&_code]:px-[5px] [&_code]:py-px [&_code]:font-mono [&_code]:text-xs"
        role="dialog"
        aria-modal="true"
        aria-label="Connect Claude Code"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2.5 flex items-center">
          <h2 className="m-0 flex-1 text-[17px] font-semibold">Connect Claude Code</h2>
          <button
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-faint transition-colors hover:bg-hover hover:text-foreground"
            aria-label="Close"
            onClick={props.onClose}
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-[18px] text-sm/[1.55] text-muted-foreground">
          Install the showcase plugin so your comments reach the agent on their own. A background
          monitor streams each comment to Claude Code as a notification — no copy-pasting, no
          re-arming a watcher.
        </p>
        <ModalSection>1 · add the marketplace</ModalSection>
        <Snip text={MARKETPLACE_CMD} />
        <ModalSection>2 · install the plugin</ModalSection>
        <Snip text={INSTALL_CMD} />
        <p className="mt-3 text-[13px]/[1.55] text-muted-foreground">
          Run both inside Claude Code. On install it asks for your <strong>Showcase URL</strong>{" "}
          (default <code>http://localhost:8229</code>, or your deployed instance) and an optional
          token.
        </p>
        <ModalSection>what it runs</ModalSection>
        <p className="mt-3 text-[13px]/[1.55] text-muted-foreground">
          The plugin connects the showcase MCP server and runs <code>showcase watch</code> against
          your board as a background process — unsandboxed, the same trust level as hooks, with no
          per-comment prompt. Comments are delivered to the agent exactly once.
        </p>
        <p className="mt-[18px] border-t-[0.5px] border-border pt-3.5 text-[13px]/[1.55] text-faint">
          Requires Claude Code ≥ 2.1.105. It&rsquo;s two commands, not a true one-click — Claude
          Code has no browser-to-terminal handoff yet.
        </p>
      </div>
    </div>
  );
}

// The modal's lowercase section heading (was `.modal h3`).
function ModalSection(props: { children: ReactNode }) {
  return (
    <h3 className="mt-[18px] mb-2 text-xs font-medium tracking-[0.02em] text-muted-foreground lowercase">
      {props.children}
    </h3>
  );
}

function Snip(props: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded-[10px] border-[0.5px] border-border bg-card py-3 pr-11 pl-3.5 font-mono text-[12px]/[1.6] break-all whitespace-pre-wrap text-foreground">
      {props.text}
      <button
        className="absolute top-2 right-2 flex size-7 cursor-pointer items-center justify-center rounded-md border-[0.5px] border-border bg-background text-faint transition-colors hover:text-foreground"
        aria-label={copied ? "Copied" : "Copy"}
        title={copied ? "Copied" : "Copy"}
        onClick={() => {
          navigator.clipboard.writeText(props.text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="size-3.5 text-[#4caf78]" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
