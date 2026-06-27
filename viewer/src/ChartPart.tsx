import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPart as ChartPartData } from "./api.ts";
import { type Mode, themeById } from "../../server/themes.ts";
import { useSurfaceTheme, useResolvedMode } from "./theme.ts";

// Tone → fixed hue for the review charts (treemap cells, scatter points). These
// match the diff/severity palette (sensitive=red, logic=amber, mechanical=gray)
// so the charts read with the rest of the review; an unknown tone falls back to
// the board accent. Tones are a closed set the server emits — never an
// agent-supplied color string — so there's nothing to sanitize.
const TONE_HUE: Record<string, string> = {
  sensitive: "#e03131",
  danger: "#e03131",
  logic: "#d9870a",
  warn: "#d9870a",
  mechanical: "#9aa0a6",
  cool: "#9aa0a6",
  normal: "#2f9e44",
};
const QUADRANT_TICKS = ["", "Low", "Med", "High"];

// Categorical series palette. The first series uses the board accent so a
// single-series chart matches the chrome; the rest are fixed hues chosen to read
// well on both light and dark surfaces. A multi-series or pie chart cycles
// through accent → these.
const REST_PALETTE = ["#e8590c", "#2f9e44", "#9c36b5", "#1098ad", "#e64980", "#f59f00"];

interface ThemeColors {
  text: string;
  muted: string;
  faint: string;
  border: string;
  surface: string;
  accent: string;
}

// Resolve chart colors from the SURFACE's theme (not the document root), so a
// chart on a themed surface — e.g. a data-viz preset pinned to `ocean` — uses
// that surface's palette instead of the board chrome's. Mirrors how the
// sandboxed parts pass themeById(surfaceTheme) into their frame; reading
// document.body here would always yield the board theme and ignore the override.
function readThemeColors(themeId: string, mode: Mode): ThemeColors {
  const p = mode === "dark" ? themeById(themeId).dark : themeById(themeId).light;
  return {
    text: p.text,
    muted: p.muted,
    faint: p.faint,
    border: p.border,
    surface: p.surface,
    accent: p.info.text,
  };
}

