/**
 * Query Planner Module
 * ====================
 * Decomposes user queries into atomic execution steps using a cheap LLM.
 * Each step maps to a specific tool with validated arguments.
 */

import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatContentToText, LLM_TIMEOUT_MS } from "./llm";
import { envJson, maxSeasonYear, minSeasonYear, plannerConfig, seasonYearRangeLabel, telemetryStartYear } from "./config";
import {
    detectGpName,
    driverCodesPromptList,
    getSessionCodes,
    getTeams,
} from "./reference-data";

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
 * Schema for the complete execution plan (cap is config-driven;
 * evaluated at startup from F1_PLANNER_SCHEMA_MAX_STEPS).
 */
export const PlanSchema = z.object({
    steps: z.array(StepSchema).max(plannerConfig.schemaMaxSteps()).describe(`List of execution steps (max ${plannerConfig.schemaMaxSteps()})`),
    reasoning: z.string().optional().describe("Brief explanation of the plan"),
});

export type Step = z.infer<typeof StepSchema>;
export type Plan = z.infer<typeof PlanSchema>;

// =============================================================================
// Planner Prompt (built dynamically — years, driver codes, session codes,
// and step budgets all come from lib/config.ts + lib/reference-data.ts so the
// prompt tracks the live season and any configured overrides)
// =============================================================================

function plannerYearContext(): { currentYear: number; preTelemetryLastYear: number; yearRange: string; minYear: number; telemetryYear: number } {
    const currentYear = new Date().getFullYear();
    return {
        currentYear,
        // Full telemetry lags the calendar: the current season is in progress,
        // so the latest year with *complete* telemetry is last year.
        preTelemetryLastYear: currentYear - 1,
        yearRange: seasonYearRangeLabel(),
        minYear: minSeasonYear(),
        telemetryYear: telemetryStartYear(),
    };
}

