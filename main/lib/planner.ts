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

// Data availability depends on the calendar year, so the current year is
// interpolated into the prompt rather than hardcoded — this keeps the
// planner honest about the current season without frequent code updates.
const PLANNER_CURRENT_YEAR = new Date().getFullYear();
// Full telemetry lags the calendar: the current season is in progress, so
// the latest year with *complete* telemetry is last year.
const PLANNER_PRE_TELEMETRY_LAST_YEAR = PLANNER_CURRENT_YEAR - 1;
const PLANNER_PROMPT_YEAR_RANGE = `1950-${PLANNER_CURRENT_YEAR}`;

const PLANNER_SYSTEM_PROMPT = `You are a query planner for an F1 AI assistant. Decompose queries into 1-5 atomic execution steps.

Available Tools (FastAPI):
- get_seasons: Lists ${PLANNER_PROMPT_YEAR_RANGE} seasons.
- get_events(year): Lists events.
- get_gp_names(year): Get canonical Grand Prix names for a season. Use this FIRST if you're unsure of the exact GP name.
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
- retrieve_regulations(query, season, section, doc_type?, event?): Search FIA regulations + stewards' decisions (section: Sporting, Technical, Financial; doc_type: regulation or decision; event e.g. "Austrian Grand Prix" for decisions). Returns relevant chunks with source citations.
- web_search(query, domain_type?, recency_minutes?, after_date?, before_date?): TinyFish web search. REQUIRED for latest/most-recent/last-race/current/news questions — use domain_type="news" plus a recency window (e.g. recency_minutes=10080 for the last 7 days). Returns sources with title/url/snippet/publisher/date.
- fetch_web_pages(urls, question?): TinyFish page extraction (clean markdown). Use AFTER web_search on the top 1-3 URLs to verify key facts before answering. NOT a substitute for searching.

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
NOTE: Driver lineups change yearly. If you are unsure of a driver's 3-letter code for a specific year, include a get_results or get_driver_standings step first to discover the correct codes from the actual data.

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
3. Use 3-letter driver codes (NOR, not "Lando Norris"). If unsure of a driver's code for a specific year, plan a get_results or get_driver_standings call first to discover it.
4. For race: use session="R". For qualifying: use session="Q".
5. Always use correct GP names: "Abu Dhabi" (not "abu dhabi 23"). If unsure of the canonical GP name, include a get_gp_names(year) or get_events(year) step FIRST to discover valid names.
6. **CONCRETE ARGS ONLY (no placeholders, ever)**: Every step's args must be fully concrete values — a real GP name, a real driver code, a real year. NEVER emit placeholder tokens like LAST_COMPLETED_GP, LATEST, TBD, "latest", "previous", or "current" in any structured arg (gp, driver, session, year, ...). Steps are validated before execution and placeholders are rejected, failing the step. If the GP/year is genuinely unknown, plan ONLY discovery steps (get_gp_names / get_events / web_search) with a concrete year — NO dependent data steps in the same plan.
7. **RECENCY ("latest" / "last race" / "most recent" / "current" / news)**: NEVER resolve these with FastF1 tools — you cannot know which GP was last without searching, and guessing a GP returns the wrong race. ALWAYS plan web_search first (domain_type="news", recency_minutes covering the question, e.g. 10080 for ~last week), then fetch_web_pages on the top URLs to verify. FastF1 tools are for NAMED GP + year analysis only.
8. **FOLLOW-UPS**: The conversation history (below, when present) is authoritative for pronouns and references — "that race", "the winner", "his fastest lap", "compare them" MUST be resolved from history into concrete args (GP name, year, driver codes). Only ask for clarification (needs_plan=false) when history contains no resolvable entity.
9. **YEAR RANGE**: Years 1950-${PLANNER_CURRENT_YEAR} are supported with different data availability:
   - **1950-2017**: Use ergast tools ONLY (get_driver_standings, get_race, get_qualifying). NO telemetry/laps/weather available.
   - **2018-${PLANNER_PRE_TELEMETRY_LAST_YEAR}**: All tools available including telemetry, laps, weather, etc.
   - **${PLANNER_CURRENT_YEAR} (current season)**: Sessions that have already finished are available. Live / in-progress sessions are blocked at the API layer for cost protection; if the user asks about a session that is currently running, fall back to web_search for live updates.
   Example for "Senna 1994 championship": {"steps": [{"tool": "get_driver_standings", "args": {"year": 1994}}], "reasoning": "1994 is pre-2018, using ergast API for standings."}
   Example for "1994 Monaco race telemetry": {"steps": [], "reasoning": "Telemetry not available for 1994. Only standings and results available for pre-2018 seasons."}
   Example for "${PLANNER_CURRENT_YEAR} Australian GP results": {"needs_plan": true, "reasoning": "Current-season completed race results are available via FastF1.", "steps": [{"description": "Get race results", "tool": "get_race", "args": {"year": ${PLANNER_CURRENT_YEAR}, "gp": "Australia"}}]}
10. **TOOL SELECTION**:
   - Use get_telemetry for comparisons and visualization queries
   - Use get_telemetry_summary only when user explicitly asks for "stats" or "summary"
   - Use get_fastest_lap for single lap analysis
11. **WHAT-IF / HYPOTHETICAL QUERIES**: Use run_simulation for:
   - "What if X didn't happen?" (counterfactuals)
   - "What would happen if...?" (predictions)
   - "How would X affect Y?" (impact analysis)
   - "Simulate...", "Project...", "Predict..." queries
   DO NOT use LLM reasoning for hypotheticals. Always use run_simulation with appropriate parameters.
12. **DATA-DRIVEN SIMULATIONS**: For what-if queries about specific races/events:
   - Step 1: Fetch relevant historical data (get_laps, get_race, etc.) to ground the simulation
   - Step 2: Run simulation with base_value/variance informed by the fetched data
   This ensures simulations are based on REAL data, not guessed parameters.
13. **PENALTIES / STEWARDS' DECISIONS**: Queries about penalties, fines, disqualifications,
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
Output: {"needs_plan": true, "reasoning": "Penalty question needs stewards' decision documents, not results.", "steps": [{"description": "Search 2024 stewards' decisions for penalties", "tool": "retrieve_regulations", "args": {"query": "penalty", "season": 2024, "section": "Sporting", "doc_type": "decision"}}]}

Example E (recency — NEVER guess a GP):
Input: "Who won the last race?"
Output: {"needs_plan": true, "reasoning": "Recency question needs web search, not a guessed GP.", "steps": [{"description": "Search news for the most recent F1 race winner", "tool": "web_search", "args": {"query": "most recent Formula 1 race winner", "domain_type": "news", "recency_minutes": 10080}}, {"description": "Verify winner on top sources", "tool": "fetch_web_pages", "args": {"urls": ["https://www.formula1.com/en/latest/article/..."], "question": "Who won the most recent Formula 1 race?"}}]}`;

