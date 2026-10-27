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

/**
 * Tool-level error payloads (as opposed to thrown errors).
 *
 * Several tools fail softly by returning `{ error: true, message }` or
 * `{ success: false, error }` instead of throwing: web search without an API
 * key, regulation retrieval failures, invalid visualization requests, and
 * simulation failures all use this shape. Treating those payloads as
 * successful context is dangerous: the responder sees a "result" that
 * contains no data and can fall back to training knowledge. This helper
 * normalizes them into a real step failure.
 */
export interface ToolErrorPayload {
    message: string;
}

export function readToolErrorPayload(data: unknown): ToolErrorPayload | null {
    let parsed: unknown = data;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed) as unknown;
        } catch {
            return null;
        }
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
    }
    const rec = parsed as Record<string, unknown>;
    const errorValue = rec.error;
    if (errorValue === true) {
        return {
            message:
                typeof rec.message === "string" && rec.message.trim()
                    ? rec.message
                    : "Tool reported an error",
        };
    }
    if (rec.success === false) {
        return {
            message:
                typeof rec.error === "string" && rec.error.trim()
                    ? rec.error
                    : typeof rec.message === "string" && rec.message.trim()
                        ? rec.message
                        : "Tool reported an error",
        };
    }
    // `{ error: "message" }` (e.g. run_simulation) is also a soft failure.
    // Do not treat an `errors` array (fetch_web_pages partial results) as one.
    if (typeof errorValue === "string" && errorValue.trim()) {
        return { message: errorValue };
    }
    return null;
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
    get_constructors_standings: "get_constructor_standings",
    get_constructor_standings_for_year: "get_constructor_standings",
    get_team_standings: "get_constructor_standings",
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

            const toolError = readToolErrorPayload(parsedData);
            if (toolError) {
                return {
                    step: stepIndex,
                    tool: step.tool,
                    args: validatedArgs as Record<string, unknown>,
                    success: false,
                    error: toolError.message,
                    durationMs: Date.now() - startTime,
                };
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
 * Tyre/stint, weather, and race-control payloads are also kept complete
 * enough for strategy/conditions questions; telemetry is summarized first.
 */
const ROW_CAP_BY_KEY: Record<string, number> = {
    events: 30,
    grand_prix: 30,
    results: 25,
    standings: 25,
    sessions: 15,
    // Strategy/conditions answers need the full row set, not the generic
    // 12-row cap. These payloads are still bounded and compact.
    tyres: 80,
    messages: 100,
    data: 60,
};

/** Fields projected from fat classification rows, including quote-ready gaps. */
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
    "GapToLeader",
    "PositionsGained",
    "Gap",
    "Q1",
    "Q2",
    "Q3",
    "Status",
    "Points",
    "Laps",
] as const;

/**
 * Estimate token count from a string
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Telemetry channels that identify a telemetry payload. Weather payloads
 * also use a `data` array, so presence of a generic array is not enough.
 */
const TELEMETRY_CHANNELS = ["Speed", "Throttle", "Brake", "nGear", "DRS", "RPM"];

/**
 * Check if data is telemetry-like (a `data` array of driving channels).
 */
function isTelemetryData(data: unknown): data is { data: unknown[];[key: string]: unknown } {
    if (typeof data !== "object" || data === null || !("data" in data)) return false;
    const points = (data as { data: unknown }).data;
    if (!Array.isArray(points) || points.length === 0) return false;
    const first = points[0];
    if (typeof first !== "object" || first === null) return false;
    return TELEMETRY_CHANNELS.some((channel) => channel in (first as Record<string, unknown>));
}

/**
 * Check if data is laps-like (has a non-empty `laps` array). The old
 * threshold (>20) let small lap sets fall through to the generic row cap,
 * which silently dropped laps 13-20 from the responder's context.
 */
function isLapsData(data: unknown): data is { laps: unknown[];[key: string]: unknown } {
    return (
        typeof data === "object" &&
        data !== null &&
        "laps" in data &&
        Array.isArray((data as { laps: unknown[] }).laps) &&
        (data as { laps: unknown[] }).laps.length > 0
    );
}

