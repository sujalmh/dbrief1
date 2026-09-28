"use client"

import { memo, useState } from "react"
import { cn } from "@/lib/utils"
import { Check, X, Loader2, ChevronDown, ChevronUp, Brain, Layers } from "lucide-react"
import type { ResearchIteration } from "@/lib/store"

interface PlanningGridProps {
    steps?: {
        description: string
        tool: string
        status: 'pending' | 'running' | 'success' | 'failed'
        result?: string
    }[]
    reasoning?: string
    // Deep research mode props
    iterations?: ResearchIteration[]
    researchType?: string
}

function PlanningGridComponent({ steps, reasoning, iterations, researchType }: PlanningGridProps) {
    const [isReasoningExpanded, setIsReasoningExpanded] = useState(false)
    const [expandedIterations, setExpandedIterations] = useState<Set<number>>(new Set([1]))
    // Touch screens have no hover, so the strategy breakdown is also
    // tap-toggleable (desktop keeps the hover reveal as well).
    const [detailsOpen, setDetailsOpen] = useState(false)

    // Deep research mode: render iterations
    if (iterations && iterations.length > 0) {
        const totalTasks = iterations.reduce((acc, it) => acc + it.tasks.length, 0)
        const completedTasks = iterations.reduce(
            (acc, it) => acc + it.tasks.filter(t => t.status === 'success' || t.status === 'failed' || t.status === 'skipped').length,
            0
        )

        return (
            <div className="relative z-10 w-full mb-3 select-none">
                {/* Research Type Badge */}
                {researchType && (
                    <div className="mb-2 flex items-center gap-2">
                        <Layers className="h-3 w-3 text-purple-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
                            {researchType.replace(/_/g, " ")}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                            · {iterations.length} iterations · {completedTasks}/{totalTasks} tasks done
                        </span>
                    </div>
                )}

                {/* Iteration Sections */}
                <div className="space-y-2">
                    {iterations.map((iter) => {
                        const isExpanded = expandedIterations.has(iter.iteration)
                        const iterComplete = iter.tasks.every(
                            t => t.status === 'success' || t.status === 'failed' || t.status === 'skipped'
                        )

                        return (
                            <div key={iter.iteration} className="rounded-lg border border-border/50 bg-background/50 overflow-hidden">
                                <button
                                    onClick={() => {
                                        const next = new Set(expandedIterations)
                                        if (next.has(iter.iteration)) next.delete(iter.iteration)
                                        else next.add(iter.iteration)
                                        setExpandedIterations(next)
                                    }}
                                    className="w-full flex items-center gap-2 p-2 hover:bg-muted/50 transition-colors"
                                >
                                    <span className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold bg-purple-500/20 text-purple-400">
                                        {iter.iteration}
                                    </span>
                                    <span className="text-xs font-medium">
                                        Iteration {iter.iteration}
                                    </span>
                                    {iterComplete && <Check className="h-3 w-3 text-[var(--f1-green)]" />}
                                    <span className="text-[10px] text-muted-foreground">
                                        {iter.tasks.filter(t => t.status === 'success').length}/{iter.tasks.length} done
                                    </span>
                                    {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground ml-auto" /> : <ChevronDown className="h-3 w-3 text-muted-foreground ml-auto" />}
                                </button>

                                {isExpanded && (
                                    <div className="px-2 pb-2">
                                        {iter.reasoning && (
                                            <div className="text-[10px] text-muted-foreground/60 italic mb-2 px-2">
                                                {iter.reasoning}
                                            </div>
                                        )}
                                        {/* Progress bar */}
                                        <div className="flex h-1 w-full gap-0.5 mb-2">
                                            {iter.tasks.map((task) => (
                                                <div
                                                    key={task.id}
                                                    className={cn(
                                                        "flex-1 rounded-full transition-colors",
                                                        task.status === 'pending' && "bg-muted",
                                                        task.status === 'running' && "bg-[var(--f1-yellow)]",
                                                        task.status === 'success' && "bg-[var(--f1-green)]",
                                                        task.status === 'failed' && "bg-[var(--f1-red)]",
                                                        task.status === 'skipped' && "bg-muted/50"
                                                    )}
                                                />
                                            ))}
                                        </div>
                                        {/* Task list */}
                                        <div className="space-y-1 min-w-0">
                                            {iter.tasks.map((task) => (
                                                <div key={task.id} className="flex min-w-0 items-center gap-2 text-xs">
                                                    <div className="shrink-0">
                                                        {task.status === 'pending' && <span className="text-[10px] text-muted-foreground/50">○</span>}
                                                        {task.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-[var(--f1-yellow)]" />}
                                                        {task.status === 'success' && <Check className="h-3 w-3 text-[var(--f1-green)]" />}
                                                        {task.status === 'failed' && <X className="h-3 w-3 text-[var(--f1-red)]" />}
                                                        {task.status === 'skipped' && <span className="text-[10px] text-muted-foreground/50">⊘</span>}
                                                    </div>
                                                    <span className={cn(
                                                        "font-mono min-w-0 flex-1 break-words",
                                                        task.status === 'pending' && "text-muted-foreground",
                                                        task.status === 'success' && "text-foreground/80",
                                                        task.status === 'failed' && "text-[var(--f1-red)]",
                                                        task.status === 'skipped' && "text-muted-foreground/50"
                                                    )}>
                                                        {task.description}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground/40 ml-auto shrink-0">
                                                        {task.tool}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        )
    }

    // Normal mode: render flat steps (existing behavior)
    if (!steps || steps.length === 0) return null

    // Determine overall state for container styling
    const isComplete = steps.every(s => s.status === 'success' || s.status === 'failed')
    const hasError = steps.some(s => s.status === 'failed')

    return (
        <div className="relative z-10 w-full mb-3 select-none">
            {/* Reasoning Trace (if available) */}
            {reasoning && (
                <div className="mb-2 rounded-lg border bg-background/95 shadow-sm overflow-hidden transition-all duration-300">
                    <button
                        onClick={() => setIsReasoningExpanded(!isReasoningExpanded)}
                        className="w-full flex items-center justify-between p-2 hover:bg-muted/50 transition-colors"
                    >
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <Brain className="h-3 w-3" />
                            <span>Thinking Process</span>
                        </div>
                        {isReasoningExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
                    </button>

                    <div className={cn(
                        "grid transition-all duration-300 ease-in-out",
                        isReasoningExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                    )}>
                        <div className="min-h-0">
                            <div className="px-3 pb-3 pt-0 text-xs font-mono text-foreground/70 whitespace-pre-wrap leading-relaxed border-t border-muted/20">
                                {reasoning}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Combined Visualization */}
            <div className="flex flex-col gap-1 group">

                {/* 1. Progress Lines Container (tap to expand on touch) */}
                <button
                    type="button"
                    onClick={() => setDetailsOpen((o) => !o)}
                    aria-expanded={detailsOpen}
                    aria-label="Toggle strategy details"
                    className="flex h-1.5 w-full gap-1 overflow-hidden rounded-full bg-muted/20 cursor-pointer min-h-[12px] items-center py-1"
                >
                    {steps.map((step, index) => (
                        <div
                            key={step.description || index}
                            className={cn(
                                "relative flex-1 h-1.5 rounded-full transition-colors duration-300",
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
                </button>

                {/* 2. Expanded Details (hover on desktop, tap on touch) */}
                <div className={cn(
                    "grid gap-1 overflow-hidden transition-all duration-300 ease-out",
                    detailsOpen
                        ? "grid-rows-[1fr] opacity-100 mt-1"
                        : "grid-rows-[0fr] opacity-0",
                    "md:group-hover:grid-rows-[1fr] md:group-hover:opacity-100",
                    "md:group-hover:mt-1"
                )}>
                    <div className="min-h-0 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
                        <div className="mb-2 flex items-center justify-between px-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            <span>Strategy</span>
                            <span>{isComplete ? (hasError ? "Error" : "Ready") : "Calculating..."}</span>
                        </div>

                        <div className="space-y-1">
                            {steps.map((step, index) => (
                                <div
                                    key={step.description || index}
                                    className={cn(
                                        "flex items-start justify-between rounded px-2 py-2 text-xs font-mono transition-colors",
                                        step.status === 'running' && "bg-muted/50",
                                        step.status === 'failed' && "bg-[var(--f1-red)]/10 text-[var(--f1-red)]"
                                    )}
                                >
                                    <div className="flex min-w-0 items-start gap-2 flex-1">
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
                                            "flex-1 min-w-0 break-words pb-0.5",
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
