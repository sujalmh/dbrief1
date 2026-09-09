/**
 * Planner Agent
 * =============
 *
 * Owns task generation. The Planner translates the Reasoner's strategy into
 * concrete, executable Tasks with tool names, args, and optional dependencies.
 *
 * The Planner discovers tools from the registry (self-describing) — no tool
 * knowledge is hardcoded in the prompt. The prompt includes
 * `registry.toPromptString()` which lists all available tools with their
 * descriptions and output shapes.
 *
 * The Planner NEVER evaluates progress, NEVER reflects, and NEVER synthesizes
 * the final answer. It only produces tasks.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { ToolRegistry } from "../tool-registry";
import type { EvidenceStore } from "../evidence-store";
import type { ResearchMemory } from "../memory";
import type { Task, ResearchType, ResearchBudget, IntentAnalysis } from "../types";
import { extractJson, extractContent } from "../llm-parse";
import { maxSeasonYear, minSeasonYear, plannerConfig, telemetryStartYear } from "@/lib/config";
import { driverCodesPromptList, getGpNames } from "@/lib/reference-data";

// =============================================================================
// Schemas
// =============================================================================

const TaskOutputSchema = z.object({
    description: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
    dependsOn: z.array(z.string()).optional().default([]),
    rationale: z.string().optional(),
});

const PlanOutputSchema = z.object({
    tasks: z.array(TaskOutputSchema),
    reasoning: z.string().optional(),
});

// =============================================================================
// Planner
// =============================================================================

export class Planner {
    constructor(
        private model: BaseChatModel,
        private registry: ToolRegistry
    ) { }

    /**
     * Create executable tasks from the Reasoner's strategy.
     *
     * @param strategy - from the Reasoner (initial or next strategy)
     * @param params - context for task generation
     */
    async createTasks(
        strategy: string,
        params: {
            objective: string;
            researchType: ResearchType;
            evidenceStore: EvidenceStore;
            memory: ResearchMemory;
            budget: ResearchBudget;
            iteration: number;
            deepResearch: boolean;
            intentAnalysis?: IntentAnalysis | null;
        }
    ): Promise<{ tasks: Task[]; reasoning: string }> {
        const { objective, researchType, evidenceStore, memory, budget, iteration, deepResearch, intentAnalysis } = params;

        const toolList = this.registry.toPromptString(deepResearch);
        const intentSection = intentAnalysis
            ? `
## Intent Analysis (from Intent Analyzer — use this to guide your task selection)
- Primary intent: ${intentAnalysis.primaryIntent}
- Entities:
  - Drivers: ${intentAnalysis.entities.drivers.join(", ") || "none specified"}
  - Teams: ${intentAnalysis.entities.teams.join(", ") || "none specified"}
  - Grand Prix: ${intentAnalysis.entities.grandPrix.join(", ") || "none specified"}
  - Years: ${intentAnalysis.entities.years.join(", ") || "none specified"}
  - Sessions: ${intentAnalysis.entities.sessions.join(", ") || "none specified"}
  - Other concepts: ${intentAnalysis.entities.other.join(", ") || "none"}
- Temporal context: ${intentAnalysis.temporalContext}
- Comparison axis: ${intentAnalysis.comparisonAxis || "N/A"}
- Data needs: ${intentAnalysis.dataNeeds.join("; ") || "none specified"}
- Suggested tools: ${intentAnalysis.suggestedTools.join(", ") || "none specified"}
- Ambiguities: ${intentAnalysis.ambiguities.join("; ") || "none"}
- Requires simulation: ${intentAnalysis.requiresSimulation}
- Requires web search: ${intentAnalysis.requiresWebSearch}
- Conversation context: ${intentAnalysis.conversationContext}

IMPORTANT: Use the entities above as-is for tool args (driver codes, GP names, years, sessions). Do NOT invent different values. If an ambiguity is flagged, prefer fetching data first (e.g., get_events) to resolve it.
`
            : "";

        const systemPrompt = `You are the Planner in an F1 research agent. Your job is to translate the Reasoner's strategy into concrete, executable tasks.

## Available Tools (discover from this list — do NOT use tools not listed here)
${toolList}

## Rules
1. Each task must use a tool from the list above.
2. Tool args must match the tool's input schema.
3. Use {{task_id.field.path}} template syntax in args to reference outputs of prior tasks. Example: { "gp": "{{task_1.events[2].event_name}}" }
4. Use dependsOn to specify task IDs that must complete before this task can run.
5. Each task needs a rationale explaining why it's needed.
6. Only produce tasks that are needed for the current strategy — don't over-plan.
7. For years before ${telemetryStartYear()}, only use get_driver_standings, get_race, get_qualifying, get_results (no telemetry/laps).
8. Driver codes are 3 letters, e.g.: ${driverCodesPromptList().split(", ").slice(0, 8).join(", ")}, etc.

## Handling Predictive / Simulation / What-If Queries
When the objective is a prediction, counterfactual, or "what-if" scenario (keywords: "what if", "simulate", "predict", "project", "how would", "what would happen", "counterfactual", "hypothetical"), you MUST:
1. FIRST fetch relevant historical data to ground the simulation. For example:
   - "What if Abu Dhabi 2021 didn't end under safety car?" → get_laps for HAM and VER around lap 53
   - "What if reliability improved?" → get_race or get_driver_standings for prior races
   - "What if qualifying was wet?" → get_qualifying or get_laps for the relevant session
2. THEN call run_simulation, passing the fetched data via the 'reference_data' arg (using {{task_id}} template syntax) and naming the numeric field via 'reference_field' (e.g., "LapTime", "points", "gap"). This grounds the simulation in REAL observations rather than guessed parameters.
3. Choose the metric carefully:
   - "gap" for performance/time deltas between drivers
   - "time" for absolute lap times
   - "points" for championship or scoring outcomes
   - "position" for finishing positions
4. Set dependsOn so the simulation task runs AFTER the data-fetch tasks.
Example plan for "What if Abu Dhabi 2021 didn't end under safety car?":
  task_1: get_laps(year=2021, gp="Abu Dhabi", session="R", driver="HAM", lap_start=50, lap_end=55)
  task_2: get_laps(year=2021, gp="Abu Dhabi", session="R", driver="VER", lap_start=50, lap_end=55)
  task_3: run_simulation(scenario_id="abu-dhabi-21-no-sc", horizon="race", metric="gap", reference_data="{{task_1}}", reference_field="LapTime", dependsOn=["task_1","task_2"])
If no historical data is relevant (pure hypothetical), you may call run_simulation with explicit base_value/variance, but prefer grounding in data whenever possible.

## Current State
- Objective: ${objective}
- Research type: ${researchType}
- Iteration: ${iteration} of ${budget.maxIterations}
- Budget remaining: ${budget.maxTasks - budget.tasksExecuted} tasks
${intentSection}
## Evidence collected so far
${truncatePromptSection(evidenceStore.toReasonerContextString(), plannerConfig.evidenceTruncateChars())}

## Memory (prior discoveries — don't re-fetch these)
${truncatePromptSection(memory.toContextString(), plannerConfig.memoryTruncateChars())}`;

        const humanMsg = `Strategy from Reasoner: ${strategy}\n\nGenerate tasks for this strategy.`;

        // Try structured output first (guarantees schema-valid JSON)
        try {
            const structuredModel = this.model.withStructuredOutput(PlanOutputSchema, { name: "plan", strict: true });
            const validated = await structuredModel.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(humanMsg),
            ]);

            return { tasks: capAndDedupeTasks(validated.tasks, iteration), reasoning: validated.reasoning || "" };
        } catch (structuredError) {
            console.log("[Planner] Structured output failed, falling back to manual parsing:", structuredError instanceof Error ? structuredError.message : structuredError);
        }

        // Fallback: manual invoke + JSON extraction
        let response: { content: unknown };
        try {
            response = await this.model.invoke([
                new SystemMessage(systemPrompt + '\n\nRespond as JSON:\n{"tasks": [{"description": "...", "tool": "...", "args": {...}, "dependsOn": ["..."], "rationale": "..."}], "reasoning": "..."}'),
                new HumanMessage(humanMsg + " Respond with ONLY the JSON object, no other text."),
            ]);
        } catch (invokeError) {
            console.error("[Planner] LLM invoke failed:", invokeError instanceof Error ? invokeError.message : invokeError);
            const fallbackTasks = this.createFallbackTasks(strategy, objective, iteration);
            return {
                tasks: fallbackTasks,
                reasoning: `LLM invoke failed (${invokeError instanceof Error ? invokeError.message : "unknown"}), using fallback plan`,
            };
        }

        const content = extractContent(response.content);

        try {
            const parsed = extractJson(content);
            const validated = PlanOutputSchema.parse(parsed);

            // Assign IDs and iteration numbers
            return { tasks: capAndDedupeTasks(validated.tasks, iteration), reasoning: validated.reasoning || "" };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "unknown error";
            console.error("[Planner] JSON parsing failed:", errorMsg);
            console.error("[Planner] Raw LLM response (first 500 chars):", content.slice(0, 500));

            // No third LLM retry (removed for latency): the old path made a
            // THIRD sequential model call after two failures. Go straight to
            // the deterministic fallback plan instead.
            // Final fallback: generate a simple plan from the strategy
            const fallbackTasks = this.createFallbackTasks(strategy, objective, iteration);
            if (fallbackTasks.length > 0) {
                return {
                    tasks: fallbackTasks,
                    reasoning: `Planning JSON parsing failed (${errorMsg}), using fallback plan`,
                };
            }

            return {
                tasks: [],
                reasoning: `Planning failed: ${errorMsg}`,
            };
        }
    }

    /**
     * Create a simple fallback plan when LLM JSON parsing fails.
     * Extracts year and GP from the objective/strategy and generates
     * basic data-gathering tasks.
     */
    private createFallbackTasks(strategy: string, objective: string, iteration: number): Task[] {
        const text = `${objective} ${strategy}`;
        const tasks: Task[] = [];
        let taskNum = 1;

        // Extract year (bounds are config-driven; accepts 19xx + 20xx)
        const yearMatch = text.match(/(?:19|20)\d{2}/);
        let year = new Date().getFullYear();
        if (yearMatch) {
            const parsed = parseInt(yearMatch[0], 10);
            if (parsed >= minSeasonYear() && parsed <= maxSeasonYear()) year = parsed;
        }

        // Extract GP name from the shared reference data (not a local list)
        const gpMatch = getGpNames().find((gp) =>
            text.toLowerCase().includes(gp.toLowerCase())
        );

        // Always get standings for the year
        tasks.push({
            id: `task_${iteration}_${taskNum++}`,
            description: `Get driver standings for ${year}`,
            tool: "get_driver_standings",
            args: { year },
            dependsOn: [],
            status: "pending" as const,
            iteration,
            rationale: "Fallback: get standings to understand championship context",
        });

        // If a GP was detected, get race and qualifying results
        if (gpMatch) {
            tasks.push({
                id: `task_${iteration}_${taskNum++}`,
                description: `Get race results for ${gpMatch} ${year}`,
                tool: "get_race",
                args: { year, gp: gpMatch },
                dependsOn: [],
                status: "pending" as const,
                iteration,
                rationale: `Fallback: get race results for ${gpMatch}`,
            });

            tasks.push({
                id: `task_${iteration}_${taskNum++}`,
                description: `Get qualifying results for ${gpMatch} ${year}`,
                tool: "get_qualifying",
                args: { year, gp: gpMatch },
                dependsOn: [],
                status: "pending" as const,
                iteration,
                rationale: `Fallback: get qualifying results for ${gpMatch}`,
            });
        }

        return tasks;
    }
}

