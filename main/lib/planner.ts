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
- get_laps(year, gp, session, driver?, lap_start?, lap_end?): Lap times for a SINGLE driver. Limit to specific lap range when possible.
- get_fastest_lap(year, gp, session, driver?): Fastest lap info (preferred over get_laps for single lap analysis).
- get_telemetry(year, gp, session, driver, lap?): Telemetry data (speed, throttle, brake). Use for comparisons and visualization.
- get_telemetry_summary(year, gp, session, driver, lap?): Statistical summary only. Use when user asks for stats/summaries, NOT for comparisons.
- get_weather/race_control(year, gp, session): Conditions/Flags.
- get_tyres(year, gp, session, driver?): Tyre strategies.

- get_driver_standings(year, driver?): Final driver standings (points, wins).
- retrieve_regulations(query, year, type): Search FIA regulation documents (sporting, technical, financial). Returns relevant regulation chunks with source citations.
- web_search(query): For news/current events ONLY.

Simulation Tool:
- run_simulation(scenario_id, horizon, metric, iterations?, base_value?, variance?, seed?): Run counterfactual/predictive simulations for "what-if" analysis.
  * horizon: "lap" | "race" | "season" | "custom"
  * metric: "time" (lap times), "points" (0-25 per race), "gap" (performance delta), "position" (1-20), "score" (0-100)
  * base_value: Expected/average value. For "gap" use negative = faster (e.g., -2.5 means 2.5s faster per lap)
  * variance: Standard deviation for randomness
  * Returns: Statistical summary (mean, min, max, percentiles)

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
   Example: "Compare Lando and Oscar" → get_telemetry(driver="NOR") + get_telemetry(driver="PIA")
3. Use 3-letter driver codes (NOR, not "Lando Norris").
4. For race: use session="R". For qualifying: use session="Q".
5. Always use correct GP names: "Abu Dhabi" (not "abu dhabi 23").
6. **YEAR RANGE**: Years 1950-2025 are supported with different data availability:
   - **1950-2017**: Use ergast tools ONLY (get_driver_standings, get_race, get_qualifying). NO telemetry/laps/weather available.
   - **2018-2025**: All tools available including telemetry, laps, weather, etc.
   Example for "Senna 1994 championship": {"steps": [{"tool": "get_driver_standings", "args": {"year": 1994}}], "reasoning": "1994 is pre-2018, using ergast API for standings."}
   Example for "1994 Monaco race telemetry": {"steps": [], "reasoning": "Telemetry not available for 1994. Only standings and results available for pre-2018 seasons."}
7. **TOOL SELECTION**:
   - Use get_telemetry for comparisons and visualization queries
   - Use get_telemetry_summary only when user explicitly asks for "stats" or "summary"
   - Use get_fastest_lap for single lap analysis
8. **WHAT-IF / HYPOTHETICAL QUERIES**: Use run_simulation for:
   - "What if X didn't happen?" (counterfactuals)
   - "What would happen if...?" (predictions)
   - "How would X affect Y?" (impact analysis)
   - "Simulate...", "Project...", "Predict..." queries
   DO NOT use LLM reasoning for hypotheticals. Always use run_simulation with appropriate parameters.
9. **DATA-DRIVEN SIMULATIONS**: For what-if queries about specific races/events:
   - Step 1: Fetch relevant historical data (get_laps, get_race, etc.) to ground the simulation
   - Step 2: Run simulation with base_value/variance informed by the fetched data
   This ensures simulations are based on REAL data, not guessed parameters.

**OUTPUT FORMAT**:
First, output your reasoning as plain text explaining your thought process.
Then, output the JSON plan on a new line starting with "PLAN:".

Example output:
I need to compare two drivers' lap times. This requires fetching data for each driver separately. Monaco 2024 is a recent race with full telemetry available. I'll use get_fastest_lap for both VER and HAM in qualifying session for efficiency.

PLAN: {"steps": [{"description": "Get fastest lap for Verstappen", "tool": "get_fastest_lap", "args": {"year": 2024, "gp": "Monaco", "session": "Q", "driver": "VER"}}, {"description": "Get fastest lap for Hamilton", "tool": "get_fastest_lap", "args": {"year": 2024, "gp": "Monaco", "session": "Q", "driver": "HAM"}}], "reasoning": "Using get_fastest_lap for token efficiency."}

Example 2: "Compare telemetry between Lando and Oscar in Abu Dhabi 2023 race"
The user wants telemetry comparison between two McLaren drivers. I need to get telemetry for both NOR and PIA. Since they want race data, I'll use session="R" and fetch the fastest lap for each driver.

PLAN: {"steps": [{"description": "Get telemetry for Norris", "tool": "get_telemetry", "args": {"year": 2023, "gp": "Abu Dhabi", "session": "R", "driver": "NOR", "lap": "fastest"}}, {"description": "Get telemetry for Piastri", "tool": "get_telemetry", "args": {"year": 2023, "gp": "Abu Dhabi", "session": "R", "driver": "PIA", "lap": "fastest"}}], "reasoning": "Using get_telemetry for visualization comparison."}

Example 3: "What if Abu Dhabi 2021 didn't end under safety car?"
This is a data-driven counterfactual. First I need to fetch the actual lap times around lap 53 (when SC was deployed) to see the real gap. Then simulate what would have happened without the SC.