// =============================================================================
// Conversational Detection + Shared Planner Helpers
// =============================================================================

/**
 * A single conversation turn passed to the planner so follow-ups
 * ("in that race", "his fastest lap", "compare them") can be resolved
 * into concrete args. Content should be pre-truncated by the caller.
 */
export interface ChatHistoryItem {
    role: "user" | "assistant";
    content: string;
}

/**
 * True when the message asks about recency: latest / last race /
 * most recent / current standings / news. Recency questions MUST be
 * answered from web search (TinyFish), never by pointing FastF1 tools
 * at a guessed or placeholder GP — the FastF1 backend fuzzy-matches
 * unknown GP strings to *some* event instead of failing, which
 * produces confidently-wrong "latest winner" answers (observed in prod).
 */
export function isRecencyQuery(message: string): boolean {
    return /\b(latest|most\s+recent|last\s+(race|grand\s*prix|gp|round|weekend|event)|who\s+won\s+(the\s+)?(last|latest)|just\s+(happened|finished|ended|announced)|breaking|this\s+week|current\s+(standings|season|championship|driver|drivers)|news\b)/i.test(
        message
    );
}

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
    deepResearchMode: boolean,
    webRecencyOnly: boolean = false
): PlanDecision {
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error(`Failed to parse planner response as JSON`);
    }
    const obj = parsed as Record<string, unknown>;

    // Legacy shape: bare {steps, reasoning?} implies a plan is needed.
    if (!("needs_plan" in obj)) {
        return {
            needsPlan: true,
            plan: validateAndFilterPlan(parsed, extractedReasoning, webSearchEnabled, deepResearchMode, webRecencyOnly),
        };
    }

    if (obj.needs_plan === false) {
        const reply = typeof obj.reply === "string" && obj.reply.trim() ? obj.reply : "Hey! 🏎️ How can I help you with F1 today?";
        return {
            needsPlan: false,
            plan: {
                steps: [],
                reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "Conversational message — no tools needed",
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
                deepResearchMode,
                webRecencyOnly
            ),
        };
    }

    throw new Error(`Failed to parse planner response: invalid needs_plan value`);
}

