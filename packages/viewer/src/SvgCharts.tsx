// The hand-rolled trusted-SVG review-depth charts: the shapes Recharts lacks
// (file minimap / heat-strip, co-change adjacency matrix, layered arc diagram).
// Like the Recharts path these are DATA rendered through React elements —
// every label is a text node, so agent-authored strings escape by construction
// and need no sandbox. Chart data caps are rendering caps, not validation: a
// too-big dataset renders its head plus an explicit "+N more" note, never a
// silent truncation.
import type { Mode } from "@showcase/core/themes";
import type { ChartPart as ChartPartData } from "./api.ts";
import { type ThemeColors, toneHue } from "./chartTheme.ts";

interface SvgChartProps {
  part: ChartPartData;
  colors: ThemeColors;
  mode: Mode;
}

const firstSeries = (part: ChartPartData): string => (Array.isArray(part.y) ? part.y[0] : part.y);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

function OverflowNote(props: { hidden: number; what: string }) {
  if (props.hidden <= 0) return null;
  return (
    <div className="px-2 pb-1 text-center text-[11px] text-faint">
      +{props.hidden} more {props.what} not shown
    </div>
  );
}

function Caption(props: { caption?: string }) {
  if (!props.caption) return null;
  return <div className="px-2 pt-1 pb-2 text-center text-[11px] text-faint">{props.caption}</div>;
}

// --- minimap / heat-strip -----------------------------------------------------
// One horizontal strip; each row is a segment whose width is proportional to
// its `y` value (e.g. lines changed) and whose color comes from its `tone`.
// The whole PR's footprint in one glance: where the change landed, how much of
// it is hot. Percent-based geometry so the strip fills the card at any width.
const MINIMAP_MAX = 60;

