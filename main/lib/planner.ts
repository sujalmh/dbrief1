/**
 * Query Planner Module
 * ====================
 * Decomposes user queries into atomic execution steps using a cheap LLM.
 * Each step maps to a specific tool with validated arguments.
 */

import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// =============================================================================
// Schemas
// =============================================================================

/**
 * Schema for a single execution step
 */
export const StepSchema = z.object({
    tool: z.string().describe("Name of the tool to execute"),
    args: z.record(z.string(), z.unknown()).describe("Arguments for the tool"),
});

/**
 * Schema for the complete execution plan
 */
export const PlanSchema = z.object({
    steps: z.array(StepSchema).max(5).describe("List of execution steps (max 5)"),
    reasoning: z.string().optional().describe("Brief explanation of the plan"),
});

export type Step = z.infer<typeof StepSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// =============================================================================
// Planner Prompt
// =============================================================================

const PLANNER_SYSTEM_PROMPT = `You are a query planner for an F1 AI assistant. Decompose queries into 1-5 atomic execution steps.
Available Tools (FastAPI):
- get_seasons: Lists 2018-2025 seasons.
- get_events(year): Lists events.
- get_sessions(year, gp): Lists sessions (FP1...R).
- get_results(year, gp, session): Full session results.
- get_qualifying(year, gp): Qualifying specific results.
- get_race(year, gp): Race specific results.
- get_laps(year, gp, session, driver?, lap_start?, lap_end?): Lap times.
- get_fastest_lap(year, gp, session, driver?): Fastest lap info.
- get_telemetry(year, gp, session, driver, lap?): Speed/Throttle/Brake data.
- get_weather/race_control(year, gp, session): Conditions/Flags.
- get_tyres(year, gp, session, driver?): Tyre strategies.
- web_search(query): For news/current events ONLY.

Rules:
1. MAX 5 steps.
2. Logic: "Compare VER/HAM qualifying" -> 2x get_laps calls.
3. Use get_race for race results, get_qualifying for quali.
4. Output strict JSON only.

Example: "Compare VER and HAM lap times in Monaco 2024 Qualifying"
{
  "steps": [
    { "tool": "get_laps", "args": { "year": 2024, "gp": "Monaco", "session": "Q", "driver": "VER" } },
    { "tool": "get_laps", "args": { "year": 2024, "gp": "Monaco", "session": "Q", "driver": "HAM" } }
  ],
  "reasoning": "Fetch lap data for both drivers to compare."
}`;

// =============================================================================
// Planner Functions
// =============================================================================

/**
 * Plan execution steps for a user query
 *
 * @param model - The planner LLM model
 * @param message - User's message/query
 * @param webSearchEnabled - Whether web search is available
 * @returns Validated execution plan
 */
export async function planQuery(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false
): Promise<Plan> {
    // Build the system prompt with web search context
    let systemPrompt = PLANNER_SYSTEM_PROMPT;
    const currentDate = new Date().toISOString().split('T')[0];
    systemPrompt += `\n\nCurrent Date: ${currentDate}`;

    if (!webSearchEnabled) {
        systemPrompt += "\n\n**NOTE: Web search is DISABLED. Do not use the web_search tool.**";
    }

    // Create messages
    const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
    ];

    // Get response from LLM
    const response = await model.invoke(messages);

    // Extract content
    const content =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    // Parse JSON from response
    const plan = parseJsonResponse(content);

    // Validate with Zod
    const validatedPlan = PlanSchema.parse(plan);

    // Filter out web_search if disabled
    if (!webSearchEnabled) {
        validatedPlan.steps = validatedPlan.steps.filter(
            (step) => step.tool !== "web_search"
        );
    }

    // Enforce max 5 steps
    if (validatedPlan.steps.length > 5) {
        validatedPlan.steps = validatedPlan.steps.slice(0, 5);
    }

    return validatedPlan;
}

/**
 * Parse JSON from LLM response, handling markdown code blocks
 */
function parseJsonResponse(content: string): unknown {
    // Remove markdown code block if present
    let jsonStr = content.trim();

    // Handle ```json ... ``` format
    const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
        jsonStr = jsonBlockMatch[1].trim();
    }

    try {
        return JSON.parse(jsonStr);
    } catch (error) {
        throw new Error(`Failed to parse planner response as JSON: ${content}`);
    }
}

/**
 * Create a fallback plan when planning fails
 * Attempts to extract basic intent from the query
 */
export function createFallbackPlan(message: string): Plan {
    const lowerMessage = message.toLowerCase();

    // Try to extract year
    const yearMatch = message.match(/20\d{2}/);
    const year = yearMatch ? parseInt(yearMatch[0]) : 2024;

    // Try to detect GP name from common ones
    const gpPatterns = [
        { pattern: /monaco/i, name: "Monaco" },
        { pattern: /silverstone|british/i, name: "Silverstone" },
        { pattern: /monza|italian/i, name: "Monza" },
        { pattern: /spa|belgium|belgian/i, name: "Belgium" },
        { pattern: /suzuka|japanese|japan/i, name: "Japan" },
        { pattern: /austin|us\s*gp|united states/i, name: "United States" },
        { pattern: /bahrain/i, name: "Bahrain" },
        { pattern: /saudi|jeddah/i, name: "Saudi Arabia" },
        { pattern: /australia|melbourne/i, name: "Australia" },
        { pattern: /miami/i, name: "Miami" },
        { pattern: /canada|montreal/i, name: "Canada" },
        { pattern: /austria|spielberg/i, name: "Austria" },
        { pattern: /hungary|hungaroring/i, name: "Hungary" },
        { pattern: /netherlands|zandvoort/i, name: "Netherlands" },
        { pattern: /singapore/i, name: "Singapore" },
        { pattern: /mexico/i, name: "Mexico" },
        { pattern: /brazil|interlagos/i, name: "Brazil" },
        { pattern: /vegas|las vegas/i, name: "Las Vegas" },
        { pattern: /qatar/i, name: "Qatar" },
        { pattern: /abu dhabi/i, name: "Abu Dhabi" },
    ];

    let gp: string | null = null;
    for (const { pattern, name } of gpPatterns) {
        if (pattern.test(message)) {
            gp = name;
            break;
        }
    }

    // Determine what type of data to fetch
    if (lowerMessage.includes("qualifying") || lowerMessage.includes("q1") || lowerMessage.includes("q2") || lowerMessage.includes("q3")) {
        if (gp) {
            return {
                steps: [{ tool: "get_qualifying", args: { year, gp } }],
                reasoning: "Fallback: detected qualifying query",
            };
        }
    }

    if (lowerMessage.includes("race") || lowerMessage.includes("winner") || lowerMessage.includes("podium")) {
        if (gp) {
            return {
                steps: [{ tool: "get_race", args: { year, gp } }],
                reasoning: "Fallback: detected race query",
            };
        }
    }

    if (lowerMessage.includes("weather")) {
        if (gp) {
            return {
                steps: [{ tool: "get_weather", args: { year, gp, session: "R" } }],
                reasoning: "Fallback: detected weather query",
            };
        }
    }

    if (lowerMessage.includes("season") || lowerMessage.includes("calendar") || lowerMessage.includes("events")) {
        return {
            steps: [{ tool: "get_events", args: { year } }],
            reasoning: "Fallback: detected season/calendar query",
        };
    }

    // Default: return events for the detected year
    return {
        steps: [{ tool: "get_events", args: { year } }],
        reasoning: "Fallback: could not determine specific intent, returning season events",
    };
}
