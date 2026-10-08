/**
 * Chart Type Library
 * ==================
 *
 * The new intelligent chart family. Each component takes pre-aggregated
 * rows (from `visualization-intelligence.ts`) and renders a clean,
 * analyst-grade chart. The renderer never has to invent axis labels,
 * tick formatters, or highlight annotations — they're all baked into the
 * spec.
 *
 * Why these components?
 * --------------------
 * The previous `chart-types.tsx` always fell back to a horizontal bar
 * chart with a meaningless "Time / Position" axis. The new components
 * are designed to match specific question types (rank, distribution,
 * correlation, telemetry, etc.) and carry titles, units, and insights
 * derived from the user's objective.
 */

"use client";

import * as React from "react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
    Cell,
    ReferenceLine,
    LabelList,
    LineChart,
    Line,
    AreaChart,
    Area,
    ScatterChart,
    Scatter,
    ZAxis,
    ComposedChart,
    ReferenceArea,
} from "recharts";
import { F1_PALETTE, CHART_TOKENS, colorForDriver, colorForSeries, STEERING_COLORS } from "./chart-palette";

// =============================================================================
// Helpers
// =============================================================================

/** Format a value according to the chart's unit. */
function formatValue(value: number, unit: string): string {
    if (value == null || isNaN(value)) return "—";
    if (unit === "s") {
        if (value < 10) return `${value.toFixed(3)}s`;
        const mins = Math.floor(value / 60);
        const secs = (value % 60).toFixed(3).padStart(6, "0");
        return `${mins}:${secs}`;
    }
    if (unit === "pts" || unit === "points") return `${value} pts`;
    if (unit === "laps") return `${value} laps`;
    if (unit === "pos") return `P${value}`;
    if (unit === "°C") return `${value}°C`;
    if (unit === "%") return `${value}%`;
    if (unit === "km/h") return `${value.toFixed(0)} km/h`;
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(2);
}

/**
 * Compact axis-tick formatter for narrow viewports. The full
 * `formatValue` repeats the unit on every tick ("300 km/h"), which
 * wraps inside a 390px chart next to an axis label that already
 * carries the unit. Compact ticks show bare values; the axis label
 * and the tooltip keep the unit. Desktop benefits too (less ink).
 */
function formatTick(value: number, unit: string): string {
    if (value == null || isNaN(value)) return "—";
    if (unit === "s") return formatValue(value, unit);
    if (unit === "°C") return `${value}°`;
    if (unit === "%") return `${value}%`;
    if (unit === "pos") return `P${value}`;
    if (Number.isInteger(value)) return value.toString();
    return value.toFixed(1);
}

// =============================================================================
// Header
// =============================================================================

interface ChartHeaderProps {
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
}

