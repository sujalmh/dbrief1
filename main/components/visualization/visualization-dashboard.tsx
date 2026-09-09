/**
 * Smart Visualization Dashboard
 * =============================
 *
 * Renders a coordinated set of `ChartSpec`s produced by the research
 * visualization planner. Each chart:
 *   - Has a clear title + subtitle + question + insight
 *   - Uses pre-aggregated data from the planner (no raw 200-lap dumps)
 *   - Carries its own axis labels and units
 *
 * The dashboard supports carousel navigation, but prefers to show
 * multiple charts together when the screen is wide.
 */

"use client";

import * as React from "react";
import { BarChart3, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import { ChartDispatcher } from "./chart-dispatcher";
import type { ChartSpec } from "@/lib/research/types";

interface VisualizationDashboardProps {
    specs: ChartSpec[];
}

export function VisualizationDashboard({ specs }: VisualizationDashboardProps) {
    const [currentIndex, setCurrentIndex] = React.useState(0);
    const isWide = useMediaQuery("(min-width: 1024px)");

    React.useEffect(() => {
        if (currentIndex >= specs.length) setCurrentIndex(0);
    }, [specs.length, currentIndex]);

    if (!specs || specs.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                <BarChart3 className="h-12 w-12 mb-2 opacity-30" />
                <p className="text-sm">No charts to display</p>
            </div>
        );
    }

    if (isWide && specs.length > 1) {
        return (
            <div className="h-full overflow-y-auto p-4 space-y-6">
                <DashboardHeader count={specs.length} />
                {specs.map((spec) => (
                    <DashboardCard key={spec.id} spec={spec} />
                ))}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <DashboardHeader count={specs.length} />
            <div className="flex-1 overflow-auto">
                {specs[currentIndex] && <DashboardCard spec={specs[currentIndex]} />}
            </div>
            {specs.length > 1 && (
                <DashboardPagination
                    current={currentIndex}
                    total={specs.length}
                    onPrev={() =>
                        setCurrentIndex((p) => (p > 0 ? p - 1 : specs.length - 1))
                    }
                    onNext={() =>
                        setCurrentIndex((p) => (p < specs.length - 1 ? p + 1 : 0))
                    }
                    onSelect={setCurrentIndex}
                />
            )}
        </div>
    );
}

function DashboardHeader({ count }: { count: number }) {
    return (
        <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Research Dashboard
            </h2>
            <span className="text-xs text-muted-foreground">{count} chart{count === 1 ? "" : "s"}</span>
        </div>
    );
}

function DashboardCard({ spec }: { spec: ChartSpec }) {
    return (
        <div className="border-b border-border/30 last:border-b-0">
            <ChartDispatcher spec={spec} />
        </div>
    );
}

function DashboardPagination({
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
        <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/5">
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={onPrev} className="h-9 w-9">
                        <ChevronLeft className="h-5 w-5" />
                        <span className="sr-only">Previous Chart</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Previous Chart</p>
                </TooltipContent>
            </Tooltip>
            <div className="flex items-center gap-2">
                {Array.from({ length: total }).map((_, index) => (
                    <button
                        key={index}
                        onClick={() => onSelect(index)}
                        className={cn(
                            "h-2 w-2 rounded-full transition-all duration-200",
                            index === current
                                ? "bg-[var(--f1-red)] w-6"
                                : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                        )}
                        aria-label={`Go to chart ${index + 1}`}
                    />
                ))}
            </div>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={onNext} className="h-9 w-9">
                        <ChevronRight className="h-5 w-5" />
                        <span className="sr-only">Next Chart</span>
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>Next Chart</p>
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

export function EmptyDashboard({ message }: { message?: string }) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
            <X className="h-10 w-10 mb-2 opacity-30" />
            <p className="text-sm">{message ?? "Ask a research question to see charts"}</p>
        </div>
    );
}
