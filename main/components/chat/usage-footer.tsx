"use client"

/** Per-message footer (model + tokens + cost). Renders for BYOK messages only. */

import { useMemo } from "react"
import { Coins, Cpu, Gauge, Wrench } from "lucide-react"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Message } from "@/lib/store"
import { cn } from "@/lib/utils"

interface UsageFooterProps {
    usage: NonNullable<Message['usage']>
    className?: string
}

function fmtTokens(n: number): string {
    if (n == null) return "0"
    return n.toLocaleString("en-US")
}

function fmtCost(cost: number | null | undefined): string {
    if (cost == null) return ""
    if (cost === 0) return "Free"
    if (cost < 0.0001) return "<$0.0001"
    if (cost < 1) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
}

function shortModelId(id: string): string {
    if (!id) return ""
    return id.split("/").pop() || id
}

export function UsageFooter({ usage, className }: UsageFooterProps) {
    const isByok = usage.provider === "byok"
    const hasCached = useMemo(() => (usage.cachedTokens ?? 0) > 0, [usage.cachedTokens])
    const hasReasoning = useMemo(
        () => (usage.reasoningTokens ?? 0) > 0,
        [usage.reasoningTokens]
    )
    const costStr = fmtCost(usage.cost)
    const hasPlanner = useMemo(
        () => !!usage.plannerModel && usage.plannerModel !== usage.model,
        [usage.plannerModel, usage.model]
    )

    if (!isByok) return null

    return (
        <div
            data-testid="usage-footer"
            className={cn(
                "mt-3 pt-2 border-t border-border/40 flex flex-col gap-1 text-[10px] font-mono text-muted-foreground/80",
                className
            )}
        >
            {hasPlanner && (
                <div
                    data-testid="usage-planner-row"
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                    <span
                        className="inline-flex items-center gap-1"
                        title={`Full planner model id: ${usage.plannerModel}`}
                    >
                        <Wrench className="h-3 w-3 shrink-0" />
                        <span className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">planner</span>
                        <span className="truncate max-w-[180px]">
                            {shortModelId(usage.plannerModel!)}
                        </span>
                    </span>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                    className="inline-flex items-center gap-1"
                    title={`Full model id: ${usage.model}`}
                >
                    <Cpu className="h-3 w-3 shrink-0" />
                    {hasPlanner && (
                        <span className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">answer</span>
                    )}
                    <span className="truncate max-w-[180px]">
                        {shortModelId(usage.model)}
                    </span>
                </span>

            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className="inline-flex items-center gap-1 cursor-default"
                        data-testid="usage-tokens"
                    >
                        <Gauge className="h-3 w-3 shrink-0" />
                        <span>
                            {fmtTokens(usage.promptTokens)} in · {fmtTokens(usage.completionTokens)} out
                        </span>
                    </span>
                </TooltipTrigger>
                <TooltipContent
                    side="top"
                    className="text-[11px] px-3 py-2 space-y-0.5"
                >
                    <div className="font-bold uppercase tracking-wider text-muted-foreground">
                        Token breakdown
                    </div>
                    <div>Prompt: {fmtTokens(usage.promptTokens)}</div>
                    <div>Completion: {fmtTokens(usage.completionTokens)}</div>
                    {hasReasoning && (
                        <div>Reasoning: {fmtTokens(usage.reasoningTokens!)}</div>
                    )}
                    {hasCached && (
                        <div>Cached: {fmtTokens(usage.cachedTokens!)}</div>
                    )}
                    <div className="text-muted-foreground/80">
                        Total: {fmtTokens(usage.totalTokens)}
                    </div>
                </TooltipContent>
            </Tooltip>

            {costStr && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span
                            className="inline-flex items-center gap-1 cursor-default"
                            data-testid="usage-cost"
                        >
                            <Coins className="h-3 w-3 shrink-0" />
                            <span>{costStr}</span>
                        </span>
                    </TooltipTrigger>
                    <TooltipContent
                        side="top"
                        className="text-[11px] px-3 py-2 max-w-xs"
                    >
                        <div>
                            Provider cost in USD. Includes prompt,
                            completion{hasReasoning ? ", reasoning" : ""} and
                            {hasCached ? " cached" : " non-cached"} tokens.
                        </div>
                    </TooltipContent>
                </Tooltip>
            )}
            </div>
        </div>
    )
}
