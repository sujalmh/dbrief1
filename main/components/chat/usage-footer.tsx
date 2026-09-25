"use client"

/**
 * UsageFooter
 * ===========
 *
 * Inline footer rendered at the bottom of every assistant message
 * bubble. Always surfaces the wall-clock response time; in BYOK mode
 * it additionally surfaces (a) the model that actually produced the
 * response and (b) the per-call usage accounting captured by the
 * backend (per the OpenRouter Usage Accounting docs):
 *
 *   BYOK:    <time>  ·  <model-id>  ·  <prompt + completion tokens>  ·  <cost>
 *   Managed: <time>  ·  (<cost> only when the gateway reports one)
 *
 * Model + token stats are BYOK-only — managed users neither pick the
 * model nor pay per token, so those chips would be noise. Response
 * time is mode-independent (measured client-side from send to last
 * token, even for fast-path replies that never emit a `usage` event).
 *
 * The component is intentionally small and unobtrusive — it uses
 * tooltip on hover for the per-stage breakdown (reasoning tokens,
 * cached tokens) so the bubble itself stays visually quiet.
 */

import { Coins, Cpu, Gauge, Timer, Wrench } from "lucide-react"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Message } from "@/lib/store"
import { cn } from "@/lib/utils"

interface UsageFooterProps {
    /** Token/cost accounting. Absent for fast-path replies that never
        emit a backend `usage` event — the time chip still renders. */
    usage?: Message['usage']
    /** Wall-clock response time in ms (client-measured, both modes). */
    durationMs?: number | null
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

/**
 * Format a wall-clock duration compactly: "4.2s", "45s", "2m 30s".
 * Sub-10s values keep one decimal (streaming latency differences
 * are perceptible there); larger values round to whole units.
 */
export function fmtDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return ""
    const s = ms / 1000
    if (s < 10) return `${s.toFixed(1)}s`
    if (s < 60) return `${Math.round(s)}s`
    const m = Math.floor(s / 60)
    const rem = Math.round(s % 60)
    if (m < 60) return rem === 0 ? `${m}m` : `${m}m ${rem}s`
    const h = Math.floor(m / 60)
    const remM = m % 60
    return remM === 0 ? `${h}h` : `${h}h ${remM}m`
}

export function UsageFooter({ usage, durationMs, className }: UsageFooterProps) {
    // Model + token stats are BYOK-only (usage.provider is the aiMode
    // the backend served: "managed" | "byok"). Cost keeps its old
    // behavior — rendered whenever the gateway reports one.
    const showModelStats = usage?.provider === "byok"
    const showDuration =
        typeof durationMs === "number" &&
        Number.isFinite(durationMs) &&
        durationMs >= 0
    const hasCached = (usage?.cachedTokens ?? 0) > 0
    const hasReasoning = (usage?.reasoningTokens ?? 0) > 0
    const costStr = fmtCost(usage?.cost)
    // The backend only sets `plannerModel` when the user picked
    // a different model for the planner role. When it matches
    // the responder (or is missing entirely) we hide the
    // planner row entirely so the footer stays compact for the
    // common case where both roles share a model.
    const hasPlanner =
        !!usage?.plannerModel && usage.plannerModel !== usage.model

    // Nothing to show (e.g. a legacy message with neither duration
    // nor reported cost) — skip the bordered box entirely.
    if (!showDuration && !showModelStats && !costStr) return null

    return (
        <div
            data-testid="usage-footer"
            className={cn(
                "mt-3 pt-2 border-t border-border/40 flex flex-col gap-1 text-[10px] font-mono text-muted-foreground/80",
                className
            )}
        >
            {/* Planner model row — BYOK-only, and only when the user
                picked a different model for the planner role
                (intent analysis + step decomposition). The icon
                (Wrench) hints at the role. */}
            {showModelStats && hasPlanner && (
                <div
                    data-testid="usage-planner-row"
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                    <span
                        className="inline-flex items-center gap-1"
                        title={`Full planner model id: ${usage!.plannerModel}`}
                    >
                        <Wrench className="h-3 w-3 shrink-0" />
                        <span className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">planner</span>
                        <span className="truncate max-w-[180px]">
                            {shortModelId(usage!.plannerModel!)}
                        </span>
                    </span>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {/* Response time — both modes, always first. */}
                {showDuration && (
                    <span
                        className="inline-flex items-center gap-1"
                        title="Wall-clock time from send to last token"
                        data-testid="usage-duration"
                    >
                        <Timer className="h-3 w-3 shrink-0" />
                        <span>{fmtDuration(durationMs!)}</span>
                    </span>
                )}

                {showModelStats && (
                    <>
                        {/* Responder model. Same tooltip affordance as
                            before; the "answer" label only appears next
                            to a distinct planner row. */}
                        <span
                            className="inline-flex items-center gap-1"
                            title={`Full model id: ${usage!.model}`}
                        >
                            <Cpu className="h-3 w-3 shrink-0" />
                            {hasPlanner && (
                                <span className="text-muted-foreground/70 uppercase tracking-wider text-[9px]">answer</span>
                            )}
                            <span className="truncate max-w-[180px]">
                                {shortModelId(usage!.model)}
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
                                        {fmtTokens(usage!.promptTokens)} in · {fmtTokens(usage!.completionTokens)} out
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
                                <div>Prompt: {fmtTokens(usage!.promptTokens)}</div>
                                <div>Completion: {fmtTokens(usage!.completionTokens)}</div>
                                {hasReasoning && (
                                    <div>Reasoning: {fmtTokens(usage!.reasoningTokens!)}</div>
                                )}
                                {hasCached && (
                                    <div>Cached: {fmtTokens(usage!.cachedTokens!)}</div>
                                )}
                                <div className="text-muted-foreground/80">
                                    Total: {fmtTokens(usage!.totalTokens)}
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </>
                )}

            {/* Cost — only rendered when the provider reported one.
                OpenRouter populates `usage.cost`; Gemini / HuggingFace
                don't, so for those we simply omit the line. */}
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
                            OpenRouter cost in USD credits. Includes prompt,
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