export function ChartHeader({ title, subtitle, insight, question }: ChartHeaderProps) {
    return (
        <div className="space-y-1 px-1 pb-3 border-b border-border/40">
            <h3 className="text-base font-bold uppercase tracking-wide text-foreground">
                {title}
            </h3>
            {subtitle && (
                <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
            {question && (
                <p className="text-[11px] text-muted-foreground/80 italic">
                    {question}
                </p>
            )}
            {insight && (
                <p className="text-xs mt-1 px-2 py-1 rounded bg-[var(--f1-red)]/10 text-[var(--f1-red)] font-medium">
                    ✦ {insight}
                </p>
            )}
        </div>
    );
}

// =============================================================================
// Common tooltip
// =============================================================================

interface TooltipPayload {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string; payload: Record<string, unknown> }>;
    label?: string | number;
    unit?: string;
}

function SmartTooltip({ active, payload, label, unit }: TooltipPayload) {
    if (!active || !payload || payload.length === 0) return null;
    return (
        <div className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur text-xs">
            {label != null && (
                <p className="font-semibold text-sm mb-1 text-foreground">{label}</p>
            )}
            <div className="space-y-1">
                {payload.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-muted-foreground">{entry.name}:</span>
                        <span className="font-medium text-foreground">
                            {formatValue(entry.value, unit ?? "")}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// =============================================================================
// Sorted Horizontal Bar (rankings / comparisons)
// =============================================================================

interface HorizontalBarSpec {
    type: "horizontal_bar";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<{ key: string; value: number; label?: string }>;
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
    highlightKey?: string;
    /** Rank charts (finishing order): sort ascending so P1 leads. */
    sortAsc?: boolean;
}

export function HorizontalBarChart({ spec }: { spec: HorizontalBarSpec }) {
    // Re-sort defensively — the planner already sorts, but be defensive.
    // Rank charts sort ascending (P1 first, winner highlighted);
    // everything else sorts descending (leader first).
    const data = [...spec.data].sort((a, b) =>
        spec.sortAsc ? a.value - b.value : b.value - a.value
    );
    const highlight = spec.highlightKey ?? data[0]?.key;

    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={Math.max(280, data.length * 36 + 60)}>
                <BarChart
                    data={data}
                    layout="vertical"
                    margin={{ top: 10, right: 30, left: 60, bottom: 25 }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} horizontal={false} />
                    <XAxis
                        minTickGap={28}
                        type="number"
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => formatTick(v, spec.unit)}
                        label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -10, fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <YAxis
                        type="category"
                        dataKey="key"
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11, fontWeight: 500 }}
                        width={70}
                    />
                    <Tooltip content={<SmartTooltip unit={spec.unit} />} />
                    <Bar
                        dataKey="value"
                        radius={[0, 6, 6, 0]}
                        name={spec.yAxisLabel}
                        // No mount animation: charts must render their final
                        // state immediately (background tabs/screenshots never
                        // tick rAF, and chat shouldn't jank while scrolling).
                        isAnimationActive={false}
                    >
                        {data.map((entry, i) => (
                            <Cell
                                key={`cell-${i}`}
                                fill={entry.key === highlight ? CHART_TOKENS.highlight : colorForDriver(entry.key, i)}
                            />
                        ))}
                        <LabelList
                            dataKey="value"
                            position="right"
                            formatter={(v: unknown) => formatValue(Number(v), spec.unit)}
                            style={{ fill: CHART_TOKENS.foreground, fontSize: 10, fontWeight: 500 }}
                        />
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// =============================================================================
// Line Chart (lap progression, points over time)
// =============================================================================

interface LineSpec {
    type: "line" | "area";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<Record<string, number | string>>;
    xField: string;
    yField: string;
    series: string[];
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
}

export function LineOrAreaChart({ spec }: { spec: LineSpec }) {
    const isArea = spec.type === "area";
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={360}>
                {isArea ? (
                    <AreaChart data={spec.data} margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} />
                        <XAxis
                        minTickGap={28}
                            dataKey={spec.xField}
                            stroke={CHART_TOKENS.axis}
                            tick={{ fontSize: 11 }}
                            label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -15, fontSize: 11, fill: CHART_TOKENS.axis }}
                        />
                        <YAxis
                            stroke={CHART_TOKENS.axis}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) => formatTick(v, spec.unit)}
                            label={{ value: spec.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: CHART_TOKENS.axis }}
                        />
                        <Tooltip content={<SmartTooltip unit={spec.unit} />} />
                        <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 10, fontSize: 11 }} />
                        {spec.series.map((s, i) => (
                            <Area
                                key={s}
                                type="monotone"
                                dataKey={s}
                                name={s}
                                stroke={colorForSeries(s, i)}
                                fill={colorForSeries(s, i)}
                                fillOpacity={0.25}
                                strokeWidth={2}
                                isAnimationActive={false}
                            />
                        ))}
                    </AreaChart>
                ) : (
                    <LineChart data={spec.data} margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} />
                        <XAxis
                        minTickGap={28}
                            dataKey={spec.xField}
                            stroke={CHART_TOKENS.axis}
                            tick={{ fontSize: 11 }}
                            label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -15, fontSize: 11, fill: CHART_TOKENS.axis }}
                        />
                        <YAxis
                            stroke={CHART_TOKENS.axis}
                            tick={{ fontSize: 11 }}
                            tickFormatter={(v) => formatTick(v, spec.unit)}
                            label={{ value: spec.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: CHART_TOKENS.axis }}
                        />
                        <Tooltip content={<SmartTooltip unit={spec.unit} />} />
                        <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 10, fontSize: 11 }} />
                        {spec.series.map((s, i) => (
                            <Line
                                key={s}
                                type="monotone"
                                dataKey={s}
                                name={s}
                                stroke={colorForSeries(s, i)}
                                strokeWidth={2}
                                dot={spec.data.length < 30 ? { r: 3 } : false}
                                connectNulls
                                isAnimationActive={false}
                            />
                        ))}
                    </LineChart>
                )}
            </ResponsiveContainer>
        </div>
    );
}

