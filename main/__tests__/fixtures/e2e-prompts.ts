/**
 * E2E Cross-Model Prompt Suite
 * =============================
 *
 * Prompt categories the user explicitly asked us to cover:
 *  - RECENT     : current-season queries (2024/2025/2026, telemetry + lap rich)
 *  - PAST       : historical queries (2018+, 2010-2017, pre-1980)
 *  - COMPARISON : multi-driver / multi-team / multi-lap queries
 *  - INFERENCE  : what-ifs, counterfactuals, predictions, season-level math
 *
 * Each prompt records:
 *  - the canonical expected behaviour (tools + key args) the planner should produce
 *  - tags the grader uses for stability scoring
 *  - per-prompt "poison checks" — values that, if present in a model response,
 *    prove the model is hallucinating or using training data instead of the tools
 */

export type E2ECategory = "RECENT" | "PAST" | "COMPARISON" | "INFERENCE";

export interface E2EPrompt {
    id: string;
    category: E2ECategory;
    prompt: string;
    /** Tags used for grouping in the final report. */
    tags: string[];
    /**
     * For RECENT/PAST/COMPARISON: the tool(s) the planner MUST emit.
     * For INFERENCE: at least one tool, with at least one being run_simulation.
     */
    expectTools?: string[];
    /**
     * Required args (subset match). GP/driver/year in particular are the
     * highest-value hallucination checks.
     */
    expectArgs?: Record<string, unknown>;
    /** "any": any one of the listed tools is acceptable. */
    expectToolsAny?: string[];
    /** Forbidden tools — planner should not pick these for this prompt. */
    forbidTools?: string[];
    /** Year the planner is being asked about; tracked for hallucination. */
    expectedYear?: number;
    /** Driver the planner is being asked about; tracked for hallucination. */
    expectedDriver?: string;
    /** GP the planner is being asked about; tracked for hallucination. */
    expectedGp?: string;
    /**
     * Strings the LLM responder MUST NOT make up. We check the full
     * response text. Example: the 2021 Abu Dhabi winner is VER, so if
     * a model answers "Hamilton won 2021 Abu Dhabi" we catch it.
     */
    mustNotMention?: string[];
    /**
     * Strings the responder MUST mention. Use sparingly; mostly we trust
     * tools to deliver the right facts.
     */
    mustMention?: string[];
    /** If the prompt is intentionally pre-2018, telemetry must be skipped. */
    pre2018?: boolean;
}

// =============================================================================
// RECENT — 2024/2025/2026 telemetry-rich sessions
// =============================================================================
export const RECENT_PROMPTS: E2EPrompt[] = [
    {
        id: "recent-ver-monaco-2024",
        category: "RECENT",
        prompt: "Show Verstappen's lap times in the 2024 Monaco Grand Prix race.",
        tags: ["single-driver", "race"],
        expectTools: ["get_laps"],
        expectArgs: { year: 2024, gp: "Monaco", session: "R", driver: "VER" },
        expectedYear: 2024,
        expectedDriver: "VER",
        expectedGp: "Monaco",
    },
    {
        id: "recent-hamilton-telemetry-bahrain-2024",
        category: "RECENT",
        prompt: "Show telemetry for Lewis Hamilton's fastest lap at the 2024 Bahrain GP qualifying.",
        tags: ["telemetry", "qualifying"],
        expectTools: ["get_telemetry"],
        expectArgs: { year: 2024, gp: "Bahrain", session: "Q", driver: "HAM" },
        expectedYear: 2024,
        expectedDriver: "HAM",
        expectedGp: "Bahrain",
    },
    {
        id: "recent-piastri-tyres-japan-2024",
        category: "RECENT",
        prompt: "What was Piastri's tyre strategy in the 2024 Japanese Grand Prix?",
        tags: ["strategy"],
        expectTools: ["get_tyres"],
        expectArgs: { year: 2024, gp: "Japan", driver: "PIA" },
        expectedYear: 2024,
        expectedDriver: "PIA",
        expectedGp: "Japan",
    },
    {
        id: "recent-standings-2024",
        category: "RECENT",
        prompt: "Who won the 2024 drivers' championship?",
        tags: ["standings"],
        expectTools: ["get_driver_standings"],
        expectArgs: { year: 2024 },
        expectedYear: 2024,
    },
    {
        id: "recent-weather-britain-2024",
        category: "RECENT",
        prompt: "What was the weather like during the 2024 British Grand Prix?",
        tags: ["weather"],
        expectTools: ["get_weather"],
        expectArgs: { year: 2024, gp: "Great Britain" },
        expectedYear: 2024,
        expectedGp: "Great Britain",
    },
];

