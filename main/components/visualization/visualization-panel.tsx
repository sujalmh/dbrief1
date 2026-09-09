/**
 * Visualization Panel
 * ===================
 *
 * Side panel that renders the visualization data associated with the
 * current assistant message. Two rendering modes:
 *
 *   1. ChartSpec mode (deep research): renders the `chartSpecs` produced
 *      by the visualization planner via `ChartDispatcher`.
 *   2. Smart aggregation mode (standard chat): synthesizes a `ChartSpec[]`
 *      from raw tool results using the `smart-aggregator` module.
 *
 * The old "dump every comparison row into a bar chart" behavior is gone:
 * charts now go through the same aggregation + chart-selection pipeline
 * whether the user is in deep research mode or not.
 */

"use client";

import * as React from "react";
import { useState, useMemo, useEffect } from "react";
import { useChatStore } from "@/lib/store";
import { BarChart3, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { ChartDispatcher } from "./chart-dispatcher";
import { EmptyDashboard } from "./visualization-dashboard";
import { synthesizeChartSpecs } from "@/lib/visualization/smart-aggregator";
import type { ChartSpec } from "@/lib/research/types";

/**
 * Type guard: detects when the visualization panel was handed a list of
 * `ChartSpec` (e.g. by the deep-research visualization planner) versus a
 * list of raw tool results. The deep-research chat handler stores
 * specs directly in the panel store, so we must not re-aggregate them.
 */
function looksLikeChartSpecs(data: unknown): boolean {
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

export function VisualizationPanel() {
    const {
        settings,
        visualizationData,
        visualizationWidth,
        updateVisualizationWidth,
        isVisualizationCollapsed,
        toggleVisualizationCollapse,
        activeMessageId,
        setActiveMessageId,
        messages,
    } = useChatStore();
    const [localWidth, setLocalWidth] = useState(visualizationWidth);
    const [isResizing, setIsResizing] = useState(false);
    const [isHoveringHandle, setIsHoveringHandle] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(0);
    const isDesktop = useMediaQuery("(min-width: 768px)");

    // ---------------------------------------------------------------------
    // Width / drag state
    // ---------------------------------------------------------------------
    // Sync the store width into local state when not resizing. This is an
    // intentional prop-to-state sync (local edits during drag must not be
    // clobbered), not derived state.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (!isResizing) setLocalWidth(visualizationWidth);
    }, [visualizationWidth, isResizing]);

    const localWidthRef = React.useRef(localWidth);
    useEffect(() => {
        localWidthRef.current = localWidth;
    }, [localWidth]);

    useEffect(() => {
        if (!isResizing) return;
        let frameId: number;
        const handleMouseMove = (e: MouseEvent) => {
            if (frameId) cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(() => {
                const newWidth = window.innerWidth - e.clientX;
                if (newWidth >= 320 && newWidth <= window.innerWidth * 0.8) {
                    setLocalWidth(newWidth);
                }
            });
        };
        const handleMouseUp = () => {
            setIsResizing(false);
            updateVisualizationWidth(localWidthRef.current);
            if (frameId) cancelAnimationFrame(frameId);
        };
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            if (frameId) cancelAnimationFrame(frameId);
        };
    }, [isResizing, updateVisualizationWidth]);

    // ---------------------------------------------------------------------
    // Decide which chart specs to render
    // ---------------------------------------------------------------------
    const hasData = Array.isArray(visualizationData) && visualizationData.length > 0;
    const activeMessage = useMemo(
        () => messages.find((m) => m.id === activeMessageId) ?? null,
        [messages, activeMessageId]
    );
    const researchSpecs = activeMessage?.chartSpecs;
    const lastUserQuery = useMemo(() => {
        if (!activeMessageId) return "";
        const idx = messages.findIndex((m) => m.id === activeMessageId);
        for (let i = idx - 1; i >= 0; i--) {
            if (messages[i].role === "user") return messages[i].content;
        }
        return "";
    }, [activeMessageId, messages]);

    const chartSpecs: ChartSpec[] = useMemo(() => {
        if (researchSpecs && researchSpecs.length > 0) return researchSpecs;
        if (!hasData) return [];
        if (looksLikeChartSpecs(visualizationData)) {
            return visualizationData as unknown as ChartSpec[];
        }
        try {
            return synthesizeChartSpecs(
                visualizationData as unknown as Array<{ tool: string; args: Record<string, unknown>; success: boolean; data: unknown }>,
                lastUserQuery
            );
        } catch (e) {
            console.error("[VizPanel] synthesizeChartSpecs failed:", e);
            return [];
        }
    }, [researchSpecs, hasData, visualizationData, lastUserQuery]);

    // Clamp during render instead of a correcting effect — avoids an extra
    // render pass and the set-state-in-effect lint (curr index may go stale
    // when the spec list shrinks, e.g. new message replaces researchSpecs).
    const safeIndex = chartSpecs.length === 0 ? 0 : Math.min(currentIndex, chartSpecs.length - 1);

    // ---------------------------------------------------------------------
    // Restore the active message after a refresh / new session
    // ---------------------------------------------------------------------
    //
    // The persisted `visualizationData` survives across reloads, but
    // `activeMessageId` is intentionally NOT persisted (it would get
    // stale quickly as the user navigates messages). When the panel
    // mounts without an active message but there IS persisted
    // visualization data, fall back to the most recent assistant
    // message that has either chartSpecs or visualizationData. This
    // way the user sees the same chart they were looking at before
    // refreshing the page.
    useEffect(() => {
        if (activeMessageId) return;
        if (!visualizationData || (Array.isArray(visualizationData) && visualizationData.length === 0)) {
            return;
        }
        // Prefer messages with explicit chartSpecs (deep research).
        const withSpecs = [...messages].reverse().find(
            (m) => m.role === "assistant" && m.chartSpecs && m.chartSpecs.length > 0
        );
        if (withSpecs) {
            setActiveMessageId(withSpecs.id);
            return;
        }
        // Otherwise, the most recent assistant message that has
        // visualizationData attached.
        const withViz = [...messages].reverse().find(
            (m) => m.role === "assistant" && m.visualizationData
        );
        if (withViz) {
            setActiveMessageId(withViz.id);
        }
    }, [activeMessageId, visualizationData, messages, setActiveMessageId]);

    // ---------------------------------------------------------------------
    // Conditional returns (all hooks above this point)
    // ---------------------------------------------------------------------
    if (!settings.visualizeEnabled) return null;

    if (isVisualizationCollapsed) {
        return (
            <div
                className={cn(
                    "fixed z-30 flex items-center transition-all duration-300",
                    isDesktop ? "right-0 top-14 h-[calc(100vh-3.5rem)]" : "bottom-6 right-4"
                )}
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleVisualizationCollapse(false)}
                            className={cn(
                                "bg-muted/50 hover:bg-muted border-border shadow-lg backdrop-blur-sm",
                                isDesktop
                                    ? "h-12 w-8 rounded-l-lg rounded-r-none border-l border-y"
                                    : "h-12 w-12 rounded-full border"
                            )}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            <span className="sr-only">Expand Visualization</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                        <p>Expand Visualization</p>
                    </TooltipContent>
                </Tooltip>
            </div>
        );
    }

    return (
        <div
            className={cn(
                "fixed z-30 bg-background/95 flex flex-col shadow-[inset_10px_0_20px_-10px_rgba(0,0,0,0.5)] transition-[width,transform,opacity]",
                isDesktop && "right-0 top-14 h-[calc(100vh-3.5rem)] border-l border-white/10",
                isDesktop && (isResizing ? "duration-0 select-none" : "duration-300"),
                !isDesktop && "inset-0 top-14 w-full h-[calc(100vh-3.5rem)]"
            )}
            style={{ width: isDesktop ? `${localWidth}px` : "100%" }}
        >
            {/* Drag handle */}
            {isDesktop && (
                <div
                    className={cn(
                        "absolute left-0 top-0 w-2 h-full -ml-1 cursor-ew-resize z-40 transition-colors group",
                        isResizing && "bg-[var(--f1-red)]/50"
                    )}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        setIsResizing(true);
                    }}
                    onMouseEnter={() => setIsHoveringHandle(true)}
                    onMouseLeave={() => setIsHoveringHandle(false)}
                >
                    <div
                        className={cn(
                            "w-[2px] h-full mx-auto transition-colors",
                            isResizing || isHoveringHandle
                                ? "bg-[var(--f1-red)]"
                                : "bg-transparent group-hover:bg-[var(--f1-red)]/50"
                        )}
                    />
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/20 shrink-0">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-[var(--f1-yellow)]" />
                    <h2 className="font-bold text-sm uppercase tracking-wider">Visualization</h2>
                    {settings.deepResearchMode && (
                        <span className="ml-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            Deep Research
                        </span>
                    )}
                </div>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleVisualizationCollapse(true)}
                            className="h-8 w-8"
                        >
                            <X className="h-4 w-4" />
                            <span className="sr-only">Collapse</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>Collapse</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden">
                {chartSpecs.length === 0 ? (
                    <EmptyDashboard
                        message={
                            hasData
                                ? "Data fetched but no chart answers a clear question yet"
                                : "Ask about F1 data to see charts here"
                        }
                    />
                ) : (
                    <SingleChartView
                        specs={chartSpecs}
                        currentIndex={safeIndex}
                        onSelect={setCurrentIndex}
                    />
                )}
            </div>
        </div>
    );
}

