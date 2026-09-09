/**
 * Step Executor Module
 * ====================
 * Executes planned steps sequentially with timeout and error handling.
 * Aggregates results from all tool executions.
 */

import { StructuredTool } from "@langchain/core/tools";
import { Step } from "./planner";

// =============================================================================
// Types
// =============================================================================

export interface ExecutionResult {
    step: number;
    tool: string;
    args: Record<string, unknown>; // Input arguments used for the tool
    success: boolean;
    data?: unknown;
    error?: string;
    durationMs: number;
}

// =============================================================================
// Configuration
// =============================================================================


const STEP_TIMEOUT_MS = 60000;

// =============================================================================
// Tool name resolution
// =============================================================================
//
// LLMs frequently hallucinate tool names that are close to but not exactly
// the canonical name (e.g. `get_lap_times` instead of `get_laps`). Rather
// than fail every such step, we apply a small alias table and a fuzzy
// fallback. Anything still unmatched is reported back to the caller so
// the real bugs are still visible in the logs.

const TOOL_ALIASES: Record<string, string> = {
    get_lap_times: "get_laps",
    get_laptime: "get_laps",
    get_laptimes: "get_laps",
    get_lap_data: "get_laps",
    get_driver_standings_for_year: "get_driver_standings",
    get_championship_standings: "get_driver_standings",
    get_standings: "get_driver_standings",
    get_telemetry_data: "get_telemetry",
    get_telemetry_stats: "get_telemetry_summary",
    get_telemetry_summary_stats: "get_telemetry_summary",
    get_qualifying_results: "get_qualifying",
    get_race_results: "get_race",
    get_pit_stops: "get_stints",
    get_pit_strategy: "get_stints",
    get_tyre_strategy: "get_tyres",
    get_tire_strategy: "get_tyres",
    get_tire_stints: "get_tyres",
    get_session_results: "get_results",
    get_weather_data: "get_weather",
    get_safety_car: "get_race_control",
    get_race_control_messages: "get_race_control",
    simulate: "run_simulation",
    run_sim: "run_simulation",
    simulation: "run_simulation",
};

function resolveTool(
    requested: string,
    tools: Record<string, StructuredTool>
): { tool: StructuredTool | null; normalizedTool: string; aliasHit: boolean } {
    if (tools[requested]) {
        return { tool: tools[requested], normalizedTool: requested, aliasHit: false };
    }
    // 1) Alias table hit
    const alias = TOOL_ALIASES[requested];
    if (alias && tools[alias]) {
        return { tool: tools[alias], normalizedTool: alias, aliasHit: true };
    }
    // 2) Case-insensitive / underscore-stripped fuzzy match
    const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, "");
    const target = norm(requested);
    for (const name of Object.keys(tools)) {
        if (norm(name) === target) {
            return { tool: tools[name], normalizedTool: name, aliasHit: true };
        }
    }
    return { tool: null, normalizedTool: requested, aliasHit: false };
}

export interface ExecutionContext {
    results: ExecutionResult[];
    successCount: number;
    failureCount: number;
    totalDurationMs: number;
}

const MAX_RETRIES = 2;

function isRetryableError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("400") || msg.includes("401") || msg.includes("403") || msg.includes("404")) {
        return false;
    }
    return true;
}

