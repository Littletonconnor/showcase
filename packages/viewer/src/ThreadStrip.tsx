// Anchored threads rendered in place, directly under the part they point at:
// the quoted anchor, the back-and-forth (user + agent), an inline reply line,
// and a local resolve toggle. Resolved threads collapse to one quiet row so a
// worked-through card ends clean.
import { useState } from "react";
import type { Comment } from "./api.ts";
import { relTime } from "./api.ts";
import { Button } from "@/components/ui/button";
import { Check, CheckCheck, CornerDownRight, RotateCcw } from "lucide-react";
import { cx } from "./cx.ts";
import { useBoard } from "./state.ts";
import { replyInThread, setResolved, type Thread } from "./threads.ts";

// Honest delivery state for the user's messages, from the server's own agent
// cursor: one check = persisted on the board; double check = the agent has
// actually CONSUMED it (its seq is behind session.agentSeq). No toasts — the
// message appearing in the thread is the send confirmation, and this glyph is
// the delivery receipt.
function DeliveryState(props: { comment: Comment }) {
  const agentSeq = useBoard(
    (s) => s.sessions.find((x) => x.id === props.comment.sessionId)?.agentSeq ?? 0,
  );
  const seen = props.comment.seq <= agentSeq;
  return (
    <span
      data-delivery={seen ? "seen" : "sent"}
      title={seen ? "Seen by the agent" : "Sent; the agent picks it up on its next check-in"}
      className={cx("flex-none", seen ? "text-blue-500/80" : "text-faint")}
    >
      {seen ? <CheckCheck className="size-3" /> : <Check className="size-3" />}
    </span>
  );
}

function anchorLabel(c: Comment): string {
  const a = c.anchor;
  if (!a) return "";
  return [
    a.file,
    a.line !== undefined ? `line ${a.line}` : null,
    a.step !== undefined ? `step ${a.step + 1}` : null,
    a.pos ? `at ${a.pos.x}%, ${a.pos.y}%` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

// A reviewer-proposed edit rendered as plain −/+ rows (text nodes, no markup).
function SuggestionRows(props: { suggestion: { before: string; after: string } }) {
  return (
    <div
      data-thread-suggestion
      className="my-1 overflow-hidden rounded-md border-[0.5px] border-border font-mono text-[11.5px]"
    >
      {props.suggestion.before.trim() ? (
        <div className="flex gap-1.5 bg-red-500/10 px-2 py-0.5 text-red-800 dark:text-red-300">
          <span className="flex-none select-none">−</span>
          <span className="min-w-0 whitespace-pre-wrap">{props.suggestion.before}</span>
        </div>
      ) : null}
      <div className="flex gap-1.5 bg-emerald-500/10 px-2 py-0.5 text-emerald-800 dark:text-emerald-300">
        <span className="flex-none select-none">+</span>
        <span className="min-w-0 whitespace-pre-wrap">{props.suggestion.after}</span>
      </div>
    </div>
  );
}

function Message(props: { comment: Comment }) {
  const c = props.comment;
  const isUser = c.author === "user";
  return (
    <div className="flex items-baseline gap-2" data-thread-message>
      <span
        className={cx(
          "flex-none text-[10.5px] font-semibold uppercase tracking-wide",
          isUser
            ? "text-blue-600/80 dark:text-blue-400/80"
            : "text-emerald-700/80 dark:text-emerald-400/80",
        )}
      >
        {isUser ? "you" : c.author}
      </span>
      <span className="min-w-0 text-[12.5px] leading-relaxed whitespace-pre-wrap text-foreground">
        {c.text}
      </span>
      <span className="ml-auto flex-none text-[10px] text-faint tabular-nums">
        {relTime(c.createdAt)}
      </span>
      {isUser ? <DeliveryState comment={c} /> : null}
    </div>
  );
}

function ThreadCard(props: { thread: Thread }) {
  const { root, replies } = props.thread;
  const [replyText, setReplyText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const resolved = root.resolved === true;
  const label = anchorLabel(root);

  if (resolved && !expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        data-thread-resolved
        className="flex w-full items-center gap-2 rounded-lg border-[0.5px] border-border/60 bg-muted/20 px-3 py-1.5 text-left text-[11.5px] text-faint transition-colors hover:bg-muted/40 hover:text-muted-foreground"
      >
        <Check className="size-3 flex-none text-emerald-600/70" />
        <span className="truncate">
          {root.anchor?.quote ? `“${root.anchor.quote}” — ` : label ? `${label} — ` : ""}
          {root.text}
        </span>
        <span className="ml-auto flex-none">resolved</span>
      </button>
    );
  }

  const send = async () => {
    const trimmed = replyText.trim();
    if (!trimmed) return;
    if (await replyInThread(root.id, trimmed)) setReplyText("");
  };

  return (
    <div
      data-thread
      className="rounded-lg border-[0.5px] border-blue-500/20 bg-blue-500/[0.04] px-3 py-2"
    >
      {(root.anchor?.quote || label) && (
        <div className="mb-1 flex min-w-0 items-center gap-1.5 border-l-2 border-blue-500/50 pl-2 text-[11px] text-muted-foreground">
          {label ? <span className="flex-none font-mono">{label}</span> : null}
          {root.anchor?.quote ? (
            <span className="truncate italic">“{root.anchor.quote}”</span>
          ) : null}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Message comment={root} />
        {root.suggestion ? <SuggestionRows suggestion={root.suggestion} /> : null}
        {replies.map((r) => (
          <div key={r.id} className="flex gap-1.5 pl-1">
            <CornerDownRight className="mt-1 size-3 flex-none text-faint" />
            <div className="min-w-0 flex-1">
              <Message comment={r} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          type="text"
          value={replyText}
          placeholder="Reply…"
          spellCheck={false}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          className="h-6.5 min-w-0 flex-1 rounded-md bg-transparent px-2 text-[12px] text-foreground placeholder:text-faint focus:bg-muted/40 focus:outline-none"
        />
        {/* Resolve only once there is a back-and-forth to conclude — a lone
            check beside a fresh question reads like a send button. */}
        {replies.length > 0 || resolved ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-faint hover:text-emerald-600"
            aria-label={resolved ? "Reopen thread" : "Resolve thread"}
            title={resolved ? "Reopen" : "Resolve — local, never sent to the agent"}
            onClick={() => void setResolved(root.id, !resolved)}
          >
            {resolved ? <RotateCcw /> : <Check />}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// The strip of threads under one part.
export function ThreadStrip(props: { threads: Thread[] }) {
  if (props.threads.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 border-t-[0.5px] border-border bg-muted/10 px-3.5 py-2">
      {props.threads.map((t) => (
        <ThreadCard key={t.root.id} thread={t} />
      ))}
    </div>
  );
}