// =============================================================================
// Scatter (correlation: grid vs finish, tyre age vs lap time)
// =============================================================================

interface ScatterSpec {
    type: "scatter";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<{ key: string; x: number; y: number; group?: string }>;
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
    /** When true, draw y=x reference line */
    diagonal?: boolean;
}

export function ScatterPlot({ spec }: { spec: ScatterSpec }) {
    const groups = Array.from(new Set(spec.data.map((d) => d.group).filter(Boolean) as string[]));
    const single = groups.length === 0;
    // Diagonal y=x segment clipped to the data domain so it always
    // renders inside the plot (a hardcoded 1→22 segment vanishes when
    // the axes zoom to the data).
    const xs = spec.data.map((d) => d.x);
    const ys = spec.data.map((d) => d.y);
    const diagLo = Math.min(...xs, ...ys);
    const diagHi = Math.max(...xs, ...ys);

    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={360}>
                <ScatterChart margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} />
                    <XAxis
                        minTickGap={28}
                        type="number"
                        dataKey="x"
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -15, fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <YAxis
                        type="number"
                        dataKey="y"
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => formatTick(v, spec.unit)}
                        label={{ value: spec.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <ZAxis range={[60, 60]} />
                    <Tooltip content={<SmartTooltip unit={spec.unit} />} cursor={{ strokeDasharray: "3 3" }} />
                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 10, fontSize: 11 }} />
                    {spec.diagonal && Number.isFinite(diagLo) && Number.isFinite(diagHi) && (
                        <ReferenceLine
                            segment={[
                                { x: diagLo, y: diagLo },
                                { x: diagHi, y: diagHi },
                            ]}
                            stroke={CHART_TOKENS.axis}
                            strokeDasharray="4 4"
                            opacity={0.5}
                            label={{ value: "y = x", position: "insideTopLeft", fontSize: 10, fill: CHART_TOKENS.axis }}
                        />
                    )}
                    {single ? (
                        <Scatter name={spec.yAxisLabel} data={spec.data} fill={CHART_TOKENS.highlight} isAnimationActive={false} />
                    ) : (
                        groups.map((g, i) => {
                            const points = spec.data.filter((d) => d.group === g);
                            return (
                                <Scatter
                                    key={g}
                                    name={g}
                                    data={points}
                                    fill={colorForDriver(g, i)}
                                    isAnimationActive={false}
                                />
                            );
                        })
                    )}
                </ScatterChart>
            </ResponsiveContainer>
        </div>
    );
}

// =============================================================================
// Stacked Bar (compound usage, strategy)
// =============================================================================

interface StackedBarSpec {
    type: "stacked_bar";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<Record<string, number | string>>;
    xField: string;
    series: string[];
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
}