async function executeStep(
    step: Step,
    stepIndex: number,
    tools: Record<string, StructuredTool>
): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Resolve the tool, applying common-sense aliases for hallucinated
    // tool names. We've seen Llama, Nemotron, and Poolside all invent
    // names like `get_lap_times`, `get_driver_standings_for_year`, or
    // `get_telemetry_data` instead of the canonical `get_laps`,
    // `get_driver_standings`, `get_telemetry`. A small alias table plus
    // a case-insensitive / underscore-stripped lookup catches the most
    // common ones without hiding actual bugs.
    const { tool, normalizedTool, aliasHit } = resolveTool(step.tool, tools);
    if (!tool) {
        return {
            step: stepIndex,
            tool: step.tool,
            args: step.args,
            success: false,
            error: `Unknown tool: ${step.tool}. Available: ${Object.keys(tools).join(", ")}`,
            durationMs: Date.now() - startTime,
        };
    }

    if (aliasHit && process.env.NODE_ENV === "development") {
        console.warn(
            `[Executor] Step ${stepIndex}: remapped hallucinated tool "${step.tool}" -> "${normalizedTool}"`
        );
    }

    // Validate args against tool schema. LangChain's tool.schema can be a
    // Zod schema, a JSON schema, or a callable returning either. Only Zod
    // schemas expose .parseAsync; fall back to safeParse or skipping when
    // the tool uses a different schema format.
    let validatedArgs = step.args;
    if (tool.schema) {
        try {
            const schema = tool.schema as { parseAsync?: (input: unknown) => Promise<unknown>; parse?: (input: unknown) => unknown };
            if (typeof schema.parseAsync === "function") {
                validatedArgs = await schema.parseAsync(step.args) as Record<string, unknown>;
            } else if (typeof schema.parse === "function") {
                validatedArgs = schema.parse(step.args) as Record<string, unknown>;
            }
            // If the schema is JSON-schema (no parse methods), skip strict
            // validation here — the tool will validate and surface errors.
        } catch (e) {
            return {
                step: stepIndex,
                tool: step.tool,
                args: step.args,
                success: false,
                error: `Schema validation failed: ${e instanceof Error ? e.message : String(e)}`,
                durationMs: Date.now() - startTime,
            };
        }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Execute with timeout. The timer is always cleared so we never
            // leak handles on the server (Next.js warns on dangling timers
            // and they keep the event loop alive under load).
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error("Tool execution timeout")), STEP_TIMEOUT_MS);
            });

            const resultPromise = tool.invoke(validatedArgs);
            let result: unknown;
            try {
                result = await Promise.race([resultPromise, timeoutPromise]);
            } finally {
                if (timeoutId !== undefined) clearTimeout(timeoutId);
            }

            let parsedData: unknown = result;
            if (typeof result === "string") {
                try {
                    parsedData = JSON.parse(result);
                } catch {
                    // Tool returned a plain string, not JSON — keep as-is
                    // rather than failing the step.
                    parsedData = result;
                }
            }

            return {
                step: stepIndex,
                tool: step.tool,
                args: validatedArgs as Record<string, unknown>,
                success: true,
                data: parsedData,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES && isRetryableError(error)) {
                // Exponential backoff: 1s, 2s
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise((r) => setTimeout(r, delay));
            } else {
                break;
            }
        }
    }

    return {
        step: stepIndex,
        tool: step.tool,
        args: step.args,
        success: false,
        error: lastError instanceof Error ? lastError.message : String(lastError) || "Tool execution failed",
        durationMs: Date.now() - startTime,
    };
}

/**
 * Execute all steps sequentially
 *
 * @param steps - Array of steps from the planner
 * @param tools - Map of available tools
 * @returns Execution context with all results
 */
export async function executeSteps(
    steps: Step[],
    tools: Record<string, StructuredTool>,
    onUpdate?: (step: number, status: 'pending' | 'running' | 'success' | 'failed', additional?: string) => void
): Promise<ExecutionContext> {
    const startTime = Date.now();

    // Limit to max steps provided by planner
    const stepsToExecute = steps;

    // Initial pending state
    stepsToExecute.forEach((_, index) => {
        onUpdate?.(index + 1, 'pending');
    });

    // Execute in parallel with concurrency limit (max 3)
    const CONCURRENCY_LIMIT = 3;
    const results: ExecutionResult[] = new Array(stepsToExecute.length);
    let currentIndex = 0;

    const worker = async () => {
        while (currentIndex < stepsToExecute.length) {
            const index = currentIndex++;
            const step = stepsToExecute[index];
            const stepNum = index + 1;

            onUpdate?.(stepNum, 'running');
            const result = await executeStep(step, stepNum, tools);

            onUpdate?.(
                stepNum,
                result.success ? 'success' : 'failed',
                result.success ? undefined : result.error
            );

            results[index] = result;
        }
    };

    const workers = Array.from(
        { length: Math.min(CONCURRENCY_LIMIT, stepsToExecute.length) },
        () => worker()
    );
    await Promise.all(workers);

    // Log execution (for debugging)
    if (process.env.NODE_ENV === "development") {
        results.forEach(result => {
            console.log(
                `[Executor] Step ${result.step}: ${result.tool} - ${result.success ? "SUCCESS" : "FAILED"} (${result.durationMs}ms)`
            );
            if (!result.success && result.error) {
                console.error(`[Executor] Error details for Step ${result.step}:`, result.error);
            }
        });
    }

    return {
        results,
        successCount: results.filter((r) => r.success).length,
        failureCount: results.filter((r) => !r.success).length,
        totalDurationMs: Date.now() - startTime,
    };
}

// =============================================================================
// Context Budgeting Configuration
// =============================================================================

const MAX_CONTEXT_TOKENS = 150_000; // Safe limit below 262k
const CHARS_PER_TOKEN = 3; // Safer estimate for dense JSON: 1 token ≈ 3 characters
/** Max rows kept per list payload (results, standings, events, ...) before row-truncation kicks in. */
const MAX_ROWS_PER_LIST = 12;

/**
 * Estimate token count from a string
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check if data is telemetry-like (has 'data' array with many points)
 */