/** Max corner rows kept in LLM context. Even Jeddah (27 corners) fits whole. */
const MAX_CORNERS_IN_CONTEXT = 40;

function coerceFiniteNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function roundOneDecimal(value: number): number {
    return Math.round(value * 10) / 10;
}

interface TelemetrySample {
    distance: number;
    speed: number;
}

function readTelemetrySamples(points: Array<Record<string, unknown>>): TelemetrySample[] {
    const samples: TelemetrySample[] = [];
    for (const point of points) {
        const distance = coerceFiniteNumber(point.Distance ?? point.distance);
        const speed = coerceFiniteNumber(point.Speed ?? point.speed);
        if (distance !== null && speed !== null) {
            samples.push({ distance, speed });
        }
    }
    return samples;
}

/**
 * Compact corner minimum speeds from raw telemetry plus the circuit's corner
 * distances. The full telemetry array is never forwarded; each corner keeps
 * only its number, letter, and the min speed within 20 m of the corner.
 */
function computeCornerMinSpeeds(
    corners: unknown,
    samples: TelemetrySample[]
): Array<{ corner: number; letter: string; min_speed: number }> | null {
    if (!Array.isArray(corners) || corners.length === 0 || samples.length === 0) {
        return null;
    }

    const out: Array<{ corner: number; letter: string; min_speed: number }> = [];
    for (const raw of corners) {
        if (typeof raw !== "object" || raw === null) continue;
        const corner = raw as Record<string, unknown>;
        const number = coerceFiniteNumber(corner.Number ?? corner.number ?? corner.corner);
        const distance = coerceFiniteNumber(corner.Distance ?? corner.distance);
        if (number === null || distance === null) continue;

        let minSpeed: number | null = null;
        for (const sample of samples) {
            if (Math.abs(sample.distance - distance) <= 20) {
                minSpeed = minSpeed === null ? sample.speed : Math.min(minSpeed, sample.speed);
            }
        }
        if (minSpeed === null) continue;

        const letterValue = corner.Letter ?? corner.letter;
        out.push({
            corner: number,
            letter: typeof letterValue === "string" ? letterValue : "",
            min_speed: roundOneDecimal(minSpeed),
        });
    }

    return out.length > 0 ? out.slice(0, MAX_CORNERS_IN_CONTEXT) : null;
}

/** Equal-distance-thirds average speed, matching get_telemetry_summary. */
function computeSectorSpeeds(samples: TelemetrySample[]): Record<string, number> | null {
    if (samples.length === 0) return null;
    const maxDistance = Math.max(...samples.map((s) => s.distance));
    if (!(maxDistance > 0)) return null;

    const sums = [0, 0, 0];
    const counts = [0, 0, 0];
    for (const sample of samples) {
        const index = sample.distance <= maxDistance / 3
            ? 0
            : sample.distance <= (2 * maxDistance) / 3
                ? 1
                : 2;
        sums[index] += sample.speed;
        counts[index] += 1;
    }

    return {
        sector1_avg_speed: counts[0] > 0 ? roundOneDecimal(sums[0] / counts[0]) : 0,
        sector2_avg_speed: counts[1] > 0 ? roundOneDecimal(sums[1] / counts[1]) : 0,
        sector3_avg_speed: counts[2] > 0 ? roundOneDecimal(sums[2] / counts[2]) : 0,
    };
}

/**
 * Summarize telemetry data for LLM consumption
 * Replaces raw data array with statistical summary
 */