// =============================================================================
// PAST — historical, including pre-2018 (ergast-only) and 2018+ (full telemetry)
// =============================================================================
export const PAST_PROMPTS: E2EPrompt[] = [
    {
        id: "past-2020-silverstone-tyres",
        category: "PAST",
        prompt: "Plot Hamilton's tyre stints in the 2020 British Grand Prix.",
        tags: ["strategy", "single-driver"],
        expectTools: ["get_tyres"],
        expectArgs: { year: 2020, gp: "Great Britain", driver: "HAM" },
        expectedYear: 2020,
        expectedDriver: "HAM",
        expectedGp: "Great Britain",
    },
    {
        id: "past-2017-standings",
        category: "PAST",
        prompt: "Who won the 2017 F1 drivers' championship?",
        tags: ["standings", "pre-2018"],
        expectTools: ["get_driver_standings"],
        expectArgs: { year: 2017 },
        expectedYear: 2017,
        // Tools that need full telemetry data MUST NOT be selected for 2017.
        forbidTools: ["get_telemetry", "get_telemetry_summary", "get_laps", "get_tyres", "get_weather", "get_race_control"],
        pre2018: true,
    },
    {
        id: "past-1994-standings",
        category: "PAST",
        prompt: "Show the 1994 F1 drivers' standings.",
        tags: ["standings", "pre-2018"],
        expectTools: ["get_driver_standings"],
        expectArgs: { year: 1994 },
        expectedYear: 1994,
        forbidTools: ["get_telemetry", "get_telemetry_summary", "get_laps", "get_tyres", "get_weather", "get_race_control"],
        pre2018: true,
    },
    {
        id: "past-1950-first-race",
        category: "PAST",
        prompt: "Who won the first ever F1 race in 1950?",
        tags: ["standings", "pre-2018"],
        expectTools: ["get_driver_standings"],
        expectArgs: { year: 1950 },
        expectedYear: 1950,
        forbidTools: ["get_telemetry", "get_telemetry_summary", "get_laps", "get_tyres", "get_weather", "get_race_control"],
        pre2018: true,
    },
    {
        id: "past-monza-2020-raci-control",
        category: "PAST",
        prompt: "Were there any safety cars in the 2020 Italian Grand Prix?",
        tags: ["race-control"],
        expectTools: ["get_race_control"],
        expectArgs: { year: 2020, gp: "Italy" },
        expectedYear: 2020,
        expectedGp: "Italy",
    },
    {
        id: "past-telemetry-pre-2018-rejection",
        category: "PAST",
        prompt: "Show me telemetry for Senna in the 1994 Monaco Grand Prix.",
        tags: ["telemetry", "pre-2018", "should-be-rejected"],
        // The planner SHOULD refuse telemetry for pre-2018 sessions.
        expectTools: [], // explicitly empty
        forbidTools: ["get_telemetry", "get_telemetry_summary", "get_laps", "get_tyres"],
        pre2018: true,
        expectedYear: 1994,
    },
];

