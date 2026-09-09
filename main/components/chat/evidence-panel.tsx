"use client"

import { useState } from "react"
import { ChevronDown, FileText } from "lucide-react"
import type { ResearchEvidence } from "@/lib/store"

interface EvidencePanelProps {
    evidence: ResearchEvidence[]
}

const EVIDENCE_TYPE_COLORS: Record<string, string> = {
    qualifying: "text-purple-400",
    race: "text-red-400",
    laps: "text-blue-400",
    telemetry: "text-cyan-400",
    telemetry_summary: "text-cyan-300",
    weather: "text-yellow-400",
    standings: "text-green-400",
    race_control: "text-orange-400",
    tyres: "text-amber-400",
    regulation: "text-indigo-400",
    web_search: "text-gray-400",
    simulation: "text-pink-400",
    results: "text-blue-300",
    fastest_lap: "text-emerald-400",
}

export function EvidencePanel({ evidence }: EvidencePanelProps) {
    const [expanded, setExpanded] = useState(true)

    if (evidence.length === 0) return null

    return (
        <div className="mt-3 rounded-lg border border-border bg-card/50">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
            >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>Evidence Store</span>
                <span className="ml-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                    {evidence.length}
                </span>
                <ChevronDown
                    className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
                />
            </button>

            {expanded && (
                <div className="space-y-2 mt-1">
                    {evidence.map((e) => {
                        const colorClass = EVIDENCE_TYPE_COLORS[e.type] || "text-muted-foreground"
                        return (
                            <div
                                key={e.id}
                                className="flex items-start gap-2 rounded-md border border-border/50 bg-background/50 px-3 py-2"
                            >
                                <span className={`text-xs font-mono font-bold ${colorClass}`}>
                                    [{e.id}]
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs text-muted-foreground">
                                        {e.source.tool}
                                        {e.race ? ` · ${e.race}` : ""}
                                        {e.season ? ` · ${e.season}` : ""}
                                        {e.driver ? ` · ${e.driver}` : ""}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {e.summary}
                                    </div>
                                    <div className="text-xs text-muted-foreground/70">
                                        Confidence: {(e.confidence * 100).toFixed(0)}%
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
