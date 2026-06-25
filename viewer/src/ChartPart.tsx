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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPart as ChartPartData } from "./api.ts";
import { useActiveTheme, useResolvedMode } from "./theme.ts";

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

// Read the live chrome tokens. Like MermaidPart, this part renders in the
// trusted origin, so getComputedStyle is fine; the values flip with light/dark.
function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--text", "#1f2328"),
    muted: v("--muted", "#59636e"),
    faint: v("--faint", "#818b98"),
    border: v("--border", "#d1d9e0"),
    surface: v("--surface", "#ffffff"),
    accent: v("--accent", "#0969da"),
  };
}

export function ChartPart(props: { part: ChartPartData }) {
  const activeTheme = useActiveTheme();
  const mode = useResolvedMode();
  // Sanitize useId for SVG fragment ids — React ids carry colons, which break a
  // url(#…) gradient reference.
  const gradId = useId().replace(/:/g, "");
  // Re-read tokens whenever the board theme or OS scheme flips so axes/grid/
  // tooltip stay in sync. applyTheme injects the vars before activeTheme
  // updates, so getComputedStyle already sees the new values.
  const c = useMemo(readThemeColors, [activeTheme, mode]);

  const { part } = props;
  const series = Array.isArray(part.y) ? part.y : [part.y];
  const colorFor = (i: number) =>
    i === 0 ? c.accent : REST_PALETTE[(i - 1) % REST_PALETTE.length];

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
