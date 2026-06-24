import { useEffect, useState } from "react";
import type { TracePart as TracePartData, TraceStep } from "./api.ts";
import { cx } from "./cx.ts";

// Render an agent trace as a step timeline the user can scan beside the surface.
// Steps may travel inline in the part, or live in an uploaded JSON/JSONL asset
// (assetId) — which we also offer for download. When only an assetId is given we
// fetch it and render it if it parses to an array of steps.
export function TracePart(props: { part: TracePartData }) {
  const [steps, setSteps] = useState<TraceStep[]>(props.part.steps ?? []);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if ((props.part.steps?.length ?? 0) > 0 || !props.part.assetId) return;
    void fetch(`/a/${props.part.assetId}`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => setSteps(parseTrace(text)))
      .catch(() => setNote("Trace file unavailable — it may have been evicted."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tracepart">
      <div className="trace-head">
        <span className="trace-title">{props.part.title ?? "Agent trace"}</span>
        {props.part.assetId ? (
          <a className="trace-dl" href={`/a/${props.part.assetId}`} target="_blank" rel="noopener">
            download ↓
          </a>
        ) : null}
      </div>
      {note ? <div className="asset-gone">{note}</div> : null}
      <ol className="trace-steps">
        {steps.map((step, i) => (
          <TraceRow step={step} key={i} />
        ))}
      </ol>
    </div>
  );
}

function TraceRow(props: { step: TraceStep }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!props.step.detail;
  return (
    <li className={cx("trace-step", open && "open")}>
      <div
        className={cx("trace-row", hasDetail && "clickable")}
        onClick={() => hasDetail && setOpen(!open)}
      >
        {props.step.kind ? <span className="trace-kind">{props.step.kind}</span> : null}
        <span className="trace-label">{props.step.label}</span>
        {props.step.ts ? <span className="trace-ts">{props.step.ts}</span> : null}
      </div>
      {hasDetail && open ? <pre className="trace-detail">{props.step.detail}</pre> : null}
    </li>
  );
}

// Accept a JSON array of steps, a single JSON object, or JSONL (one object per
// line). Anything missing a string `label` is dropped; a bare string line
// becomes a label-only step.
function parseTrace(text: string): TraceStep[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const toStep = (v: unknown): TraceStep | null => {
    if (typeof v === "string") return { label: v };
    if (v && typeof v === "object" && typeof (v as any).label === "string") {
      const o = v as any;
      return {
        label: o.label,
        ...(typeof o.kind === "string" && { kind: o.kind }),
        ...(typeof o.detail === "string" && { detail: o.detail }),
        ...(typeof o.ts === "string" && { ts: o.ts }),
      };
    }
    return null;
  };
  try {
    const parsed = JSON.parse(trimmed);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    return arr.map(toStep).filter((s): s is TraceStep => s !== null);
  } catch {
    // not a single JSON document — try JSONL
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return toStep(JSON.parse(line));
        } catch {
          return { label: line };
        }
      })
      .filter((s): s is TraceStep => s !== null);
  }
}