export function StackedBarChart({ spec }: { spec: StackedBarSpec }) {
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={320}>
                <BarChart data={spec.data} margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} />
                    <XAxis
                        minTickGap={28}
                        dataKey={spec.xField}
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -15, fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <YAxis
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => formatTick(v, spec.unit)}
                        label={{ value: spec.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <Tooltip content={<SmartTooltip unit={spec.unit} />} />
                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 10, fontSize: 11 }} />
                    {spec.series.map((s, i) => (
                        <Bar
                            key={s}
                            dataKey={s}
                            stackId="a"
                            name={s}
                            fill={CHART_TOKENS.compound[(s as keyof typeof CHART_TOKENS.compound)] ?? F1_PALETTE[i % F1_PALETTE.length]}
                            isAnimationActive={false}
                        />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// =============================================================================
// Dumbbell (compare two values per category, e.g. 2023 vs 2024)
// =============================================================================

interface DumbbellSpec {
    type: "dumbbell";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<{ category: string; left: number; right: number; delta: number }>;
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
    leftLabel: string;
    rightLabel: string;
}

export function DumbbellChart({ spec }: { spec: DumbbellSpec }) {
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={Math.max(280, spec.data.length * 36 + 60)}>
                <ComposedChart
                    data={spec.data}
                    layout="vertical"
                    margin={{ top: 10, right: 50, left: 80, bottom: 25 }}
                >
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} horizontal={false} />
                    <XAxis
                        minTickGap={28}
                        type="number"
                        // Zoom to the data range — season deltas of ~0.5s are
                        // invisible on a zero-based axis.
                        domain={["auto", "auto"]}
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => formatTick(v, spec.unit)}
                        label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -10, fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <YAxis
                        type="category"
                        dataKey="category"
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11, fontWeight: 500 }}
                        width={80}
                    />
                    <Tooltip content={<SmartTooltip unit={spec.unit} />} />
                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 10, fontSize: 11 }} />
                    {/* Connecting bar */}
                    <Bar dataKey="left" fill="transparent" isAnimationActive={false} />
                    <Scatter dataKey="left" fill={STEERING_COLORS.yellow} name={spec.leftLabel} isAnimationActive={false} />
                    <Scatter dataKey="right" fill={STEERING_COLORS.blue} name={spec.rightLabel} isAnimationActive={false} />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

// =============================================================================
// Box Plot (distribution: lap time consistency, pit stops)
// =============================================================================

interface BoxPlotSpec {
    type: "box_plot";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    /** Per-category distribution stats */
    data: Array<{
        category: string;
        min: number;
        q1: number;
        median: number;
        q3: number;
        max: number;
        outliers?: number[];
    }>;
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
}