/**
 * Truncate a prompt section to a char budget (token/latency control).
 * Evidence + memory grow every iteration; without a cap the planner prompt
 * balloons and each successive planning call gets slower.
 */
function truncatePromptSection(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + "\n... (truncated for prompt efficiency)";
}

/**
 * Cap tasks per iteration and drop exact duplicates (same tool + args).
 * Over-planning is a direct latency multiplier (each task = a backend
 * round-trip + a reflect cycle). The cap is config-driven
 * (F1_PLANNER_MAX_TASKS_PER_ITERATION) and keeps batches tight while
 * covering multi-driver comparisons.
 */
function capAndDedupeTasks(
    raw: Array<{ description: string; tool: string; args: Record<string, unknown>; dependsOn?: string[]; rationale?: string }>,
    iteration: number,
    maxTasks?: number
): Task[] {
    const cap = maxTasks ?? plannerConfig.maxTasksPerIteration();
    const seen = new Set<string>();
    const tasks: Task[] = [];
    for (const t of raw) {
        const key = `${t.tool}:${JSON.stringify(t.args ?? {})}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tasks.push({
            id: `task_${iteration}_${tasks.length + 1}`,
            description: t.description,
            tool: t.tool,
            args: t.args,
            dependsOn: t.dependsOn || [],
            status: "pending" as const,
            iteration,
            rationale: t.rationale,
        });
        if (tasks.length >= cap) break;
    }
    return tasks;
}
