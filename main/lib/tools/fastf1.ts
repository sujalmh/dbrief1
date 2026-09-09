/**
 * F1 Data Tools
 * =============
 * HTTP wrappers for the FastAPI microservice endpoints.
 * Each tool validates inputs with Zod and handles errors gracefully.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";
import { f1ApiConfig, maxSeasonYear, minSeasonYear } from "../config";
import { getSessionCodes } from "../reference-data";

// =============================================================================
// Configuration (live — see lib/config.ts)
// =============================================================================

function apiBase(): string {
    return f1ApiConfig.baseUrl();
}

function toolTimeoutMs(): number {
    return f1ApiConfig.toolTimeoutMs();
}

function maxResponseBytes(): number {
    return f1ApiConfig.maxResponseBytes();
}
// Cap on response body size (bytes) accepted from the F1 API.
// Telemetry responses can be many MB; we refuse anything larger to avoid
// running the server out of memory. Size is config-driven (F1_MAX_RESPONSE_MB).

// =============================================================================
// Lightweight GET cache (discovery endpoints)
// =============================================================================
//
// The planner routinely fetches the same discovery payloads multiple times
// per question (get_events for GP resolution, then again as data context;
// get_gp_names + get_sessions for the same year/gp). These are idempotent
// GETs — cache them in-process so duplicate steps cost ~0ms instead of a
// full backend round-trip (which itself may hit FastF1). TTL and size are
// config-driven (F1_GET_CACHE_TTL_MS / F1_GET_CACHE_MAX_ENTRIES).
const getCache = new Map<string, { expires: number; data: unknown }>();

function getCacheGet(key: string): unknown | undefined {
    const entry = getCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
        getCache.delete(key);
        return undefined;
    }
    // LRU refresh.
    getCache.delete(key);
    getCache.set(key, entry);
    return entry.data;
}

function getCacheSet(key: string, data: unknown): void {
    const maxEntries = f1ApiConfig.getCacheMaxEntries();
    if (getCache.size >= maxEntries) {
        const oldest = getCache.keys().next();
        if (!oldest.done) getCache.delete(oldest.value);
    }
    getCache.set(key, { expires: Date.now() + f1ApiConfig.getCacheTtlMs(), data });
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Make a GET request to the F1 API (cached — see GET cache above).
 */
