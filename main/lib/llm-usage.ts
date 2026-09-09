/**
 * Usage accounting helpers
 * ========================
 *
 * Per the OpenRouter docs (Usage Accounting), the API automatically
 * returns a `usage` object in the last SSE chunk of every stream:
 *
 *   {
 *     prompt_tokens, completion_tokens, total_tokens,
 *     cost, cost_details.upstream_inference_cost,
 *     prompt_tokens_details.{cached_tokens, cache_write_tokens, audio_tokens},
 *     completion_tokens_details.reasoning_tokens
 *   }
 *
 * LangChain's `ChatOpenAI` (which is what we use to talk to OpenRouter)
 * parses this into `AIMessageChunk.usage_metadata` and `response_metadata`.
 * Gemini / HuggingFace don't expose cost natively, so for those providers
 * `cost` will be null and we only show token counts.
 *
 * This module exposes a small aggregator we can pass around the planner
 * and responder to collect usage from each LLM call and emit a single
 * `usage` SSE event at the end of the stream.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models"
import type { AIMessageChunk } from "@langchain/core/messages"

export interface UsageTotals {
    provider: string
    model: string
    /**
     * Model id used by the planner (intent analysis + step
     * decomposition). Distinct from `model` (the responder) so
     * the footer can show "planner: X / answer: Y" when the user
     * picks separate models for each role. The aggregated token
     * and cost fields cover the whole request — we don't try to
     * split them per stage because OpenRouter's `usage` block
     * doesn't make per-stage accounting easy or reliable.
     */
    plannerModel?: string
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    cachedTokens: number
    totalTokens: number
    /** USD. Null when the provider doesn't report it. */
    cost: number | null
    /** Raw upstream cost from OpenRouter (USD). Null otherwise. */
    upstreamCost: number | null
}

const ZERO: Omit<UsageTotals, "provider" | "model"> = {
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    cost: null,
    upstreamCost: null,
}

/**
 * Extract a usage delta from a single streamed chunk. Returns null when
 * the chunk doesn't carry any usage info (most chunks don't — only the
 * final one does for OpenRouter). The shape mirrors the OpenRouter
 * `usage` object so we can sum across calls.
 */
