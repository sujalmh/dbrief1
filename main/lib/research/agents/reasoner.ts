/**
 * Reasoner Agent
 * ==============
 *
 * Owns understanding and judgment. The Reasoner:
 *   1. Classifies the objective into a ResearchType and produces an initial strategy
 *   2. Reflects after each execution batch — "Was this useful? What's missing?
 *      Should I continue? Can I stop?"
 *
 * The Reasoner NEVER calls tools, NEVER generates tasks, and NEVER synthesizes
 * the final answer. It only understands, judges, and decides whether to continue.
 *
 * Tool reflection is the core mechanism that makes the agent adaptive — without
 * it, the loop is just executing a predefined plan.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type {
    EvidenceStore,
} from "../evidence-store";
import type { ResearchMemory } from "../memory";
import type { Reflection, ResearchType, ResearchBudget } from "../types";
import { RESEARCH_TYPES, RESEARCH_TYPE_EXPECTATIONS } from "../types";
import { extractJson, extractContent } from "../llm-parse";

// =============================================================================
// Schemas
// =============================================================================

const ClassificationSchema = z.object({
    researchType: z.enum(RESEARCH_TYPES as unknown as [string, ...string[]]),
    strategy: z.string().describe("Initial research strategy: what data to look for first, what angle to take"),
    reasoning: z.string().describe("Why this research type and strategy were chosen"),
});

const ReflectionOutputSchema = z.object({
    useful: z.boolean(),
    answeredPart: z.string(),
    stillMissing: z.array(z.string()),
    nextAction: z.enum(["call_tool", "stop"]),
    nextStrategy: z.string().optional(),
    reasoning: z.string(),
});

// =============================================================================
// Reasoner
// =============================================================================

export class Reasoner {
    constructor(private model: BaseChatModel) {}

    /**
     * Classify the objective and produce an initial research strategy.
     * Uses structured outputs when available (OpenRouter json_schema), falling
     * back to manual JSON extraction.
     */
    async classify(objective: string): Promise<{
        researchType: ResearchType;
        strategy: string;
        reasoning: string;
    }> {
        const systemPrompt = `You are the Reasoner in an F1 research agent. Your job is to understand the user's objective and decide the research strategy.

Classify the question into one of these research types:
${RESEARCH_TYPES.map((t) => `- ${t}`).join("\n")}

Then produce an initial strategy describing what data to look for first and what angle to take.`;

        const humanPrompt = `Objective: ${objective}`;

        // Try structured output first (guarantees schema-valid JSON)
        try {
            const structuredModel = this.model.withStructuredOutput(ClassificationSchema, { name: "classification", strict: true });
            const result = await structuredModel.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(humanPrompt),
            ]);
            return {
                researchType: result.researchType as ResearchType,
                strategy: result.strategy,
                reasoning: result.reasoning,
            };
        } catch (structuredError) {
            // Structured output not supported or failed — fall back to manual parsing
            console.log("[Reasoner] Structured output failed, falling back to manual parsing:", structuredError instanceof Error ? structuredError.message : structuredError);
        }

        // Fallback: manual invoke + JSON extraction
        try {
            const response = await this.model.invoke([
                new SystemMessage(systemPrompt + '\n\nRespond as JSON:\n{"researchType": "...", "strategy": "...", "reasoning": "..."}'),
                new HumanMessage(humanPrompt),
            ]);

            const content = extractContent(response.content);
            const parsed = extractJson(content);
            const result = ClassificationSchema.parse(parsed);
            return {
                researchType: result.researchType as ResearchType,
                strategy: result.strategy,
                reasoning: result.reasoning,
            };
        } catch (error) {
            console.error("[Reasoner] classify failed:", error instanceof Error ? error.message : error);
            // Fallback: treat as factual research
            return {
                researchType: "factual",
                strategy: `Gather relevant F1 data to answer: ${objective}`,
                reasoning: "Classification failed, defaulting to factual research",
            };
        }
    }

    /**
     * Reflect after an execution batch. This is the core adaptive mechanism.
     *
     * The Reasoner asks itself:
     *   - Was this useful? (did the last batch answer part of the question?)
     *   - What part of the question is now answered?
     *   - What is still missing?
     *   - Should I call another tool?
     *   - Can I stop?
     */
    async reflect(params: {
        objective: string;
        researchType: ResearchType;
        evidenceStore: EvidenceStore;
        memory: ResearchMemory;
        budget: ResearchBudget;
        iteration: number;
    }): Promise<Reflection> {
        const { objective, researchType, evidenceStore, memory, budget, iteration } = params;

        const expectedTypes = RESEARCH_TYPE_EXPECTATIONS[researchType] || [];
        const presentTypes = Array.from(evidenceStore.getEvidenceTypes());
        const missingTypes = expectedTypes.filter((t) => !presentTypes.includes(t as (typeof presentTypes)[number]));

        const systemPrompt = `You are the Reasoner in an F1 research agent. After each batch of tool executions, you reflect on the progress.

Ask yourself:
1. Was this useful? Did the last batch answer part of the question?
2. What part of the objective is now answered?
3. What is still missing?
4. Should I call another tool, or can I stop?

Current state:
- Objective: ${objective}
- Research type: ${researchType}
- Iteration: ${iteration} of ${budget.maxIterations}
- Tasks executed: ${budget.tasksExecuted} of ${budget.maxTasks}
- Expected evidence types: ${expectedTypes.join(", ") || "none specified"}
- Present evidence types: ${presentTypes.join(", ") || "none yet"}
- Missing evidence types: ${missingTypes.join(", ") || "none"}

Evidence collected so far:
${evidenceStore.toReasonerContextString()}

Memory (prior discoveries):
${memory.toContextString()}`;

        // Try structured output first (guarantees schema-valid JSON)
        try {
            const structuredModel = this.model.withStructuredOutput(ReflectionOutputSchema, { name: "reflection", strict: true });
            const result = await structuredModel.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage("Reflect on the progress and decide what to do next."),
            ]);
            return result as Reflection;
        } catch (structuredError) {
            console.log("[Reasoner] Structured output failed for reflect, falling back:", structuredError instanceof Error ? structuredError.message : structuredError);
        }

        // Fallback: manual invoke + JSON extraction
        try {
            const response = await this.model.invoke([
                new SystemMessage(systemPrompt + '\n\nRespond as JSON:\n{"useful": boolean, "answeredPart": "...", "stillMissing": ["..."], "nextAction": "call_tool|stop", "nextStrategy": "...", "reasoning": "..."}'),
                new HumanMessage("Reflect on the progress and decide what to do next. Respond with ONLY the JSON object, no other text."),
            ]);

            const content = extractContent(response.content);
            const parsed = extractJson(content);
            return ReflectionOutputSchema.parse(parsed) as Reflection;
        } catch (error) {
            // Fallback: if reflection fails, stop to avoid infinite loops
            return {
                useful: true,
                answeredPart: "Partial answer gathered",
                stillMissing: ["Unable to determine — reflection failed"],
                nextAction: "stop",
                reasoning: `Reflection failed: ${error instanceof Error ? error.message : "unknown error"}. Stopping to avoid infinite loop.`,
            };
        }
    }
}