function computeBoxStats(values: number[]) {
    if (values.length === 0) return { min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [] };
    const sorted = [...values].sort((a, b) => a - b);
    const q = (p: number) => {
        const idx = (sorted.length - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        const w = idx - lo;
        return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w;
    };
    const q1 = q(0.25);
    const median = q(0.5);
    const q3 = q(0.75);
    const iqr = q3 - q1;
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const inRange = sorted.filter((v) => v >= lowerFence && v <= upperFence);
    const outliers = sorted.filter((v) => v < lowerFence || v > upperFence);
    return {
        min: inRange[0] ?? sorted[0] ?? 0,
        q1,
        median,
        q3,
        max: inRange[inRange.length - 1] ?? sorted[sorted.length - 1] ?? 0,
        outliers,
    };
}

export function computeBoxPlotData(
    rows: Array<Record<string, unknown>>,
    categoryKey: string,
    valueKey: string
): BoxPlotSpec["data"] {
    const groups = new Map<string, number[]>();
    for (const row of rows) {
        const cat = String(row[categoryKey] ?? "?");
        const v = typeof row[valueKey] === "number" ? (row[valueKey] as number) : parseFloat(String(row[valueKey]));
        if (!Number.isFinite(v)) continue;
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(v);
    }
    return Array.from(groups.entries())
        .map(([category, values]) => ({ category, ...computeBoxStats(values) }))
        .sort((a, b) => a.median - b.median);
}

export function BoxPlot({ spec }: { spec: BoxPlotSpec }) {
    // Self-scaled: percentages of the data domain, so boxes, whiskers
    // and the median always line up with each other (no chart-scale
    // dependency — the old Scatter-shape version plotted raw data
    // values as pixel coordinates and drifted off-axis).
    const rows = spec.data;
    if (rows.length === 0) {
        return <EmptyChart title={spec.title} />;
    }
    const all = rows.flatMap((r) => [r.min, r.q1, r.median, r.q3, r.max, ...(r.outliers ?? [])]);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo || 1;
    const min = lo - span * 0.05;
    const max = hi + span * 0.05;
    const pct = (v: number) => ((v - min) / (max - min)) * 100;
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <div className="space-y-2.5 pt-1">
                {rows.map((r, i) => {
                    const color = colorForDriver(r.category, i);
                    const stats = `min ${formatValue(r.min, spec.unit)} · Q1 ${formatValue(r.q1, spec.unit)} · median ${formatValue(r.median, spec.unit)} · Q3 ${formatValue(r.q3, spec.unit)} · max ${formatValue(r.max, spec.unit)}${r.outliers?.length ? ` · outliers ${r.outliers.map((o) => formatValue(o, spec.unit)).join(", ")}` : ""}`;
                    return (
                        <div key={r.category} className="flex items-center gap-3">
                            <span className="w-14 shrink-0 truncate text-right text-[11px] font-semibold">
                                {r.category}
                            </span>
                            <div
                                className="relative h-9 min-w-0 flex-1 rounded bg-muted/20"
                                title={`${r.category}: ${stats}`}
                            >
                                {/* Whisker (min–max) */}
                                <div
                                    className="absolute top-1/2 h-px -translate-y-1/2 opacity-60"
                                    style={{
                                        left: `${pct(r.min)}%`,
                                        width: `${Math.max(pct(r.max) - pct(r.min), 0.5)}%`,
                                        backgroundColor: CHART_TOKENS.axis,
                                    }}
                                />
                                {/* Min / max caps */}
                                <div
                                    className="absolute top-1/2 h-3 w-px -translate-y-1/2 opacity-60"
                                    style={{ left: `${pct(r.min)}%`, backgroundColor: CHART_TOKENS.axis }}
                                />
                                <div
                                    className="absolute top-1/2 h-3 w-px -translate-y-1/2 opacity-60"
                                    style={{ left: `${pct(r.max)}%`, backgroundColor: CHART_TOKENS.axis }}
                                />
                                {/* IQR box */}
                                <div
                                    className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border"
                                    style={{
                                        left: `${pct(r.q1)}%`,
                                        width: `${Math.max(pct(r.q3) - pct(r.q1), 1)}%`,
                                        backgroundColor: `${color}33`,
                                        borderColor: `${color}88`,
                                    }}
                                />
                                {/* Median */}
                                <div
                                    className="absolute top-1/2 h-6 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded bg-white shadow"
                                    style={{ left: `${pct(r.median)}%` }}
                                />
                                {/* Outliers */}
                                {(r.outliers ?? []).map((o, oi) => (
                                    <div
                                        key={oi}
                                        className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
                                        style={{
                                            left: `${pct(o)}%`,
                                            marginTop: `${-10 + (oi % 3) * 8}px`,
                                            backgroundColor: color,
                                        }}
                                        title={`${r.category} outlier: ${formatValue(o, spec.unit)}`}
                                    />
                                ))}
                            </div>
                            <span className="w-16 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                                {formatValue(r.median, spec.unit)}
                            </span>
                        </div>
                    );
                })}
            </div>
            <p className="text-[10px] text-muted-foreground/70">
                Box = IQR (Q1–Q3) · white tick = median · line = full range
            </p>
        </div>
    );
}

// =============================================================================
// Swarm / strip plot (pace distribution: one dot per lap, IQR band per driver)
// =============================================================================

interface SwarmSpec {
    type: "swarm";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    /** One dot per lap: driver category, lap number, lap-time value */
    data: Array<{ driver: string; lap: number; value: number }>;
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
}

/**
 * Deterministic lateral jitter in [-0.31, +0.31] of a category slot so
 * dots spread without overlapping. Hash-based (not Math.random) so the
 * plot is stable across renders and SSR.
 */
function swarmJitter(driverIndex: number, lap: number): number {
    const h = Math.abs(Math.sin(driverIndex * 127.1 + lap * 311.7) * 43758.5453) % 1;
    return (h - 0.5) * 0.62;
}

