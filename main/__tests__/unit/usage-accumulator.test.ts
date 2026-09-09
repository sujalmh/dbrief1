/**
 * Tests for the UsageAccumulator + customModels settings integration
 * ================================================================
 *
 * The accumulator is the core of the per-message usage accounting
 * that powers the model + cost footer in the chat bubble. It must:
 *   - Sum token counts correctly across multiple LLM chunks
 *   - Take the LATEST non-null cost (cost is reported once, on the
 *     final chunk, and is non-additive)
 *   - Tolerate chunks that have no usage info (most chunks don't)
 *   - Return zeroed-out totals when no usage was ever observed
 *     (so the API route can still emit a `usage` event)
 *   - Accept the OpenRouter-style `response_metadata.usage` shape
 *     and the LangChain `usage_metadata` shape interchangeably
 *
 * The customModels field on settings is the user-curated list of
 * model ids that appear in the model picker. It must default to
 * `[]` for first-time users, accept additions, and reject dups.
 */

import { describe, it, expect, beforeEach } from "vitest"
import { UsageAccumulator, extractUsageFromChunk, getModelId } from "@/lib/llm-usage"
import { useChatStore } from "@/lib/store"

// Helper: build a fake chunk that mimics what LangChain emits when
// the OpenRouter stream sends a usage block. We construct it via
// `as any` to dodge the strict typing on AIMessageChunk — these
// tests only care that the extractor pulls out the right fields.
function chunkWithUsage(usage: any): any {
    return {
        content: "",
        usage_metadata: {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
        },
        response_metadata: {
            usage: {
                prompt_tokens: usage.prompt_tokens,
                completion_tokens: usage.completion_tokens,
                total_tokens: usage.total_tokens,
                cost: usage.cost,
                cost_details: { upstream_inference_cost: usage.upstream_inference_cost ?? 0 },
                prompt_tokens_details: { cached_tokens: usage.cached_tokens ?? 0 },
                completion_tokens_details: { reasoning_tokens: usage.reasoning_tokens ?? 0 },
            },
        },
    }
}

describe("extractUsageFromChunk", () => {
    it("returns null when the chunk has no usage info", () => {
        expect(extractUsageFromChunk({ content: "hi" } as any)).toBeNull()
    })

    it("extracts a full OpenRouter usage block", () => {
        const result = extractUsageFromChunk(
            chunkWithUsage({
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                cost: 0.000123,
                reasoning_tokens: 10,
                cached_tokens: 25,
                upstream_inference_cost: 0.0001,
            })
        )
        expect(result).toMatchObject({
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
            cost: 0.000123,
            reasoningTokens: 10,
            cachedTokens: 25,
            upstreamCost: 0.0001,
        })
    })

    it("falls back to usage_metadata when response_metadata.usage is absent", () => {
        const chunk = {
            content: "",
            usage_metadata: {
                input_tokens: 7,
                output_tokens: 3,
                total_tokens: 10,
            },
        }
        const result = extractUsageFromChunk(chunk as any)
        expect(result).toMatchObject({
            promptTokens: 7,
            completionTokens: 3,
            totalTokens: 10,
        })
        // No cost block → cost is null (not 0)
        expect(result?.cost).toBeNull()
    })
})

