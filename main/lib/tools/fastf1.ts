/**
 * F1 Data Tools
 * =============
 * HTTP wrappers for the FastAPI microservice endpoints.
 * Each tool validates inputs with Zod and handles errors gracefully.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";

// =============================================================================
// Configuration
// =============================================================================

const F1_API_BASE = process.env.F1_API_URL || "http://localhost:8000";
const F1_API_KEY = process.env.F1_API_KEY || "";
const TOOL_TIMEOUT_MS = 60000;

function f1Headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (F1_API_KEY) h["x-api-key"] = F1_API_KEY;
    return h;
}
// Cap on response body size (bytes) accepted from the F1 API.
// Telemetry responses can be many MB; we refuse anything larger to avoid
// running the server out of memory. 50MB is enough for any reasonable
// telemetry request via the /f1/telemetry endpoint.
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Make a GET request to the F1 API
 */
async function f1Get(endpoint: string): Promise<unknown> {
    const response = await fetch(`${F1_API_BASE}${endpoint}`, {
        method: "GET",
        headers: f1Headers(),
        signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `F1 API error: ${response.status}`);
    }

    return parseResponseBody(response);
}

/**
 * Make a POST request to the F1 API
 */
async function f1Post(endpoint: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${F1_API_BASE}${endpoint}`, {
        method: "POST",
        headers: f1Headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `F1 API error: ${response.status}`);
    }

    return parseResponseBody(response);
}

/**
 * Read a fetch response body, enforcing a size cap to prevent OOM.
 * If the body exceeds MAX_RESPONSE_BYTES, throws a descriptive error.
 */
async function parseResponseBody(response: Response): Promise<unknown> {
    // Prefer Content-Length when available so we can reject before buffering.
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null) {
        const length = Number(contentLength);
        if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
            throw new Error(
                `F1 API response too large: ${length} bytes exceeds ` +
                `limit of ${MAX_RESPONSE_BYTES} bytes`
            );
        }
    }

    // Read as ArrayBuffer so we can enforce a hard size cap regardless of
    // whether the server sent a Content-Length header.
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        throw new Error(
            `F1 API response too large: ${buffer.byteLength} bytes exceeds ` +
            `limit of ${MAX_RESPONSE_BYTES} bytes`
        );
    }
    return JSON.parse(new TextDecoder().decode(buffer));
}

// =============================================================================
// Zod Schemas for Tool Inputs
// =============================================================================
//
// The maximum year is computed dynamically (current year + 2) so that the
// LLM-facing schema description always reflects the current season. The
// /f1/seasons endpoint on the backend uses the same logic, so they stay
// in sync.
const FASTF1_MAX_YEAR = new Date().getFullYear() + 2;
const YearSchema = z.number().int().min(1950).max(FASTF1_MAX_YEAR).describe(`F1 season year (1950-${FASTF1_MAX_YEAR})`);
const GpSchema = z.string().describe("Grand Prix name. Use the `canonical` field from `get_gp_names` or the `EventName` from `get_events`. Examples: 'Monaco', 'Monaco Grand Prix', 'British', 'Abu Dhabi'. Do NOT include the year.");
const SessionSchema = z.enum(["FP1", "FP2", "FP3", "Q", "SQ", "SS", "S", "R"]).describe("Session type code. Must be exactly one of: FP1, FP2, FP3, Q (qualifying), SQ (sprint qualifying), SS (sprint shootout), S (sprint), R (race).");
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
        description: `Get the list of available F1 seasons (1950-${FASTF1_MAX_YEAR})`,
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
