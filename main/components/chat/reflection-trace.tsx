"use client"

import { useState } from "react"
import { ChevronDown, Brain, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react"
import type { ResearchReflection } from "@/lib/store"

interface ReflectionTraceProps {
    reflections: ResearchReflection[]
}

export function ReflectionTrace({ reflections }: ReflectionTraceProps) {
    const [expanded, setExpanded] = useState(true)

    if (reflections.length === 0) return null

    return (
        <div className="mt-2 rounded-lg border border-border bg-card/30">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
                <Brain className="h-4 w-4 text-purple-400" />
                <span>Reasoner Reflections</span>
                <span className="ml-1 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-bold text-purple-400">
                    {reflections.length}
                </span>
                <ChevronDown
                    className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
            </button>

            {expanded && (
                <div className="space-y-3 px-3 pb-3">
                    {reflections.map((r, i) => (
                        <div
                            key={i}
                            className="rounded-md border border-border/50 bg-background/50 p-2"
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-bold text-muted-foreground">
                                    Iteration {r.iteration}
                                </span>
                                {r.useful ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                                ) : (
                                    <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />
                                )}
                                <span className="text-xs text-muted-foreground">
                                    {r.useful ? "Useful" : "Not useful"}
                                </span>
                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                <span className={`text-xs font-bold ${r.nextAction === "stop" ? "text-red-400" : "text-green-400"}`}>
                                    {r.nextAction === "stop" ? "STOP" : "CONTINUE"}
                                </span>
                            </div>

                            {r.answeredPart && (
                                <div className="text-xs text-muted-foreground mb-1">
                                    <span className="font-semibold text-green-400/70">Answered: </span>
                                    {r.answeredPart}
                                </div>
                            )}

                            {r.stillMissing.length > 0 && (
                                <div className="text-xs text-muted-foreground mb-1">
                                    <span className="font-semibold text-yellow-400/70">Missing: </span>
                                    {r.stillMissing.join("; ")}
                                </div>
                            )}

                            {r.reasoning && (
                                <div className="text-xs text-muted-foreground/60 italic mt-1">
                                    {r.reasoning}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
