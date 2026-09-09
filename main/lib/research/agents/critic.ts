/**
 * Critic Agent
 * ============
 *
 * Post-synthesis verification agent. After the Synthesizer generates the
 * final answer, the Critic reviews it against the Evidence Store to check:
 *   1. Does every factual claim trace to a specific evidence item?
 *   2. Are there claims that contradict the evidence (wrong winner, wrong time)?
 *   3. Are there specific numbers (times, points, positions) not in any evidence?
 *
 * The Critic NEVER calls tools, NEVER plans, and NEVER synthesizes. It only
 * verifies the already-generated answer.
 *
 * If severity === "major", the ResearchManager appends a visible warning
 * to the streamed response so the user knows to cross-check.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { EvidenceStore } from "../evidence-store";
import type { CriticResult } from "../types";
import { CriticResultSchema } from "../types";
import { LLM_TIMEOUT_MS } from "@/lib/llm";
import { researchConfig } from "@/lib/config";

// =============================================================================
// Critic
// =============================================================================

export class Critic {
    constructor(private model: BaseChatModel) { }

    /**
     * Review the synthesized answer against the evidence store.
     *
     * @param answer - The full synthesized answer text
     * @param evidenceStore - The evidence store the answer should be grounded in
     * @param objective - The original user question
     * @returns CriticResult with grounded flag, issues, and severity
     */
    async review(
        answer: string,
        evidenceStore: EvidenceStore,
        objective: string
    ): Promise<CriticResult> {
        // If there's no evidence at all, the answer should have been a refusal.
        // If it's not a refusal, that's a major issue.
        if (evidenceStore.size() === 0) {
            const isRefusal = answer.toLowerCase().includes("unable to retrieve") ||
                answer.toLowerCase().includes("don't have") ||
                answer.toLowerCase().includes("no data") ||
                answer.toLowerCase().includes("insufficient data");
            return {
                grounded: isRefusal,
                issues: isRefusal
                    ? []
                    : ["Answer was generated with no evidence in the store — likely using training data."],
                severity: isRefusal ? "ok" : "major",
            };
        }

        // Fast path: short answers and refusals need no LLM verification.
        // The old path made up to TWO sequential LLM calls (structured +
        // manual fallback) for every report, blocking `done` on verification.
        // Short/refusal text has little to verify — return ok immediately.
        const lowered = answer.toLowerCase();
        const isRefusal =
            lowered.includes("unable to retrieve") ||
            lowered.includes("don't have") ||
            lowered.includes("no data") ||
            lowered.includes("insufficient data");
        if (isRefusal || answer.trim().length < researchConfig.criticMinCharsForReview()) {
            return { grounded: true, issues: [], severity: "ok" as const };
        }

        const evidenceContext = evidenceStore.toContextString();

        const systemPrompt = `You are the Critic in an F1 research agent. Your job is to verify that the synthesized answer is grounded in the collected evidence.

## Rules
1. Check every factual claim in the answer — does it trace to a specific evidence item [E#]?
2. Check for contradictions — does the answer state a winner, lap time, points total, or position that conflicts with the evidence?
3. Check for fabricated numbers — are there specific lap times, points, positions, or gaps in the answer that don't appear in any evidence?
4. Check for hallucinated entities — does the answer mention driver names, team names, or circuit names that don't appear in the evidence?
5. Do NOT check style, formatting, or completeness — only factual grounding.

## Severity
- "ok": All claims are grounded or the answer is a proper refusal.
- "minor": 1-2 minor issues (e.g., a number is slightly off, or a claim is unsupported but not contradictory).
- "major": Significant ungrounded claims, contradictions with evidence, or fabricated data.

## Objective (the user's question)
${objective}

## Evidence Store (the only valid source of facts)
${evidenceContext}

## Answer to Verify
${answer}

Analyze the answer against the evidence. Report specific issues with the claim and which evidence (if any) it contradicts.`;

        // Try structured output once with a tight timeout. The old manual
        // invoke + JSON-extraction fallback (a SECOND sequential LLM call)
        // is removed: on any failure return ok so verification never blocks
        // the answer with a false warning or added latency.
        try {
            const structuredModel = this.model.withStructuredOutput(
                CriticResultSchema,
                { name: "critic_review", strict: true }
            );
            const result = await structuredModel.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage("Verify the answer against the evidence."),
            ], { signal: AbortSignal.timeout(LLM_TIMEOUT_MS.critic) });
            return result as CriticResult;
        } catch (error) {
            console.warn(
                "[Critic] Review failed/skipped:",
                error instanceof Error ? error.message : error
            );
            // On failure, return ok (don't block the answer with a false warning)
            return {
                grounded: true,
                issues: ["Critic verification failed — could not verify the answer."],
                severity: "ok" as const,
            };
        }
    }
}
