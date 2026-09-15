"use client"

/**
 * UsageFooter (BYOK only)
 * =======================
 *
 * Inline footer rendered at the bottom of BYOK assistant message
 * bubbles. Surfaces (a) the model that actually produced the response
 * and (b) the per-call usage accounting captured by the backend:
 *
 *   <model-id>  ·  <prompt + completion tokens>  ·  <cost in USD>
 *
 * Managed responses render nothing — the owner already knows which
 * model serves them, and showing per-response model/cost details only
 * adds noise. Cost is only shown when the provider reports it;
 * otherwise we show just token counts.
 *
 * The component is intentionally small and unobtrusive — it uses
 * tooltip on hover for the per-stage breakdown (reasoning tokens,
 * cached tokens) so the bubble itself stays visually quiet.
 */

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

/**
 * Format a token count with a thousands separator. We never display
 * fractional tokens — the API reports them as integers.
 */
function fmtTokens(n: number): string {
    if (n == null) return "0"
    return n.toLocaleString("en-US")
}

/**
 * Format a USD cost. OpenRouter returns cost in credits which is
 * treated as USD for our purposes. Show with 4 significant digits
 * for tiny values, 2 for normal ones, and drop the dollar sign on
 * sub-cent amounts to avoid visual noise.
 */
function fmtCost(cost: number | null | undefined): string {
    if (cost == null) return ""
    if (cost === 0) return "Free"
    if (cost < 0.0001) return "<$0.0001"
    if (cost < 1) return `$${cost.toFixed(4)}`
    return `$${cost.toFixed(2)}`
}

/**
 * The portion of a model id after the last slash, for readability.
 * "anthropic/claude-3.5-sonnet" -> "claude-3.5-sonnet". Falls back
 * to the full id if there's no slash (some providers use unprefixed
 * names like "mistralai/Mistral-7B-Instruct-v0.3" which we still
 * trim).
 */
function shortModelId(id: string): string {
    if (!id) return ""
    return id.split("/").pop() || id
}

export function UsageFooter({ usage, className }: UsageFooterProps) {
    // BYOK-only: managed responses (and any legacy pre-two-mode
    // provider) render no footer — no model name, no cost.
    const isByok = usage.provider === "byok"
    const hasCached = useMemo(() => (usage.cachedTokens ?? 0) > 0, [usage.cachedTokens])
    const hasReasoning = useMemo(
        () => (usage.reasoningTokens ?? 0) > 0,
        [usage.reasoningTokens]
    )
    const costStr = fmtCost(usage.cost)
    // Legacy: messages produced before the managed/BYOK simplification
    // could carry a distinct `plannerModel`. New messages never set it
    // (planner and responder share one model), so the row stays hidden.
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
            {/* Planner model row — only rendered when the user
                picked a different model for the planner role
                (intent analysis + step decomposition). The icon
                (Wrench) hints at the role. */}
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

            {/* Responder model row — always present. Same tooltip
                affordance as before; we wrap the per-row content
                in a flex container so the planner/responder rows
                stack vertically. */}
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

            {/* Token counts with a tooltip showing the breakdown. */}
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

            {/* Cost — only rendered when the provider reported one. */}
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