function buildPlannerSystemPrompt(): string {
    const { currentYear, preTelemetryLastYear, yearRange, minYear, telemetryYear } = plannerYearContext();
    const driverCodes = driverCodesPromptList();
    const sessionCodes = getSessionCodes().join(", ");
    const teams = getTeams().join(", ");
    const maxSteps = plannerConfig.maxSteps();
    return `You are a query planner for an F1 AI assistant. Decompose queries into 1-${maxSteps} atomic execution steps.

Available Tools (FastAPI):
- get_seasons: Lists ${yearRange} seasons.
- get_events(year): Lists events.
- get_gp_names(year): Get canonical Grand Prix names for a season. Use this FIRST if you're unsure of the exact GP name.
- get_sessions(year, gp): Lists sessions (${sessionCodes}).
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
- retrieve_regulations(query, season, section, doc_type?, event?): Search FIA regulations + stewards' decisions (section: Sporting, Technical, Financial; doc_type: regulation or decision; event e.g. "Austrian Grand Prix" for decisions). Returns relevant chunks with source citations.
- web_search(query): For news/current events ONLY.

Simulation Tool:
- run_simulation(scenario_id, horizon, metric, iterations?, base_value?, variance?, seed?): Run counterfactual/predictive simulations for "what-if" analysis.
  * horizon: "lap" | "race" | "season" | "custom"
  * metric: "time" (lap times), "points" (0-25 per race), "gap" (performance delta), "position" (1-20), "score" (0-100)
  * base_value: Expected/average value. For "gap" use negative = faster (e.g., -2.5 means 2.5s faster per lap)
  * variance: Standard deviation for randomness
  * Returns: Statistical summary (mean, min, max, percentiles)

Known Driver Codes (${currentYear} grid — see reference data, updated dynamically):
${driverCodes}
NOTE: Driver lineups change yearly. If you are unsure of a driver's 3-letter code for a specific year, include a get_results or get_driver_standings step first to discover the correct codes from the actual data.

Known Teams: ${teams}

Session Codes: ${sessionCodes}

Rules:
1. MAX ${maxSteps} steps total.
2. **CRITICAL**: To compare MULTIPLE drivers, make SEPARATE tool calls for EACH driver.
   Example: "Compare Lando and Oscar" → get_telemetry(driver="NOR") + get_telemetry(driver="PIA")
3. Use 3-letter driver codes (NOR, not "Lando Norris"). If unsure of a driver's code for a specific year, plan a get_results or get_driver_standings call first to discover it.
4. For race: use session="R". For qualifying: use session="Q".
5. Always use correct GP names: "Abu Dhabi" (not "abu dhabi 23"). If unsure of the canonical GP name, include a get_gp_names(year) or get_events(year) step FIRST to discover valid names.
6. **YEAR RANGE**: Years ${minYear}-${currentYear} are supported with different data availability:
   - **${minYear}-${telemetryYear - 1}**: Use ergast tools ONLY (get_driver_standings, get_race, get_qualifying). NO telemetry/laps/weather available.
   - **${telemetryYear}-${preTelemetryLastYear}**: All tools available including telemetry, laps, weather, etc.
   - **${currentYear} (current season)**: Sessions that have already finished are available. Live / in-progress sessions are blocked at the API layer for cost protection; if the user asks about a session that is currently running, fall back to web_search for live updates.
   Example for "Senna 1994 championship": {"steps": [{"tool": "get_driver_standings", "args": {"year": 1994}}], "reasoning": "1994 is pre-${telemetryYear}, using ergast API for standings."}
   Example for "1994 Monaco race telemetry": {"steps": [], "reasoning": "Telemetry not available for 1994. Only standings and results available for pre-${telemetryYear} seasons."}
   Example for "${currentYear} Australian GP results": {"needs_plan": true, "reasoning": "Current-season completed race results are available via FastF1.", "steps": [{"description": "Get race results", "tool": "get_race", "args": {"year": ${currentYear}, "gp": "Australia"}}]}
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
10. **PENALTIES / STEWARDS' DECISIONS**: Queries about penalties, fines, disqualifications,
    investigations, protests, or appeals MUST use retrieve_regulations with doc_type="decision".
    Results/telemetry endpoints contain NO penalty data — never use get_events, get_race,
    or get_results for these. Use season=<year from query>; include event only when the
    user names a Grand Prix; leave section as "Sporting" (it is ignored for decisions).

**OUTPUT FORMAT (single call does both jobs)**:
Output ONLY a single JSON object — no markdown fences, no extra text.
Decide first: can this be answered WITHOUT any tool?

- Plain conversation (greetings, thanks, goodbyes, capability questions,
  anything answerable without F1 data):
  {"needs_plan": false, "reply": "<short warm reply, max 2 sentences>"}

- Anything needing F1 data, tools, or analysis:
  {"needs_plan": true, "reasoning": "<one-line plan rationale>", "steps": [...]}

Example A (conversational):
Input: "Hey! How can you help with F1?"
Output: {"needs_plan": false, "reply": "Hey! 🏎️ I can pull race results, compare drivers, analyze telemetry, explain regulations, or run what-if simulations — what are you curious about?"}

Example B (data):
Input: "Compare telemetry between Lando and Oscar in Abu Dhabi 2023 race"
Output: {"needs_plan": true, "reasoning": "Race telemetry comparison needs one call per driver.", "steps": [{"description": "Get telemetry for Norris", "tool": "get_telemetry", "args": {"year": 2023, "gp": "Abu Dhabi", "session": "R", "driver": "NOR", "lap": "fastest"}}, {"description": "Get telemetry for Piastri", "tool": "get_telemetry", "args": {"year": 2023, "gp": "Abu Dhabi", "session": "R", "driver": "PIA", "lap": "fastest"}}]}

Example C (what-if):
Input: "What if Abu Dhabi 2021 didn't end under safety car?"
Output: {"needs_plan": true, "reasoning": "Counterfactual needs real lap data first, then a grounded simulation.", "steps": [{"description": "Get HAM laps before safety car", "tool": "get_laps", "args": {"year": 2021, "gp": "Abu Dhabi", "session": "R", "driver": "HAM", "lap_start": 50, "lap_end": 55}}, {"description": "Get VER laps before safety car", "tool": "get_laps", "args": {"year": 2021, "gp": "Abu Dhabi", "session": "R", "driver": "VER", "lap_start": 50, "lap_end": 55}}, {"description": "Simulate race finish without SC", "tool": "run_simulation", "args": {"scenario_id": "abu-dhabi-21-no-sc", "horizon": "race", "metric": "gap", "base_value": 12.0, "variance": 2.0, "iterations": 1000}}]}

Example D (penalty / stewards' decision):
Input: "Who got the first penalty in 2024?"
Output: {"needs_plan": true, "reasoning": "Penalty question needs stewards' decision documents, not results.", "steps": [{"description": "Search 2024 stewards' decisions for penalties", "tool": "retrieve_regulations", "args": {"query": "penalty", "season": 2024, "section": "Sporting", "doc_type": "decision"}}]}`;
}

