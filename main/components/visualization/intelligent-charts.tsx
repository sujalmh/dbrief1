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
} from "recharts";
import { F1_PALETTE, CHART_TOKENS, colorForDriver } from "./chart-palette";

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
}

export function HorizontalBarChart({ spec }: { spec: HorizontalBarSpec }) {
    // Re-sort by value desc — the planner already sorts, but be defensive.
    const data = [...spec.data].sort((a, b) => b.value - a.value);
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
                                stroke={F1_PALETTE[i % F1_PALETTE.length]}
                                fill={F1_PALETTE[i % F1_PALETTE.length]}
                                fillOpacity={0.25}
                                strokeWidth={2}
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
                                stroke={F1_PALETTE[i % F1_PALETTE.length]}
                                strokeWidth={2}
                                dot={spec.data.length < 30 ? { r: 3 } : false}
                                connectNulls
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
                    {spec.diagonal && (
                        <ReferenceLine
                            segment={[
                                { x: 1, y: 1 },
                                { x: 22, y: 22 },
                            ]}
                            stroke={CHART_TOKENS.axis}
                            strokeDasharray="4 4"
                            opacity={0.5}
                            label={{ value: "y = x", position: "insideTopLeft", fontSize: 10, fill: CHART_TOKENS.axis }}
                        />
                    )}
                    {single ? (
                        <Scatter name={spec.yAxisLabel} data={spec.data} fill={CHART_TOKENS.highlight} />
                    ) : (
                        groups.map((g, i) => {
                            const points = spec.data.filter((d) => d.group === g);
                            return (
                                <Scatter
                                    key={g}
                                    name={g}
                                    data={points}
                                    fill={colorForDriver(g, i)}
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
                    <Bar dataKey="left" fill="transparent" />
                    <Scatter dataKey="left" fill={F1_PALETTE[0]} name={spec.leftLabel} />
                    <Scatter dataKey="right" fill={F1_PALETTE[2]} name={spec.rightLabel} />
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
    return (
        <div className="space-y-2">
            <ChartHeader
                title={spec.title}
                subtitle={spec.subtitle}
                insight={spec.insight}
                question={spec.question}
            />
            <ResponsiveContainer width="100%" height={Math.max(280, spec.data.length * 38 + 60)}>
                <ComposedChart
                    data={spec.data}
                    layout="vertical"
                    margin={{ top: 10, right: 50, left: 80, bottom: 25 }}
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
                        dataKey="category"
                        stroke={CHART_TOKENS.axis}
                        tick={{ fontSize: 11, fontWeight: 500 }}
                        width={80}
                    />
                    <Tooltip content={<SmartTooltip unit={spec.unit} />} />
                    <Bar dataKey="q3" fill="transparent" />
                    <Scatter
                        dataKey="median"
                        fill={CHART_TOKENS.highlight}
                        shape={(props: { cx?: number; cy?: number; payload?: { min: number; q1: number; median: number; q3: number; max: number } }) => {
                            const { cx, cy, payload } = props;
                            if (!payload || cx == null || cy == null) return <g />;
                            const range = payload.q3 - payload.q1;
                            return (
                                <g>
                                    <line x1={payload.q1} x2={payload.q3} y1={cy} y2={cy} stroke={CHART_TOKENS.highlight} strokeWidth={6} />
                                    <line x1={payload.min} x2={payload.max} y1={cy} y2={cy} stroke={CHART_TOKENS.axis} strokeWidth={1} />
                                    <line x1={payload.min} x2={payload.min} y1={cy - 5} y2={cy + 5} stroke={CHART_TOKENS.axis} strokeWidth={1} />
                                    <line x1={payload.max} x2={payload.max} y1={cy - 5} y2={cy + 5} stroke={CHART_TOKENS.axis} strokeWidth={1} />
                                    <circle cx={payload.median} cy={cy} r={4} fill="#fff" stroke={CHART_TOKENS.highlight} strokeWidth={2} />
                                    {/* Suppress unused warning */}
                                    <desc>{`range ${range}`}</desc>
                                </g>
                            );
                        }}
                    />
                </ComposedChart>
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
                    <Bar dataKey="count" fill={CHART_TOKENS.highlight} radius={[4, 4, 0, 0]} />
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
