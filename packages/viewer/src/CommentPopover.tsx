// The anchored-comment popover (plannotator-style): appears at the selection
// or clicked line, one at a time, and posts an author=user comment carrying
// the anchor. Fixed-positioned at the app root so it floats over sandboxed
// iframes; Escape or outside-click dismisses.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus, Replace } from "lucide-react";
import { closeComposer, postAnchoredComment, useThreads } from "./threads.ts";

export function CommentPopover() {
  const target = useThreads((s) => s.composer);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Suggest-edit mode (plannotator's "suggest code"): available when the
  // anchor carries a quote — the quote is the `before`, the reviewer edits
  // the `after` in a monospace box, and both ride with the comment.
  const [suggesting, setSuggesting] = useState(false);
  const [after, setAfter] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  // Fresh composer per target; dismiss on Escape, outside pointer-down, or any
  // scroll — the popover is position-fixed, so scrolling would drift it away
  // from the selection/line it's anchored to.
  useEffect(() => {
    setText("");
    setSuggesting(false);
    setAfter(target?.quote ?? "");
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeComposer();
    };
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) closeComposer();
    };
    const onScroll = (e: Event) => {
      // Scrolling inside the popover itself (the textarea) is fine.
      if (boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return;
      closeComposer();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    // capture: scrolls inside nested scroll containers don't bubble.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [target]);

  if (!target) return null;

  // A suggestion can send with an empty note (the edit IS the message); a
  // plain comment still needs text.
  const suggestion =
    suggesting && after !== (target.quote ?? "")
      ? { before: target.quote ?? "", after }
      : undefined;
  const canSend = suggestion ? true : !!text.trim();

  const send = async () => {
    if (!canSend || sending) return;
    setSending(true);
    const ok = await postAnchoredComment(target, text.trim() || "(suggested edit)", suggestion);
    setSending(false);
    if (ok) closeComposer();
  };

  // Clamp into the viewport; prefer below the anchor point.
  const width = 340;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, target.x - width / 2));
  const top = Math.min(window.innerHeight - 170, target.y + 8);

  const where = [
    target.file,
    target.line !== undefined ? `line ${target.line}` : null,
    target.step !== undefined ? `step ${target.step + 1}` : null,
    target.pos ? `at ${target.pos.x}%, ${target.pos.y}%` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={boxRef}
      data-comment-popover
      style={{ position: "fixed", left, top, width, zIndex: 60 }}
      className="animate-in rounded-xl border-[0.5px] border-border bg-card p-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.12),0_12px_32px_rgba(0,0,0,0.14)] fade-in-0 zoom-in-95 dark:shadow-[0_4px_12px_rgba(0,0,0,0.5),0_12px_32px_rgba(0,0,0,0.5)]"
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MessageSquarePlus className="size-3.5 flex-none text-blue-500" />
        {where ? <span className="font-mono">{where}</span> : null}
        {target.quote ? (
          <span className="truncate italic">
            &ldquo;{target.quote.length > 60 ? target.quote.slice(0, 59) + "…" : target.quote}
            &rdquo;
          </span>
        ) : null}
      </div>
      {suggesting ? (
        <textarea
          data-suggest-after
          value={after}
          disabled={sending}
          rows={2}
          aria-label="Suggested replacement"
          spellCheck={false}
          onChange={(e) => setAfter(e.target.value)}
          className="mb-1.5 w-full resize-none rounded-lg border-[0.5px] border-emerald-500/40 bg-emerald-500/5 px-2.5 py-1.5 font-mono text-[12px] text-foreground focus:border-emerald-500/60 focus:outline-none"
        />
      ) : null}
      <textarea
        autoFocus
        value={text}
        disabled={sending}
        rows={2}
        placeholder={suggesting ? "Why this edit? (optional)" : "Comment for the agent…"}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        className="w-full resize-none rounded-lg border-[0.5px] border-border bg-transparent px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-faint focus:border-brand/40 focus:outline-none"
      />
      <div className="mt-1.5 flex items-center justify-between gap-2">
        {target.quote ? (
          <button
            type="button"
            data-suggest-toggle
            onClick={() => setSuggesting((v) => !v)}
            className={
              suggesting
                ? "inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                : "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground"
            }
          >
            <Replace className="size-3" />
            Suggest edit
          </button>
        ) : (
          <span className="text-[10.5px] text-faint">Enter to send · Esc to dismiss</span>
        )}
        <Button size="sm" variant="outline" disabled={!canSend || sending} onClick={send}>
          {sending ? "Sending…" : suggestion ? "Suggest" : "Comment"}
        </Button>
      </div>
    </div>
  );
}
