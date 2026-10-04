/**
 * Step Executor Module
 * ====================
 * Executes planned steps sequentially with timeout and error handling.
 * Aggregates results from all tool executions.
 */

import { StructuredTool } from "@langchain/core/tools";
import { Step } from "./planner";
import { findPlaceholderArg, placeholderError, PLACEHOLDER_ERROR_PREFIX } from "./args-guard";

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
    if (msg.includes(PLACEHOLDER_ERROR_PREFIX)) {
        return false;
    }
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
        if (process.env.NODE_ENV === "development") {
            console.warn(
                `[Executor] Step ${stepIndex}: unknown tool "${step.tool}". Available: ${Object.keys(tools).join(", ")}`
            );
        }
        return {
            step: stepIndex,
            tool: step.tool,
            args: step.args,
            success: false,
            error: `Unknown tool: ${step.tool}`,
            durationMs: Date.now() - startTime,
        };
    }

    if (aliasHit && process.env.NODE_ENV === "development") {
        console.warn(
            `[Executor] Step ${stepIndex}: remapped hallucinated tool "${step.tool}" -> "${normalizedTool}"`
        );
    }

    // Fail closed on placeholder args (e.g. gp="LAST_COMPLETED_GP"): the
    // FastF1 backend fuzzy-matches unknown strings to *some* event instead
    // of failing, so executing would return confidently-wrong data. Checked
    // against the RAW step args (before schema validation can strip them).
    const placeholder = findPlaceholderArg(step.args);
    if (placeholder) {
        return {
            step: stepIndex,
            tool: step.tool,
            args: step.args,
            success: false,
            error: placeholderError(normalizedTool, placeholder),
            durationMs: Date.now() - startTime,
        };
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
/** Max rows kept per list payload before row-truncation kicks in. */
const MAX_ROWS_PER_LIST = 12;
/**
 * Per-payload row caps. Schedules and full classifications must stay
 * COMPLETE in LLM context — the responder anchors "last race" / "next
 * race" by comparing every event_date against today, and answers
 * backmarker questions (P20, last place) from full results tables.
 * These payloads are small (a 25-event schedule ≈ 6KB, a 20-driver
 * table ≈ 3KB), so keeping them whole is cheaper than a wrong answer.
 * Large time-series (`data`, `messages`, `laps`, ...) keep the tight cap.
 */
const ROW_CAP_BY_KEY: Record<string, number> = {
    events: 30,
    grand_prix: 30,
    results: 25,
    standings: 25,
    sessions: 15,
};

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
 * Check if data is web-fetch output (has 'pages' array with text extracts)
 */
function isFetchData(data: unknown): data is { pages: unknown[];[key: string]: unknown } {
    return (
        typeof data === "object" &&
        data !== null &&
        "pages" in data &&
        Array.isArray((data as { pages: unknown[] }).pages)
    );
}

/** Max chars kept per fetched page for LLM context (full text stays in the trace). */
const MAX_FETCH_CHARS_PER_PAGE = 2000;

/**
 * Trim fetched pages for LLM consumption: keep title/url/date plus the
 * head of each extraction. Without this the generic 10k stub below would
 * nuke the whole payload and the responder would get nothing.
 */
function summarizeFetchForLLM(data: { pages: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const pages = (data.pages as Array<Record<string, unknown>>).map((p) => {
        const text = typeof p.text === "string" ? p.text : "";
        return {
            url: p.url,
            final_url: p.final_url,
            title: p.title,
            ...(typeof p.published_date === "string" ? { published_date: p.published_date } : {}),
            text: text.length > MAX_FETCH_CHARS_PER_PAGE
                ? text.slice(0, MAX_FETCH_CHARS_PER_PAGE) + "\n\n[truncated for context]"
                : text,
        };
    });
    return {
        pages,
        ...("errors" in data ? { errors: data.errors } : {}),
        ...("question" in data ? { question: data.question } : {}),
        note: "Page texts trimmed to head excerpts for LLM context efficiency",
    };
}

/**
 * Check if data is regulation retrieval output (has 'retrieved_documents' array)
 */
function isRegulationData(data: unknown): data is { retrieved_documents: unknown[];[key: string]: unknown } {
    return (
        typeof data === "object" &&
        data !== null &&
        "retrieved_documents" in data &&
        Array.isArray((data as { retrieved_documents: unknown[] }).retrieved_documents)
    );
}

const MAX_REG_DOCS = 5;
const MAX_REG_CONTENT_CHARS = 1500;

/**
 * Citation fields kept per regulation chunk. Everything needed to cite
 * and link the source survives; chunk text is trimmed, never dropped.
 */
const REG_DOC_FIELDS = [
    "source",
    "title",
    "url",
    "source_url",
    "doc_type",
    "section",
    "event",
    "season",
    "published_on",
    "relevance_score",
] as const;

/**
 * Trim regulation chunks for LLM consumption: keep the top docs by
 * relevance_score with full citation fields plus the head of each chunk.
 * Without this the generic 10k stub below nukes the whole payload and
 * the responder refuses despite relevant docs being retrieved.
 */
function summarizeRegulationsForLLM(data: { retrieved_documents: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const docs = (data.retrieved_documents as Array<Record<string, unknown>>)
        .filter((doc) => typeof doc === "object" && doc !== null)
        .map((doc, index) => ({ doc, index }))
        .sort((a, b) => {
            const ra = typeof a.doc.relevance_score === "number" ? a.doc.relevance_score : -1;
            const rb = typeof b.doc.relevance_score === "number" ? b.doc.relevance_score : -1;
            return rb - ra || a.index - b.index;
        })
        .map(({ doc }) => doc);
    let trimmed = false;
    const kept = docs.slice(0, MAX_REG_DOCS).map((doc) => {
        const out: Record<string, unknown> = {};
        for (const f of REG_DOC_FIELDS) {
            if (doc[f] !== undefined && doc[f] !== null && doc[f] !== "") {
                out[f] = doc[f];
            }
        }
        const content = typeof doc.content === "string" ? doc.content : "";
        if (content.length > MAX_REG_CONTENT_CHARS) {
            trimmed = true;
            out.content = content.slice(0, MAX_REG_CONTENT_CHARS) + "\n\n[truncated for context]";
        } else {
            out.content = content;
        }
        return out;
    });
    const dropped = docs.length - kept.length;
    return {
        retrieved_documents: kept,
        ...("used_subqueries" in data ? { used_subqueries: data.used_subqueries } : {}),
        ...(dropped > 0 ? { retrieved_documents_truncated_from: docs.length } : {}),
        ...(dropped > 0 || trimmed
            ? { note: "Regulation chunks trimmed to head excerpts for LLM context efficiency" }
            : {}),
    };
}

/**
 * Fields the responder needs per classification row. Everything else the
 * backend sends (headshot URLs, team colors, empty broadcast/country
 * fields, Q1-Q3 nulls on race payloads) is context bloat: ~500 chars/row
 * × 20 rows trips the 10KB generic stub and hides the backmarkers.
 */
const CLASSIFICATION_ROW_FIELDS = [
    "Position",
    "ClassifiedPosition",
    "GridPosition",
    "Abbreviation",
    "Driver",
    "DriverId",
    "FullName",
    "FirstName",
    "LastName",
    "TeamName",
    "TeamId",
    "Time",
    "Gap",
    "Q1",
    "Q2",
    "Q3",
    "Status",
    "Points",
    "Laps",
] as const;

/**
 * Project a fat classification row to the fields the responder needs.
 * Non-object rows and rows matching none of the known fields pass
 * through untouched (never destroy shapes we don't recognize).
 */
function compactClassificationRow(row: unknown): unknown {
    if (typeof row !== "object" || row === null || Array.isArray(row)) return row;
    const rec = row as Record<string, unknown>;
    const compact: Record<string, unknown> = {};
    for (const f of CLASSIFICATION_ROW_FIELDS) {
        if (rec[f] !== undefined && rec[f] !== null && rec[f] !== "") {
            compact[f] = rec[f];
        }
    }
    return Object.keys(compact).length > 0 ? compact : row;
}

/**
 * Reduce a single result's data if it's too large
 */
function reduceResultData(result: ExecutionResult): ExecutionResult {
    if (!result.success || !result.data) {
        return result;
    }

    // Check if it's web-fetch output and trim page texts
    if (isFetchData(result.data)) {
        return {
            ...result,
            data: summarizeFetchForLLM(result.data),
        };
    }

    // Check if it's regulation retrieval output and trim chunk texts
    if (isRegulationData(result.data)) {
        return {
            ...result,
            data: summarizeRegulationsForLLM(result.data),
        };
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

    // Simulation output carries up to 10k raw Monte-Carlo values plus
    // full chart series destined for the FRONTEND (sent unreduced via the
    // visualization SSE event from the raw execution results). The LLM
    // only needs the narrative summary + aggregates — strip the numerics
    // explicitly instead of relying on first-array-key truncation order
    // (fragile), and to keep the generic stub below from nuking the
    // summary along with them.
    if (result.tool === "run_simulation" && typeof result.data === "object" && result.data !== null) {
        const rec = result.data as Record<string, unknown>;
        if (Array.isArray(rec.raw_values) || (typeof rec.visualization === "object" && rec.visualization !== null)) {
            const rest: Record<string, unknown> = { ...rec };
            delete rest.raw_values;
            delete rest.visualization;
            return {
                ...result,
                data: {
                    ...rest,
                    note: "raw_values (up to 10k samples) and full chart series omitted for LLM context efficiency — see summary/key_metrics/statistics; charts render client-side from the visualization event",
                },
            };
        }
    }

    // Check for other large row-list payloads (weather, tyres, stints,
    // race control, ...): keep the first rows and note how many were
    // omitted, instead of nuking the whole payload. (Without this, e.g.
    // a 20-driver results table collapses to a "[Data too large]" stub
    // and the responder is forced to refuse.) Schedules and full
    // classifications are exempt up to their per-key caps (see
    // ROW_CAP_BY_KEY) so date-anchoring ("last"/"next" race) and
    // backmarker questions always see complete data.
    //
    // Classification tables also carry fat per-driver rows (headshot URLs,
    // team colors, empty broadcast fields — ~500 chars/row). They are
    // projected to the fields the responder actually needs (see
    // compactClassificationRow) so the full 20-driver grid fits in context
    // instead of tripping the 10KB generic stub below.
    if (typeof result.data === "object" && result.data !== null) {
        const rec = { ...(result.data as Record<string, unknown>) };
        if (Array.isArray(rec.results)) {
            rec.results = (rec.results as unknown[]).map(compactClassificationRow);
            result = { ...result, data: rec };
        }
        for (const key of Object.keys(rec)) {
            const val = rec[key];
            const cap = ROW_CAP_BY_KEY[key] ?? MAX_ROWS_PER_LIST;
            if (Array.isArray(val) && val.length > cap) {
                return {
                    ...result,
                    data: {
                        ...rec,
                        [key]: val.slice(0, cap),
                        [`${key}_truncated_from`]: val.length,
                        note: `Showing first ${cap} of ${val.length} ${key} for LLM context efficiency`,
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


export interface FailedStep {
    step: number;
    tool: string;
    error: string;
}

export function buildRefusalMessage(failedSteps: FailedStep[], planReasoning?: string): string {
    const allServer = failedSteps.length > 0 && failedSteps.every((r) => SERVER_ERROR_RE.test(r.error));
    const headline = allServer
        ? "The F1 data service is temporarily unavailable. Please try again in a moment."
        : "I was unable to retrieve any F1 data for your query. This may be due to an invalid Grand Prix name, session type, or year. Please verify the details and try again.";
    const detail = failedSteps.length > 0
        ? failedSteps.map((r) => `- Step ${r.step} (${r.tool}): ${sanitizeStepError(r.error)}`).join("\n")
        : (planReasoning || "No execution steps were produced for this query.");
    return `${headline}\n\n**What went wrong:**\n` + detail;
}

const SERVER_ERROR_RE = /api key|unauthorized|\b40[013]\b|forbidden|timed out|timeout|network|fetch failed|service unavailable|internal server error/i;

function sanitizeStepError(error: string): string {
    if (SERVER_ERROR_RE.test(error)) {
        return "The F1 data service is temporarily unavailable. Please try again in a moment.";
    }
    return error;
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
            // Neutralize tag-breakout attempts from untrusted tool data
            // (e.g. a document containing "</f1_data>") so the responder's
            // <f1_data> wrapper in the chat route cannot be escaped.
            const safeJson = JSON.stringify(result.data, null, 2).replace(
                /<\/(f1_data|system|human)/gi,
                "<\\/$1"
            );
            sections.push(
                `### ${result.tool} (Step ${result.step})\n` +
                "```json\n" +
                `${safeJson}\n` +
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
