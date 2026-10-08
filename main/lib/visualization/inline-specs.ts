/**
 * Inline chart spec resolution (pure, testable)
 * =============================================
 *
 * Single place that decides which `ChartSpec[]` an in-chat chart block
 * renders for one assistant message. Extracted from the old side-panel
 * so both the component and unit tests share one implementation:
 *
 *   1. Deep-research `chartSpecs` win when present (LLM-planned).
 *   2. A `visualizationData` payload that already IS `ChartSpec[]`
 *      (deep-research handler stores specs directly) passes through.
 *   3. Otherwise raw tool results are synthesized via `smart-aggregator`
 *      (standard mode, no LLM).
 *   4. Anything else (empty, invalid, aggregator throw) → `[]` (render
 *      nothing — the chat must never crash on a bad payload).
 */

import type { ChartSpec } from "@/lib/research/types";
import { synthesizeChartSpecs } from "@/lib/visualization/smart-aggregator";

export interface RawVizResult {
    tool: string;
    args: Record<string, unknown>;
    success: boolean;
    data: unknown;
}

/**
 * Type guard: detects when a visualization payload is already a list of
 * `ChartSpec` versus a list of raw tool results. Mirrors the shape the
 * deep-research pipeline stores on the message (`id/type/xField/yField`
 * + `dataSource` in config-adjacent shape).
 */
export function looksLikeChartSpecs(data: unknown): boolean {
    if (!Array.isArray(data) || data.length === 0) return false;
    const first = data[0] as Record<string, unknown>;
    if (!first || typeof first !== "object") return false;
    return (
        typeof first.id === "string" &&
        typeof first.type === "string" &&
        typeof first.xField === "string" &&
        typeof first.yField === "string" &&
        "dataSource" in first
    );
}

export interface ResolveInlineSpecsInput {
    chartSpecs?: ChartSpec[] | null;
    visualizationData?: unknown;
    /** Last user query before this message — focuses titles/highlights. */
    query?: string;
}

/**
 * Resolve the chart specs to render inline for one message.
 * Pure: no store, no React, safe to call in render via useMemo.
 */
export function resolveInlineChartSpecs(input: ResolveInlineSpecsInput): ChartSpec[] {
    const { chartSpecs, visualizationData, query = "" } = input;

    if (chartSpecs && chartSpecs.length > 0) return chartSpecs;

    if (!Array.isArray(visualizationData) || visualizationData.length === 0) return [];

    if (looksLikeChartSpecs(visualizationData)) {
        return visualizationData as unknown as ChartSpec[];
    }

    try {
        return synthesizeChartSpecs(visualizationData as RawVizResult[], query);
    } catch (e) {
        console.error("[InlineCharts] synthesizeChartSpecs failed:", e);
        return [];
    }
}