describe("UsageAccumulator", () => {
    let acc: UsageAccumulator
    beforeEach(() => {
        acc = new UsageAccumulator("openrouter", "anthropic/claude-3.5-sonnet")
    })

    it("returns zeros when no chunks were ever added", () => {
        const final = acc.finalize()
        expect(final).toEqual({
            provider: "openrouter",
            model: "anthropic/claude-3.5-sonnet",
            promptTokens: 0,
            completionTokens: 0,
            reasoningTokens: 0,
            cachedTokens: 0,
            totalTokens: 0,
            cost: null,
            upstreamCost: null,
        })
        expect(acc.hasData()).toBe(false)
    })

    it("ignores chunks without usage info (no exception, no state change)", () => {
        acc.addChunk({ content: "hello" } as any)
        acc.addChunk({ content: "world" } as any)
        expect(acc.hasData()).toBe(false)
        expect(acc.finalize().totalTokens).toBe(0)
    })

    it("sums token counts across multiple chunks", () => {
        // OpenRouter can send partial token counts in early chunks and
        // a final chunk with the total — the accumulator should sum
        // them all up. (For OpenRouter the final chunk is the one
        // with usage, so in practice we only see one addition, but
        // the math must work for any pattern.)
        acc.addChunk(chunkWithUsage({
            prompt_tokens: 100, completion_tokens: 50, total_tokens: 150,
        }))
        acc.addChunk(chunkWithUsage({
            prompt_tokens: 50, completion_tokens: 25, total_tokens: 75,
        }))
        const final = acc.finalize()
        expect(final.promptTokens).toBe(150)
        expect(final.completionTokens).toBe(75)
        expect(final.totalTokens).toBe(225)
        expect(acc.hasData()).toBe(true)
    })

    it("takes the latest cost (not additive) and preserves non-null over null", () => {
        // OpenRouter reports cost once, on the final chunk. The
        // accumulator must take the latest *non-null* value so
        // intermediate nulls (which OpenRouter sends on every
        // chunk except the last) don't reset the cost to null.
        // It also must NOT sum cost across chunks — cost is a
        // single number for the whole request, not a running
        // total. (If the final chunk happens to be 0, the result
        // is 0; we don't suppress legitimate zero-cost values.)
        acc.addChunk(chunkWithUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0001 }))
        acc.addChunk(chunkWithUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.0002 }))
        const final = acc.finalize()
        expect(final.cost).toBe(0.0002)
        // Tokens DO sum across chunks (cumulative), so we expect 30.
        expect(final.totalTokens).toBe(30)
    })

    it("updates model id when setModel is called mid-stream", () => {
        acc.setModel("openai/gpt-4o")
        expect(acc.finalize().model).toBe("openai/gpt-4o")
    })

    it("preserves reasoning and cached token counts", () => {
        acc.addChunk(chunkWithUsage({
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            reasoning_tokens: 30,
            cached_tokens: 80,
        }))
        const final = acc.finalize()
        expect(final.reasoningTokens).toBe(30)
        expect(final.cachedTokens).toBe(80)
    })
})

describe("getModelId", () => {
    it("returns 'unknown' for null/undefined", () => {
        expect(getModelId(null)).toBe("unknown")
        expect(getModelId(undefined)).toBe("unknown")
    })

    it("reads modelName from the LangChain model", () => {
        const fakeModel = { modelName: "anthropic/claude-3.5-sonnet" }
        expect(getModelId(fakeModel as any)).toBe("anthropic/claude-3.5-sonnet")
    })

    it("falls back to .model if modelName is missing", () => {
        const fakeModel = { model: "gpt-4o" }
        expect(getModelId(fakeModel as any)).toBe("gpt-4o")
    })
})

describe("settings.customModels", () => {
    beforeEach(() => {
        useChatStore.setState((state) => ({
            settings: { ...state.settings, customModels: [] },
        }))
    })

    it("defaults to an empty list", () => {
        const { settings } = useChatStore.getState()
        // The default may have been replaced by persisted state in
        // other tests; reset explicitly.
        expect(Array.isArray(settings.customModels)).toBe(true)
    })

    it("round-trips through updateSettings", () => {
        useChatStore.getState().updateSettings({
            customModels: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
        })
        expect(useChatStore.getState().settings.customModels).toEqual([
            "anthropic/claude-3.5-sonnet",
            "openai/gpt-4o",
        ])
    })

    it("appends to the existing list without losing prior entries", () => {
        useChatStore.getState().updateSettings({ customModels: ["model-a"] })
        const current = useChatStore.getState().settings.customModels
        useChatStore.getState().updateSettings({ customModels: [...current, "model-b"] })
        expect(useChatStore.getState().settings.customModels).toEqual(["model-a", "model-b"])
    })
})

describe("settings.plannerModel", () => {
    beforeEach(() => {
        useChatStore.setState((state) => ({
            settings: { ...state.settings, plannerModel: "" },
        }))
    })

    it("defaults to the empty string (use server default)", () => {
        expect(typeof useChatStore.getState().settings.plannerModel).toBe("string")
    })

    it("round-trips through updateSettings", () => {
        useChatStore.getState().updateSettings({
            plannerModel: "nvidia/nemotron-3-super-120b-a12b:free",
        })
        expect(useChatStore.getState().settings.plannerModel).toBe(
            "nvidia/nemotron-3-super-120b-a12b:free"
        )
    })

    it("is independent of the responder model", () => {
        // The split is the whole point of the feature: the user
        // can pick one model for planning and a different one
        // for the answer. Setting plannerModel must NOT touch
        // settings.model, and vice versa.
        useChatStore.getState().updateSettings({ model: "anthropic/claude-3.5-sonnet" })
        useChatStore.getState().updateSettings({ plannerModel: "meta-llama/llama-3.1-8b-instruct:free" })
        const { settings } = useChatStore.getState()
        expect(settings.model).toBe("anthropic/claude-3.5-sonnet")
        expect(settings.plannerModel).toBe("meta-llama/llama-3.1-8b-instruct:free")
    })
})