// =============================================================================
// COMPARISON — multi-driver / multi-team
// =============================================================================
export const COMPARISON_PROMPTS: E2EPrompt[] = [
    {
        id: "cmp-ver-vs-nor-monaco-2024",
        category: "COMPARISON",
        prompt: "Compare Verstappen's and Norris's pace in the 2024 Monaco Grand Prix qualifying.",
        tags: ["two-driver", "qualifying"],
        // MUST be exactly 2 tool calls, one per driver.
        expectToolsAny: ["get_fastest_lap", "get_telemetry", "get_laps"],
        expectedYear: 2024,
        expectedGp: "Monaco",
    },
    {
        id: "cmp-ferrari-vs-redbull-monza-2021",
        category: "COMPARISON",
        prompt: "Compare Ferrari vs Red Bull race pace at Monza 2021.",
        tags: ["team-vs-team"],
        // Multi-driver fetch expected.
        expectToolsAny: ["get_laps", "get_telemetry"],
        expectedYear: 2021,
        expectedGp: "Italy",
    },
    {
        id: "cmp-three-drivers-monaco-2023",
        category: "COMPARISON",
        prompt: "Get lap times for VER, HAM, and LEC in Monaco 2023.",
        tags: ["three-driver"],
        expectToolsAny: ["get_laps", "get_fastest_lap"],
        expectedYear: 2023,
        expectedGp: "Monaco",
    },
    {
        id: "cmp-qualifying-monaco-2024",
        category: "COMPARISON",
        prompt: "Show qualifying results for Monaco 2024.",
        tags: ["all-drivers"],
        // Single get_qualifying call is the efficient path.
        expectTools: ["get_qualifying"],
        expectArgs: { year: 2024, gp: "Monaco" },
        expectedYear: 2024,
        expectedGp: "Monaco",
    },
    {
        id: "cmp-mclaren-vs-mercedes-2023",
        category: "COMPARISON",
        prompt: "How did McLaren perform versus Mercedes in 2023?",
        tags: ["team-vs-team", "season"],
        expectToolsAny: ["get_driver_standings", "get_race"],
        expectedYear: 2023,
    },
];

// =============================================================================
// INFERENCE — what-ifs / counterfactuals / predictions
// =============================================================================
export const INFERENCE_PROMPTS: E2EPrompt[] = [
    {
        id: "inf-abu-dhabi-2021-no-sc",
        category: "INFERENCE",
        prompt: "What if the 2021 Abu Dhabi Grand Prix didn't end under safety car?",
        tags: ["counterfactual", "race-level"],
        // Per planner rules, MUST include run_simulation, ideally
        // preceded by get_laps for grounding.
        expectToolsAny: ["run_simulation"],
        expectedYear: 2021,
        expectedGp: "Abu Dhabi",
    },
    {
        id: "inf-wet-spa-2019-qualifying",
        category: "INFERENCE",
        prompt: "How would lap times change if Spa 2019 qualifying had been wet?",
        tags: ["what-if", "weather"],
        expectToolsAny: ["run_simulation"],
        expectedYear: 2019,
        expectedGp: "Belgium",
    },
    {
        id: "inf-reliability-points-2023",
        category: "INFERENCE",
        prompt: "What if Verstappen had a DNF in every race of 2023? How would the points look?",
        tags: ["season-counterfactual"],
        expectToolsAny: ["run_simulation"],
        expectedYear: 2023,
    },
    {
        id: "inf-pit-stop-slow-monaco",
        category: "INFERENCE",
        prompt: "What if a pit stop took 5 extra seconds in Monaco 2024 race?",
        tags: ["what-if", "pit"],
        expectToolsAny: ["run_simulation"],
        expectedYear: 2024,
        expectedGp: "Monaco",
    },
    {
        id: "inf-lap-time-improvement-driver",
        category: "INFERENCE",
        prompt: "If a driver improves their average lap time by 0.3s, what would the impact be on a 60-lap race?",
        tags: ["pure-what-if"],
        expectToolsAny: ["run_simulation"],
    },
];

// =============================================================================
// ALL
// =============================================================================
export const ALL_E2E_PROMPTS: E2EPrompt[] = [
    ...RECENT_PROMPTS,
    ...PAST_PROMPTS,
    ...COMPARISON_PROMPTS,
    ...INFERENCE_PROMPTS,
];