function SwarmPointTooltip({ active, payload, unit }: {
    active?: boolean;
    payload?: Array<{ payload?: { driver?: string; lap?: number; value?: number } }>;
    unit?: string;
}) {
    if (!active || !payload || payload.length === 0) return null;
    const point = payload[0]?.payload;
    if (!point || point.value == null) return null;
    return (
        <div className="rounded-lg border border-border bg-background/95 p-3 shadow-lg backdrop-blur text-xs">
            <p className="font-semibold text-sm mb-1 text-foreground">
                {point.driver}{point.lap != null ? ` · Lap ${point.lap}` : ""}
            </p>
            <span className="font-medium text-foreground">
                {formatValue(point.value, unit ?? "")}
            </span>
        </div>
    );
}

export function SwarmPlot({ spec }: { spec: SwarmSpec }) {
    const drivers = Array.from(new Set(spec.data.map((d) => d.driver)));
    if (drivers.length === 0 || spec.data.length === 0) {
        return <EmptyChart title={spec.title} />;
    }
    const stats = computeBoxPlotData(
        spec.data as unknown as Array<Record<string, unknown>>,
        "driver",
        "value"
    );
    const points = spec.data.map((d) => {
        const i = Math.max(drivers.indexOf(d.driver), 0);
        return { x: i + swarmJitter(i, d.lap), y: d.value, driver: d.driver, lap: d.lap };
    });
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={Math.max(340, 200 + drivers.length * 6)}>
                <ScatterChart margin={{ top: 10, right: 30, left: 20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} />
                    <XAxis
                        type="number"
                        dataKey="x"
                        domain={[-0.5, drivers.length - 0.5]}
                        ticks={drivers.map((_, i) => i)}
                        tickFormatter={(i: number) => drivers[i] ?? ""}
                        tick={{ fontSize: 11, fontWeight: 500 }}
                        interval={0}
                        stroke={CHART_TOKENS.axis}
                        label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -15, fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <YAxis
                        type="number"
                        dataKey="y"
                        // Zoom to the data range — lap times cluster around
                        // ~90s and a zero-based axis would flatten every
                        // swarm into a line at the top.
                        domain={["auto", "auto"]}
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => formatTick(v, spec.unit)}
                        label={{ value: spec.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <Tooltip content={<SwarmPointTooltip unit={spec.unit} />} cursor={{ strokeDasharray: "3 3" }} />
                    {stats.map((s) => {
                        const i = Math.max(drivers.indexOf(s.category), 0);
                        const c = colorForDriver(s.category, i);
                        return (
                            <React.Fragment key={s.category}>
                                <ReferenceArea
                                    x1={i - 0.42}
                                    x2={i + 0.42}
                                    y1={s.q1}
                                    y2={s.q3}
                                    fill={c}
                                    fillOpacity={0.14}
                                    stroke="none"
                                />
                                <ReferenceLine
                                    segment={[{ x: i, y: s.min }, { x: i, y: s.max }]}
                                    stroke={CHART_TOKENS.axis}
                                    strokeWidth={1}
                                    opacity={0.6}
                                />
                                <ReferenceLine
                                    segment={[{ x: i - 0.42, y: s.median }, { x: i + 0.42, y: s.median }]}
                                    stroke={c}
                                    strokeWidth={2}
                                />
                            </React.Fragment>
                        );
                    })}
                    <Scatter
                        name="Lap"
                        data={points}
                        isAnimationActive={false}
                        shape={(props: { cx?: number; cy?: number; payload?: { driver?: string } }) => {
                            const { cx, cy, payload } = props;
                            if (cx == null || cy == null) return <g />;
                            const i = Math.max(drivers.indexOf(payload?.driver ?? ""), 0);
                            return (
                                <circle
                                    cx={cx}
                                    cy={cy}
                                    r={2.6}
                                    fill={colorForDriver(payload?.driver, i)}
                                    fillOpacity={0.75}
                                />
                            );
                        }}
                    />
                </ScatterChart>
            </ResponsiveContainer>
            <p className="text-[10px] text-muted-foreground/70">
                Each dot is one lap · shaded band = IQR · colored tick = median
            </p>
        </div>
    );
}

// =============================================================================
// Bump / rank-flow chart (position across laps or rounds, P1 on top)
// =============================================================================

interface BumpSpec {
    type: "bump";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<Record<string, number | string>>;
    xField: string;
    series: string[];
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
}

/** Light text on dark dots, dark text on light dots. */
function bumpTextFill(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return "#fff";
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#111" : "#fff";
}

function BumpDot(props: { cx?: number; cy?: number; value?: number | string; color?: string }) {
    const { cx, cy, value, color = "#888" } = props;
    if (cx == null || cy == null || value == null) return <g />;
    return (
        <g>
            <circle cx={cx} cy={cy} r={10} fill={color} stroke="var(--background)" strokeWidth={1.5} />
            <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dy={3.5}
                fontSize={9.5}
                fontWeight={800}
                fill={bumpTextFill(color)}
            >
                {value}
            </text>
        </g>
    );
}

export function BumpChart({ spec }: { spec: BumpSpec }) {
    if (spec.series.length === 0 || spec.data.length === 0) {
        return <EmptyChart title={spec.title} />;
    }
    let maxPos = 1;
    for (const row of spec.data) {
        for (const s of spec.series) {
            const raw = row[s];
            const v = typeof raw === "number" ? raw : parseFloat(String(raw));
            if (Number.isFinite(v)) maxPos = Math.max(maxPos, v);
        }
    }
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={Math.max(340, spec.series.length * 30 + 160)}>
                <LineChart data={spec.data} margin={{ top: 10, right: 40, left: 10, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} />
                    <XAxis
                        dataKey={spec.xField}
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -15, fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <YAxis
                        domain={[1, maxPos]}
                        reversed
                        allowDecimals={false}
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v: number) => `P${v}`}
                        label={{ value: spec.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <Tooltip content={<SmartTooltip unit={spec.unit || "pos"} />} />
                    <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: 10, fontSize: 11 }} />
                    {spec.series.map((s, i) => {
                        const c = colorForSeries(s, i);
                        return (
                            <Line
                                key={s}
                                type="monotone"
                                dataKey={s}
                                name={s}
                                stroke={c}
                                strokeWidth={2.5}
                                connectNulls
                                dot={(p) => <BumpDot {...p} color={c} />}
                                activeDot={{ r: 4, strokeWidth: 0 }}
                                isAnimationActive={false}
                            />
                        );
                    })}
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
}