function summarizeTelemetryForLLM(data: { data: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const points = data.data.filter(
        (point): point is Record<string, unknown> => typeof point === "object" && point !== null
    );

    if (points.length === 0) {
        return { ...data, data: [], summary: "No telemetry data available" };
    }

    // Extract numeric channels
    const channels = Object.keys(points[0]).filter(
        (key) => typeof points[0][key] === "number" && key !== "Time" && key !== "Distance"
    );

    const summary: Record<string, { min: number; max: number; avg: number }> = {};

    for (const channel of channels) {
        const values = points
            .map((p) => p[channel])
            .filter((v): v is number => typeof v === "number" && !isNaN(v));
        if (values.length > 0) {
            summary[channel] = {
                min: Math.round(values.reduce((a, b) => Math.min(a, b)) * 100) / 100,
                max: Math.round(values.reduce((a, b) => Math.max(a, b)) * 100) / 100,
                avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100,
            };
        }
    }

    const samples = readTelemetrySamples(points);
    const cornerMinSpeeds = computeCornerMinSpeeds(data.corners, samples);
    const sectorSpeeds = computeSectorSpeeds(samples);

    // Keep only essential metadata + summary. Field names are chosen to
    // avoid racing-domain misreads: `telemetry_points` is the count of
    // telemetry samples (NOT championship points), and `lap_number` is
    // which lap was sampled (NOT a finishing position). Corner and sector
    // aggregates are compact and derived from the sampled points.
    return {
        driver: data.driver,
        lap_number: data.lap_number,
        lap_time: data.lap_time,
        telemetry_points: points.length,
        ...(data.downsampled_from !== undefined ? { downsampled_from: data.downsampled_from } : {}),
        telemetry_summary: summary,
        ...(cornerMinSpeeds ? { corner_min_speeds: cornerMinSpeeds } : {}),
        ...(sectorSpeeds ? { sector_speeds: sectorSpeeds } : {}),
        note: "Raw telemetry data replaced with statistical summary for LLM context efficiency. Corner minimum speeds and sector averages are derived from the sampled telemetry points.",
    };
}

/**
 * Check for the compact get_telemetry_summary shape. It has no raw `data`
 * array, only channel summaries plus optional corner/sector detail.
 */
function isTelemetrySummaryData(data: unknown): data is Record<string, unknown> {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
    const rec = data as Record<string, unknown>;
    if (Array.isArray(rec.data)) return false;
    return (
        (typeof rec.speed_summary === "object" && rec.speed_summary !== null) ||
        Array.isArray(rec.corner_min_speeds)
    );
}

/**
 * Preserve corner and sector detail on get_telemetry_summary payloads. The
 * generic row cap (12) otherwise cuts a 15-27 corner circuit down to its
 * first 12 corners, which makes corner-by-corner comparisons impossible.
 */
function summarizeTelemetrySummaryForLLM(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    const corners = data.corner_min_speeds;
    if (Array.isArray(corners)) {
        const valid = corners.filter(
            (corner): corner is Record<string, unknown> => typeof corner === "object" && corner !== null
        );
        out.corner_min_speeds = valid.slice(0, MAX_CORNERS_IN_CONTEXT);
        if (valid.length > MAX_CORNERS_IN_CONTEXT) {
            out.corners_omitted = valid.length - MAX_CORNERS_IN_CONTEXT;
        }
    }
    out.note = "Compact telemetry summary retained for LLM context; corner minimum speeds and sector averages are included, raw telemetry arrays are not.";
    return out;
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

/** Format seconds as a lap time without the "95:16" hour bug. */
function formatSecondsToLapTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) return "N/A";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${secs.toFixed(3).padStart(6, "0")}`;
    }
    return `${minutes}:${secs.toFixed(3).padStart(6, "0")}`;
}

/** Lap fields the responder needs: position, pace, sectors, tyre context. */
const LAP_CONTEXT_FIELDS = [
    "LapNumber",
    "LapTime",
    "Driver",
    "Compound",
    "TyreLife",
    "Stint",
    "Sector1Time",
    "Sector2Time",
    "Sector3Time",
    "Position",
] as const;

function isNonEmpty(value: unknown): boolean {
    return value !== undefined && value !== null && value !== "" && value !== "NaT";
}

function isTruthyFlag(value: unknown): boolean {
    return value === true || value === "True" || value === "true" || value === 1 || value === "1";
}

function isPitLap(lap: Record<string, unknown>): boolean {
    return isNonEmpty(lap.PitInTime) || isNonEmpty(lap.PitOutTime);
}

function isDeletedLap(lap: Record<string, unknown>): boolean {
    return isTruthyFlag(lap.Deleted);
}

function compactLapRow(lap: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const field of LAP_CONTEXT_FIELDS) {
        if (isNonEmpty(lap[field])) out[field] = lap[field];
    }
    if (isPitLap(lap)) out.PitLap = true;
    if (isDeletedLap(lap)) out.Deleted = true;
    return Object.keys(out).length > 0 ? out : lap;
}

/**
 * Cap the compact per-lap table. One driver's race (≈78 laps) fits whole;
 * multi-driver payloads are sampled evenly while always retaining the
 * fastest and final laps, so pace/strategy questions still have real rows.
 */
const MAX_LAPS_IN_CONTEXT = 220;

function sampleLapsForContext(
    rows: Array<{ index: number; lap: Record<string, unknown> }>,
    fastestIndex: number | null,
    cap: number
): Array<{ index: number; lap: Record<string, unknown> }> {
    if (rows.length <= cap) return rows;
    const keep = new Set<number>();
    keep.add(0);
    keep.add(rows.length - 1);
    if (fastestIndex !== null) {
        const pos = rows.findIndex((r) => r.index === fastestIndex);
        if (pos >= 0) keep.add(pos);
    }
    const step = (rows.length - 1) / Math.max(1, cap - keep.size);
    for (let i = 0; i < cap && keep.size < cap; i++) {
        keep.add(Math.min(rows.length - 1, Math.round(i * step)));
    }
    return [...keep].sort((a, b) => a - b).map((i) => rows[i]);
}

/**
 * Summarize laps data for LLM consumption.
 *
 * Earlier versions kept only fastest/first/last when a lap set exceeded 20
 * rows, which made "show every lap time" unanswerable even though the data
 * was present. The responder now receives a compact per-lap table (pace,
 * sectors, compound, tyre age, position) plus clean per-driver aggregates.
 */
function summarizeLapsForLLM(data: { laps: unknown[];[key: string]: unknown }): Record<string, unknown> {
    const rawLaps = data.laps;
    const laps = rawLaps.filter(
        (lap): lap is Record<string, unknown> => typeof lap === "object" && lap !== null
    );

    if (laps.length === 0) {
        return { ...data, summary: "No lap data available" };
    }

    const parsed = laps.map((lap, index) => ({
        index,
        lap,
        seconds: parseLapTimeToSeconds(lap.LapTime),
    }));
    const valid = parsed.filter((p): p is typeof p & { seconds: number } => p.seconds !== null && p.seconds > 0);
    // Clean pace excludes pit-in/pit-out and deleted laps. Falling back to
    // all valid laps keeps the aggregate available for short/practice runs.
    const clean = valid.filter((p) => !isPitLap(p.lap) && !isDeletedLap(p.lap));
    const paceSample = clean.length > 0 ? clean : valid;

    const fastest = paceSample.reduce<typeof paceSample[number] | null>(
        (best, p) => (best === null || p.seconds < best.seconds ? p : best),
        null
    );

    const averageSeconds = paceSample.length > 0
        ? paceSample.reduce((sum, p) => sum + p.seconds, 0) / paceSample.length
        : null;

    // Per-driver aggregates make multi-driver lap payloads comparable
    // without forcing the responder to do arithmetic across 40+ rows.
    const byDriver = new Map<string, { valid: number; clean: number; totalSeconds: number; fastest: number | null; compounds: Set<string> }>();
    for (const p of valid) {
        const driver = typeof p.lap.Driver === "string" && p.lap.Driver.trim()
            ? p.lap.Driver.trim()
            : "unknown";
        const entry = byDriver.get(driver) ?? { valid: 0, clean: 0, totalSeconds: 0, fastest: null, compounds: new Set<string>() };
        entry.valid++;
        if (!isPitLap(p.lap) && !isDeletedLap(p.lap)) {
            entry.clean++;
            entry.totalSeconds += p.seconds;
        }
        if (entry.fastest === null || p.seconds < entry.fastest) entry.fastest = p.seconds;
        if (typeof p.lap.Compound === "string" && p.lap.Compound.trim()) entry.compounds.add(p.lap.Compound.trim());
        byDriver.set(driver, entry);
    }

    const allRows = parsed.map((p) => ({ index: p.index, lap: compactLapRow(p.lap) }));
    const sampled = sampleLapsForContext(allRows, fastest?.index ?? null, MAX_LAPS_IN_CONTEXT);
    const notes = [
        sampled.length < allRows.length
            ? `Showing ${sampled.length} of ${allRows.length} laps (evenly sampled; fastest and final laps retained).`
            : `Showing all ${allRows.length} laps.`,
        "Compact per-lap table for LLM context efficiency; the full lap data remains available to the chart renderer.",
    ];

    const firstLap = laps[0];
    const lastLap = laps[laps.length - 1];

    return {
        session_name: data.session_name,
        total_laps: laps.length,
        valid_laps: valid.length,
        clean_laps: clean.length,
        average_lap_time: averageSeconds !== null ? formatSecondsToLapTime(averageSeconds) : "N/A",
        average_lap_time_note:
            "Excludes pit-in/pit-out and deleted laps when clean laps exist; otherwise all timed laps.",
        key_laps: {
            fastest: fastest ? compactLapRow(fastest.lap) : null,
            first: compactLapRow(firstLap),
            last: compactLapRow(lastLap),
        },
        ...(byDriver.size > 0
            ? {
                  drivers: [...byDriver.entries()].map(([driver, v]) => ({
                      driver,
                      laps_with_times: v.valid,
                      clean_laps: v.clean,
                      average_lap_time: v.clean > 0 ? formatSecondsToLapTime(v.totalSeconds / v.clean) : "N/A",
                      fastest_lap_time: v.fastest !== null ? formatSecondsToLapTime(v.fastest) : "N/A",
                      compounds: [...v.compounds],
                  })),
              }
            : {}),
        laps: sampled.map((r) => r.lap),
        ...(sampled.length < allRows.length
            ? { laps_omitted: allRows.length - sampled.length }
            : {}),
        note: notes.join(" "),
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

    // Check if it's a compact telemetry summary and keep corner/sector detail
    if (isTelemetrySummaryData(result.data)) {
        return {
            ...result,
            data: summarizeTelemetrySummaryForLLM(result.data),
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

    // Generic truncation for large payloads. The tighter per-shape
    // summarizers above handle telemetry, laps, fetches, regulations, and
    // simulations; this is the last resort for unknown shapes.
    try {
        const strData = JSON.stringify(result.data);
        if (strData.length > 20000) {
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
    const boundaryText = [planReasoning ?? "", ...failedSteps.map((r) => r.error)].join("\n");
    const isDataBoundary = DATA_BOUNDARY_RE.test(boundaryText);
    const hasPlanReason = !!(planReasoning && planReasoning.trim());
    const headline = allServer
        ? "The F1 data service is temporarily unavailable. Please try again in a moment."
        : isDataBoundary
          ? "That data isn't available for the requested session. The details below explain why."
          : hasPlanReason
            ? "I couldn't complete that request. The details below explain why."
            : "I was unable to retrieve any F1 data for your query. This may be due to an invalid Grand Prix name, session type, or year. Please verify the details and try again.";
    const detail = failedSteps.length > 0
        ? failedSteps.map((r) => `- Step ${r.step} (${r.tool}): ${sanitizeStepError(r.error)}`).join("\n")
        : (planReasoning || "No execution steps were produced for this query.");
    return `${headline}\n\n**What went wrong:**\n` + detail;
}

const SERVER_ERROR_RE = /api key|unauthorized|\b40[013]\b|forbidden|timed out|timeout|network|fetch failed|service unavailable|internal server error/i;
const DATA_BOUNDARY_RE = /only available from 2018|not available before 2018|pre-2018|no telemetry (?:data )?(?:is )?available/i;

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
            // Include the call args (year/GP/session/driver) in every
            // section header. FastF1 payloads often carry only a session
            // name, and without args the responder cannot name the Grand
            // Prix/year it is supposed to cite. Keep the arg block small
            // so reference_data-style payloads cannot bloat the context.
            let argsText = "";
            try {
                const serialized = JSON.stringify(result.args ?? {});
                if (serialized && serialized !== "{}") {
                    argsText = serialized.length > 500
                        ? `${serialized.slice(0, 500)}…`
                        : serialized;
                }
            } catch {
                argsText = "";
            }
            sections.push(
                `### ${result.tool} (Step ${result.step})` +
                (argsText ? `\nArgs: ${argsText}` : "") +
                "\n```json\n" +
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
