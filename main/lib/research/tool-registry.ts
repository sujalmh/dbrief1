/**
 * Self-Describing Tool Registry
 * =============================
 *
 * Unified registry for all F1 research tools. Each tool is registered with
 * ToolMetadata that describes its inputs, outputs, and dependencies. The
 * Planner and Reasoner discover tools from this registry — no tool knowledge
 * is hardcoded into prompts.
 *
 * Adding a new tool only requires:
 *   1. Creating the LangChain tool in lib/tools/
 *   2. Registering it here with ToolMetadata
 *
 * No prompt changes needed.
 */

import { StructuredTool } from "@langchain/core/tools";
import { f1Tools } from "@/lib/tools/fastf1";
import { regulationRetrieveTool } from "@/lib/tools/regulation";
import { webSearchTool, fetchWebPagesTool } from "@/lib/tools/search";
import { runSimulationTool } from "@/lib/tools/simulation";
import { createVisualizationTool } from "@/lib/tools/visualization";
import type { ToolMetadata } from "./types";

// =============================================================================
// Tool Metadata Definitions
// =============================================================================

// Use the current calendar year in tool descriptions so the LLM never
// thinks the current season is "unavailable". Without this, the LLM would
// see hardcoded "1950-2025" descriptions long after 2025 and refuse to
// answer questions about the current season.
const CURRENT_YEAR = new Date().getFullYear();
const SEASONS_RANGE = `1950-${CURRENT_YEAR}`;