export function ChartPart(props: { part: ChartPartData }) {
  const activeTheme = useSurfaceTheme();
  const mode = useResolvedMode();
  // Sanitize useId for SVG fragment ids — React ids carry colons, which break a
  // url(#…) gradient reference.
  const gradId = useId().replace(/:/g, "");
  // Re-read tokens whenever the board theme or OS scheme flips so axes/grid/
  // tooltip stay in sync. applyTheme injects the vars before activeTheme
  // updates, so getComputedStyle already sees the new values.
  const c = useMemo(() => readThemeColors(activeTheme, mode), [activeTheme, mode]);

  const { part } = props;
  const series = Array.isArray(part.y) ? part.y : [part.y];
  // Explicit per-series/per-slice colors win; otherwise the first series uses the
  // board accent and the rest cycle the fixed palette.
  const colorFor = (i: number) =>
    part.colors?.[i] ?? (i === 0 ? c.accent : REST_PALETTE[(i - 1) % REST_PALETTE.length]);

  const axisProps = { tick: { fontSize: 11, fill: c.muted }, stroke: c.border, tickLine: false };
  const xLabel = part.xLabel
    ? {
        value: part.xLabel,
        position: "insideBottom" as const,
        offset: -12,
        fontSize: 11,
        fill: c.faint,
      }
    : undefined;
  const yLabel = part.yLabel
    ? {
        value: part.yLabel,
        angle: -90,
        position: "insideLeft" as const,
        fontSize: 11,
        fill: c.faint,
      }
    : undefined;
  const margin = { top: 8, right: 12, bottom: part.xLabel ? 22 : 6, left: part.yLabel ? 12 : 0 };

  const tooltip = (
    <Tooltip
      cursor={{ fill: c.faint, fillOpacity: 0.08 }}
      contentStyle={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        fontSize: 12,
        color: c.text,
        boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
      }}
      labelStyle={{ color: c.muted, marginBottom: 2 }}
      itemStyle={{ color: c.text }}
    />
  );
  const grid = <CartesianGrid stroke={c.border} strokeOpacity={0.5} vertical={false} />;

  // Treemap cell: a tinted rectangle (area = value) with a colored edge keyed to
  // the row's `tone`, labeled when it's big enough to read. Recharts clones this
  // with the laid-out node geometry (x/y/width/height) and the row's fields.
  const renderTreemapCell = (node: {
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    name?: string;
    tone?: string;
  }) => {
    const { x = 0, y = 0, width = 0, height = 0, name = "", tone } = node;
    if (width <= 0 || height <= 0) return <g />;
    const hue = TONE_HUE[String(tone ?? "")] ?? c.accent;
    const maxChars = Math.floor((width - 12) / 6.5);
    const label = name.length > maxChars ? `${name.slice(0, Math.max(1, maxChars - 1))}…` : name;
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill={hue}
          fillOpacity={0.18}
          stroke={c.surface}
          strokeWidth={1}
        />
        <rect x={x} y={y} width={Math.min(3, width)} height={height} fill={hue} />
        {width > 46 && height > 18 ? (
          <text x={x + 8} y={y + 15} fontSize={11} fill={c.text} style={{ pointerEvents: "none" }}>
            {label}
          </text>
        ) : null}
      </g>
    );
  };

  // Scatter (quadrant) tooltip: the point's label + its confidence/coverage band,
  // read from the hovered datum. A custom renderer because the generic axis
  // tooltip would show bare 1–3 numbers, not the Low/Med/High the axes use.
  const renderScatterTip = (tip: {
    active?: boolean;
    payload?: Array<{ payload?: Record<string, unknown> }>;
  }) => {
    if (!tip.active || !tip.payload?.length) return null;
    const row = tip.payload[0]?.payload ?? {};
    const label =
      typeof row.label === "string" ? row.label : typeof row.name === "string" ? row.name : "";
    const xv = Math.round(Number(row[part.x]));
    const yv = Math.round(Number(row[Array.isArray(part.y) ? part.y[0] : part.y]));
    return (
      <div
        style={{
          background: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          padding: "6px 9px",
          fontSize: 12,
          color: c.text,
          maxWidth: 240,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
        }}
      >
        {label ? <div style={{ marginBottom: 2 }}>{label}</div> : null}
        <div style={{ color: c.muted }}>
          {part.xLabel ?? "confidence"}: {QUADRANT_TICKS[xv] ?? xv} · {part.yLabel ?? "coverage"}:{" "}
          {QUADRANT_TICKS[yv] ?? yv}
        </div>
      </div>
    );
  };

  // Custom legend rendered below the chart (Recharts' built-in legend reverses
  // order and its `payload` prop isn't typed). For a pie the items are the data
  // categories; for a multi-series cartesian chart they're the series. A single
  // series needs no legend.
  const legendItems =
    part.chartType === "pie"
      ? part.data.map((d, i) => ({ label: String(d[part.x] ?? ""), color: colorFor(i) }))
      : series.length > 1
        ? series.map((s, i) => ({ label: s, color: colorFor(i) }))
        : [];

  const chart = () => {
    switch (part.chartType) {
      case "line":
        return (
          <LineChart data={part.data} margin={margin}>
            {grid}
            <XAxis dataKey={part.x} {...axisProps} label={xLabel} />
            <YAxis {...axisProps} width={44} label={yLabel} />
            {tooltip}
            {series.map((s, i) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={colorFor(i)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        );
      case "area":
        return (
          <AreaChart data={part.data} margin={margin}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s} id={`${gradId}-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colorFor(i)} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={colorFor(i)} stopOpacity={0.02} />
                </linearGradient>
              ))}
            </defs>
            {grid}
            <XAxis dataKey={part.x} {...axisProps} label={xLabel} />
            <YAxis {...axisProps} width={44} label={yLabel} />
            {tooltip}
            {series.map((s, i) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stroke={colorFor(i)}
                strokeWidth={2}
                fill={`url(#${gradId}-${i})`}
                stackId={part.stacked ? "s" : undefined}
              />
            ))}
          </AreaChart>
        );
      case "pie":
        return (
          <PieChart margin={margin}>
            {tooltip}
            <Pie
              data={part.data}
              dataKey={series[0]}
              nameKey={part.x}
              innerRadius="55%"
              outerRadius="80%"
              paddingAngle={2}
              stroke={c.surface}
              strokeWidth={2}
            >
              {part.data.map((_, i) => (
                <Cell key={i} fill={colorFor(i)} />
              ))}
            </Pie>
          </PieChart>
        );
      case "treemap":
        // Risk-weighted treemap (§8.1): area = the `y` value (e.g. churn), color
        // = the row's `tone` (sensitivity). The eye is pulled to the big hot
        // rectangle — attention routing as a visual reflex. The custom content
        // tints each cell from TONE_HUE and labels it when it's big enough to read.
        return (
          <Treemap
            data={part.data as never}
            dataKey={series[0]}
            nameKey={part.x}
            stroke={c.surface}
            isAnimationActive={false}
            content={renderTreemapCell as never}
          />
        );
      case "scatter": {
        // Confidence × coverage quadrant (§8.3): x = confidence, y = coverage,
        // both 1–3. The bottom-right (high confidence, low coverage) is the
        // danger zone — a confident change in unverified code — shaded so the eye
        // lands there. Points are tinted by `tone` (the server flags danger-zone
        // findings). Axes read Low/Med/High, not bare numbers.
        const yKey = series[0];
        return (
          <ScatterChart margin={{ top: 10, right: 16, bottom: part.xLabel ? 24 : 10, left: 4 }}>
            {grid}
            <ReferenceArea
              x1={2.5}
              x2={3.5}
              y1={0.5}
              y2={1.5}
              fill="#e03131"
              fillOpacity={0.08}
              stroke="none"
            />
            <ReferenceLine x={2} stroke={c.border} strokeDasharray="3 3" />
            <ReferenceLine y={2} stroke={c.border} strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey={part.x}
              domain={[0.5, 3.5]}
              ticks={[1, 2, 3]}
              tickFormatter={(v: number) => QUADRANT_TICKS[v] ?? ""}
              {...axisProps}
              label={xLabel}
            />
            <YAxis
              type="number"
              dataKey={yKey}
              domain={[0.5, 3.5]}
              ticks={[1, 2, 3]}
              tickFormatter={(v: number) => QUADRANT_TICKS[v] ?? ""}
              width={44}
              {...axisProps}
              label={yLabel}
            />
            <Tooltip
              cursor={{ stroke: c.faint, strokeOpacity: 0.2 }}
              content={renderScatterTip as never}
            />
            <Scatter data={part.data} fill={c.accent}>
              {part.data.map((d, i) => (
                <Cell key={i} fill={TONE_HUE[String(d.tone ?? "")] ?? c.accent} />
              ))}
            </Scatter>
          </ScatterChart>
        );
      }
      default:
        return (
          <BarChart data={part.data} margin={margin}>
            {grid}
            <XAxis dataKey={part.x} {...axisProps} label={xLabel} />
            <YAxis {...axisProps} width={44} label={yLabel} />
            {tooltip}
            {series.map((s, i) => (
              <Bar
                key={s}
                dataKey={s}
                fill={colorFor(i)}
                radius={[4, 4, 0, 0]}
                maxBarSize={48}
                stackId={part.stacked ? "s" : undefined}
              />
            ))}
          </BarChart>
        );
    }
  };

  return (
    <div className="border-t-[0.5px] border-border px-2 pt-3 pb-1">
      <div className="h-[260px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chart()}
        </ResponsiveContainer>
      </div>
      {legendItems.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-2 pt-2 text-[11px] text-muted-foreground">
          {legendItems.map((item) => (
            <span className="inline-flex items-center gap-1.5" key={item.label}>
              <span
                className="inline-block size-2.5 rounded-[2px]"
                style={{ background: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
      {part.caption ? (
        <div className="px-2 pt-1 pb-2 text-center text-[11px] text-faint">{part.caption}</div>
      ) : null}
    </div>
  );
}