// =============================================================================
// Conversational Detection + Shared Planner Helpers
// =============================================================================

// =============================================================================
// Decide + Plan (single model call)
// =============================================================================

/**
 * Result of the single decide-and-plan model call. Conversational messages
 * resolve to a direct reply with no tools; data questions resolve to a plan.
 */
export interface PlanDecision {
    needsPlan: boolean;
    plan: Plan;
    /** Direct reply — only set when needsPlan is false. */
    reply?: string;
}

/**
 * Resolve a raw parsed model response into a PlanDecision.
 * Accepts both the new shape ({needs_plan, steps?, reply?, reasoning?})
 * and the legacy shape ({steps, reasoning?}, with or without a PLAN: prefix
 * handled upstream) so existing stubs and callers keep working.
 */
function resolveDecision(
    parsed: unknown,
    extractedReasoning: string | undefined,
    webSearchEnabled: boolean,
    deepResearchMode: boolean
): PlanDecision {
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error(`Failed to parse planner response as JSON`);
    }
    const obj = parsed as Record<string, unknown>;

    // Legacy shape: bare {steps, reasoning?} implies a plan is needed.
    if (!("needs_plan" in obj)) {
        return {
            needsPlan: true,
            plan: validateAndFilterPlan(parsed, extractedReasoning, webSearchEnabled, deepResearchMode),
        };
    }

    if (obj.needs_plan === false) {
        const reply = typeof obj.reply === "string" && obj.reply.trim() ? obj.reply : plannerConfig.fallbackReply();
        return {
            needsPlan: false,
            plan: {
                steps: [],
                reasoning: typeof obj.reasoning === "string" ? obj.reasoning : plannerConfig.fallbackReasoning(),
            },
            reply,
        };
    }

    if (obj.needs_plan === true) {
        return {
            needsPlan: true,
            plan: validateAndFilterPlan(
                { steps: obj.steps ?? [], reasoning: obj.reasoning },
                extractedReasoning,
                webSearchEnabled,
                deepResearchMode
            ),
        };
    }

    throw new Error(`Failed to parse planner response: invalid needs_plan value`);
}

/**
 * Build the full system prompt with date, web-search flag, and deep-research overrides.
 * Step budgets come from plannerConfig (F1_PLANNER_MAX_STEPS /
 * F1_PLANNER_DEEP_MAX_STEPS) so the cap the prompt advertises always matches
 * the cap validateAndFilterPlan enforces.
 */
function buildPlannerPrompt(webSearchEnabled: boolean, deepResearchMode: boolean): string {
    let prompt = buildPlannerSystemPrompt();
    const currentDate = new Date().toISOString().split('T')[0];
    prompt += `\n\nCurrent Date: ${currentDate}`;

    if (!webSearchEnabled) {
        prompt += "\n\n**NOTE: Web search is DISABLED. Do not use the web_search tool.**";
    }

    if (deepResearchMode) {
        const normalCap = `MAX ${plannerConfig.maxSteps()} steps total`;
        const deepCap = `MAX ${plannerConfig.deepMaxSteps()} steps total. Create as many steps as needed for a comprehensive analysis.`;
        if (prompt.includes(normalCap)) {
            prompt = prompt.replace(normalCap, deepCap);
        } else {
            prompt += `\n\n**NOTE: Deep research mode — up to ${plannerConfig.deepMaxSteps()} steps allowed.**`;
        }
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

    const maxSteps = deepResearchMode ? plannerConfig.deepMaxSteps() : plannerConfig.maxSteps();
    if (validatedPlan.steps.length > maxSteps) {
        validatedPlan.steps = validatedPlan.steps.slice(0, maxSteps);
    }

    return validatedPlan;
}

// =============================================================================
// Planner Functions
// =============================================================================

function responseToText(response: { content: unknown }): string {
    // Handles both string content (chat/completions) and content blocks
    // (responses API) via the shared helper.
    return chatContentToText(response.content);
}

/**
 * Decide AND plan in a SINGLE model call.
 * Conversational messages come back with a direct reply (no tools, no
 * second call); data questions come back with an execution plan.
 */
export async function decidePlan(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    deepResearchMode: boolean = false
): Promise<PlanDecision> {
    const systemPrompt = buildPlannerPrompt(webSearchEnabled, deepResearchMode);

    const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(message),
    ];

    const response = await model.invoke(messages, {
        // Hang protection: a stalled upstream must surface as an AbortError
        // (classified `network` by the caller) instead of hanging the stream.
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS.planner),
    });
    const { plan: parsed, reasoning } = parseJsonResponse(responseToText(response));

    return resolveDecision(parsed, reasoning, webSearchEnabled, deepResearchMode);
}