const TOOL_METADATA: Record<string, ToolMetadata> = {
    get_seasons: {
        name: "get_seasons",
        description: `Get the list of available F1 seasons (${SEASONS_RANGE})`,
        category: "data",
        outputType: "seasons",
        outputShape: `{ seasons: number[] } — array of year numbers from 1950 to ${CURRENT_YEAR}`,
        requires: [],
        provides: ["seasons"],
    },
    get_events: {
        name: "get_events",
        description: "Get all F1 events (Grand Prix) for a specific season year",
        category: "data",
        outputType: "events",
        outputShape: "{ year, events: [{ round_number, country, location, event_name, event_date, event_format, sessions[] }] }",
        requires: [],
        provides: ["events"],
    },
    get_gp_names: {
        name: "get_gp_names",
        description: "Get canonical Grand Prix names for a specific season year. Use this FIRST to discover valid GP names before calling session-specific tools.",
        category: "data",
        outputType: "events",
        outputShape: "{ grand_prix: [{ round, event_name, location, country, canonical }] }",
        requires: [],
        provides: ["events"],
    },
    get_sessions: {
        name: "get_sessions",
        description: "Get available sessions (FP1, FP2, FP3, Q, R) for a specific Grand Prix",
        category: "data",
        outputType: "sessions",
        outputShape: "{ year, gp, sessions: [{ session_name, session_type, date, available }] }",
        requires: ["events"],
        provides: ["sessions"],
    },
    get_results: {
        name: "get_results",
        description: "Get results for any session (practice, qualifying, or race)",
        category: "data",
        outputType: "results",
        outputShape: "{ session_name, results: [{ position, driver, team, lap_time, gap, status, points }] }",
        requires: [],
        provides: ["results"],
    },
    get_qualifying: {
        name: "get_qualifying",
        description: "Get qualifying results with Q1, Q2, Q3 times for a Grand Prix",
        category: "data",
        outputType: "qualifying",
        outputShape: "{ session_name, results: [{ position, driver, team, q1, q2, q3, lap_time }] }",
        requires: [],
        provides: ["qualifying"],
    },
    get_race: {
        name: "get_race",
        description: "Get race results including positions, times, and status for a Grand Prix",
        category: "data",
        outputType: "race",
        outputShape: "{ session_name, results: [{ position, driver, team, lap_time, gap, status, points, grid_position }] }",
        requires: [],
        provides: ["race"],
    },
    get_laps: {
        name: "get_laps",
        description: "Get lap-by-lap data with optional filters for driver and lap range",
        category: "data",
        outputType: "laps",
        outputShape: "{ session_name, total_laps, laps: [{ LapNumber, LapTime, Driver, Compound, TyreLife, Sector1, Sector2, Sector3 }] }",
        requires: [],
        provides: ["laps"],
    },
    get_fastest_lap: {
        name: "get_fastest_lap",
        description: "Get the fastest lap in a session, optionally filtered by driver",
        category: "data",
        outputType: "fastest_lap",
        outputShape: "{ session_name, driver, lap_number, lap_time, sector1, sector2, sector3, compound, tyre_life }",
        requires: [],
        provides: ["fastest_lap"],
    },
    get_telemetry: {
        name: "get_telemetry",
        description: "Get detailed telemetry (speed, throttle, brake, gear) for a driver's lap. Returns large arrays — use get_telemetry_summary for LLM analysis",
        category: "data",
        outputType: "telemetry",
        outputShape: "{ driver, lap_number, lap_time, data: [{ Distance, Speed, Throttle, Brake, RPM, nGear, DRS }], corners, telemetry_points }",
        requires: [],
        provides: ["telemetry"],
    },
    get_telemetry_summary: {
        name: "get_telemetry_summary",
        description: "Get statistical summary of telemetry (min/max/avg speed, throttle, brake, corner speeds) for a driver's lap. PREFERRED for LLM analysis",
        category: "data",
        outputType: "telemetry_summary",
        outputShape: "{ driver, lap_number, lap_time, compound, tyre_life, speed_summary{min,max,avg}, throttle_summary, brake_summary, corner_min_speeds[], sector_speeds[] }",
        requires: [],
        provides: ["telemetry_summary"],
    },
    get_weather: {
        name: "get_weather",
        description: "Get weather conditions (temperature, humidity, rainfall) during a session",
        category: "data",
        outputType: "weather",
        outputShape: "{ session_name, data: [{ time, air_temp, track_temp, humidity, pressure, wind_speed, wind_direction, rainfall }] }",
        requires: [],
        provides: ["weather"],
    },
    get_race_control: {
        name: "get_race_control",
        description: "Get race control messages including flags, penalties, and track incidents",
        category: "data",
        outputType: "race_control",
        outputShape: "{ session_name, messages: [{ time, category, message, flag, scope, driver }] }",
        requires: [],
        provides: ["race_control"],
    },
    get_tyres: {
        name: "get_tyres",
        description: "Get tyre compound and stint information for a session",
        category: "data",
        outputType: "tyres",
        outputShape: "{ session_name, tyres: [{ driver, stint, compound, tyre_life_start, fresh_tyre, laps_in_stint, first_lap, last_lap }] }",
        requires: [],
        provides: ["tyres"],
    },
    get_driver_standings: {
        name: "get_driver_standings",
        description: "Get final driver standings (points, wins, position) for a specific season",
        category: "data",
        outputType: "standings",
        outputShape: "{ year, standings: [{ position, driver, points, wins, team }] }",
        requires: [],
        provides: ["standings"],
    },
    retrieve_regulations: {
        name: "retrieve_regulations",
        description: "Retrieve FIA F1 documents (regulations and stewards' decisions) from the vector store. Use for questions about rules, regulations, penalties, or official FIA documents",
        category: "regulation",
        outputType: "regulation",
        outputShape: "{ retrieved_documents: [{ source, date, type, content }], used_subqueries: string[] }",
        requires: [],
        provides: ["regulation"],
    },
    web_search: {
        name: "web_search",
        description: "TinyFish web search for current F1 news and context. REQUIRED for latest/most-recent/last-race/current questions (use domain_type 'news' + a recency window). Never resolve recency with FastF1 tools.",
        category: "search",
        outputType: "web_search",
        outputShape: "{ results: [{ title, url, snippet, date?, publisher? }], query }",
        requires: [],
        provides: ["web_search"],
        deepResearchOnly: true,
    },
    fetch_web_pages: {
        name: "fetch_web_pages",
        description: "TinyFish page extraction (clean markdown) for URLs from web_search results. Use AFTER web_search on the top 1-3 URLs to verify key facts for latest/news answers.",
        category: "search",
        outputType: "web_fetch",
        outputShape: "{ pages: [{ url, final_url, title, published_date?, text }], errors[] }",
        requires: [],
        provides: ["web_fetch"],
        deepResearchOnly: true,
    },
    run_simulation: {
        name: "run_simulation",
        description: "Run Monte Carlo simulation for what-if / counterfactual / predictive analysis. To ground simulations in real data, first fetch historical data (get_laps, get_race, etc.) and pass it via reference_data with reference_field naming the numeric field to derive base/variance from. Examples: 'What if Verstappen retired in 3 races?', 'What if Abu Dhabi 2021 didn't end under safety car?'",
        category: "simulation",
        outputType: "simulation",
            outputShape: "{ scenario_id, summary, key_metrics: {mean, min, max, std_dev, p50_median, p95}, visualization, statistics, raw_values, parameters_used: {base_value, variance, derived_from_reference_data, grounding: explicit|derived|defaults|defaults-despite-reference, reference_field, warning?} }",
        requires: [],
        provides: ["simulation"],
        deepResearchOnly: true,
    },
    create_visualization: {
        name: "create_visualization",
        description: "Signal the frontend to create a visualization chart from data collected in previous steps",
        category: "visualization",
        outputType: "visualization",
        outputShape: "{ action, chart_type, data_source, message }",
        requires: [],
        provides: ["visualization"],
    },
};