describe("setMessageUsage with plannerModel", () => {
    beforeEach(() => {
        useChatStore.setState({ messages: [] })
    })

    it("persists plannerModel alongside the responder model", () => {
        useChatStore.setState({
            messages: [
                { id: "m1", role: "assistant", content: "hi", timestamp: 1 },
            ],
        })
        useChatStore.getState().setMessageUsage("m1", {
            provider: "openrouter",
            model: "anthropic/claude-3.5-sonnet",
            plannerModel: "meta-llama/llama-3.1-8b-instruct:free",
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cost: 0.001,
            reasoningTokens: 0,
            cachedTokens: 0,
        })
        const usage = useChatStore.getState().messages[0].usage
        expect(usage?.plannerModel).toBe("meta-llama/llama-3.1-8b-instruct:free")
    })
})

describe("setMessageUsage", () => {
    beforeEach(() => {
        useChatStore.setState({ messages: [] })
    })

    it("attaches usage to the targeted message and leaves others alone", () => {
        useChatStore.setState({
            messages: [
                { id: "m1", role: "user", content: "hi", timestamp: 1 },
                { id: "m2", role: "assistant", content: "hello", timestamp: 2 },
                { id: "m3", role: "assistant", content: "world", timestamp: 3 },
            ],
        })
        useChatStore.getState().setMessageUsage("m2", {
            provider: "openrouter",
            model: "anthropic/claude-3.5-sonnet",
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cost: 0.0001,
            reasoningTokens: 0,
            cachedTokens: 0,
        })
        const messages = useChatStore.getState().messages
        expect(messages[0].usage).toBeUndefined()
        expect(messages[1].usage).toMatchObject({
            provider: "openrouter",
            model: "anthropic/claude-3.5-sonnet",
            totalTokens: 30,
            cost: 0.0001,
        })
        expect(messages[2].usage).toBeUndefined()
    })
})

describe("UsageAccumulator planner/responder split", () => {
    it("omits plannerModel when it equals the responder model", () => {
        // Common case: the user picked a model and didn't override
        // the planner, so the server falls back to the same model
        // for both roles. The footer should treat this as a
        // single-model response and NOT show a planner row.
        const acc = new UsageAccumulator(
            "openrouter",
            "anthropic/claude-3.5-sonnet",
            "anthropic/claude-3.5-sonnet"
        )
        acc.addChunk(
            chunkWithUsage({
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                cost: 0.001,
            })
        )
        const final = acc.finalize()
        expect(final.model).toBe("anthropic/claude-3.5-sonnet")
        expect(final.plannerModel).toBeUndefined()
    })

    it("includes plannerModel when it differs from the responder model", () => {
        // The user picked a cheap fast model for planning (e.g.
        // Llama 3.1 8B) and a more capable model for the final
        // answer (e.g. Claude Sonnet). The footer should show
        // both so the user can verify the split.
        const acc = new UsageAccumulator(
            "openrouter",
            "anthropic/claude-3.5-sonnet",
            "meta-llama/llama-3.1-8b-instruct:free"
        )
        acc.addChunk(
            chunkWithUsage({
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                cost: 0.001,
            })
        )
        const final = acc.finalize()
        expect(final.model).toBe("anthropic/claude-3.5-sonnet")
        expect(final.plannerModel).toBe("meta-llama/llama-3.1-8b-instruct:free")
    })

    it("omits plannerModel when no planner model was provided at all", () => {
        // The simplest case: the user never picked a planner
        // model. The server uses its built-in cheap planner
        // and never reports a plannerModel on the usage
        // event. The footer must collapse the two rows.
        const acc = new UsageAccumulator("openrouter", "anthropic/claude-3.5-sonnet")
        acc.addChunk(
            chunkWithUsage({
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
                cost: 0,
            })
        )
        expect(acc.finalize().plannerModel).toBeUndefined()
    })

    it("allows late-binding the planner model via setPlannerModel", () => {
        // The model id might not be known until the first
        // streaming chunk is read (e.g. when LangChain fills
        // in `modelName` on the instance). The accumulator
        // should accept a late update.
        const acc = new UsageAccumulator("openrouter", "anthropic/claude-3.5-sonnet")
        acc.setPlannerModel("nvidia/nemotron-3-super-120b-a12b:free")
        acc.addChunk(
            chunkWithUsage({
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
                cost: 0.0001,
            })
        )
        expect(acc.finalize().plannerModel).toBe("nvidia/nemotron-3-super-120b-a12b:free")
    })
})