export function extractUsageFromChunk(chunk: AIMessageChunk | { usage_metadata?: unknown; response_metadata?: unknown; [k: string]: unknown }): Partial<UsageTotals> | null {
    // LangChain puts OpenRouter's usage on `usage_metadata` (token counts)
    // and on `response_metadata.usage` (full object including `cost`).
    const chunkRec = chunk as unknown as Record<string, unknown>;
    const meta = chunkRec.usage_metadata as
        | {
              input_tokens?: number
              output_tokens?: number
              total_tokens?: number
          }
        | undefined
    const respMeta = chunkRec.response_metadata as
        | {
              usage?: {
                  prompt_tokens?: number
                  completion_tokens?: number
                  total_tokens?: number
                  cost?: number
                  cost_details?: { upstream_inference_cost?: number | null }
                  prompt_tokens_details?: { cached_tokens?: number }
                  completion_tokens_details?: { reasoning_tokens?: number }
              }
          }
        | undefined

    if (!meta && !respMeta?.usage) return null

    const usage = respMeta?.usage ?? {}
    return {
        promptTokens: usage.prompt_tokens ?? meta?.input_tokens ?? 0,
        completionTokens:
            usage.completion_tokens ?? meta?.output_tokens ?? 0,
        totalTokens:
            usage.total_tokens ??
            meta?.total_tokens ??
            (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
        reasoningTokens:
            usage.completion_tokens_details?.reasoning_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        cost: typeof usage.cost === "number" ? usage.cost : null,
        upstreamCost:
            typeof usage.cost_details?.upstream_inference_cost === "number"
                ? usage.cost_details!.upstream_inference_cost!
                : null,
    }
}

/**
 * Lightweight accumulator. Each LLM call calls `addChunk` as it streams
 * (we'll typically only see one chunk with usage — the last one — per
 * call). At the end we call `finalize()` to get a single UsageTotals
 * suitable for sending over SSE.
 */
export class UsageAccumulator {
    private totals: Omit<UsageTotals, "provider" | "model"> = { ...ZERO }
    private provider: string
    private model: string
    private plannerModel: string | undefined
    private sawUsage = false

    constructor(
        provider: string,
        model: string,
        /**
         * Optional model id for the planner (intent analysis +
         * step decomposition). When the planner and responder
         * use the same model (the default when the user hasn't
         * picked a separate planner model) we leave this
         * undefined so the footer can collapse the two rows
         * into one.
         */
        plannerModel?: string
    ) {
        this.provider = provider
        this.model = model
        this.plannerModel = plannerModel
    }

    /**
     * Mark the model that produced these chunks. Allows the caller to
     * update the model mid-stream (e.g. planner vs. responder pick
     * different models).
     */
    setModel(model: string) {
        this.model = model
    }

    /**
     * Late-bind the planner model id (e.g. if the planner
     * model is only known after the first chunk is read). Same
     * rationale as `setModel`.
     */
    setPlannerModel(model: string | undefined) {
        this.plannerModel = model
    }

    addChunk(chunk: AIMessageChunk) {
        const delta = extractUsageFromChunk(chunk)
        if (!delta) return
        this.sawUsage = true
        this.totals.promptTokens += delta.promptTokens ?? 0
        this.totals.completionTokens += delta.completionTokens ?? 0
        this.totals.totalTokens += delta.totalTokens ?? 0
        this.totals.reasoningTokens += delta.reasoningTokens ?? 0
        this.totals.cachedTokens += delta.cachedTokens ?? 0
        // Cost: take the LATEST non-null value. Some providers
        // (Anthropic via OpenRouter) send cost=0 on intermediate
        // chunks and the real number on the last one.
        if (delta.cost != null) this.totals.cost = delta.cost
        if (delta.upstreamCost != null) this.totals.upstreamCost = delta.upstreamCost
    }

    /**
     * Same as `addChunk` but for non-streaming results (e.g. a single
     * `.invoke()` from the IntentAnalyzer). LangChain returns an
     * `AIMessage` with `usage_metadata` and `response_metadata`
     * populated, which we read the same way.
     */
    addResult(result: unknown) {
        this.addChunk(result as AIMessageChunk)
    }

    /**
     * Return the final aggregated totals. We always return *something*
     * (with zero counts) even if the provider didn't report usage, so
     * the frontend has a consistent shape to render.
     */
    finalize(): UsageTotals {
        const base: UsageTotals = {
            provider: this.provider,
            model: this.model,
            ...this.totals,
        }
        // Only include `plannerModel` when it's set AND distinct
        // from the responder model. The footer uses presence of
        // this field to decide whether to show a second row.
        if (this.plannerModel && this.plannerModel !== this.model) {
            base.plannerModel = this.plannerModel
        }
        return base
    }

    /** True if at least one chunk reported usage. Useful for the SSE handler. */
    hasData(): boolean {
        return this.sawUsage
    }
}

/**
 * Walk a LangChain stream and accumulate usage. The caller is expected
 * to forward each chunk downstream (e.g. to write tokens to the SSE
 * response) and we take care of the bookkeeping. The model is yielded
 * as a small marker we attach to the last emitted usage object.
 */
export async function* trackUsage<T extends AIMessageChunk>(
    source: AsyncIterable<T>,
    accumulator: UsageAccumulator
): AsyncIterable<T> {
    for await (const chunk of source) {
        accumulator.addChunk(chunk)
        yield chunk
    }
}

/**
 * Convenience: returns the model name from a LangChain chat model, or
 * the literal 'unknown' if LangChain can't tell us. We use this so the
 * per-message footer reflects the model that was actually used, not
 * whatever the user has selected at the moment of viewing.
 */
export function getModelId(model: BaseChatModel | null | undefined): string {
    if (!model) return "unknown"
    const m = model as unknown as { modelName?: string; model?: string }
    return m.modelName || m.model || "unknown"
}