/** Web tools are gated separately from FastF1 tools (recency auto-allow). */
const WEB_TOOLS = new Set(["web_search", "fetch_web_pages"]);

/**
 * Render recent conversation turns for the planner prompt so follow-up
 * references ("that race", "the winner", "his fastest lap") resolve to
 * concrete args. Kept short: last 6 turns, 500 chars each.
 */
function renderHistoryBlock(history: ChatHistoryItem[]): string {
    const turns = (history || [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-6)
        .map((m) => `${m.role}: ${m.content.trim().slice(0, 500)}`);
    if (turns.length === 0) return "";
    return `\n\n## Conversation History (resolve pronouns/references from this — it is authoritative)\n${turns.join("\n")}`;
}

/**
 * Build the full system prompt with date, web-search scope, history,
 * and deep-research overrides.
 */
function buildPlannerPrompt(
    webSearchEnabled: boolean,
    deepResearchMode: boolean,
    webRecencyOnly: boolean = false,
    history: ChatHistoryItem[] = []
): string {
    let prompt = PLANNER_SYSTEM_PROMPT;
    const currentDate = new Date().toISOString().split('T')[0];
    prompt += `\n\nCurrent Date: ${currentDate}`;

    if (webSearchEnabled) {
        // Full web access — no extra note needed.
    } else if (webRecencyOnly) {
        prompt += "\n\n**NOTE: Web search is RESTRICTED to this recency query. Use web_search/fetch_web_pages ONLY for the latest/most-recent/current/news question at hand — not for general historical analysis (use FastF1 tools for that).**";
    } else {
        prompt += "\n\n**NOTE: Web search is DISABLED. Do not use the web_search or fetch_web_pages tools.**";
    }

    if (deepResearchMode) {
        prompt = prompt.replace(
            "MAX 5 steps total",
            "MAX 25 steps total. Create as many steps as needed for a comprehensive analysis."
        );
    }

    prompt += renderHistoryBlock(history);

    return prompt;
}

/**
 * Validate raw parsed plan, merge reasoning, filter web tools when they
 * are not allowed, and cap step count. Web tools survive the filter when
 * web search is enabled OR auto-allowed for a recency query.
 */
function validateAndFilterPlan(
    parsedPlan: unknown,
    extractedReasoning: string | undefined,
    webSearchEnabled: boolean,
    deepResearchMode: boolean,
    webRecencyOnly: boolean = false
): Plan {
    const validatedPlan = PlanSchema.parse(parsedPlan);

    if (extractedReasoning && !validatedPlan.reasoning) {
        validatedPlan.reasoning = extractedReasoning;
    } else if (extractedReasoning && validatedPlan.reasoning) {
        validatedPlan.reasoning = `${extractedReasoning}\n\n${validatedPlan.reasoning}`;
    }

    if (!webSearchEnabled && !webRecencyOnly) {
        validatedPlan.steps = validatedPlan.steps.filter(
            (step) => !WEB_TOOLS.has(step.tool)
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

function responseToText(response: { content: unknown }): string {
    // Handles both string content (chat/completions) and content blocks
    // (responses API) via the shared helper.
    return chatContentToText(response.content);
}

/**
 * Decide AND plan in a SINGLE model call.
 * Conversational messages come back with a direct reply (no tools, no
 * second call); data questions come back with an execution plan.
 *
 * @param history - recent conversation turns for follow-up resolution.
 *   Recency queries ("who won the last race") auto-allow web tools even
 *   when `webSearchEnabled` is false — FastF1 tools must never be used
 *   to guess "latest".
 */
export async function decidePlan(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    deepResearchMode: boolean = false,
    history: ChatHistoryItem[] = []
): Promise<PlanDecision> {
    const webRecencyOnly = !webSearchEnabled && isRecencyQuery(message);
    const systemPrompt = buildPlannerPrompt(webSearchEnabled, deepResearchMode, webRecencyOnly, history);

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

    return resolveDecision(parsed, reasoning, webSearchEnabled, deepResearchMode, webRecencyOnly);
}

/**
 * Plan execution steps for a user query.
 * Thin wrapper over decidePlan for callers that only want the plan.
 */
export async function planQuery(
    model: BaseChatModel,
    message: string,
    webSearchEnabled: boolean = false,
    deepResearchMode: boolean = false,
    history: ChatHistoryItem[] = []
): Promise<Plan> {
    return (await decidePlan(model, message, webSearchEnabled, deepResearchMode, history)).plan;
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
    onReasoningToken?: (token: string) => void,
    history: ChatHistoryItem[] = []
): Promise<Plan> {
    return (await decidePlan(model, message, webSearchEnabled, deepResearchMode, history)).plan;
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

    // RECENCY FIRST: when the LLM planner is down, "who won the last race"
    // must still resolve via web search — never via a guessed GP (the
    // FastF1 backend fuzzy-matches unknown strings to the wrong event).
    // web_search is pure HTTP (no LLM), so it works during model outages.
    if (isRecencyQuery(message)) {
        return {
            steps: [
                {
                    description: "Search news for the most recent F1 result (fallback)",
                    tool: "web_search",
                    args: {
                        query: message.slice(0, 200),
                        domain_type: "news",
                    },
                },
            ],
            reasoning: "Fallback: recency query — routing to web_search while the planner is unavailable",
        };
    }

    // Try to extract year. F1 history spans 1950+, so match 19xx and 20xx.
    // Only accept 4-digit years in the plausible F1 range — a bare 2-digit
    // number (e.g. the "21" in "Abu Dhabi 21") must NOT become year 21.
    const yearMatch = message.match(/(?:19|20)\d{2}/);
    let year = new Date().getFullYear();
    if (yearMatch) {
        const parsed = parseInt(yearMatch[0], 10);
        if (parsed >= 1950 && parsed <= new Date().getFullYear() + 2) {
            year = parsed;
        }
    }

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
    // PRIORITY: Detect simulation / what-if / predictive queries FIRST so they
    // don't fall through to a generic "get events" plan when the LLM planner
    // fails. These need run_simulation, not data retrieval.
    const isSimulationQuery =
        /\b(what\s*if|simulate|simulation|predict|project|counterfactual|hypothetical|how\s+would|what\s+would)\b/i.test(lowerMessage);

    if (isSimulationQuery) {
        // Try to infer the metric from the query
        const metricMatch = lowerMessage.match(/\b(lap\s*time|time)\b/i) ? "time"
            : lowerMessage.match(/\b(points|championship|standings)\b/i) ? "points"
                : lowerMessage.match(/\b(position|place|finish)\b/i) ? "position"
                    : lowerMessage.match(/\b(gap|delta|margin)\b/i) ? "gap"
                        : "points"; // sensible default for season-level what-ifs

        const horizonMatch = lowerMessage.match(/\b(season|championship|year)\b/i) ? "season"
            : lowerMessage.match(/\b(lap)\b/i) ? "lap"
                : "race"; // default to race-level

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

    if (lowerMessage.includes("penalt") || lowerMessage.includes("steward") || lowerMessage.includes("disqualif") || lowerMessage.includes("investigat") || lowerMessage.includes("protest") || lowerMessage.includes("appeal") || lowerMessage.includes("fine ")) {
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
