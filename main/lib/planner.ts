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
    steps: z.array(StepSchema).max(5).describe("List of execution steps (max 5)"),
    reasoning: z.string().optional().describe("Brief explanation of the plan"),
});

export type Step = z.infer<typeof StepSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// =============================================================================
// Planner Prompt
// =============================================================================

const PLANNER_SYSTEM_PROMPT = `You are a query planner for an F1 AI assistant using the OpenF1 API and Ergast API. Decompose queries into 1-5 atomic execution steps.

**CRITICAL WORKFLOW**:
1. For OpenF1 (2023+ data), get session_key first via get_sessions.
2. For Historical (pre-2023) or Aggregated Stats ("since 2015", "drivers with > 100 points"), use get_driver_standings or get_cumulative_stats.

Available Tools:

Historical & Aggregated Stats (1950+):
- get_driver_standings(year, round?): Driver standings for ANY year. Use 'round' for standings after X rounds.
- get_cumulative_stats(year_gte, year_lte, round_gte?, round_lte?): Aggregated stats (points, wins) over multiple years or round ranges.
  - Use for: "drivers with > 400 points since 2015", "points scored between round 12 and 16", "first 5 rounds of 2024".

Session Discovery (OpenF1, 2023+ ONLY):
- get_seasons: Lists available seasons (2023-2025)
- get_meetings(year, country_name?): Lists Grand Prix weekends for a year. Returns meeting_key.
- get_sessions(year?, country_name?, session_name?, meeting_key?): Get sessions. Returns session_key. ALWAYS call this first to get the session_key!

Driver & Lap Data (OpenF1, 2023+ ONLY):
- get_drivers(session_key, driver_number?, name_acronym?): Driver info for a session
- get_laps(session_key, driver_number?, lap_number?): Lap times and sectors

Telemetry (High-frequency data) (OpenF1, 2023+ ONLY):
- get_car_data(session_key, driver_number, date_gte?, date_lte?): Telemetry (speed, throttle, brake)
- get_location(session_key, driver_number, date_gte?, date_lte?): Car position on track

Race Data (OpenF1, 2023+ ONLY):
- get_intervals(session_key, driver_number?): Gap data between drivers
- get_position(session_key, driver_number?, position_lte?): Position changes
- get_race_control(session_key, category?, flag?): Flags, penalties, safety cars
- get_weather(session_key): Weather conditions

Strategy (OpenF1, 2023+ ONLY):
- get_stints(session_key, driver_number?, compound?): Tyre stints
- get_pit_stops(session_key, driver_number?): Pit stop data

Results (OpenF1, 2023+ ONLY):
- get_session_results(session_key, position_lte?): Final standings
- get_starting_grid(session_key, position_lte?): Grid positions
- get_overtakes(session_key, driver_number?): Overtake data (beta)
- get_team_radio(session_key, driver_number?): Radio messages

- web_search(query): For news/current events ONLY.
- create_visualization(chart_type, data_source): Create chart from collected data. Use as FINAL step when user wants visualization.
  - chart_types: "lap_times", "telemetry", "comparison", "weather"
  - data_source: tool name that fetched data (e.g., "get_laps", "get_car_data")

Rules:
1. MAX 5 steps total.
2. ALWAYS get session_key first via get_sessions for OpenF1 tools.
3. For pre-2023 data, utilize get_driver_standings or get_cumulative_stats. Do NOT use OpenF1 tools for < 2023.
4. To compare MULTIPLE drivers, make SEPARATE tool calls for EACH driver.
5. Use driver_number (e.g., 1, 44) not driver codes in tool args.
6. Output ONLY valid JSON.
7. If user asks to "show", "plot", "graph", or "visualize" data, add create_visualization as FINAL step.
8. If the query is ambiguous, unsafe, or impossible, return "steps": [] and explain why in "reasoning".

Example 1: "Who scored the most points since 2015?"
{
  "steps": [
    { "description": "Get cumulative stats from 2015 to 2025", "tool": "get_cumulative_stats", "args": { "year_gte": 2015, "year_lte": 2025 } }
  ],
  "reasoning": "User asks for cumulative points since 2015. Using get_cumulative_stats."
}

Example 2: "Drivers with more than 100 points after 10 rounds since 2015"
{
  "steps": [
    { "description": "Get cumulative stats since 2015 for first 10 rounds", "tool": "get_cumulative_stats", "args": { "year_gte": 2015, "year_lte": 2025, "round_lte": 10 } }
  ],
  "reasoning": "Since 2015, filtered to 'after 10 rounds' implies limits to first 10 rounds of each season."
}

Example 3: "Standings in 2012"
{
  "steps": [
    { "description": "Get 2012 standings", "tool": "get_driver_standings", "args": { "year": 2012 } }
  ],
  "reasoning": "Historical standings request for 2012."
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
    let plan: any;
    try {
        plan = parseJsonResponse(content);
    } catch (error) {
        // Fallback for non-JSON responses (likely conversational refusal/clarification)
        console.warn("Planner output was not valid JSON, treating as raw reasoning:", content);
        return {
            steps: [],
            reasoning: content
        };
    }

    // Validate with Zod
    try {
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
    } catch (zodError) {
        console.warn("Planner JSON schema validation failed:", zodError);
        return {
            steps: [],
            reasoning: `Plan validation failed: ${typeof plan === 'object' ? JSON.stringify(plan) : content}`
        };
    }
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

    // Try to extract year (OpenF1 only supports 2023+)
    const yearMatch = message.match(/20(23|24|25)/);
    const year = yearMatch ? parseInt(`20${yearMatch[1]}`) : 2024;

    // Try to detect country name from common ones
    const countryPatterns = [
        { pattern: /monaco/i, name: "Monaco" },
        { pattern: /silverstone|british|great britain/i, name: "Great Britain" },
        { pattern: /monza|italian|italy/i, name: "Italy" },
        { pattern: /spa|belgium|belgian/i, name: "Belgium" },
        { pattern: /suzuka|japanese|japan/i, name: "Japan" },
        { pattern: /austin|us\s*gp|united states|usa/i, name: "United States" },
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

    let countryName: string | null = null;
    for (const { pattern, name } of countryPatterns) {
        if (pattern.test(message)) {
            countryName = name;
            break;
        }
    }

    // Detect session type
    let sessionName: string | null = null;
    if (lowerMessage.includes("qualifying") || lowerMessage.includes("q1") || lowerMessage.includes("q2") || lowerMessage.includes("q3")) {
        sessionName = "Qualifying";
    } else if (lowerMessage.includes("race") || lowerMessage.includes("winner") || lowerMessage.includes("podium")) {
        sessionName = "Race";
    } else if (lowerMessage.includes("sprint")) {
        sessionName = "Sprint";
    } else if (lowerMessage.includes("practice") || lowerMessage.includes("fp1") || lowerMessage.includes("fp2") || lowerMessage.includes("fp3")) {
        sessionName = "Practice 1";
    }

    // If we have both country and session, get the session
    if (countryName && sessionName) {
        return {
            steps: [
                {
                    description: `Get ${sessionName} session for ${countryName} ${year}`,
                    tool: "get_sessions",
                    args: { year, country_name: countryName, session_name: sessionName }
                }
            ],
            reasoning: `Fallback: detected ${sessionName.toLowerCase()} query for ${countryName}`,
        };
    }

    // If only country, get all sessions for that meeting
    if (countryName) {
        return {
            steps: [
                {
                    description: `Get sessions for ${countryName} ${year}`,
                    tool: "get_sessions",
                    args: { year, country_name: countryName }
                }
            ],
            reasoning: `Fallback: detected ${countryName} query`,
        };
    }

    // If season/calendar query
    if (lowerMessage.includes("season") || lowerMessage.includes("calendar") || lowerMessage.includes("events") || lowerMessage.includes("schedule")) {
        return {
            steps: [{ description: `Get meetings for ${year}`, tool: "get_meetings", args: { year } }],
            reasoning: "Fallback: detected season/calendar query",
        };
    }

    // Default: return meetings for the detected year
    return {
        steps: [{ description: `Get meetings for ${year}`, tool: "get_meetings", args: { year } }],
        reasoning: "Fallback: could not determine specific intent, returning season meetings",
    };
}

