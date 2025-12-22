/**
 * OpenF1 API Tools
 * =================
 * HTTP wrappers for the OpenF1 FastAPI microservice endpoints.
 * Each tool validates inputs with Zod and handles errors gracefully.
 * 
 * OpenF1 supports data from 2023 onwards.
 * Most endpoints require a `session_key` which can be obtained from
 * the /f1/sessions endpoint.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";

// =============================================================================
// Configuration
// =============================================================================

const F1_API_BASE = process.env.F1_API_URL || "http://localhost:8000";
const TOOL_TIMEOUT_MS = 60000;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Make a GET request to the F1 API
 */
async function f1Get(endpoint: string, params?: Record<string, unknown>): Promise<unknown> {
    const url = new URL(`${F1_API_BASE}${endpoint}`);

    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null) {
                url.searchParams.append(key, String(value));
            }
        });
    }

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `F1 API error: ${response.status}`);
    }

    return response.json();
}

/**
 * Make a POST request to the F1 API
 */
async function f1Post(endpoint: string, body: unknown): Promise<unknown> {
    const response = await fetch(`${F1_API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `F1 API error: ${response.status}`);
    }

    return response.json();
}

// =============================================================================
// Zod Schemas for Tool Inputs
// =============================================================================

const YearSchema = z.coerce.number().int().min(2023).max(2025).describe("F1 season year (2023-2025, OpenF1 only supports 2023+)");
const SessionKeySchema = z.coerce.number().int().describe("OpenF1 session key (obtain from get_sessions)");
const MeetingKeySchema = z.coerce.number().int().optional().describe("OpenF1 meeting key");
const DriverNumberSchema = z.coerce.number().int().optional().describe("Driver number (e.g., 1 for Verstappen, 44 for Hamilton)");
const DriverAcronymSchema = z.string().optional().describe("Driver 3-letter code (e.g., 'VER', 'HAM')");
const CountryNameSchema = z.string().optional().describe("Country name (e.g., 'Belgium', 'Monaco')");
const SessionNameSchema = z.string().optional().describe("Session name (e.g., 'Race', 'Qualifying', 'Sprint', 'Practice 1')");
const DateTimeSchema = z.string().optional().describe("ISO datetime string for filtering");
const RoundSchema = z.coerce.number().int().min(1).optional().describe("Round number");
const StartYearSchema = z.coerce.number().int().min(1950).describe("Start year (1950+)");
const EndYearSchema = z.coerce.number().int().min(1950).describe("End year (1950+)");

// =============================================================================
// Session Discovery Tools
// =============================================================================

/**
 * Get available F1 seasons
 */
export const getSeasonsTool = tool(
    async () => {
        return await f1Get("/f1/seasons");
    },
    {
        name: "get_seasons",
        description: "Get the list of available F1 seasons. OpenF1 supports 2023 onwards.",
        schema: z.object({}),
    }
);

/**
 * Get meetings (Grand Prix weekends) for a season
 */
export const getMeetingsTool = tool(
    async ({ year, country_name }) => {
        return await f1Get("/f1/meetings", { year, country_name });
    },
    {
        name: "get_meetings",
        description: "Get all F1 meetings (Grand Prix weekends) for a specific season. Returns meeting_key for each.",
        schema: z.object({
            year: YearSchema,
            country_name: CountryNameSchema,
        }),
    }
);

/**
 * Get sessions with optional filters
 */
export const getSessionsTool = tool(
    async ({ year, country_name, session_name, meeting_key }) => {
        return await f1Get("/f1/sessions", { year, country_name, session_name, meeting_key });
    },
    {
        name: "get_sessions",
        description: "Get F1 sessions with optional filters. Returns session_key which is required for most other tools. Use this first to find the session_key for a specific race/qualifying/practice.",
        schema: z.object({
            year: YearSchema.optional(),
            country_name: CountryNameSchema,
            session_name: SessionNameSchema,
            meeting_key: MeetingKeySchema,
        }),
    }
);

// =============================================================================
// Driver Tools
// =============================================================================

/**
 * Get driver information for a session
 */
export const getDriversTool = tool(
    async ({ session_key, driver_number, name_acronym }) => {
        return await f1Get("/f1/drivers", { session_key, driver_number, name_acronym });
    },
    {
        name: "get_drivers",
        description: "Get driver information for a specific session. Returns driver numbers and team info.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
            name_acronym: DriverAcronymSchema,
        }),
    }
);

// =============================================================================
// Lap Data Tools
// =============================================================================

/**
 * Get lap data for a session
 */
export const getLapsTool = tool(
    async ({ session_key, driver_number, lap_number }) => {
        return await f1Get("/f1/laps", { session_key, driver_number, lap_number });
    },
    {
        name: "get_laps",
        description: "Get detailed lap information including lap times, sectors, and compounds for a session.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
            lap_number: z.coerce.number().int().min(1).optional().describe("Specific lap number"),
        }),
    }
);

// =============================================================================
// Telemetry Tools
// =============================================================================

/**
 * Get car telemetry data
 */
export const getCarDataTool = tool(
    async ({ session_key, driver_number, date_gte, date_lte }) => {
        return await f1Get("/f1/car-data", { session_key, driver_number, date_gte, date_lte });
    },
    {
        name: "get_car_data",
        description: "Get car telemetry data (speed, throttle, brake, DRS, gear, RPM) sampled at ~3.7 Hz. Use date filters to limit data volume.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: z.number().int().describe("Driver number (required)"),
            date_gte: DateTimeSchema.describe("Start datetime (ISO format) - strongly recommended for filtering"),
            date_lte: DateTimeSchema.describe("End datetime (ISO format) - strongly recommended for filtering"),
        }),
    }
);

/**
 * Get car location data
 */
export const getLocationTool = tool(
    async ({ session_key, driver_number, date_gte, date_lte }) => {
        return await f1Get("/f1/location", { session_key, driver_number, date_gte, date_lte });
    },
    {
        name: "get_location",
        description: "Get approximate car location on circuit (X, Y coordinates) sampled at ~3.7 Hz.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: z.number().int().describe("Driver number (required)"),
            date_gte: DateTimeSchema,
            date_lte: DateTimeSchema,
        }),
    }
);

// =============================================================================
// Race Data Tools
// =============================================================================

/**
 * Get interval data between drivers
 */
export const getIntervalsTool = tool(
    async ({ session_key, driver_number }) => {
        return await f1Get("/f1/intervals", { session_key, driver_number });
    },
    {
        name: "get_intervals",
        description: "Get gap/interval data between drivers during a session.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
        }),
    }
);

/**
 * Get position data
 */
export const getPositionTool = tool(
    async ({ session_key, driver_number, position_lte }) => {
        return await f1Get("/f1/position", { session_key, driver_number, position_lte });
    },
    {
        name: "get_position",
        description: "Get driver positions throughout a session. Shows position changes over time.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
            position_lte: z.coerce.number().int().min(1).optional().describe("Maximum position filter (e.g., 10 for top 10)"),
        }),
    }
);

/**
 * Get race control messages
 */
export const getRaceControlTool = tool(
    async ({ session_key, category, flag }) => {
        return await f1Get("/f1/race-control", { session_key, category, flag });
    },
    {
        name: "get_race_control",
        description: "Get race control messages including flags (YELLOW, RED, GREEN), penalties, and track status.",
        schema: z.object({
            session_key: SessionKeySchema,
            category: z.string().optional().describe("Category filter (e.g., 'Flag', 'SafetyCar')"),
            flag: z.string().optional().describe("Flag filter (e.g., 'YELLOW', 'RED')"),
        }),
    }
);

// =============================================================================
// Weather Tools
// =============================================================================

/**
 * Get weather data for a session
 */
export const getWeatherTool = tool(
    async ({ session_key }) => {
        return await f1Get("/f1/weather", { session_key });
    },
    {
        name: "get_weather",
        description: "Get weather conditions during a session (air temp, track temp, humidity, pressure, rainfall, wind).",
        schema: z.object({
            session_key: SessionKeySchema,
        }),
    }
);

// =============================================================================
// Strategy Tools
// =============================================================================

/**
 * Get stint information
 */
export const getStintsTool = tool(
    async ({ session_key, driver_number, compound }) => {
        return await f1Get("/f1/stints", { session_key, driver_number, compound });
    },
    {
        name: "get_stints",
        description: "Get stint information showing tyre compounds and lap ranges for each stint.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
            compound: z.string().optional().describe("Tyre compound filter (SOFT, MEDIUM, HARD, INTERMEDIATE, WET)"),
        }),
    }
);

/**
 * Get pit stop information
 */
export const getPitStopsTool = tool(
    async ({ session_key, driver_number }) => {
        return await f1Get("/f1/pit", { session_key, driver_number });
    },
    {
        name: "get_pit_stops",
        description: "Get pit stop data including pit lane times.",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
        }),
    }
);

// =============================================================================
// Results Tools
// =============================================================================

/**
 * Get session results
 */
export const getSessionResultsTool = tool(
    async ({ session_key, position_lte }) => {
        return await f1Get("/f1/results", { session_key, position_lte });
    },
    {
        name: "get_session_results",
        description: "Get session standings/results (final positions, finish status).",
        schema: z.object({
            session_key: SessionKeySchema,
            position_lte: z.coerce.number().int().min(1).optional().describe("Maximum position filter"),
        }),
    }
);

/**
 * Get starting grid
 */
export const getStartingGridTool = tool(
    async ({ session_key, position_lte }) => {
        return await f1Get("/f1/starting-grid", { session_key, position_lte });
    },
    {
        name: "get_starting_grid",
        description: "Get the starting grid for a race session.",
        schema: z.object({
            session_key: SessionKeySchema,
            position_lte: z.coerce.number().int().min(1).optional().describe("Maximum position filter"),
        }),
    }
);

// =============================================================================
// Event Tools
// =============================================================================

/**
 * Get overtake data
 */
export const getOvertakesTool = tool(
    async ({ session_key, driver_number }) => {
        return await f1Get("/f1/overtakes", { session_key, driver_number });
    },
    {
        name: "get_overtakes",
        description: "Get overtake information during a race session (beta feature).",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
        }),
    }
);

/**
 * Get team radio communications
 */
export const getTeamRadioTool = tool(
    async ({ session_key, driver_number }) => {
        return await f1Get("/f1/team-radio", { session_key, driver_number });
    },
    {
        name: "get_team_radio",
        description: "Get team radio communications (limited selection published by F1).",
        schema: z.object({
            session_key: SessionKeySchema,
            driver_number: DriverNumberSchema,
        }),
    }
);

// =============================================================================
// Historical & Aggregated Stats Tools (Ergast)
// =============================================================================

/**
 * Get driver standings for a specific year
 */
export const getDriverStandingsTool = tool(
    async ({ year, round }) => {
        return await f1Get("/f1/standings", { year, round });
    },
    {
        name: "get_driver_standings",
        description: "Get driver standings for a specific year. Supports historical data (pre-2023). Use 'round' to see standings at a specific point in the season.",
        schema: z.object({
            year: YearSchema.min(1950),
            round: RoundSchema,
        }),
    }
);

/**
 * Get aggregated cumulative stats
 */
export const getCumulativeStatsTool = tool(
    async ({ year_gte, year_lte, round_gte, round_lte }) => {
        return await f1Post("/f1/stats/cumulative", { year_gte, year_lte, round_gte, round_lte });
    },
    {
        name: "get_cumulative_stats",
        description: "Get aggregated stats (points, wins) over a range of years/rounds. Essential for 'since 2015' or 'between round X and Y' queries.",
        schema: z.object({
            year_gte: StartYearSchema,
            year_lte: EndYearSchema,
            round_gte: RoundSchema.describe("Start round (inclusive)"),
            round_lte: RoundSchema.describe("End round (inclusive)"),
        }),
    }
);

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * All available OpenF1 data tools
 */
export const openF1Tools: Record<string, StructuredTool> = {
    // Session Discovery
    get_seasons: getSeasonsTool,
    get_meetings: getMeetingsTool,
    get_sessions: getSessionsTool,

    // Drivers
    get_drivers: getDriversTool,

    // Lap Data
    get_laps: getLapsTool,

    // Telemetry
    get_car_data: getCarDataTool,
    get_location: getLocationTool,

    // Race Data
    get_intervals: getIntervalsTool,
    get_position: getPositionTool,
    get_race_control: getRaceControlTool,

    // Weather
    get_weather: getWeatherTool,

    // Strategy
    get_stints: getStintsTool,
    get_pit_stops: getPitStopsTool,

    // Results
    get_session_results: getSessionResultsTool,
    get_starting_grid: getStartingGridTool,

    // Events
    get_overtakes: getOvertakesTool,
    get_team_radio: getTeamRadioTool,

    // Historical
    get_driver_standings: getDriverStandingsTool,
    get_cumulative_stats: getCumulativeStatsTool,
};

/**
 * Get all OpenF1 tools as an array
 */
export function getOpenF1Tools(): StructuredTool[] {
    return Object.values(openF1Tools);
}