PLAN: {"steps": [{"description": "Get HAM laps before safety car", "tool": "get_laps", "args": {"year": 2021, "gp": "Abu Dhabi", "session": "R", "driver": "HAM", "lap_start": 50, "lap_end": 55}}, {"description": "Get VER laps before safety car", "tool": "get_laps", "args": {"year": 2021, "gp": "Abu Dhabi", "session": "R", "driver": "VER", "lap_start": 50, "lap_end": 55}}, {"description": "Simulate race finish without SC", "tool": "run_simulation", "args": {"scenario_id": "abu-dhabi-21-no-sc", "horizon": "race", "metric": "gap", "base_value": 12.0, "variance": 2.0, "iterations": 1000}}], "reasoning": "Fetching real lap data to ground simulation. HAM had ~12s lead before SC."}

Example 4: "Show telemetry for Lando and Oscar in Monaco 2024"
The user wants to see telemetry for two drivers separately. Using "show" indicates they want individual visualizations for each driver, not a single comparison. I'll fetch telemetry for both NOR and PIA separately, which will create two distinct charts.

PLAN: {"steps": [{"description": "Get telemetry for Norris", "tool": "get_telemetry", "args": {"year": 2024, "gp": "Monaco", "session": "Q", "driver": "NOR", "lap": "fastest"}}, {"description": "Get telemetry for Piastri", "tool": "get_telemetry", "args": {"year": 2024, "gp": "Monaco", "session": "Q", "driver": "PIA", "lap": "fastest"}}], "reasoning": "Separate telemetry calls create individual charts in the visualization carousel."}

Example 5: "Compare qualifying results for Monaco 2024"
The user wants a comparison of all drivers in qualifying. A single call to get_qualifying will return all results, and the frontend will create a comparison chart showing all drivers.

PLAN: {"steps": [{"description": "Get qualifying results", "tool": "get_qualifying", "args": {"year": 2024, "gp": "Monaco"}}], "reasoning": "Single qualifying call provides comparison data for all drivers in one chart."}`;

// =============================================================================
// Shared Planner Helpers
// =============================================================================

/**
 * Build the full system prompt with date, web-search flag, and deep-research overrides.
 */
function buildPlannerPrompt(webSearchEnabled: boolean, deepResearchMode: boolean): string {
    let prompt = PLANNER_SYSTEM_PROMPT;
    const currentDate = new Date().toISOString().split('T')[0];
    prompt += `\n\nCurrent Date: ${currentDate}`;

    if (!webSearchEnabled) {
        prompt += "\n\n**NOTE: Web search is DISABLED. Do not use the web_search tool.**";
    }

    if (deepResearchMode) {
        prompt = prompt.replace(
            "MAX 5 steps total",
            "MAX 25 steps total. Create as many steps as needed for a comprehensive analysis."
        );
    }

    return prompt;
}

/**
 * Validate raw parsed plan, merge reasoning, filter web_search, and cap step count.
 */
function validateAndFilterPlan(
    parsedPlan: unknown,
    extractedReasoning: string | undefined,
    webSearchEnabled: boolean,
    deepResearchMode: boolean
): Plan {
    const validatedPlan = PlanSchema.parse(parsedPlan);

    if (extractedReasoning && !validatedPlan.reasoning) {
        validatedPlan.reasoning = extractedReasoning;
    } else if (extractedReasoning && validatedPlan.reasoning) {
        validatedPlan.reasoning = `${extractedReasoning}\n\n${validatedPlan.reasoning}`;
    }

    if (!webSearchEnabled) {
        validatedPlan.steps = validatedPlan.steps.filter(
            (step) => step.tool !== "web_search"
        );
    }

    const maxSteps = deepResearchMode ? 25 : 5;
    if (validatedPlan.steps.length > maxSteps) {
        validatedPlan.steps = validatedPlan.steps.slice(0, maxSteps);
    }

    return validatedPlan;
}

// =============================================================================
// Planner Functions
// =============================================================================

/**
 * Plan execution steps for a user query
 */
export async function planQuery(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    deepResearchMode: boolean = false
): Promise<Plan> {
    const systemPrompt = buildPlannerPrompt(webSearchEnabled, deepResearchMode);

    const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
    ];

    const response = await model.invoke(messages);

    const content =
        typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

    const { plan: parsedPlan, reasoning } = parseJsonResponse(content);

    return validateAndFilterPlan(parsedPlan, reasoning, webSearchEnabled, deepResearchMode);
}

/**
 * Stream planning with reasoning trace
 */
export async function streamPlanQuery(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    deepResearchMode: boolean = false,
    onReasoningToken?: (token: string) => void
): Promise<Plan> {
    const systemPrompt = buildPlannerPrompt(webSearchEnabled, deepResearchMode);

    const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
    ];

    let fullContent = "";
    const stream = await model.stream(messages);

    for await (const chunk of stream) {
        const content =
            typeof chunk.content === "string"
                ? chunk.content
                : JSON.stringify(chunk.content);

        if (content) {
            fullContent += content;

            if (onReasoningToken && !fullContent.includes('PLAN:')) {
                onReasoningToken(content);
            }
        }
    }

    const { plan: parsedPlan, reasoning } = parseJsonResponse(fullContent);

    return validateAndFilterPlan(parsedPlan, reasoning, webSearchEnabled, deepResearchMode);
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
