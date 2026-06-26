import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Code, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isReadonly, relTime } from "./api.ts";
import { cx } from "./cx.ts";
import {
  notifyComposing,
  sendComment,
  sessionRespondKey,
  toast,
  useBoard,
  useResponding,
  type ViewComment,
} from "./state.ts";

export function Thread(props: {
  surfaceId: string | null;
  // Set for the session-level chat (surfaceId null): scopes the responding
  // indicator to `session:<id>` instead of a surface.
  sessionId?: string;
  placeholder: string;
  send: (text: string) => Promise<string | null>;
  // When set, the composer is hidden behind a Comment action and the other
  // per-card actions (open/delete/…) share the footer toolbar. The bar sits on
  // the card surface, set off by a hairline divider and muted action styling,
  // so a user's comment never reads as part of the agent-rendered UI.
  collapsible?: boolean;
  readonly?: boolean;
  actions?: (startReply: () => void) => ReactNode;
  // Link/open/delete, shown under the persistent composer once a card has
  // messages — the chat input takes the footer, these recede beneath it.
  secondaryActions?: ReactNode;
}) {
  const [replying, setReplying] = useState(false);
  const comments = useBoard((s) => s.comments);
  const respondKey =
    props.surfaceId ?? (props.sessionId ? sessionRespondKey(props.sessionId) : null);
  const responding = useResponding(respondKey);
  const list = comments.filter((c) => c.surfaceId === props.surfaceId);
  const hasMessages = list.length > 0;
  // Heartbeat the agent's feedback wait while this composer is active, so
  // queueing a second message doesn't get cut off by the first.
  const onComposing = props.readonly
    ? undefined
    : () => notifyComposing({ session: props.sessionId, surface: props.surfaceId });
  // Once a card has a conversation, pin the composer at the bottom like a chat
  // input; an untouched card keeps it collapsed behind the Comment action so it
  // stays compact.
  const showComposer = !props.readonly && (hasMessages || replying);
  // Keep the newest message in view as the thread grows (a chat-input feel).
  const endRef = useRef<HTMLDivElement>(null);
  const count = list.length;
  useEffect(() => {
    if (count > 0 || responding)
      endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count, responding]);
  return (
    <div className="thread">
      {list.length || responding ? (
        <div className="flex flex-col border-t-[0.5px] border-border px-3.5 py-3">
          {list.map((c, i) => {
            // First message of a run from the same author wears the label +
            // timestamp; continuations stack tighter under it.
            const startsRun = i === 0 || list[i - 1].author !== c.author;
            return <CommentRow comment={c} startsRun={startsRun} key={c.id} />;
          })}
          {responding ? <TypingIndicator hasMessages={hasMessages} /> : null}
          <div ref={endRef} />
        </div>
      ) : null}
      {props.collapsible ? (
        <div className="border-t-[0.5px] border-border px-2.5 py-2">
          {showComposer ? (
            <div className="flex flex-col gap-1.5">
              <Composer
                placeholder={props.placeholder}
                send={props.send}
                autofocus={replying}
                onCancel={hasMessages ? undefined : () => setReplying(false)}
                onComposing={onComposing}
              />
              {hasMessages && props.secondaryActions ? (
                <div className="flex items-center justify-end gap-0.5">
                  {props.secondaryActions}
                </div>
              ) : null}
            </div>
          ) : (
            // Pin a min height so swapping the bar for the inline composer (when
            // you start the first comment) never pops the card above.
            <div className="flex min-h-[34px] items-center gap-0.5">
              {props.actions?.(() => setReplying(true))}
            </div>
          )}
        </div>
      ) : !props.readonly ? (
        <div className="border-t-[0.5px] border-border px-2.5 py-2">
          <Composer placeholder={props.placeholder} send={props.send} onComposing={onComposing} />
        </div>
      ) : null}
    </div>
  );
}

// The "agent is responding…" bubble — agent-aligned, three softly bouncing dots.
// Shown while we expect a reply (the user sent to a listening session); cleared
// when the reply lands or the responding timeout elapses.
function TypingIndicator(props: { hasMessages: boolean }) {
  return (
    <div
      className={cx(
        "cmt items-start flex flex-col",
        props.hasMessages ? "mt-3" : "mt-0",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
      )}
      aria-label="Agent is responding"
    >
      <div className="flex items-center gap-1 rounded-2xl bg-muted px-3 py-2.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-bounce rounded-full bg-foreground/40 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 0.15 - 0.3}s` }}
          />
        ))}
      </div>
    </div>
  );
}

