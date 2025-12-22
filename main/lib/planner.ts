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
    description: z.string().describe("Human-readable description of what this step does"),
    tool: z.string().describe("Name of the tool to execute"),
    args: z.record(z.string(), z.unknown()).describe("Arguments for the tool"),
});

/**
 * Schema for the complete execution plan
 */
export const PlanSchema = z.object({
    steps: z.array(StepSchema).max(25).describe("List of execution steps (max 25)"),
    reasoning: z.string().optional().describe("Brief explanation of the plan"),
});

export type Step = z.infer<typeof StepSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// =============================================================================
// Planner Prompt
// =============================================================================

const PLANNER_SYSTEM_PROMPT = `You are a query planner for an F1 AI assistant. Decompose queries into 1-5 atomic execution steps.

Available Tools (FastAPI):
- get_seasons: Lists 1950-2025 seasons.
- get_events(year): Lists events.
- get_sessions(year, gp): Lists sessions (FP1...R).
- get_results(year, gp, session): Full session results.
- get_qualifying(year, gp): Qualifying specific results.
- get_race(year, gp): Race specific results.
- get_laps(year, gp, session, driver?, lap_start?, lap_end?): Lap times for a SINGLE driver.
- get_fastest_lap(year, gp, session, driver?): Fastest lap info.
- get_telemetry(year, gp, session, driver, lap?): Speed/Throttle/Brake data for a SINGLE driver.
- get_weather/race_control(year, gp, session): Conditions/Flags.
- get_tyres(year, gp, session, driver?): Tyre strategies.

- get_driver_standings(year, driver?): Final driver standings (points, wins).
- web_search(query): For news/current events ONLY.

Common Driver Codes (2024):
- Max Verstappen: VER | Lewis Hamilton: HAM | Fernando Alonso: ALO
- Charles Leclerc: LEC | Carlos Sainz: SAI | Sergio Perez: PER
- Lando Norris: NOR | Oscar Piastri: PIA | George Russell: RUS
- Yuki Tsunoda: TSU | Daniel Ricciardo: RIC | Lance Stroll: STR
- Pierre Gasly: GAS | Esteban Ocon: OCO | Alex Albon: ALB
- Logan Sargeant: SAR | Kevin Magnussen: MAG | Nico Hulkenberg: HUL
- Zhou Guanyu: ZHO | Valtteri Bottas: BOT

Session Codes:
- Practice: FP1, FP2, FP3
- Qualifying: Q (or "Qualifying")
- Sprint Qualifying: SQ
- Sprint: S
- Race: R (or "Race")

Rules:
1. MAX 5 steps total.
2. **CRITICAL**: To compare MULTIPLE drivers, make SEPARATE tool calls for EACH driver.
   Example: "Compare Lando and Oscar" → get_laps(driver="NOR") + get_laps(driver="PIA")
3. Use 3-letter driver codes (NOR, not "Lando Norris").
4. For race: use session="R". For qualifying: use session="Q".
5. Always use correct GP names: "Abu Dhabi" (not "abu dhabi 23").
6. **YEAR RANGE**: Years 1950-2025 are supported with different data availability:
   - **1950-2017**: Use ergast tools ONLY (get_driver_standings, get_race, get_qualifying). NO telemetry/laps/weather available.
   - **2018-2025**: All tools available including telemetry, laps, weather, etc.
   Example for "Senna 1994 championship": {"steps": [{"tool": "get_driver_standings", "args": {"year": 1994}}], "reasoning": "1994 is pre-2018, using ergast API for standings."}
   Example for "1994 Monaco race telemetry": {"steps": [], "reasoning": "Telemetry not available for 1994. Only standings and results available for pre-2018 seasons."}

**OUTPUT FORMAT**:
First, output your reasoning as plain text explaining your thought process.
Then, output the JSON plan on a new line starting with "PLAN:".

Example output:
I need to compare two drivers' lap times. This requires fetching data for each driver separately. Monaco 2024 is a recent race with full telemetry available. I'll use get_laps for both VER and HAM in qualifying session.

PLAN: {"steps": [{"description": "Fetch lap times for Verstappen", "tool": "get_laps", "args": {"year": 2024, "gp": "Monaco", "session": "Q", "driver": "VER"}}, {"description": "Fetch lap times for Hamilton", "tool": "get_laps", "args": {"year": 2024, "gp": "Monaco", "session": "Q", "driver": "HAM"}}], "reasoning": "Fetch lap data separately for VER and HAM to enable comparison visualization."}

Example 2: "Compare telemetry between Lando and Oscar in Abu Dhabi 2023 race"
The user wants telemetry comparison between two McLaren drivers. I need to get telemetry for both NOR and PIA. Since they want race data, I'll use session="R" and fetch the fastest lap for each driver.

PLAN: {"steps": [{"description": "Get fastest lap telemetry for Norris", "tool": "get_telemetry", "args": {"year": 2023, "gp": "Abu Dhabi", "session": "R", "driver": "NOR", "lap": "fastest"}}, {"description": "Get fastest lap telemetry for Piastri", "tool": "get_telemetry", "args": {"year": 2023, "gp": "Abu Dhabi", "session": "R", "driver": "PIA", "lap": "fastest"}}], "reasoning": "Fetch telemetry for both McLaren drivers (NOR and PIA) for comparison."}`;

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
    webSearchEnabled: boolean = false,
    reasoningMode: boolean = false
): Promise<Plan> {
    // Build the system prompt with web search context
    let systemPrompt = PLANNER_SYSTEM_PROMPT;
    const currentDate = new Date().toISOString().split('T')[0];
    systemPrompt += `\n\nCurrent Date: ${currentDate}`;

    if (!webSearchEnabled) {
        systemPrompt += "\n\n**NOTE: Web search is DISABLED. Do not use the web_search tool.**";
    }

    if (reasoningMode) {
        systemPrompt = systemPrompt.replace("MAX 5 steps total", "MAX 25 steps total. Create as many steps as needed for a comprehensive analysis.");
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

    // Parse JSON from response (now returns { plan, reasoning })
    const { plan: parsedPlan, reasoning: extractedReasoning } = parseJsonResponse(content);

    // Validate with Zod
    let validatedPlan: Plan;
    try {
        validatedPlan = PlanSchema.parse(parsedPlan);
    } catch (e) {
        validatedPlan = PlanSchema.parse(parsedPlan);
    }

    // Merge extracted reasoning with plan reasoning if available
    if (extractedReasoning && !validatedPlan.reasoning) {
        validatedPlan.reasoning = extractedReasoning;
    } else if (extractedReasoning && validatedPlan.reasoning) {
        // Prepend extracted reasoning to plan reasoning
        validatedPlan.reasoning = `${extractedReasoning}\n\n${validatedPlan.reasoning}`;
    }

    // Filter out web_search if disabled
    if (!webSearchEnabled) {
        validatedPlan.steps = validatedPlan.steps.filter(
            (step) => step.tool !== "web_search"
        );
    }

    // Enforce max steps based on mode
    const maxSteps = reasoningMode ? 25 : 5;
    if (validatedPlan.steps.length > maxSteps) {
        validatedPlan.steps = validatedPlan.steps.slice(0, maxSteps);
    }

    return validatedPlan;
}

/**
 * Stream planning with reasoning trace
 * 
 * @param model - The planner LLM model
 * @param message - User's message/query
 * @param webSearchEnabled - Whether web search is available
 * @param reasoningMode - Whether to allow more steps
 * @param onReasoningToken - Callback for each reasoning token
 * @returns Validated execution plan
 */
export async function streamPlanQuery(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    reasoningMode: boolean = false,
    onReasoningToken?: (token: string) => void
): Promise<Plan> {
    // Build the system prompt with web search context
    let systemPrompt = PLANNER_SYSTEM_PROMPT;
    const currentDate = new Date().toISOString().split('T')[0];
    systemPrompt += `\n\nCurrent Date: ${currentDate}`;

    if (!webSearchEnabled) {
        systemPrompt += "\n\n**NOTE: Web search is DISABLED. Do not use the web_search tool.**";
    }

    if (reasoningMode) {
        systemPrompt = systemPrompt.replace("MAX 5 steps total", "MAX 25 steps total. Create as many steps as needed for a comprehensive analysis.");
    }

    // Create messages
    const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
    ];

    // Stream response from LLM
    let fullContent = "";
    const stream = await model.stream(messages);

    for await (const chunk of stream) {
        const content =
            typeof chunk.content === "string"
                ? chunk.content
                : JSON.stringify(chunk.content);

        if (content) {
            fullContent += content;

            // If we haven't hit the PLAN: marker yet, emit reasoning tokens
            if (onReasoningToken && !fullContent.includes('PLAN:')) {
                onReasoningToken(content);
            }
        }
    }

    // Parse the complete response
    const { plan: parsedPlan, reasoning: extractedReasoning } = parseJsonResponse(fullContent);

    // Validate with Zod
    let validatedPlan: Plan;
    try {
        validatedPlan = PlanSchema.parse(parsedPlan);
    } catch (e) {
        validatedPlan = PlanSchema.parse(parsedPlan);
    }

    // Merge extracted reasoning with plan reasoning if available
    if (extractedReasoning && !validatedPlan.reasoning) {
        validatedPlan.reasoning = extractedReasoning;
    } else if (extractedReasoning && validatedPlan.reasoning) {
        validatedPlan.reasoning = `${extractedReasoning}\n\n${validatedPlan.reasoning}`;
    }

    // Filter out web_search if disabled
    if (!webSearchEnabled) {
        validatedPlan.steps = validatedPlan.steps.filter(
            (step) => step.tool !== "web_search"
        );
    }

    // Enforce max steps based on mode
    const maxSteps = reasoningMode ? 25 : 5;
    if (validatedPlan.steps.length > maxSteps) {
        validatedPlan.steps = validatedPlan.steps.slice(0, maxSteps);
    }

    return validatedPlan;
}