// =============================================================================
// Tool Registry Class
// =============================================================================

export class ToolRegistry {
    private tools: Map<string, StructuredTool> = new Map();
    private metadata: Map<string, ToolMetadata> = new Map();
    // Memoized prompt strings keyed by the deepResearch flag.
    // toPromptString() is rebuilt from the same registry contents on
    // every research iteration (up to 20×/request) — cache it and only
    // invalidate when the registry itself changes.
    private promptCache: Map<boolean, string> = new Map();

    /**
     * Register a tool with its metadata.
     * Logs a warning if a tool is already registered with the same name.
     */
    register(tool: StructuredTool, metadata: ToolMetadata): void {
        if (this.tools.has(metadata.name)) {
            console.warn(
                `[ToolRegistry] Overwriting existing tool "${metadata.name}". ` +
                `This may mask configuration errors — ensure this is intentional.`
            );
        }
        this.tools.set(metadata.name, tool);
        this.metadata.set(metadata.name, metadata);
        this.promptCache.clear();
    }

    /**
     * Get a tool by name.
     */
    getTool(name: string): StructuredTool | undefined {
        return this.tools.get(name);
    }

    /**
     * Get metadata for a tool.
     */
    getToolMetadata(name: string): ToolMetadata | undefined {
        return this.metadata.get(name);
    }

    /**
     * Get all registered tools as a map (for the Executor).
     */
    getAllTools(): Record<string, StructuredTool> {
        const result: Record<string, StructuredTool> = {};
        for (const [name, tool] of this.tools) {
            result[name] = tool;
        }
        return result;
    }

    /**
     * Get all tool metadata.
     */
    getAllMetadata(): ToolMetadata[] {
        return Array.from(this.metadata.values());
    }

    /**
     * Filter tools available for the current research mode.
     */
    getToolsForMode(deepResearch: boolean): ToolMetadata[] {
        return this.getAllMetadata().filter((m) => !m.deepResearchOnly || deepResearch);
    }

    /**
     * Serialize all tool metadata to a compact string for inclusion in
     * Planner and Reasoner prompts. This replaces hardcoded tool knowledge.
     * Result is memoized per flag (see promptCache) — registry contents
     * are fixed after createToolRegistry(), but register() invalidates.
     */
    toPromptString(deepResearch: boolean = true): string {
        const cached = this.promptCache.get(deepResearch);
        if (cached !== undefined) return cached;
        const tools = this.getToolsForMode(deepResearch);
        const str = tools
            .map((m) => {
                const reqStr = m.requires.length > 0 ? ` (requires: ${m.requires.join(", ")})` : "";
                return `### ${m.name}${reqStr}\n${m.description}\nOutput: ${m.outputShape}`;
            })
            .join("\n\n");
        this.promptCache.set(deepResearch, str);
        return str;
    }
}

// =============================================================================
// Default Registry Factory
// =============================================================================

/**
 * Build the default tool registry with all F1 tools registered.
 * @param deepResearch - whether to include deep-research-only tools (web_search, simulation)
 */
export function createToolRegistry(deepResearch: boolean = true): ToolRegistry {
    const registry = new ToolRegistry();

    // F1 data tools (14)
    for (const [name, tool] of Object.entries(f1Tools)) {
        const metadata = TOOL_METADATA[name];
        if (metadata) {
            registry.register(tool, metadata);
        }
    }

    // Regulation tool (FIA regulations + stewards' decisions vector search).
    registry.register(regulationRetrieveTool, TOOL_METADATA.retrieve_regulations);

    // Deep-research-only tools
    if (deepResearch) {
        registry.register(webSearchTool, TOOL_METADATA.web_search);
        registry.register(fetchWebPagesTool, TOOL_METADATA.fetch_web_pages);
        registry.register(runSimulationTool, TOOL_METADATA.run_simulation);
    }

    // Visualization tool (always available)
    registry.register(createVisualizationTool, TOOL_METADATA.create_visualization);

    return registry;
}