// A prompt proposed by a surface's own UI (a sendPrompt() button — the
// drill-down loop). It is stamped author:"surface", never "user", so it can't
// reach the agent on its own (untrusted markup must not impersonate the user).
// This renders it as an explicit suggestion the user relays with one tap, which
// re-posts it as a genuine user message — closing the loop while keeping the
// trust boundary.
function SurfaceSuggestion(props: { comment: ViewComment; startsRun: boolean }) {
  const [sent, setSent] = useState(false);
  const relay = async () => {
    const sid = props.comment.surfaceId;
    if (!sid || sent) return;
    setSent(true);
    await sendComment(
      { surface: sid, text: props.comment.text, author: "user" },
      sid,
      props.comment.text,
    );
  };
  return (
    <div
      className={cx(
        "cmt flex flex-col items-start",
        props.startsRun ? "mt-3 first:mt-0" : "mt-0.5",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
      )}
      data-cid={props.comment.id}
    >
      <div className="max-w-[88%] rounded-2xl border border-dashed border-border bg-background px-3 py-2">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-faint">
          <Sparkles className="size-3" />
          Suggested by this surface
        </div>
        <div className="text-[13px] leading-snug break-words whitespace-pre-wrap text-foreground">
          {props.comment.text}
        </div>
        {!isReadonly() ? (
          <button
            type="button"
            disabled={sent}
            onClick={relay}
            className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {sent ? (
              <>
                <Check className="size-3" /> Sent
              </>
            ) : (
              <>
                <ArrowUp className="size-3" /> Send to agent
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CommentRow(props: { comment: ViewComment; startsRun: boolean }) {
  if (props.comment.author === "surface")
    return <SurfaceSuggestion comment={props.comment} startsRun={props.startsRun} />;
  const isUser = props.comment.author === "user";
  // `cmt` + `user` are oracle hooks (the e2e suite asserts `.thread .cmt.user`).
  // Sender is conveyed by alignment + colour — no label. The comment text is
  // plain text rendered as a React text node: it escapes by construction and
  // never becomes HTML, so it's the sanctioned non-iframe path for
  // agent-authored *data* and needs no sandbox. The timestamp is a hover title.
  return (
    <div
      className={cx(
        "cmt group/cmt flex flex-col",
        // Continuations within a run hug the previous bubble; a new run gets air.
        props.startsRun ? "mt-3 first:mt-0" : "mt-0.5",
        isUser ? "user items-end" : "items-start",
        // Pending bubbles pulse; settled ones get a quick one-shot enter. Both
        // yield to prefers-reduced-motion.
        props.comment.pending
          ? "animate-pulse opacity-60 motion-reduce:animate-none"
          : "animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
      )}
      data-cid={props.comment.id}
    >
      <div
        className={cx(
          "max-w-[88%] rounded-2xl px-3 py-1.5 text-[13px] leading-snug break-words whitespace-pre-wrap",
          // Sender by tone, not a saturated fill: the user gets a soft peach
          // (brand-subtle) bubble with coral text, the agent a warm-gray bubble —
          // distinct, but quieter and more Claude-like than a loud coral block.
          isUser ? "bg-brand-subtle text-brand" : "bg-muted text-foreground",
        )}
        title={relTime(props.comment.createdAt)}
      >
        {props.comment.anchor?.line != null ? (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold opacity-70">
            <Code className="size-3" /> Line {props.comment.anchor.line}
          </div>
        ) : null}
        {props.comment.text}
      </div>
    </div>
  );
}

function Composer(props: {
  placeholder: string;
  send: (text: string) => Promise<string | null>;
  autofocus?: boolean;
  onCancel?: () => void;
  // Fired on focus and on each keystroke so the thread can heartbeat "still
  // composing" to the server (it throttles), keeping a parked agent's feedback
  // batch open while the user queues more messages.
  onComposing?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Track emptiness so the send button can disable when there's nothing to post.
  const [empty, setEmpty] = useState(true);
  const send = async () => {
    const input = inputRef.current;
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    setEmpty(true);
    const error = await props.send(text);
    // on failure the text goes back in the input — never silently lost
    if (error !== null) {
      if (!input.value) input.value = text;
      setEmpty(false);
      input.focus();
      toast(`Couldn't post that comment — ${error}. It's back in the box.`);
    }
  };
  useEffect(() => {
    if (props.autofocus) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        ref={inputRef}
        placeholder={props.placeholder}
        aria-label="Comment"
        title="Press Enter to send"
        className="h-8 flex-1 rounded-lg text-[13px]"
        onFocus={() => props.onComposing?.()}
        onInput={(e) => {
          setEmpty(!e.currentTarget.value.trim());
          props.onComposing?.();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
          // Escape folds the composer back to the action bar — but only when
          // it's empty, so an in-progress reply can't be lost to a stray key.
          else if (e.key === "Escape" && !inputRef.current?.value && props.onCancel)
            props.onCancel();
        }}
      />
      {props.onCancel ? (
        <Button size="sm" variant="ghost" className="h-8" onClick={props.onCancel}>
          Cancel
        </Button>
      ) : null}
      <Button
        size="icon-sm"
        variant="default"
        className="size-8 flex-none rounded-lg"
        disabled={empty}
        aria-label="Send comment"
        title="Send (Enter)"
        onClick={send}
      >
        <ArrowUp className="size-4" />
      </Button>
    </div>
  );
}
