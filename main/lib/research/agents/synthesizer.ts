/**
 * Synthesizer Agent
 * =================
 *
 * Owns final answer generation. The Synthesizer reads from the Evidence Store
 * + Memory + Confidence + ChartSpecs and produces the final report.
 *
 * Every claim in the report must reference an evidence ID (e.g., "[E3]").
 * A post-generation validator checks that all [E#] references exist in the
 * evidence store.
 *
 * The Synthesizer NEVER calls tools, NEVER plans, and NEVER reflects.
 * It only synthesizes the answer from collected evidence.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { EvidenceStore } from "../evidence-store";
import type { ResearchMemory } from "../memory";
import type { ConfidenceScore, ChartSpec, ResearchType } from "../types";
import { chatContentToText } from "@/lib/llm";

// =============================================================================
// Synthesizer
// =============================================================================

export class Synthesizer {
    constructor(private model: BaseChatModel) { }

    /**
     * Generate the final report. Streams tokens directly as the LLM produces
     * them (time-to-first-token = one chunk, not the full answer).
     *
     * Guardrails:
     *   1. Refuse-on-empty: if the evidence store is empty, yield a fixed
     *      refusal message without calling the LLM.
     *   2. Citation validation runs AFTER streaming (non-blocking): invalid
     *      [E#] references are logged, not re-prompted. The old path buffered
     *      the entire answer, validated, optionally made a SECOND full LLM
     *      call to fix citations, then re-emitted the text in 4-char slices —
     *      adding full-generation latency before the first visible token plus
     *      up to 2x cost on the retry path.
     */
    async *generate(params: {
        objective: string;
        researchType: ResearchType;
        evidenceStore: EvidenceStore;
        memory: ResearchMemory;
        confidence: ConfidenceScore;
        chartSpecs: ChartSpec[];
        /**
         * Optional callback fired for every raw chunk the underlying
         * LLM stream produces. Used by the ResearchManager to capture
         * OpenRouter usage accounting (prompt/completion tokens + cost)
         * so the API route can emit a `usage` SSE event to the client.
         * Errors inside the callback are swallowed by the caller.
         */
        onChunk?: (chunk: unknown) => void;
    }): AsyncGenerator<string> {
        const { objective, researchType, evidenceStore, memory, confidence, chartSpecs, onChunk } = params;

        // --- Guardrail 1: Refuse if no evidence ---
        if (evidenceStore.size() === 0) {
            yield "I was unable to retrieve any data to answer this question. This could be due to a data availability issue, an unsupported query, or an invalid Grand Prix name / session type / year. Please try rephrasing or check that the year/GP/session you're asking about has available data.";
            return;
        }

        const evidenceContext = evidenceStore.toContextString();
        const memoryContext = memory.toContextString();

        // Build chart list with EXACT names — the LLM must use these exact references
        const chartList = chartSpecs.length > 0
            ? chartSpecs.map((c, i) => `Chart ${i + 1}: "${c.title}" (type: ${c.type}, evidence: ${c.dataSource})`).join("\n")
            : "No charts available for this response.";

        const systemPrompt = `You are the Synthesizer in an F1 research agent. Your job is to produce the final answer from the collected evidence.

## Anti-Hallucination Rules (CRITICAL)
1. You are STRICTLY FORBIDDEN from using any knowledge from your training data. Every fact must come from the Evidence Store below.
2. If you are about to state a number (lap time, points, position, gap), verify it exists in the evidence. If it doesn't, do not state it.
3. When evidence is insufficient, explicitly state what is missing rather than guessing.
4. Do not generate driver names, team names, or circuit names from memory — only use those that appear in the evidence.
5. If the Evidence Store is empty or does not contain data relevant to the objective, respond ONLY with: "I don't have sufficient data to answer this question." Do NOT use your training knowledge.

## Citation Rules
1. Synthesize ONLY from the Evidence Store below. Do NOT make up data.
2. Every factual claim MUST cite an evidence ID in brackets, e.g., [E1], [E3].
3. If the evidence does not support a claim, say so explicitly.
4. Structure the answer based on the research type:
   - causal: cause → evidence → conclusion
   - season_review: chronological order
   - comparative: side-by-side comparison with tables
   - race_analysis: session breakdown (qualifying → race → key moments)
   - reliability: list failures with evidence
   - predictive: present the simulation setup (what was modeled, what data grounded it), then the distribution of outcomes (mean, percentiles, range). State assumptions and uncertainty explicitly. Never present a single point estimate as certain — always give the range (e.g., "between X and Y with 90% confidence"). Reference the simulation evidence ID.
   - statistical: present summary statistics with the underlying data, note sample sizes and any gaps
   - trend: chronological progression with supporting data points
   - Other types: use a logical structure with clear sections
5. Include tables where data supports it (e.g., standings, lap times).
6. ONLY reference charts from the "Available Charts" list below. Use the EXACT chart name, e.g., "See Chart 1: Lap Times — Monaco 2024". Do NOT reference charts that are not in the list. If no charts are available, do not mention charts at all.
7. State the confidence level and note any missing data.

## Research Type
${researchType}

## Confidence
Overall: ${(confidence.overall * 100).toFixed(0)}%
Factors: ${JSON.stringify(confidence.factors, null, 2)}

## Evidence Store
${evidenceContext}

## Memory (prior discoveries)
${memoryContext}

## Available Charts (reference ONLY these — do not invent chart numbers)
${chartList}

## Objective
${objective}

Produce a comprehensive, evidence-backed answer. Use markdown formatting.`;

        const humanMessage = new HumanMessage("Generate the final report.");

        try {
            // Direct streaming: forward each chunk immediately while
            // buffering a copy for post-stream citation validation.
            // First token reaches the client after one chunk, not after
            // the full generation.
            let fullText = "";
            const stream = await this.model.stream([
                new SystemMessage(systemPrompt),
                humanMessage,
            ]);

            for await (const chunk of stream) {
                try { onChunk?.(chunk) } catch { /* best-effort */ }
                const content = chatContentToText(chunk.content);
                if (!content) continue;
                fullText += content;
                yield content;
            }

            // Post-stream validation (non-blocking, no re-prompt): log
            // invalid refs so they are visible in server logs without
            // paying for a second full generation.
            const invalidRefs = this.validateReferences(fullText, evidenceStore);
            if (invalidRefs.length > 0) {
                console.warn(
                    `[Synthesizer] Invalid citations (not re-prompting): ${invalidRefs.join(", ")}.`
                );
            }
        } catch (error) {
            yield `\n\n[Synthesis error: ${error instanceof Error ? error.message : "unknown error"}]\n\n${evidenceContext}`;
        }
    }

    /**
     * Validate that all [E#] references in the text exist in the evidence store.
     * Returns a list of invalid references (empty if all valid).
     */
    validateReferences(text: string, evidenceStore: EvidenceStore): string[] {
        const refs = text.match(/\[E\d+\]/g) || [];
        const validIds = new Set(evidenceStore.getAll().map((e) => `[${e.id}]`));
        return refs.filter((ref) => !validIds.has(ref));
    }
}
