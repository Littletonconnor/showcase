// The checkpoint part — learn mode's assessment unit, rendered ENTIRELY in the
// trusted origin from data (React text nodes; nothing agent-authored becomes
// markup, C1). The reveal is structurally gated: it does not enter the DOM
// until an attempt is committed, so "peek then answer" is impossible (P4/P8).
// Skipping records telemetry but shows NO reveal — skip is not a fast path to
// the answer (anti-goal: answer-dumping).
import { useMemo, useState } from "react";
import type { Checkpoint } from "@showcase/core/types";
import { Button } from "@/components/ui/button";
import { cx } from "./cx.ts";
import { isReadonly } from "./api.ts";
import { markAttempt, postTelemetry, useLearn } from "./learn.ts";

const KIND_LABEL: Record<Checkpoint["kind"], string> = {
  predict: "Predict",
  mcq: "Check",
  completion: "Complete",
  explain: "Explain back",
  trace: "Trace",
  apply: "Apply",
};

// Free-text kinds the agent grades (no options, no expected answer).
const AGENT_GRADED_NOTE =
  "Sent to your agent to grade; a substantive reply lands in the session shortly.";

// Whitespace/case-normalized exact match for client-graded free text (trace).
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// One line of calibration feedback from (confidence, correctness) — collected
// for exactly this line, never as a mastery signal (P3).
function calibrationLine(confidence: number, correct: boolean | undefined): string | null {
  if (correct === undefined) return null;
  const sure = confidence >= 0.7;
  const unsure = confidence <= 0.3;
  if (sure && !correct) {
    return "High confidence, incorrect: the most teachable moment. Your sense of knowing this was miscalibrated; the reveal below is worth a slow read.";
  }
  if (sure && correct) return "High confidence, correct: well calibrated here.";
  if (unsure && correct) {
    return "Low confidence, correct: you know this better than you think.";
  }
  if (unsure && !correct)
    return "Low confidence, incorrect: accurately calibrated; now close the gap.";
  return null;
}