async function f1Get(endpoint: string): Promise<unknown> {
    const cached = getCacheGet(endpoint);
    if (cached !== undefined) return cached;

    const response = await fetch(`${apiBase()}${endpoint}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(toolTimeoutMs()),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `F1 API error: ${response.status}`);
    }

    const data = await parseResponseBody(response);
    getCacheSet(endpoint, data);
    return data;
}

/**
 * Make a POST request to the F1 API
 */
async function f1Post(endpoint: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${apiBase()}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(toolTimeoutMs()),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `F1 API error: ${response.status}`);
    }

    return parseResponseBody(response);
}

/**
 * Read a fetch response body, enforcing a size cap to prevent OOM.
 * If the body exceeds the configured cap, throws a descriptive error.
 */
async function parseResponseBody(response: Response): Promise<unknown> {
    const cap = maxResponseBytes();
    // Prefer Content-Length when available so we can reject before buffering.
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
        const length = Number(contentLength);
        if (Number.isFinite(length) && length > cap) {
            throw new Error(
                `F1 API response too large: ${length} bytes exceeds ` +
                `limit of ${cap} bytes`
            );
        }
    }

    // Read as ArrayBuffer so we can enforce a hard size cap regardless of
    // whether the server sent a Content-Length header.
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > cap) {
        throw new Error(
            `F1 API response too large: ${buffer.byteLength} bytes exceeds ` +
            `limit of ${cap} bytes`
        );
    }
    return JSON.parse(new TextDecoder().decode(buffer));
}

// =============================================================================
// Zod Schemas for Tool Inputs
// =============================================================================
//
// Year bounds are config-driven (F1_MIN_SEASON_YEAR / current year +
// F1_SEASON_YEAR_BUFFER) so the LLM-facing schema stays in sync with the
// backend without code changes.
const FASTF1_MAX_YEAR = maxSeasonYear();
const FASTF1_MIN_YEAR = minSeasonYear();
const YearSchema = z.number().int().min(FASTF1_MIN_YEAR).max(FASTF1_MAX_YEAR).describe(`F1 season year (${FASTF1_MIN_YEAR}-${FASTF1_MAX_YEAR})`);
const GpSchema = z.string().describe("Grand Prix name. Use the `canonical` field from `get_gp_names` or the `EventName` from `get_events`. Examples: 'Monaco', 'Monaco Grand Prix', 'British', 'Abu Dhabi'. Do NOT include the year.");
const SESSION_CODES = getSessionCodes() as [string, ...string[]];
const SessionSchema = z.enum(SESSION_CODES).describe(`Session type code. Must be exactly one of: ${getSessionCodes().join(", ")}.`);
const DriverSchema = z.string().describe("Driver code (e.g., 'VER', 'HAM', 'LEC')");

// =============================================================================
// F1 Data Tools
// =============================================================================

/**
 * Get available F1 seasons
 */
export const getSeasonsTool = tool(
    async () => {
        return JSON.stringify(await f1Get("/f1/seasons"));
    },
    {
        name: "get_seasons",
        description: `Get the list of available F1 seasons (${FASTF1_MIN_YEAR}-${FASTF1_MAX_YEAR})`,
        schema: z.object({}),
    }
);

/**
 * Get events for a season
 */
export const getEventsTool = tool(
    async ({ year }) => {
        return JSON.stringify(await f1Get(`/f1/events?year=${year}`));
    },
    {
        name: "get_events",
        description: "Get all F1 events (Grand Prix) for a specific season year",
        schema: z.object({
            year: YearSchema,
        }),
    }
);

/**
 * Get sessions for an event
 */
export const getSessionsTool = tool(
    async ({ year, gp }) => {
        return JSON.stringify(await f1Get(`/f1/sessions?year=${year}&gp=${encodeURIComponent(gp)}`));
    },
    {
        name: "get_sessions",
        description: "Get available sessions (FP1, FP2, FP3, Q, R) for a specific Grand Prix",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
        }),
    }
);

/**
 * Get session results
 */
export const getResultsTool = tool(
    async ({ year, gp, session }) => {
        return JSON.stringify(await f1Post("/f1/results", { year, gp, session }));
    },
    {
        name: "get_results",
        description: "Get results for any session (practice, qualifying, or race)",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
        }),
    }
);

/**
 * Get qualifying results
 */
export const getQualifyingTool = tool(
    async ({ year, gp }) => {
        return JSON.stringify(await f1Post("/f1/qualifying", { year, gp, session: "Q" }));
    },
    {
        name: "get_qualifying",
        description: "Get qualifying results (Q session) with Q1, Q2, Q3 times for a Grand Prix. NOTE: This always fetches the 'Q' session. For sprint races or other sessions, use `get_results` with session='SQ' or 'S'.",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
        }),
    }
);

/**
 * Get race results
 */
export const getRaceTool = tool(
    async ({ year, gp }) => {
        return JSON.stringify(await f1Post("/f1/race", { year, gp, session: "R" }));
    },
    {
        name: "get_race",
        description: "Get race results (R session) including positions, times, and status for a Grand Prix. NOTE: This always fetches the 'R' session. For sprint races, use `get_results` with session='S'.",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
        }),
    }
);

/**
 * Get lap data
 */
export const getLapsTool = tool(
    async ({ year, gp, session, driver, lap_start, lap_end }) => {
        return JSON.stringify(await f1Post("/f1/laps", {
            year,
            gp,
            session,
            driver: driver || undefined,
            lap_start: lap_start || undefined,
            lap_end: lap_end || undefined,
        }));
    },
    {
        name: "get_laps",
        description: "Get lap-by-lap data with optional filters for driver and lap range",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
            driver: z.string().optional().describe("Filter by driver code"),
            lap_start: z.number().int().optional().describe("Starting lap number"),
            lap_end: z.number().int().optional().describe("Ending lap number"),
        }),
    }
);

/**
 * Get fastest lap
 */
export const getFastestLapTool = tool(
    async ({ year, gp, session, driver }) => {
        return JSON.stringify(await f1Post("/f1/laps/fastest", {
            year,
            gp,
            session,
            driver: driver || undefined,
        }));
    },
    {
        name: "get_fastest_lap",
        description: "Get the fastest lap in a session, optionally filtered by driver",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
            driver: z.string().optional().describe("Filter by driver code for their fastest lap"),
        }),
    }
);

/**
 * Get telemetry data
 */
export const getTelemetryTool = tool(
    async ({ year, gp, session, driver, lap }) => {
        return JSON.stringify(await f1Post("/f1/telemetry", {
            year,
            gp,
            session,
            driver,
            lap: lap ? String(lap) : "fastest",
        }));
    },
    {
        name: "get_telemetry",
        description: "Get detailed telemetry data (speed, throttle, brake, gear) for a specific driver and lap. WARNING: Returns large data arrays - use get_telemetry_summary for LLM analysis",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
            driver: DriverSchema,
            lap: z.union([z.string(), z.number()]).optional().describe("Lap identifier: 'fastest' or lap number"),
        }),
    }
);

/**
 * Get telemetry summary (LLM-optimized)
 */
export const getTelemetrySummaryTool = tool(
    async ({ year, gp, session, driver, lap }) => {
        return JSON.stringify(await f1Post("/f1/telemetry/summary", {
            year,
            gp,
            session,
            driver,
            lap: lap ? String(lap) : "fastest",
        }));
    },
    {
        name: "get_telemetry_summary",
        description: "Get statistical summary of telemetry (min/max/avg speed, throttle, brake, corner speeds) for a driver's lap. PREFERRED for LLM analysis - much more token-efficient than raw telemetry",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
            driver: DriverSchema,
            lap: z.union([z.string(), z.number()]).optional().describe("Lap identifier: 'fastest' or lap number"),
        }),
    }
);


/**
 * Get weather data
 */
export const getWeatherTool = tool(
    async ({ year, gp, session }) => {
        return JSON.stringify(await f1Post("/f1/weather", { year, gp, session }));
    },
    {
        name: "get_weather",
        description: "Get weather conditions (temperature, humidity, rainfall) during a session",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
        }),
    }
);

/**
 * Get race control messages
 */
export const getRaceControlTool = tool(
    async ({ year, gp, session }) => {
        return JSON.stringify(await f1Post("/f1/race-control", { year, gp, session }));
    },
    {
        name: "get_race_control",
        description: "Get race control messages including flags, penalties, and track incidents",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
        }),
    }
);

/**
 * Get tyre information
 */
export const getTyresTool = tool(
    async ({ year, gp, session, driver }) => {
        return JSON.stringify(await f1Post("/f1/tyres", {
            year,
            gp,
            session,
            driver: driver || undefined,
        }));
    },
    {
        name: "get_tyres",
        description: "Get tyre compound and stint information for a session",
        schema: z.object({
            year: YearSchema,
            gp: GpSchema,
            session: SessionSchema,
            driver: z.string().optional().describe("Filter by driver code"),
        }),
    }

);

/**
 * Get driver standings
 */
export const getDriverStandingsTool = tool(
    async ({ year, driver }) => {
        return JSON.stringify(await f1Post("/f1/standings/drivers", {
            year,
            driver: driver || undefined,
        }));
    },
    {
        name: "get_driver_standings",
        description: "Get final driver standings (points, wins, position) for a specific season",
        schema: z.object({
            year: YearSchema,
            driver: z.string().optional().describe("Filter by driver code"),
        }),
    }
);

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Get canonical GP names for a season
 */
export const getGpNamesTool = tool(
    async ({ year }) => {
        return JSON.stringify(await f1Get(`/f1/gp-names?year=${year}`));
    },
    {
        name: "get_gp_names",
        description: "Get canonical Grand Prix names for a specific season year. Use this FIRST to discover valid GP names before calling session-specific tools. Returns round number, event name, location, country, and canonical name.",
        schema: z.object({
            year: YearSchema,
        }),
    }
);

/**
 * All available F1 data tools
 */
export const f1Tools: Record<string, StructuredTool> = {
    get_seasons: getSeasonsTool,
    get_events: getEventsTool,
    get_gp_names: getGpNamesTool,
    get_sessions: getSessionsTool,
    get_results: getResultsTool,
    get_qualifying: getQualifyingTool,
    get_race: getRaceTool,
    get_laps: getLapsTool,
    get_fastest_lap: getFastestLapTool,
    get_telemetry: getTelemetryTool,
    get_telemetry_summary: getTelemetrySummaryTool,
    get_weather: getWeatherTool,
    get_race_control: getRaceControlTool,

    get_tyres: getTyresTool,
    get_driver_standings: getDriverStandingsTool,
};

/**
 * Get all F1 tools as an array
 */
export function getF1Tools(): StructuredTool[] {
    return Object.values(f1Tools);
}