// =============================================================================
// Histogram
// =============================================================================

interface HistogramSpec {
    type: "histogram";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<{ bin: string; count: number }>;
    xAxisLabel: string;
    yAxisLabel: string;
    unit: string;
}

export function Histogram({ spec }: { spec: HistogramSpec }) {
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={300}>
                <BarChart data={spec.data} margin={{ top: 10, right: 30, left: 20, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKENS.grid} opacity={0.4} />
                    <XAxis
                        minTickGap={28}
                        dataKey="bin"
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        label={{ value: spec.xAxisLabel, position: "insideBottom", offset: -15, fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <YAxis
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11 }}
                        label={{ value: spec.yAxisLabel, angle: -90, position: "insideLeft", fontSize: 11, fill: CHART_TOKENS.axis }}
                    />
                    <Tooltip content={<SmartTooltip unit="" />} />
                    <Bar dataKey="count" fill={CHART_TOKENS.highlight} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

// =============================================================================
// KPI / Summary (single number with a label)
// =============================================================================

interface KpiSpec {
    type: "kpi";
    title: string;
    subtitle?: string;
    insight?: string;
    question?: string;
    data: Array<{ key: string; value: number; label?: string }>;
    unit: string;
}

export function KpiCard({ spec }: { spec: KpiSpec }) {
    const top = spec.data[0];
    if (!top) {
        return <EmptyChart title={spec.title} />;
    }
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <div className="rounded-xl border border-border bg-card/40 p-6 text-center">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    {top.key}
                </p>
                <p className="text-4xl font-bold text-[var(--f1-red)] mt-2">
                    {formatValue(top.value, spec.unit)}
                </p>
                {top.label && (
                    <p className="text-xs text-muted-foreground mt-1">{top.label}</p>
                )}
            </div>
        </div>
    );
}

// =============================================================================
// Empty / fallback
// =============================================================================

export function EmptyChart({ title }: { title?: string }) {
    return (
        <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-sm">No data to display{title ? ` for "${title}"` : ""}</p>
        </div>
    );
}
