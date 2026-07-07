// The conversation rail — the browser half of a LIVE back-and-forth with the
// agent, built entirely on the existing comment pipe (no new channel, no new
// wire type): user messages are session comments, agent replies are agent-
// authored comments, delivery receipts come from the same agentSeq cursor the
// threads use, and presence is the session's listening flag. This reverses
// the old "no in-app chat" stance deliberately (the owner asked for it): the
// heavyweight conversation still lives in the editor, but quick back-and-
// forth no longer requires alt-tabbing to a terminal.
//
// A floating dock, bottom-right: collapsed it is one pill with the live
// presence dot; expanded it shows the session's message stream (anchored
// comments carry their anchor as a context chip) and an always-ready
// composer. Telemetry and signal comments ([checkpoint]/[confused]/[plan])
// are pipe plumbing, not conversation — they stay hidden here.
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { api, isReadonly, exportBundle, relTime, type Comment } from "./api.ts";
import { cx } from "./cx.ts";
import { toast, useBoard } from "./state.ts";

const NOISE_RE = /^\[(checkpoint|confused|plan)\]/;

function anchorChip(c: Comment): string | null {
  const a = c.anchor;
  if (!a) return null;
  const loc = [
    a.file,
    a.line !== undefined ? `line ${a.line}` : null,
    a.step !== undefined ? `step ${a.step + 1}` : null,
    a.pos ? `at ${a.pos.x}%, ${a.pos.y}%` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const quote = a.quote ? `“${a.quote.length > 40 ? `${a.quote.slice(0, 39)}…` : a.quote}”` : "";
  return [loc, quote].filter(Boolean).join(" ") || null;
}

function Receipt(props: { comment: Comment; agentSeq: number }) {
  const seen = props.comment.seq <= props.agentSeq;
  return (
    <span
      data-delivery={seen ? "seen" : "sent"}
      title={seen ? "Seen by the agent" : "Sent; the agent picks it up on its next check-in"}
      className={cx("text-[10px]", seen ? "text-blue-500/80" : "text-faint")}
    >
      {seen ? "✓✓" : "✓"}
    </span>
  );
}

export function ConversationRail() {
  const selected = useBoard((s) => s.selected);
  const session = useBoard((s) => s.sessions.find((x) => x.id === s.selected));
  const comments = useBoard((s) => s.comments);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  // Messages seen while open — drives the collapsed pill's unread dot.
  const lastSeenSeq = useRef(0);
  const [unread, setUnread] = useState(false);

  const messages = useMemo(
    () =>
      comments
        .filter((c) => c.sessionId === selected && !NOISE_RE.test(c.text))
        .sort((a, b) => a.seq - b.seq),
    [comments, selected],
  );
  const agentSeq = (session as { agentSeq?: number } | undefined)?.agentSeq ?? 0;
  const listening = !!session?.listening;
  const latestSeq = messages.length > 0 ? messages[messages.length - 1].seq : 0;

  // Track unread agent messages while collapsed; opening clears them.
  useEffect(() => {
    if (open) {
      lastSeenSeq.current = latestSeq;
      setUnread(false);
      return;
    }
    const latest = messages[messages.length - 1];
    if (latest && latest.seq > lastSeenSeq.current && latest.author !== "user") setUnread(true);
  }, [open, latestSeq, messages]);

  // Keep the stream pinned to the newest message.
  useEffect(() => {
    if (!open) return;
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, latestSeq]);

  if (!selected || isReadonly() || exportBundle()) return null;

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await api("/api/comments", {
        method: "POST",
        body: JSON.stringify({ session: selected, text: trimmed }),
      });
      setText("");
    } catch {
      toast("Couldn't send the message");
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        data-conversation-pill
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full border-[0.5px] border-border bg-card px-3.5 py-2 text-[12.5px] font-medium text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-colors hover:bg-hover dark:shadow-[0_4px_16px_rgba(0,0,0,0.5)]"
      >
        <MessageCircle className="size-4 text-muted-foreground" />
        Chat
        <span
          data-presence={listening ? "listening" : "idle"}
          title={
            listening ? "The agent is listening now" : "The agent reads this on its next check-in"
          }
          className={cx(
            "size-2 rounded-full",
            listening ? "bg-emerald-500" : "bg-muted-foreground/40",
          )}
        />
        {unread ? (
          <span data-conversation-unread className="size-2 rounded-full bg-blue-500" />
        ) : null}
      </button>
    );
  }

  return (
    <div
      data-conversation-rail
      className="fixed right-5 bottom-5 z-40 flex max-h-[min(560px,70svh)] w-[360px] flex-col overflow-hidden rounded-xl border-[0.5px] border-border bg-card shadow-[0_8px_24px_rgba(0,0,0,0.16)] max-[700px]:right-2 max-[700px]:bottom-2 max-[700px]:w-[calc(100vw-1rem)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
    >
      <div className="flex items-center gap-2 border-b-[0.5px] border-border px-3.5 py-2.5">
        <MessageCircle className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-semibold text-foreground">Conversation</span>
        <span
          aria-live="polite"
          className={cx(
            "inline-flex items-center gap-1.5 text-[11px]",
            listening ? "text-emerald-600 dark:text-emerald-400" : "text-faint",
          )}
        >
          <span
            className={cx(
              "size-1.5 rounded-full",
              listening ? "bg-emerald-500" : "bg-muted-foreground/40",
            )}
          />
          {listening ? "agent listening" : "agent idle — delivered on its next check-in"}
        </span>
        <button
          type="button"
          aria-label="Close conversation"
          onClick={() => setOpen(false)}
          className="ml-auto rounded-md p-1 text-faint hover:bg-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div
        ref={streamRef}
        className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-3"
      >
        {messages.length === 0 ? (
          <p className="m-auto max-w-[26ch] text-center text-[12px] text-faint">
            Talk to the agent about this session — anchored notes from the cards land here too.
          </p>
        ) : (
          messages.map((c) => {
            const isUser = c.author === "user";
            const chip = anchorChip(c);
            return (
              <div
                key={c.id}
                data-conversation-message
                className={cx(
                  "flex max-w-[85%] flex-col gap-0.5",
                  isUser ? "self-end items-end" : "self-start",
                )}
              >
                {chip ? (
                  <span className="max-w-full truncate rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                    {chip}
                  </span>
                ) : null}
                <div
                  className={cx(
                    "rounded-xl px-3 py-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap",
                    isUser
                      ? "rounded-br-sm bg-blue-500/10 text-foreground"
                      : "rounded-bl-sm bg-muted text-foreground",
                  )}
                >
                  {c.text}
                </div>
                <span className="flex items-center gap-1 text-[10px] text-faint">
                  {isUser ? "you" : c.author} · {relTime(c.createdAt)}
                  {isUser ? <Receipt comment={c} agentSeq={agentSeq} /> : null}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-end gap-1.5 border-t-[0.5px] border-border px-3 py-2.5">
        <textarea
          value={text}
          disabled={sending}
          rows={1}
          placeholder="Message the agent…"
          aria-label="Message the agent"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-24 min-h-[30px] w-full flex-1 resize-none rounded-lg border-[0.5px] border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-faint focus:border-brand/40 focus:outline-none"
        />
        <button
          type="button"
          aria-label="Send message"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
          className="flex-none rounded-lg bg-blue-500 p-2 text-white transition-opacity disabled:opacity-40"
        >
          <Send className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
