"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import { Check, X, Loader2 } from "lucide-react"

interface PlanningGridProps {
    steps: {
        description: string
        tool: string
        status: 'pending' | 'running' | 'success' | 'failed'
        result?: string
    }[]
}

function PlanningGridComponent({ steps }: PlanningGridProps) {
    if (!steps || steps.length === 0) return null

    // Determine overall state for container styling
    const isComplete = steps.every(s => s.status === 'success' || s.status === 'failed')
    const hasError = steps.some(s => s.status === 'failed')

    return (
        <div className="group relative z-10 w-full mb-3 select-none">
            {/* Combined Visualization */}
            <div className="flex flex-col gap-1">

                {/* 1. Progress Lines Container */}
                <div className="flex h-1.5 w-full gap-1 overflow-hidden rounded-full bg-muted/20">
                    {steps.map((step, index) => (
                        <div
                            key={index}
                            className={cn(
                                "relative flex-1 transition-colors duration-300",
                                // Background base
                                "bg-muted",
                                // Completed states
                                step.status === 'success' && "bg-[var(--f1-green)]",
                                step.status === 'failed' && "bg-[var(--f1-red)]",
                                // Running state handled by inner div
                                step.status === 'running' && "bg-muted"
                            )}
                        >
                            {/* Running Animation: White bar filling slowly */}
                            {step.status === 'running' && (
                                <div className="absolute inset-0 bg-white/80 animate-[progress-fill_2s_ease-in-out_infinite] origin-left" />
                            )}
                        </div>
                    ))}
                </div>

                {/* 2. Expanded Details (Reveals on Hover) */}
                <div className={cn(
                    "grid gap-1 overflow-hidden transition-all duration-300 ease-out",
                    "grid-rows-[0fr] opacity-0 group-hover:grid-rows-[1fr] group-hover:opacity-100",
                    "group-hover:mt-1"
                )}>
                    <div className="min-h-0 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
                        <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <span>Strategy</span>
                            <span>{isComplete ? (hasError ? "Error" : "Ready") : "Calculating..."}</span>
                        </div>

                        <div className="space-y-1">
                            {steps.map((step, index) => (
                                <div
                                    key={index}
                                    className={cn(
                                        "flex items-start justify-between rounded px-2 py-2 text-xs font-mono transition-colors",
                                        step.status === 'running' && "bg-muted/50",
                                        step.status === 'failed' && "bg-[var(--f1-red)]/10 text-[var(--f1-red)]"
                                    )}
                                >
                                    <div className="flex items-start gap-2 flex-1">
                                        <div className={cn(
                                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-xs text-[9px] font-bold mt-0.5",
                                            step.status === 'pending' && "bg-muted text-muted-foreground",
                                            step.status === 'running' && "bg-[var(--f1-yellow)] text-black",
                                            step.status === 'success' && "bg-[var(--f1-green)] text-black",
                                            step.status === 'failed' && "bg-[var(--f1-red)] text-white"
                                        )}>
                                            {index + 1}
                                        </div>
                                        <span className={cn(
                                            "flex-1 break-words pb-0.5",
                                            step.status === 'pending' && "text-muted-foreground",
                                            step.status === 'success' && "text-[var(--f1-green)] brightness-75",
                                            step.status === 'failed' && "text-[var(--f1-red)]"
                                        )}>
                                            {step.description}
                                        </span>
                                    </div>

                                    <div className="ml-2 shrink-0 mt-1">
                                        {step.status === 'pending' && <span className="text-[10px] text-muted-foreground/50">WAIT</span>}
                                        {step.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-[var(--f1-yellow)]" />}
                                        {step.status === 'success' && <Check className="h-3 w-3 text-[var(--f1-green)]" />}
                                        {step.status === 'failed' && <X className="h-3 w-3 text-[var(--f1-red)]" />}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <style jsx global>{`
                @keyframes progress-fill {
                    0% { width: 0%; opacity: 0.5; }
                    50% { width: 70%; opacity: 1; }
                    100% { width: 100%; opacity: 0; }
                }
            `}</style>
        </div>
    )
}

// Export memoized component
export const PlanningGrid = memo(PlanningGridComponent);