/**
 * Plan execution steps for a user query.
 * Thin wrapper over decidePlan for callers that only want the plan.
 */
export async function planQuery(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    deepResearchMode: boolean = false
): Promise<Plan> {
    return (await decidePlan(model, message, webSearchEnabled, deepResearchMode)).plan;
}

/**
 * Stream planning with reasoning trace.
 * Buffers the single decide-and-plan call, then resolves like planQuery.
 * (The onReasoningToken hook is kept for API compatibility but no longer
 * receives per-token planning output, since the new format is pure JSON.)
 */
export async function streamPlanQuery(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    deepResearchMode: boolean = false,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onReasoningToken?: (token: string) => void
): Promise<Plan> {
    return (await decidePlan(model, message, webSearchEnabled, deepResearchMode)).plan;
}

/**
 * Parse JSON from LLM response, handling markdown code blocks, the legacy
 * "reasoning text\n\nPLAN: {json}" prefix, and JSON objects embedded in
 * prose (via balanced-brace extraction). Returns the raw parsed value plus
 * any extracted reasoning prefix.
 */
function parseJsonResponse(content: string): { plan: unknown; reasoning?: string } {
    const text = content.trim();

    // 1) Canonical "PLAN: {json}" marker (legacy format)
    const planMarkerIndex = text.indexOf('PLAN:');
    if (planMarkerIndex !== -1) {
        const reasoningText = text.substring(0, planMarkerIndex).trim();
        const jsonStr = text.substring(planMarkerIndex + 5).trim();
        const tryParse = (s: string) => {
            try { return JSON.parse(s); } catch { return undefined; }
        };
        // Try as-is, then try the first balanced { ... } in jsonStr
        let parsed = tryParse(jsonStr);
        if (parsed === undefined) {
            const obj = extractFirstBalancedJsonObject(jsonStr);
            if (obj) parsed = tryParse(obj);
        }
        if (parsed !== undefined) return { plan: parsed, reasoning: reasoningText };
    }

    // 2) Markdown fenced block (```json ... ``` or ``` ... ```)
    const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
        const inside = jsonBlockMatch[1].trim();
        try { return { plan: JSON.parse(inside) }; } catch { /* fall through */ }
    }

    // 3) Whole response is JSON
    try { return { plan: JSON.parse(text) }; } catch { /* fall through */ }

    // 4) Embedded balanced JSON object somewhere in the response
    const embedded = extractFirstBalancedJsonObject(text);
    if (embedded) {
        try { return { plan: JSON.parse(embedded) }; } catch { /* fall through */ }
    }

    throw new Error(`Failed to parse planner response as JSON: ${text.slice(0, 200)}`);
}

/**
 * Find the first balanced top-level JSON object in `s`.
 *
 * Walks the string tracking brace depth (skipping braces inside strings and
 * respecting escape sequences). Returns the slice from the matching opening
 * brace to its closing brace, or null if no balanced object is found.
 *
 * This lets us recover plans from responses like:
 *   "Sure! Here you go:\n{\"steps\":[...]} \nLet me know if..."
 */
function extractFirstBalancedJsonObject(s: string): string | null {
    let depth = 0;
    let start = -1;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (escape) { escape = false; continue; }
        if (inString) {
            if (c === '\\') escape = true;
            else if (c === '"') inString = false;
            continue;
        }
        if (c === '"') { inString = true; continue; }
        if (c === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                return s.substring(start, i + 1);
            }
            if (depth < 0) return null;
        }
    }
    return null;
}

/**
 * Create a fallback plan when planning fails
 * Attempts to extract basic intent from the query
 */
