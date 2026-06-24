import { useMemo, useState } from "react";
import type { Surface, TraceStep } from "./api.ts";
import { Card } from "./Card.tsx";
import { cx } from "./cx.ts";
import { useBoard } from "./state.ts";

// Treatment E, refined (A → C). A left rail where only anchors get a node —
// user prompts and published surfaces. Each turn shows just its intent (first
// note) and outcome (last note); everything between — the middle notes AND the
// tool calls, in their real chronological order — folds into one "··· N steps
// ···" toggle. Expanding it reveals the work in order (a note, then the
// commands it triggered, then the next note), not an end-of-turn command dump.
// Steps are the real session trace (synced from the transcript) interleaved
// with surfaces by time.

interface Gap {
  surface: Surface | null; // the surface this gap leads into; null = trailing
  steps: TraceStep[];
}

function buildGaps(surfs: readonly Surface[], steps: readonly TraceStep[]): Gap[] {
  const gaps: Gap[] = surfs.map((s) => ({ surface: s, steps: [] }));
  gaps.push({ surface: null, steps: [] });
  const at = (s: Surface) => Date.parse(s.createdAt);
  for (const step of steps) {
    const t = step.ts ? Date.parse(step.ts) : NaN;
    let idx = gaps.length - 1; // default: trailing
    if (!Number.isNaN(t)) {
      const found = surfs.findIndex((s) => at(s) >= t);
      if (found >= 0) idx = found;
    }
    gaps[idx].steps.push(step);
  }
  return gaps;
}

// A turn: a prompt (or the lead-in before one) and its ordered events — the
// agent's notes and tool calls, kept in sequence so the fold can show them in
// the order they happened.
interface Turn {
  prompt: TraceStep | null;
  events: TraceStep[];
}

function groupTurns(steps: readonly TraceStep[]): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const ensure = () => {
    if (!cur) {
      cur = { prompt: null, events: [] };
      turns.push(cur);
    }
    return cur;
  };
  for (const s of steps) {
    if (s.kind === "prompt") {
      cur = { prompt: s, events: [] };
      turns.push(cur);
    } else {
      ensure().events.push(s);
    }
  }
  return turns;
}

export function SessionTimeline() {
  const surfaces = useBoard((s) => s.surfaces);
  const traceSteps = useBoard((s) => s.traceSteps);
  const streamLoading = useBoard((s) => s.streamLoading);
  const gaps = useMemo(() => buildGaps(surfaces, traceSteps), [surfaces, traceSteps]);
  const empty = !streamLoading && surfaces.length === 0 && traceSteps.length === 0;
  return (
    <div className="timeline">
      {empty ? <div className="empty">No surfaces in this session yet.</div> : null}
      {gaps.map((gap, gi) => (
        <div key={gap.surface ? gap.surface.id : `trailing-${gi}`} style={{ display: "contents" }}>
          {groupTurns(gap.steps).map((turn, ti) => (
            <TurnBlock turn={turn} key={ti} />
          ))}
          {gap.surface ? (
            <div className="tl-surface">
              <span className="tl-node"></span>
              <Card surface={gap.surface} />
            </div>
          ) : null}
        </div>
      ))}
      {surfaces.length > 0 || traceSteps.length > 0 ? (
        <div className="tl-row tl-tail">
          <div className="body">waiting for feedback…</div>
        </div>
      ) : null}
    </div>
  );
}

function TurnBlock(props: { turn: Turn }) {
  const events = props.turn.events;
  // first and last note positions; the work between them (and the tool calls)
  // collapse into the fold.
  const sayIdx = useMemo(
    () => events.reduce<number[]>((acc, e, i) => (e.kind === "say" ? (acc.push(i), acc) : acc), []),
    [events],
  );
  const intentIdx = sayIdx.length > 0 ? sayIdx[0] : -1;
  const outcomeIdx = sayIdx.length > 1 ? sayIdx[sayIdx.length - 1] : -1;
  const middle = useMemo(
    () => events.filter((_, i) => i !== intentIdx && i !== outcomeIdx),
    [events, intentIdx, outcomeIdx],
  );
  return (
    <>
      {props.turn.prompt ? <TextRow kind="prompt" step={props.turn.prompt} /> : null}
      {intentIdx >= 0 ? <TextRow kind="response" step={events[intentIdx]} /> : null}
      {middle.length > 0 ? <WorkFold steps={middle} /> : null}
      {outcomeIdx >= 0 ? <TextRow kind="response" step={events[outcomeIdx]} /> : null}
    </>
  );
}

// The middle of a turn — notes and tool calls in order — behind one toggle.
// Collapsed it's a quiet "··· N steps ···" line; expanded it lays the steps out
// in sequence (a note, then the commands under it, then the next note).
function WorkFold(props: { steps: TraceStep[] }) {
  const [open, setOpen] = useState(false);
  const n = props.steps.length;
  return (
    <>
      <div className="tl-row tl-notes-fold">
        <div className="body tl-clickable" onClick={() => setOpen(!open)}>
          {open ? `··· hide ${n} steps ···` : `··· ${n} steps ···`}
        </div>
      </div>
      {open
        ? props.steps.map((s, i) =>
            s.kind === "say" ? (
              <TextRow kind="response" step={s} key={i} />
            ) : (
              <CommandRow step={s} key={i} />
            ),
          )
        : null}
    </>
  );
}

// A prompt (with its rail node) or a response (no marker): first line, expanding
// to the full text on click.
function TextRow(props: { kind: "prompt" | "response"; step: TraceStep }) {
  const [open, setOpen] = useState(false);
  const detail = props.step.detail;
  const more = !!detail && detail !== props.step.label;
  return (
    <div className={`tl-row tl-${props.kind}`}>
      {props.kind === "prompt" ? <span className="tl-marker prompt"></span> : null}
      <div className="body">
        <div className={cx(more && "tl-clickable")} onClick={() => more && setOpen(!open)}>
          {props.step.label}
        </div>
        {open && more ? <pre className="tl-detail">{detail}</pre> : null}
      </div>
    </div>
  );
}

// One tool call inside an expanded fold: a faint mono line (kind + label),
// expanding to its input/result detail.
function CommandRow(props: { step: TraceStep }) {
  const [open, setOpen] = useState(false);
  const more = !!props.step.detail;
  return (
    <div className="tl-row tl-cmd-row">
      <div className="body">
        <div
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
          className={cx(more && "tl-clickable")}
          onClick={() => more && setOpen(!open)}
        >
          {props.step.kind ? <span className="knd">{props.step.kind}</span> : null}
          <span>{props.step.label}</span>
        </div>
        {open && more ? <pre className="tl-detail">{props.step.detail}</pre> : null}
      </div>
    </div>
  );
}