/**
 * Parse JSON from LLM response, handling markdown code blocks and reasoning prefix
 * New format: "reasoning text\n\nPLAN: {json}"
 */
function parseJsonResponse(content: string): { plan: unknown; reasoning?: string } {
    // Remove markdown code block if present
    let text = content.trim();

    // Handle ```json ... ``` format
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
        text = jsonBlockMatch[1].trim();
    }

    // Check if response has the new format with "PLAN:" marker
    const planMarkerIndex = text.indexOf('PLAN:');

    if (planMarkerIndex !== -1) {
        // Extract reasoning (everything before PLAN:)
        const reasoningText = text.substring(0, planMarkerIndex).trim();

        // Extract JSON (everything after PLAN:)
        const jsonStr = text.substring(planMarkerIndex + 5).trim();

        try {
            const plan = JSON.parse(jsonStr);
            return { plan, reasoning: reasoningText };
        } catch (error) {
            throw new Error(`Failed to parse plan JSON: ${jsonStr}`);
        }
    }

    // Fallback: try to parse entire content as JSON (old format)
    try {
        return { plan: JSON.parse(text) };
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
                steps: [{ description: `Get qualifying results for ${gp} ${year}`, tool: "get_qualifying", args: { year, gp } }],
                reasoning: "Fallback: detected qualifying query",
            };
        }
    }

    if (lowerMessage.includes("race") || lowerMessage.includes("winner") || lowerMessage.includes("podium")) {
        if (gp) {
            return {
                steps: [{ description: `Get race results for ${gp} ${year}`, tool: "get_race", args: { year, gp } }],
                reasoning: "Fallback: detected race query",
            };
        }
    }

    if (lowerMessage.includes("weather")) {
        if (gp) {
            return {
                steps: [{ description: `Get weather for ${gp} ${year}`, tool: "get_weather", args: { year, gp, session: "R" } }],
                reasoning: "Fallback: detected weather query",
            };
        }
    }

    if (lowerMessage.includes("season") || lowerMessage.includes("calendar") || lowerMessage.includes("events")) {
        return {
            steps: [{ description: `Get event list for ${year}`, tool: "get_events", args: { year } }],
            reasoning: "Fallback: detected season/calendar query",
        };

    }

    if (lowerMessage.includes("standings") || lowerMessage.includes("points") || lowerMessage.includes("championship")) {
        return {
            steps: [{ description: `Get driver standings for ${year}`, tool: "get_driver_standings", args: { year } }],
            reasoning: "Fallback: detected standings/points query",
        };
    }

    // Default: return events for the detected year
    return {
        steps: [{ description: `Get event list for ${year}`, tool: "get_events", args: { year } }],
        reasoning: "Fallback: could not determine specific intent, returning season events",
    };
}