export function createFallbackPlan(message: string): Plan {
    const lowerMessage = message.toLowerCase();

    // Year extraction bounds are config-driven (F1_MIN_SEASON_YEAR /
    // F1_SEASON_YEAR_BUFFER). Only accept 4-digit years in the plausible F1
    // range — a bare 2-digit number (e.g. the "21" in "Abu Dhabi 21") must
    // NOT become year 21.
    const yearMatch = message.match(/(?:19|20)\d{2}/);
    let year = new Date().getFullYear();
    if (yearMatch) {
        const parsed = parseInt(yearMatch[0], 10);
        if (parsed >= minSeasonYear() && parsed <= maxSeasonYear()) {
            year = parsed;
        }
    }

    // GP detection uses the shared reference-data patterns (built-ins +
    // F1_GP_PATTERNS_JSON env override + runtime registration).
    const gp = detectGpName(message);

    // Simulation / metric / horizon keyword sets are config-overridable so
    // new phrasings can be routed without code changes.
    const simKeywords = envJson<string[]>("F1_SIMULATION_KEYWORDS_JSON", [
        "what\\s*if", "simulate", "simulation", "predict", "project",
        "counterfactual", "hypothetical", "how\\s+would", "what\\s+would",
    ]);
    const simPattern = new RegExp(`\\b(${simKeywords.join("|")})\\b`, "i");
    const metricRules = envJson<Array<{ match: string; metric: string }>>("F1_SIMULATION_METRICS_JSON", [
        { match: "lap\\s*time|time", metric: "time" },
        { match: "points|championship|standings", metric: "points" },
        { match: "position|place|finish", metric: "position" },
        { match: "gap|delta|margin", metric: "gap" },
    ]);
    const horizonRules = envJson<Array<{ match: string; horizon: string }>>("F1_SIMULATION_HORIZONS_JSON", [
        { match: "season|championship|year", horizon: "season" },
        { match: "lap", horizon: "lap" },
    ]);
    const matchAny = (rules: Array<{ match: string }>, key: "metric" | "horizon"): string | null => {
        for (const rule of rules) {
            try {
                if (new RegExp(`\\b(${rule.match})\\b`, "i").test(lowerMessage)) {
                    return (rule as Record<string, string>)[key];
                }
            } catch {
                if (lowerMessage.includes(rule.match)) return (rule as Record<string, string>)[key];
            }
        }
        return null;
    };

    // Determine what type of data to fetch
    // PRIORITY: Detect simulation / what-if / predictive queries FIRST so they
    // don't fall through to a generic "get events" plan when the LLM planner
    // fails. These need run_simulation, not data retrieval.
    const isSimulationQuery = simPattern.test(lowerMessage);

    if (isSimulationQuery) {
        // Try to infer the metric/horizon from the query
        const metricMatch = matchAny(metricRules, "metric") ?? "points"; // sensible default for season-level what-ifs
        const horizonMatch = matchAny(horizonRules, "horizon") ?? "race"; // default to race-level

        // Build a scenario_id from the message so it's identifiable
        const scenarioId = message
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, "")
            .trim()
            .split(/\s+/)
            .slice(0, 6)
            .join("-")
            .slice(0, 60) || "fallback-scenario";

        return {
            steps: [
                {
                    description: `Run simulation for: ${message.slice(0, 80)}`,
                    tool: "run_simulation",
                    args: {
                        scenario_id: scenarioId,
                        horizon: horizonMatch,
                        metric: metricMatch,
                        iterations: 1000,
                    },
                    // base_value/variance intentionally omitted — the simulation
                    // tool will fall back to metric defaults.
                },
            ],
            reasoning: "Fallback: detected simulation/what-if query — routing to run_simulation",
        };
    }

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

    const penaltyKeywords = envJson<string[]>("F1_PENALTY_KEYWORDS_JSON", [
        "penalt", "steward", "disqualif", "investigat", "protest", "appeal", "fine ",
    ]);
    if (penaltyKeywords.some((k) => lowerMessage.includes(k))) {
        return {
            steps: [{ description: `Search ${year} stewards' decisions`, tool: "retrieve_regulations", args: { query: message.slice(0, 200), season: year, section: "Sporting", doc_type: "decision" } }],
            reasoning: "Fallback: detected penalty/decision query",
        };
    }

    // Default: return events for the detected year
    return {
        steps: [{ description: `Get event list for ${year}`, tool: "get_events", args: { year } }],
        reasoning: "Fallback: could not determine specific intent, returning season events",
    };
}