export function MinimapChart(props: SvgChartProps) {
  const { part, colors: c, mode } = props;
  const yKey = firstSeries(part);
  const rows = part.data
    .map((d) => ({ label: String(d[part.x] ?? ""), value: num(d[yKey]), tone: d.tone }))
    .filter((r) => r.value > 0)
    .slice(0, MINIMAP_MAX);
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total <= 0)
    return <div className="px-3.5 py-2.5 text-xs text-faint">No plottable minimap data.</div>;

  let offset = 0;
  const segments = rows.map((r) => {
    const w = (r.value / total) * 100;
    const seg = { ...r, left: offset, width: w };
    offset += w;
    return seg;
  });

  return (
    <div data-chart="minimap" className="px-3 pt-2">
      <svg width="100%" height="40" role="img" aria-label={part.caption ?? "File heat-strip"}>
        {segments.map((s, i) => (
          <g key={i}>
            <rect
              x={`${s.left}%`}
              y={4}
              width={`${s.width}%`}
              height={26}
              rx={2}
              fill={toneHue(mode, s.tone, c.accent)}
              fillOpacity={0.32}
              stroke={c.surface}
              strokeWidth={1}
            >
              <title>{`${s.label} — ${s.value}`}</title>
            </rect>
            <rect
              x={`${s.left}%`}
              y={26}
              width={`${s.width}%`}
              height={4}
              fill={toneHue(mode, s.tone, c.accent)}
            />
            {s.width > 12 ? (
              <text
                x={`${s.left + s.width / 2}%`}
                y={20}
                textAnchor="middle"
                fontSize={10.5}
                fill={c.text}
                style={{ pointerEvents: "none" }}
              >
                {s.label.length > Math.floor(s.width * 0.9)
                  ? `${s.label.slice(0, Math.max(1, Math.floor(s.width * 0.9) - 1))}…`
                  : s.label}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <OverflowNote hidden={part.data.length - rows.length} what="files" />
      <Caption caption={part.caption} />
    </div>
  );
}

// --- co-change adjacency matrix -----------------------------------------------
// Rows are `x` values, columns are `x2` values, cell intensity is the summed
// `y` value — which files move together, at a glance. Fixed cell geometry in a
// horizontally scrollable container so a wide matrix never squeezes illegibly.
const MATRIX_MAX = 32;
const CELL = 20;

export function MatrixChart(props: SvgChartProps) {
  const { part, colors: c, mode } = props;
  const yKey = firstSeries(part);
  const x2 = part.x2 ?? "";
  const rowLabels: string[] = [];
  const colLabels: string[] = [];
  const cells = new Map<string, { value: number; tone: unknown }>();
  for (const d of part.data) {
    const r = String(d[part.x] ?? "");
    const col = String(d[x2] ?? "");
    if (!r || !col) continue;
    if (!rowLabels.includes(r) && rowLabels.length < MATRIX_MAX) rowLabels.push(r);
    if (!colLabels.includes(col) && colLabels.length < MATRIX_MAX) colLabels.push(col);
    if (!rowLabels.includes(r) || !colLabels.includes(col)) continue;
    const key = `${r}\u0000${col}`;
    const prev = cells.get(key);
    cells.set(key, { value: (prev?.value ?? 0) + num(d[yKey]), tone: d.tone ?? prev?.tone });
  }
  if (rowLabels.length === 0 || colLabels.length === 0)
    return <div className="px-3.5 py-2.5 text-xs text-faint">No plottable matrix data.</div>;
  const max = Math.max(1, ...[...cells.values()].map((v) => v.value));

  const labelW = Math.min(170, Math.max(...rowLabels.map((l) => l.length)) * 6.4 + 12);
  const colH = Math.min(120, Math.max(...colLabels.map((l) => l.length)) * 5.4 + 14);
  const width = labelW + colLabels.length * CELL + 6;
  const height = colH + rowLabels.length * CELL + 6;
  const truncate = (l: string, budget: number) =>
    l.length > budget ? `…${l.slice(-(budget - 1))}` : l;

  return (
    <div data-chart="matrix" className="overflow-x-auto px-3 pt-2">
      <svg width={width} height={height} role="img" aria-label={part.caption ?? "Co-change matrix"}>
        {colLabels.map((l, j) => (
          <text
            key={`c${j}`}
            transform={`rotate(-55 ${labelW + j * CELL + CELL / 2} ${colH - 6})`}
            x={labelW + j * CELL + CELL / 2}
            y={colH - 6}
            fontSize={10}
            fill={c.muted}
          >
            {truncate(l, 22)}
          </text>
        ))}
        {rowLabels.map((l, i) => (
          <text
            key={`r${i}`}
            x={labelW - 6}
            y={colH + i * CELL + CELL / 2 + 3.5}
            textAnchor="end"
            fontSize={10}
            fill={c.muted}
          >
            {truncate(l, 26)}
          </text>
        ))}
        {rowLabels.map((r, i) =>
          colLabels.map((col, j) => {
            const cell = cells.get(`${r}\u0000${col}`);
            const v = cell?.value ?? 0;
            return (
              <rect
                key={`${i}-${j}`}
                x={labelW + j * CELL + 1}
                y={colH + i * CELL + 1}
                width={CELL - 2}
                height={CELL - 2}
                rx={2}
                fill={v > 0 ? toneHue(mode, cell?.tone, c.accent) : c.border}
                fillOpacity={v > 0 ? 0.18 + 0.72 * (v / max) : 0.18}
              >
                <title>{`${r} × ${col}: ${v}`}</title>
              </rect>
            );
          }),
        )}
      </svg>
      <OverflowNote
        hidden={
          new Set(part.data.map((d) => String(d[part.x] ?? ""))).size -
          rowLabels.length +
          (new Set(part.data.map((d) => String(d[x2] ?? ""))).size - colLabels.length)
        }
        what="rows/columns"
      />
      <Caption caption={part.caption} />
    </div>
  );
}

// --- layered arc diagram --------------------------------------------------------
// Nodes (the union of `x` and `x2` values, in first-appearance order) sit on a
// baseline; each row draws an arc from its `x` node to its `x2` node, stroke
// width scaled by `y` and colored by `tone`. Reads layered dependency flow —
// long arcs crossing many nodes are exactly the couplings worth a look.
const ARC_MAX_NODES = 28;
const ARC_W = 680;
const ARC_BASE = 150;
const ARC_LABEL_H = 76;

export function ArcChart(props: SvgChartProps) {
  const { part, colors: c, mode } = props;
  const yKey = firstSeries(part);
  const x2 = part.x2 ?? "";
  const nodes: string[] = [];
  const addNode = (v: unknown) => {
    const s = String(v ?? "");
    if (s && !nodes.includes(s) && nodes.length < ARC_MAX_NODES) nodes.push(s);
  };
  for (const d of part.data) {
    addNode(d[part.x]);
    addNode(d[x2]);
  }
  const edges = part.data
    .map((d) => ({
      from: nodes.indexOf(String(d[part.x] ?? "")),
      to: nodes.indexOf(String(d[x2] ?? "")),
      value: num(d[yKey]),
      tone: d.tone,
    }))
    .filter((e) => e.from >= 0 && e.to >= 0 && e.from !== e.to);
  if (nodes.length < 2 || edges.length === 0)
    return <div className="px-3.5 py-2.5 text-xs text-faint">No plottable arc data.</div>;
  const max = Math.max(1, ...edges.map((e) => e.value));

  const pad = 28;
  const nx = (i: number) => pad + (i * (ARC_W - 2 * pad)) / Math.max(1, nodes.length - 1);
  const height = ARC_BASE + ARC_LABEL_H;
  const skipped = part.data.length - edges.length;

  return (
    <div data-chart="arc" className="px-3 pt-2">
      <svg
        viewBox={`0 0 ${ARC_W} ${height}`}
        width="100%"
        role="img"
        aria-label={part.caption ?? "Arc diagram"}
      >
        <line x1={pad} y1={ARC_BASE} x2={ARC_W - pad} y2={ARC_BASE} stroke={c.border} />
        {edges.map((e, i) => {
          const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
          const x1 = nx(a);
          const xr = nx(b);
          const r = (xr - x1) / 2;
          const ry = Math.min(ARC_BASE - 10, r);
          return (
            <path
              key={i}
              d={`M ${x1} ${ARC_BASE} A ${r} ${ry} 0 0 1 ${xr} ${ARC_BASE}`}
              fill="none"
              stroke={toneHue(mode, e.tone, c.accent)}
              strokeOpacity={0.55}
              strokeWidth={1 + 2.5 * (e.value / max)}
              strokeLinecap="round"
            >
              <title>{`${nodes[e.from]} → ${nodes[e.to]}: ${e.value}`}</title>
            </path>
          );
        })}
        {nodes.map((n, i) => (
          <g key={n}>
            <circle cx={nx(i)} cy={ARC_BASE} r={3} fill={c.muted} />
            <text
              transform={`rotate(-42 ${nx(i)} ${ARC_BASE + 14})`}
              x={nx(i)}
              y={ARC_BASE + 14}
              textAnchor="end"
              fontSize={10}
              fill={c.muted}
            >
              {n.length > 24 ? `…${n.slice(-23)}` : n}
            </text>
          </g>
        ))}
      </svg>
      <OverflowNote hidden={skipped} what="rows (self-loops or overflow)" />
      <Caption caption={part.caption} />
    </div>
  );
}
