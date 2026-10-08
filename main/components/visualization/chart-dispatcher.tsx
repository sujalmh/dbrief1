/**
 * Chart Spec Dispatcher
 * =====================
 *
 * Takes a `ChartSpec` (from the planner) and renders the appropriate
 * intelligent chart component. The dispatcher is also responsible for
 * deriving the per-component "spec" object from the chart spec's `config`
 * bag — it never invents data or labels.
 *
 * If a spec doesn't have pre-aggregated data, we try to compute it from
 * the underlying `data` array. This keeps the dispatcher robust against
 * partially-populated specs from older plans.
 */

"use client";

import * as React from "react";
import type { ChartSpec } from "@/lib/research/types";
import {
    HorizontalBarChart,
    LineOrAreaChart,
    ScatterPlot,
    StackedBarChart,
    SwarmPlot,
    BumpChart,
    DumbbellChart,
    BoxPlot,
    Histogram,
    KpiCard,
    computeBoxPlotData,
    EmptyChart,
} from "./intelligent-charts";

interface DataRow {
    key: string;
    value: number;
    label?: string;
    extra?: Record<string, number | string>;
}

interface SpecConfig {
    data?: DataRow[];
    /** Series keys to plot for line/area/stacked_bar (e.g., ["speed", "throttle"]) */
    series?: string[];
    /** X-axis data key (defaults to "x") */
    xField?: string;
    xAxisLabel?: string;
    yAxisLabel?: string;
    unit?: string;
    insight?: string;
    highlight?: { key: string; value: number };
    intent?: string;
    aggregation?: string;
    /** Dumbbell endpoint labels (e.g., seasons); fall back to "A"/"B". */
    leftLabel?: string;
    rightLabel?: string;
}

/**
 * Resolve the list of series keys to render for a line/area/stacked bar
 * chart. The smart-aggregator and visualization-planner both emit the
 * series list in `config.series`. As a fallback we auto-detect numeric
 * keys on the first data row (other than the x-axis key) so the chart
 * still renders even if a spec omits the explicit list.
 */
function resolveSeries(cfg: SpecConfig, data: DataRow[]): string[] {
    if (Array.isArray(cfg.series) && cfg.series.length > 0) {
        return cfg.series.filter((s) => typeof s === "string" && s.length > 0);
    }
    // Telemetry-style rows: { x, speed, throttle, brake }. Use the
    // numeric keys other than the x-axis key as series.
    if (data.length > 0) {
        const first = data[0] as unknown as Record<string, unknown>;
        const xKey = cfg.xField ?? "x";
        return Object.keys(first)
            .filter((k) => k !== xKey && k !== "key" && k !== "value" && k !== "label" && k !== "extra")
            .filter((k) => {
                const v = first[k];
                return typeof v === "number" || v == null;
            });
    }
    return [];
}

export function ChartDispatcher({ spec }: { spec: ChartSpec }) {
    const cfg = (spec.config ?? {}) as SpecConfig;
    const data = Array.isArray(cfg.data) ? cfg.data : [];
    const xAxisLabel = cfg.xAxisLabel ?? spec.xField;
    const yAxisLabel = cfg.yAxisLabel ?? spec.yField;
    const unit = cfg.unit ?? "";
    const insight = cfg.insight ?? spec.insight;
    const question = spec.question;

    switch (spec.type) {
        case "horizontal_bar":
        case "bar":
            return (
                <HorizontalBarChart
                    spec={{
                        type: "horizontal_bar",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data,
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                        highlightKey: cfg.highlight?.key,
                    }}
                />
            );

        case "line":
        case "area":
        case "telemetry_multi":
            return (
                <LineOrAreaChart
                    spec={{
                        // Deep-research telemetry plans emit
                        // `telemetry_multi`; the renderer has no dedicated
                        // multi-channel component, so it shares the
                        // line/area renderer (series resolved from config).
                        type: spec.type === "area" ? "area" : "line",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as Array<Record<string, number | string>>,
                        xField: cfg.xField ?? spec.xField ?? "x",
                        yField: spec.yField,
                        series: resolveSeries(cfg, data),
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                    }}
                />
            );

        case "scatter":
            return (
                <ScatterPlot
                    spec={{
                        type: "scatter",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as Array<{ key: string; x: number; y: number; group?: string }>,
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                        diagonal: cfg.intent === "qualifying_vs_result",
                    }}
                />
            );

        case "stacked_bar":
            return (
                <StackedBarChart
                    spec={{
                        type: "stacked_bar",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as Array<Record<string, number | string>>,
                        xField: spec.xField,
                        series: resolveSeries(cfg, data),
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                    }}
                />
            );

        case "swarm":
            return (
                <SwarmPlot
                    spec={{
                        type: "swarm",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as Array<{ driver: string; lap: number; value: number }>,
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                    }}
                />
            );

        case "bump":
            return (
                <BumpChart
                    spec={{
                        type: "bump",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as Array<Record<string, number | string>>,
                        xField: cfg.xField ?? spec.xField ?? "x",
                        series: resolveSeries(cfg, data),
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                    }}
                />
            );

        case "dumbbell":
            return (
                <DumbbellChart
                    spec={{
                        type: "dumbbell",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as Array<{ category: string; left: number; right: number; delta: number }>,
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                        leftLabel: cfg.leftLabel ?? "A",
                        rightLabel: cfg.rightLabel ?? "B",
                    }}
                />
            );

        case "box_plot":
            return (
                <BoxPlot
                    spec={{
                        type: "box_plot",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as BoxPlotSpec["data"],
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                    }}
                />
            );

        case "histogram":
            return (
                <Histogram
                    spec={{
                        type: "histogram",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data: data as unknown as Array<{ bin: string; count: number }>,
                        xAxisLabel,
                        yAxisLabel,
                        unit,
                    }}
                />
            );

        case "kpi":
            return (
                <KpiCard
                    spec={{
                        type: "kpi",
                        title: spec.title,
                        subtitle: spec.subtitle,
                        insight,
                        question,
                        data,
                        unit,
                    }}
                />
            );

        case "heatmap":
        default:
            return <EmptyChart title={spec.title} />;
    }
}

// Helper type re-export
type BoxPlotSpec = {
    data: Array<{
        category: string;
        min: number;
        q1: number;
        median: number;
        q3: number;
        max: number;
        outliers?: number[];
    }>;
};

export { computeBoxPlotData };