// Prompt/reveal text renders as text nodes with `code` spans for backtick
// runs — data-to-text only, no HTML path.
function InlineText(props: { text: string; className?: string }) {
  const chunks = useMemo(() => props.text.split(/(`[^`]+`)/g), [props.text]);
  return (
    <span className={cx("whitespace-pre-wrap", props.className)}>
      {chunks.map((c, i) =>
        c.startsWith("`") && c.endsWith("`") && c.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
            {c.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{c}</span>
        ),
      )}
    </span>
  );
}

export function CheckpointPart(props: { surfaceId: string; checkpoint: Checkpoint }) {
  const cp = props.checkpoint;
  const attempt = useLearn((s) => s.attempts[cp.id]);
  const [freeText, setFreeText] = useState("");
  const [confidence, setConfidence] = useState(0.5);
  const [startedAt] = useState(() => Date.now());
  const readonly = isReadonly();

  const hasOptions = !!cp.options && cp.options.length > 0;
  const clientGraded = hasOptions || !!cp.expected;

  const commit = (
    answer: string | string[],
    correct: boolean | undefined,
    misconception?: string,
  ) => {
    const state = {
      answer,
      ...(correct !== undefined ? { correct } : {}),
      ...(cp.askConfidence ? { confidence } : {}),
    };
    markAttempt(cp.id, state);
    postTelemetry(props.surfaceId, {
      v: 1,
      type: "checkpoint_attempt",
      checkpointId: cp.id,
      conceptId: cp.conceptId,
      kind: cp.kind,
      answer,
      ...(correct !== undefined ? { correct } : {}),
      ...(misconception ? { misconception } : {}),
      ...(cp.askConfidence ? { confidence } : {}),
      latencyMs: Date.now() - startedAt,
    });
  };

  const skip = () => {
    markAttempt(cp.id, { answer: "", skipped: true });
    postTelemetry(props.surfaceId, {
      v: 1,
      type: "checkpoint_skipped",
      checkpointId: cp.id,
      conceptId: cp.conceptId,
    });
  };

  const chooseOption = (id: string) => {
    const chosen = cp.options!.find((o) => o.id === id);
    if (!chosen) return;
    commit([id], chosen.correct === true, chosen.misconception);
  };

  const submitFreeText = () => {
    const trimmed = freeText.trim();
    if (!trimmed) return;
    const correct = cp.expected ? norm(trimmed) === norm(cp.expected) : undefined;
    commit(trimmed, correct);
  };

  const attempted = !!attempt;
  const skipped = attempt?.skipped === true;
  const chosenIds = new Set(Array.isArray(attempt?.answer) ? attempt.answer : []);
  const calibration =
    attempt?.confidence !== undefined ? calibrationLine(attempt.confidence, attempt.correct) : null;

  return (
    <div
      className="border-t-[0.5px] border-border px-4 py-3"
      data-checkpoint={cp.id}
      data-attempted={attempted ? "true" : "false"}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="inline-flex flex-none items-center rounded-full bg-blue-500/10 px-2 py-[2px] text-[10.5px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:text-blue-300 dark:ring-blue-400/25">
          {KIND_LABEL[cp.kind] ?? cp.kind}
        </span>
        {attempted && !skipped ? (
          attempt!.correct === undefined ? (
            <span className="text-[11px] text-faint">answered</span>
          ) : attempt!.correct ? (
            <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              correct
            </span>
          ) : (
            <span className="text-[11px] font-medium text-red-600 dark:text-red-400">
              not quite
            </span>
          )
        ) : null}
        {skipped ? <span className="text-[11px] text-faint">skipped</span> : null}
      </div>

      <div className="text-[13.5px] leading-relaxed text-foreground">
        <InlineText text={cp.prompt} />
      </div>
      {cp.code ? (
        <pre className="mt-2 overflow-x-auto rounded-lg border-[0.5px] border-border bg-muted/40 px-3 py-2 font-mono text-[12px] leading-relaxed">
          {cp.code.code}
        </pre>
      ) : null}

      {/* --- the answering surface (pre-attempt only) --- */}
      {!attempted && !readonly ? (
        <div className="mt-2.5">
          {hasOptions ? (
            <div className="flex flex-col gap-1.5">
              {cp.options!.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => chooseOption(o.id)}
                  className="rounded-lg border-[0.5px] border-border bg-transparent px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:border-brand/40 hover:bg-muted/40"
                >
                  <InlineText text={o.label} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={freeText}
                onChange={(e) => setFreeText(e.target.value)}
                rows={cp.kind === "explain" || cp.kind === "apply" ? 4 : 2}
                placeholder={
                  cp.kind === "explain"
                    ? "Explain it in your own words, from memory, not by scrolling up…"
                    : "Your answer…"
                }
                spellCheck={false}
                className="w-full rounded-lg border-[0.5px] border-border bg-transparent px-3 py-2 text-[13px] text-foreground placeholder:text-faint focus:border-brand/40 focus:outline-none"
              />
            </div>
          )}
          {cp.askConfidence ? (
            <label className="mt-2 flex items-center gap-2 text-[11.5px] text-muted-foreground">
              How sure are you?
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(confidence * 100)}
                onChange={(e) => setConfidence(Number(e.target.value) / 100)}
                className="w-36 accent-blue-500"
              />
              <span className="tabular-nums">{Math.round(confidence * 100)}%</span>
            </label>
          ) : null}
          <div className="mt-2 flex items-center gap-2">
            {!hasOptions ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!freeText.trim()}
                onClick={submitFreeText}
              >
                Commit answer
              </Button>
            ) : null}
            <button
              type="button"
              onClick={skip}
              className="text-[11.5px] text-faint underline-offset-2 hover:text-muted-foreground hover:underline"
            >
              skip (no reveal; skips tell the agent to change approach)
            </button>
          </div>
        </div>
      ) : null}

      {/* --- post-attempt: the answer given, the reveal, calibration --- */}
      {attempted && !skipped ? (
        <div className="mt-2.5">
          {hasOptions ? (
            <div className="flex flex-col gap-1.5">
              {cp.options!.map((o) => {
                const chosen = chosenIds.has(o.id);
                const correct = o.correct === true;
                return (
                  <div
                    key={o.id}
                    className={cx(
                      "rounded-lg border-[0.5px] px-3 py-2 text-[13px]",
                      correct
                        ? "border-emerald-500/40 bg-emerald-500/8 text-emerald-800 dark:text-emerald-300"
                        : chosen
                          ? "border-red-500/40 bg-red-500/8 text-red-800 dark:text-red-300"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    <InlineText text={o.label} />
                    {chosen && !correct && o.misconception ? (
                      <div className="mt-1 text-[11.5px] text-red-700/80 dark:text-red-300/80">
                        The wrong model behind this pick: {o.misconception}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border-[0.5px] border-border bg-muted/30 px-3 py-2 text-[13px] text-foreground">
              <span className="mr-1.5 text-[11px] text-faint">your answer:</span>
              <InlineText
                text={Array.isArray(attempt!.answer) ? attempt!.answer.join(", ") : attempt!.answer}
              />
            </div>
          )}
          {calibration ? (
            <div className="mt-2 text-[11.5px] italic text-muted-foreground">{calibration}</div>
          ) : null}
          <div
            data-reveal
            className="mt-2 rounded-lg border-[0.5px] border-blue-500/25 bg-blue-500/5 px-3 py-2 text-[13px] leading-relaxed text-foreground"
          >
            <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wide text-blue-700/80 dark:text-blue-300/80">
              Resolution
            </span>
            <InlineText text={cp.reveal} />
            {!clientGraded ? (
              <div className="mt-1.5 text-[11.5px] text-faint">{AGENT_GRADED_NOTE}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The locked placeholder Card renders in place of an explorable's iframe until
// its gate checkpoint is attempted (predict-before-manipulate, P4/P7).
export function ExplorableLock(props: { gateId: string }) {
  return (
    <div
      data-explorable-locked={props.gateId}
      className="flex items-center gap-2 border-t-[0.5px] border-border bg-muted/20 px-4 py-6 text-[12.5px] text-muted-foreground"
    >
      <span aria-hidden>🔒</span>
      Commit a prediction above to unlock this interactive. Deciding what you expect first is what
      makes playing with it stick.
    </div>
  );
}