function isTelemetryData(data: unknown): data is { data: unknown[];[key: string]: unknown } {
    return (
        typeof data === "object" &&
        data !== null &&
        "data" in data &&
        Array.isArray((data as { data: unknown[] }).data) &&
        (data as { data: unknown[] }).data.length > 50
    );
}

/**
 * Check if data is laps-like (has 'laps' array with many entries)
 */
function isLapsData(data: unknown): data is { laps: unknown[];[key: string]: unknown } {
    return (
        typeof data === "object" &&
        data !== null &&
        "laps" in data &&
        Array.isArray((data as { laps: unknown[] }).laps) &&
        (data as { laps: unknown[] }).laps.length > 20
    );
}

/**
 * Summarize telemetry data for LLM consumption
 * Replaces raw data array with statistical summary
 */
function summarizeTelemetryForLLM(data: { data: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const points = data.data as Array<Record<string, number>>;

    if (points.length === 0) {
        return { ...data, data: [], summary: "No telemetry data available" };
    }

    // Extract numeric channels
    const channels = Object.keys(points[0]).filter(
        (key) => typeof points[0][key] === "number" && key !== "Time" && key !== "Distance"
    );

    const summary: Record<string, { min: number; max: number; avg: number }> = {};

    for (const channel of channels) {
        const values = points.map((p) => p[channel]).filter((v) => typeof v === "number" && !isNaN(v));
        if (values.length > 0) {
            summary[channel] = {
                min: Math.round(values.reduce((a, b) => Math.min(a, b)) * 100) / 100,
                max: Math.round(values.reduce((a, b) => Math.max(a, b)) * 100) / 100,
                avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
            };
        }
    }

    // Keep only essential metadata + summary. Field names are chosen to
    // avoid racing-domain misreads: `telemetry_points` is the count of
    // telemetry samples (NOT championship points), and `lap_number` is
    // which lap was sampled (NOT a finishing position).
    return {
        driver: data.driver,
        lap_number: data.lap_number,
        lap_time: data.lap_time,
        telemetry_points: points.length,
        telemetry_summary: summary,
        note: "Raw telemetry data replaced with statistical summary for LLM context efficiency",
    };
}


/**
 * Helper to parse various lap time formats into seconds
 * Handles: numbers, "MM:SS.mmm", "HH:MM:SS.mmm"
 */
function parseLapTimeToSeconds(lapTime: unknown): number | null {
    if (typeof lapTime === 'number') return lapTime;

    if (typeof lapTime === 'string') {
        // Clean potential "0 days " prefix (common in Python timedelta stringification)
        const cleanTime = lapTime.replace("0 days ", "").trim();

        const parts = cleanTime.split(':');

        // Handle HH:MM:SS.mmm
        if (parts.length === 3) {
            const h = parseFloat(parts[0]);
            const m = parseFloat(parts[1]);
            const s = parseFloat(parts[2]);
            if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
            return h * 3600 + m * 60 + s;
        }
        // Handle MM:SS.mmm
        if (parts.length === 2) {
            const m = parseFloat(parts[0]);
            const s = parseFloat(parts[1]);
            if (isNaN(m) || isNaN(s)) return null;
            return m * 60 + s;
        }

        // Handle raw seconds string
        const num = parseFloat(cleanTime);
        return isNaN(num) ? null : num;
    }

    return null;
}

/**
 * Summarize laps data for LLM consumption
 * Keeps only key laps (fastest, first, last) and aggregates the rest
 */
function summarizeLapsForLLM(data: { laps: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const laps = data.laps as Array<Record<string, unknown>>;

    if (laps.length === 0) {
        return { ...data, summary: "No lap data available" };
    }

    // Find fastest lap (lexical comparison works for standard time strings)
    const fastestLap = laps.reduce((fastest, lap) => {
        const currentSec = parseLapTimeToSeconds(lap.LapTime);
        const fastestSec = parseLapTimeToSeconds(fastest.LapTime);

        if (currentSec === null) return fastest;
        if (fastestSec === null) return lap;

        return currentSec < fastestSec ? lap : fastest;
    }, laps[0]);

    // Calculate Average Lap Time
    const validLapSeconds = laps
        .map((l) => parseLapTimeToSeconds(l.LapTime))
        .filter((t): t is number => t !== null && t > 0);

    let averageLapTimeStr = "N/A";

    if (validLapSeconds.length > 0) {
        const totalSeconds = validLapSeconds.reduce((a, b) => a + b, 0);
        const avgSeconds = totalSeconds / validLapSeconds.length;

        // Format back to MM:SS.mmm for readability
        const mins = Math.floor(avgSeconds / 60);
        const secs = (avgSeconds % 60).toFixed(3);
        averageLapTimeStr = `${mins}:${secs.padStart(6, '0')}`;
    }

    // Get first and last lap
    const firstLap = laps[0];
    const lastLap = laps[laps.length - 1];

    return {
        session_name: data.session_name,
        total_laps: laps.length,
        average_lap_time: averageLapTimeStr,
        key_laps: {
            fastest: fastestLap,
            first: firstLap,
            last: lastLap,
        },
        laps_with_times: validLapSeconds.length,
        note: "Full lap table replaced with key laps and average summary for LLM context efficiency",
    };
}

/**
 * Reduce a single result's data if it's too large
 */
function reduceResultData(result: ExecutionResult): ExecutionResult {
    if (!result.success || !result.data) {
        return result;
    }

    // Check if it's telemetry data and summarize
    if (isTelemetryData(result.data)) {
        return {
            ...result,
            data: summarizeTelemetryForLLM(result.data),
        };
    }

    // Check if it's laps data and summarize
    if (isLapsData(result.data)) {
        return {
            ...result,
            data: summarizeLapsForLLM(result.data),
        };
    }

    // Check for other large row-list payloads (results, standings, events,
    // weather, tyres, stints, race control, ...): keep the first rows and
    // note how many were omitted, instead of nuking the whole payload.
    // (Without this, e.g. a 20-driver results table collapses to a
    // "[Data too large]" stub and the responder is forced to refuse.)
    if (typeof result.data === "object" && result.data !== null) {
        const rec = result.data as Record<string, unknown>;
        for (const key of Object.keys(rec)) {
            const val = rec[key];
            if (Array.isArray(val) && val.length > MAX_ROWS_PER_LIST) {
                return {
                    ...result,
                    data: {
                        ...rec,
                        [key]: val.slice(0, MAX_ROWS_PER_LIST),
                        [`${key}_truncated_from`]: val.length,
                        note: `Showing first ${MAX_ROWS_PER_LIST} of ${val.length} ${key} for LLM context efficiency`,
                    },
                };
            }
        }
    }

    // Generic truncation for large payloads
    try {
        const strData = JSON.stringify(result.data);
        if (strData.length > 10000) {
            let summaryInfo = "";
            if (typeof result.data === "object" && result.data !== null) {
                summaryInfo = ` Keys available: ${Object.keys(result.data).join(", ")}`;
            }
            return {
                ...result,
                data: `[Data too large, truncated. String length: ${strData.length}.${summaryInfo}]`,
            };
        }
    } catch {
        // Ignore JSON stringify errors for circular refs
    }

    return result;
}


export function aggregateContext(context: ExecutionContext): string {
    if (context.results.length === 0) {
        return "No data was retrieved from F1 tools.";
    }

    // Step 1: Reduce large data structures (telemetry, laps, etc.)
    const reducedResults = context.results.map(reduceResultData);

    const sections: string[] = [];

    for (const result of reducedResults) {
        if (result.success && result.data) {
            sections.push(
                `### ${result.tool} (Step ${result.step})\n` +
                "```json\n" +
                `${JSON.stringify(result.data, null, 2)}\n` +
                "```"
            );
        } else if (!result.success) {
            sections.push(
                `### ${result.tool} (Step ${result.step}) - FAILED\n` +
                `Error: ${result.error}`
            );
        }
    }

    const summary =
        `**Execution Summary**: ` +
        `${context.successCount}/${context.results.length} steps succeeded ` +
        `in ${context.totalDurationMs}ms`;

    // Build progressively to avoid mid-section truncation
    const maxChars = MAX_CONTEXT_TOKENS * CHARS_PER_TOKEN;
    let aggregated = summary;
    let remaining = maxChars - summary.length;

    for (const section of sections) {
        // +2 for the double newline we add
        const sectionSize = section.length + 2;

        if (sectionSize > remaining) {
            aggregated +=
                "\n\n**[Context truncated due to size limits — some tool results omitted]**";
            break;
        }

        aggregated += `\n\n${section}`;
        remaining -= sectionSize;
    }

    // Optional safety check (logging only)
    const estimatedTokens = estimateTokens(aggregated);
    if (estimatedTokens > MAX_CONTEXT_TOKENS) {
        console.warn(
            `[Executor] Context near token limit (${estimatedTokens}/${MAX_CONTEXT_TOKENS})`
        );
    }

    return aggregated;
}

/**
 * Create a simplified context object for the LLM (less verbose)
 *
 * @param context - Execution context with results
 * @returns Simplified data object
 */
export function simplifyContext(context: ExecutionContext): Record<string, unknown> {
    const simplified: Record<string, unknown> = {};

    for (const result of context.results) {
        if (result.success && result.data) {
            // Use tool name as key, add index if duplicate
            const key = simplified[result.tool] ? `${result.tool}_${result.step}` : result.tool;
            simplified[key] = result.data;
        }
    }

    return simplified;
}
