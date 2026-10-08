/**
 * Inline Charts (in-chat visualizations)
 * ======================================
 *
 * t3code-style replacement for the old fixed-right VisualizationPanel:
 * charts render inside the assistant message that produced them, stacked
 * vertically in message order, instead of in a side dock driven by a
 * global `activeMessageId`.
 *
 * Data flow (per message, no global panel state):
 *   - Deep research: `message.chartSpecs` (LLM-planned) rendered as-is.
 *   - Standard mode: `message.visualizationData` (raw tool results)
 *     synthesized via `smart-aggregator` using the preceding user query.
 * Charts always render — there is no visualization toggle anymore.
 *
 * Bundle: recharts (~hundreds of KB) stays out of the initial paint —
 * `message-bubble` dynamic-imports this module with `ssr: false`, so
 * this file (and ChartDispatcher → intelligent-charts) only downloads
 * when a chart actually needs to render.
 */

"use client";

import * as React from "react";
import { useMemo } from "react";
import dynamic from "next/dynamic";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveInlineChartSpecs } from "@/lib/visualization/inline-specs";
import type { ChartSpec } from "@/lib/research/types";

const ChartDispatcher = dynamic(
    () => import("./chart-dispatcher").then((m) => m.ChartDispatcher),
    { ssr: false, loading: () => null }
);

interface InlineChartsProps {
    /** Stable message id — used for test hooks + React keys. */
    messageId: string;
    /** Deep-research specs stored on the message (preferred). */
    chartSpecs?: ChartSpec[] | null;
    /** Raw tool results stored on the message (standard mode). */
    visualizationData?: unknown;
    /** Preceding user query — focuses smart-aggregator titles/highlights. */
    query?: string;
    /** True while this message is still streaming. */
    isStreaming?: boolean;
    /**
     * True once the answer text has started (first token painted).
     * Charts never precede the response: while streaming with no text
     * yet, a compact placeholder holds the slot instead.
     */
    contentStarted?: boolean;
}

export function InlineCharts({
    messageId,
    chartSpecs,
    visualizationData,
    query = "",
    isStreaming = false,
    contentStarted = true,
}: InlineChartsProps) {
    const specs = useMemo(
        () => resolveInlineChartSpecs({ chartSpecs, visualizationData, query }),
        [chartSpecs, visualizationData, query]
    );

    // Streaming with data on the way — or with specs ready but no answer
    // text yet: hold a compact placeholder so charts never appear before
    // the response starts. No specs and not streaming → render nothing
    // (chat stays clean when there's nothing chartable).
    if (specs.length === 0) {
        if (isStreaming) {
            return (
                <div
                    data-testid="inline-charts-loading"
                    data-message-id={messageId}
                    className="mt-3 flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-xs text-muted-foreground animate-pulse"
                >
                    <BarChart3 className="h-4 w-4 shrink-0 text-[var(--f1-yellow)]" />
                    <span className="font-mono uppercase tracking-wider">Preparing charts…</span>
                </div>
            );
        }
        return null;
    }

    if (isStreaming && !contentStarted) {
        return (
            <div
                data-testid="inline-charts-loading"
                data-message-id={messageId}
                className="mt-3 flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 text-xs text-muted-foreground animate-pulse"
            >
                <BarChart3 className="h-4 w-4 shrink-0 text-[var(--f1-yellow)]" />
                <span className="font-mono uppercase tracking-wider">Preparing charts…</span>
            </div>
        );
    }

    return (
        <div
            data-testid="inline-charts"
            data-message-id={messageId}
            data-chart-count={specs.length}
            className="mt-3 min-w-0 max-w-full space-y-4"
        >
            {specs.length > 1 && (
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <BarChart3 className="h-3.5 w-3.5 text-[var(--f1-yellow)]" />
                    <span>
                        {specs.length} charts
                    </span>
                </div>
            )}
            {specs.map((spec) => (
                <figure
                    key={spec.id}
                    data-testid={`inline-chart-${spec.id}`}
                    data-chart-type={spec.type}
                    className={cn(
                        "min-w-0 max-w-full overflow-hidden rounded-xl",
                        "border border-border/50 bg-card/40",
                        "px-3 py-3 sm:px-4 sm:py-4"
                    )}
                >
                    <ChartDispatcher spec={spec} />
                </figure>
            ))}
        </div>
    );
}