// =============================================================================
// Single-chart-per-view (used for both 1-chart and N-chart cases)
// =============================================================================

function SingleChartView({
    specs,
    currentIndex,
    onSelect,
}: {
    specs: ChartSpec[];
    currentIndex: number;
    onSelect: (i: number) => void;
}) {
    if (specs.length === 1) {
        return (
            <div className="h-full overflow-auto">
                <ChartDispatcher spec={specs[0]} />
            </div>
        );
    }
    return (
        <div className="h-full flex flex-col">
            <div className="flex-1 overflow-auto">
                {specs[currentIndex] && <ChartDispatcher spec={specs[currentIndex]} />}
            </div>
            <SimplePager
                current={currentIndex}
                total={specs.length}
                onPrev={() => onSelect(currentIndex > 0 ? currentIndex - 1 : specs.length - 1)}
                onNext={() => onSelect(currentIndex < specs.length - 1 ? currentIndex + 1 : 0)}
                onSelect={onSelect}
            />
        </div>
    );
}

function SimplePager({
    current,
    total,
    onPrev,
    onNext,
    onSelect,
}: {
    current: number;
    total: number;
    onPrev: () => void;
    onNext: () => void;
    onSelect: (i: number) => void;
}) {
    return (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/5">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={onPrev} className="h-9 w-9">
                        <ChevronLeft className="h-5 w-5" />
                        <span className="sr-only">Previous</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Previous chart</p>
                </TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-2">
                {Array.from({ length: total }).map((_, i) => (
                    <button
                        key={i}
                        onClick={() => onSelect(i)}
                        className={cn(
                            "h-2 w-2 rounded-full transition-all duration-200",
                            i === current ? "bg-[var(--f1-red)] w-6" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                        )}
                        aria-label={`Go to chart ${i + 1}`}
                    />
                ))}
            </div>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={onNext} className="h-9 w-9">
                        <ChevronRight className="h-5 w-5" />
                        <span className="sr-only">Next</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Next chart</p>
                </TooltipContent>
            </Tooltip>
        </div>
    );
}
