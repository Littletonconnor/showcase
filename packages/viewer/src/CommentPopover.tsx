// The anchored-comment popover (plannotator-style): appears at the selection
// or clicked line, one at a time, and posts an author=user comment carrying
// the anchor. Fixed-positioned at the app root so it floats over sandboxed
// iframes; Escape or outside-click dismisses.
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquarePlus } from "lucide-react";
import { closeComposer, postAnchoredComment, useThreads } from "./threads.ts";

export function CommentPopover() {
  const target = useThreads((s) => s.composer);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Fresh composer per target; dismiss on Escape or outside pointer-down.
  useEffect(() => {
    setText("");
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeComposer();
    };
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) closeComposer();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [target]);

  if (!target) return null;

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const ok = await postAnchoredComment(target, trimmed);
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
      <textarea
        autoFocus
        value={text}
        disabled={sending}
        rows={2}
        placeholder="Comment for the agent…"
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
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10.5px] text-faint">Enter to send · Esc to dismiss</span>
        <Button size="sm" variant="outline" disabled={!text.trim() || sending} onClick={send}>
          Comment
        </Button>
      </div>
    </div>
  );
}
