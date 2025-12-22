/**
 * Comprehensive Test Prompts for All OpenF1 Endpoints
 * ====================================================
 * Complete coverage of all 17 OpenF1 API endpoints with realistic user queries
 */

export interface ComprehensiveTestCase {
    prompt: string
    expectedTools: string[]
    expectedDrivers?: number[]
    expectedYear?: number
    expectedCountry?: string
    expectedSession?: string
    description: string
    category: string
}

// =============================================================================
// Session Discovery Tests (3 endpoints)
// =============================================================================

export const SESSION_DISCOVERY_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "What seasons are available?",
        expectedTools: ["get_seasons"],
        description: "Get available F1 seasons",
        category: "Session Discovery"
    },
    {
        prompt: "Show me all races in 2024",
        expectedTools: ["get_meetings"],
        expectedYear: 2024,
        description: "Get all meetings for 2024 season",
        category: "Session Discovery"
    },
    {
        prompt: "What sessions happened in Monaco 2024?",
        expectedTools: ["get_sessions"],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        description: "Get all sessions for Monaco 2024",
        category: "Session Discovery"
    },
    {
        prompt: "When was qualifying in Abu Dhabi 2024?",
        expectedTools: ["get_sessions"],
        expectedYear: 2024,
        expectedCountry: "Abu Dhabi",
        expectedSession: "Qualifying",
        description: "Get specific session info",
        category: "Session Discovery"
    }
]

// =============================================================================
// Driver & Lap Data Tests (2 endpoints)
// =============================================================================

export const DRIVER_LAP_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Who raced in Monaco 2024?",
        expectedTools: ["get_sessions", "get_drivers"],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        description: "Get drivers for a session",
        category: "Driver Data"
    },
    {
        prompt: "Show Verstappen's lap times in Monaco 2024 qualifying",
        expectedTools: ["get_sessions", "get_laps"],
        expectedDrivers: [1],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        expectedSession: "Qualifying",
        description: "Get lap times for specific driver",
        category: "Lap Data"
    },
    {
        prompt: "Compare times between Lando and Oscar in Abu Dhabi 2024 GP",
        expectedTools: ["get_sessions", "get_laps", "get_laps"],
        expectedDrivers: [4, 81],
        expectedYear: 2024,
        expectedCountry: "Abu Dhabi",
        expectedSession: "Race",
        description: "Compare lap times between two drivers",
        category: "Lap Data"
    },
    {
        prompt: "What was Hamilton's fastest lap in Silverstone 2024 race?",
        expectedTools: ["get_sessions", "get_laps"],
        expectedDrivers: [44],
        expectedYear: 2024,
        expectedCountry: "Great Britain",
        expectedSession: "Race",
        description: "Get fastest lap for driver",
        category: "Lap Data"
    }
]

// =============================================================================
// Telemetry Tests (2 endpoints)
// =============================================================================

export const TELEMETRY_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Show Leclerc's speed trace in Monza 2024 qualifying",
        expectedTools: ["get_sessions", "get_car_data"],
        expectedDrivers: [16],
        expectedYear: 2024,
        expectedCountry: "Italy",
        expectedSession: "Qualifying",
        description: "Get car telemetry data",
        category: "Telemetry"
    },
    {
        prompt: "Plot Verstappen's throttle and brake data in Spa 2024",
        expectedTools: ["get_sessions", "get_car_data"],
        expectedDrivers: [1],
        expectedYear: 2024,
        expectedCountry: "Belgium",
        description: "Get throttle and brake telemetry",
        category: "Telemetry"
    },
    {
        prompt: "Show car position data for Alonso in Monaco 2024",
        expectedTools: ["get_sessions", "get_location"],
        expectedDrivers: [14],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        description: "Get car location on track",
        category: "Telemetry"
    }
]

// =============================================================================
// Race Data Tests (4 endpoints)
// =============================================================================

export const RACE_DATA_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Show the gaps between drivers in Bahrain 2024 race",
        expectedTools: ["get_sessions", "get_intervals"],
        expectedYear: 2024,
        expectedCountry: "Bahrain",
        expectedSession: "Race",
        description: "Get interval data",
        category: "Race Data"
    },
    {
        prompt: "How did positions change in the Singapore 2024 race?",
        expectedTools: ["get_sessions", "get_position"],
        expectedYear: 2024,
        expectedCountry: "Singapore",
        expectedSession: "Race",
        description: "Get position changes over time",
        category: "Race Data"
    },
    {
        prompt: "Were there any yellow flags in Monaco 2024?",
        expectedTools: ["get_sessions", "get_race_control"],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        description: "Get race control messages and flags",
        category: "Race Data"
    },
    {
        prompt: "What was the weather like in Silverstone 2024 qualifying?",
        expectedTools: ["get_sessions", "get_weather"],
        expectedYear: 2024,
        expectedCountry: "Great Britain",
        expectedSession: "Qualifying",
        description: "Get weather conditions",
        category: "Race Data"
    },
    {
        prompt: "Show me all penalties in the Austrian GP 2024",
        expectedTools: ["get_sessions", "get_race_control"],
        expectedYear: 2024,
        expectedCountry: "Austria",
        description: "Get penalties from race control",
        category: "Race Data"
    }
]

// =============================================================================
// Strategy Tests (2 endpoints)
// =============================================================================

export const STRATEGY_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "What tyre strategy did Sainz use in Monza 2024?",
        expectedTools: ["get_sessions", "get_stints"],
        expectedDrivers: [55],
        expectedYear: 2024,
        expectedCountry: "Italy",
        expectedSession: "Race",
        description: "Get tyre stint information",
        category: "Strategy"
    },
    {
        prompt: "Compare tyre strategies between Ferrari and Red Bull in Hungary 2024",
        expectedTools: ["get_sessions", "get_stints"],
        expectedYear: 2024,
        expectedCountry: "Hungary",
        description: "Compare team tyre strategies",
        category: "Strategy"
    },
    {
        prompt: "How many pit stops did Perez make in Mexico 2024?",
        expectedTools: ["get_sessions", "get_pit_stops"],
        expectedDrivers: [11],
        expectedYear: 2024,
        expectedCountry: "Mexico",
        expectedSession: "Race",
        description: "Get pit stop data",
        category: "Strategy"
    },
    {
        prompt: "Show all pit stops in the Brazilian GP 2024",
        expectedTools: ["get_sessions", "get_pit_stops"],
        expectedYear: 2024,
        expectedCountry: "Brazil",
        expectedSession: "Race",
        description: "Get all pit stops for a race",
        category: "Strategy"
    }
]

// =============================================================================
// Results Tests (2 endpoints)
// =============================================================================

export const RESULTS_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Who won the Monaco 2024 race?",
        expectedTools: ["get_sessions", "get_session_results"],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        expectedSession: "Race",
        description: "Get race results",
        category: "Results"
    },
    {
        prompt: "Show the top 10 finishers in Abu Dhabi 2024",
        expectedTools: ["get_sessions", "get_session_results"],
        expectedYear: 2024,
        expectedCountry: "Abu Dhabi",
        expectedSession: "Race",
        description: "Get top 10 results",
        category: "Results"
    },
    {
        prompt: "What was the starting grid for Silverstone 2024?",
        expectedTools: ["get_sessions", "get_starting_grid"],
        expectedYear: 2024,
        expectedCountry: "Great Britain",
        expectedSession: "Race",
        description: "Get starting grid positions",
        category: "Results"
    },
    {
        prompt: "Who got pole position in Spa 2024?",
        expectedTools: ["get_sessions", "get_session_results"],
        expectedYear: 2024,
        expectedCountry: "Belgium",
        expectedSession: "Qualifying",
        description: "Get qualifying results for pole",
        category: "Results"
    }
]

// =============================================================================
// Event Tests (2 endpoints)
// =============================================================================

export const EVENT_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Show overtakes in the Las Vegas 2024 race",
        expectedTools: ["get_sessions", "get_overtakes"],
        expectedYear: 2024,
        expectedCountry: "Las Vegas",
        expectedSession: "Race",
        description: "Get overtake data",
        category: "Events"
    },
    {
        prompt: "How many overtakes did Norris make in Austin 2024?",
        expectedTools: ["get_sessions", "get_overtakes"],
        expectedDrivers: [4],
        expectedYear: 2024,
        expectedCountry: "United States",
        expectedSession: "Race",
        description: "Get overtakes for specific driver",
        category: "Events"
    },
    {
        prompt: "What did the team say to Hamilton during Monaco 2024?",
        expectedTools: ["get_sessions", "get_team_radio"],
        expectedDrivers: [44],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        description: "Get team radio messages",
        category: "Events"
    },
    {
        prompt: "Show all team radio from the Japanese GP 2024",
        expectedTools: ["get_sessions", "get_team_radio"],
        expectedYear: 2024,
        expectedCountry: "Japan",
        expectedSession: "Race",
        description: "Get all team radio for a race",
        category: "Events"
    }
]

// =============================================================================
// Complex Multi-Step Tests
// =============================================================================

export const COMPLEX_WORKFLOW_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Compare Verstappen and Leclerc's race pace and tyre strategy in Bahrain 2024",
        expectedTools: ["get_sessions", "get_laps", "get_laps", "get_stints", "get_stints"],
        expectedDrivers: [1, 16],
        expectedYear: 2024,
        expectedCountry: "Bahrain",
        expectedSession: "Race",
        description: "Multi-driver comparison with multiple data types",
        category: "Complex Workflow"
    },
    {
        prompt: "Show me the complete race story for Monaco 2024: results, overtakes, and penalties",
        expectedTools: ["get_sessions", "get_session_results", "get_overtakes", "get_race_control"],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        expectedSession: "Race",
        description: "Multiple data types for race analysis",
        category: "Complex Workflow"
    },
    {
        prompt: "Analyze McLaren's performance in Singapore 2024: both drivers' lap times and strategies",
        expectedTools: ["get_sessions", "get_laps", "get_laps", "get_stints", "get_stints"],
        expectedDrivers: [4, 81],
        expectedYear: 2024,
        expectedCountry: "Singapore",
        description: "Team analysis with multiple drivers",
        category: "Complex Workflow"
    }
]

// =============================================================================
// Edge Cases & Error Handling
// =============================================================================

export const EDGE_CASE_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Show data from 2022 Monaco GP",
        expectedTools: [],
        description: "Pre-2023 data (should be rejected)",
        category: "Edge Cases"
    },
    {
        prompt: "What happened in the 2026 Australian GP?",
        expectedTools: [],
        description: "Future year (should be rejected)",
        category: "Edge Cases"
    },
    {
        prompt: "Show Schumacher's lap times in 2024",
        expectedTools: [],
        description: "Invalid driver for 2024 season",
        category: "Edge Cases"
    },
    {
        prompt: "Compare times in Abu Dhabi 25",
        expectedTools: ["get_sessions"],
        expectedYear: 2025,
        expectedCountry: "Abu Dhabi",
        description: "Abbreviated year format (25 -> 2025)",
        category: "Edge Cases"
    }
]

// =============================================================================
// Aggregated Test Suite
// =============================================================================

export const ALL_COMPREHENSIVE_TESTS: ComprehensiveTestCase[] = [
    ...SESSION_DISCOVERY_TESTS,
    ...DRIVER_LAP_TESTS,
    ...TELEMETRY_TESTS,
    ...RACE_DATA_TESTS,
    ...STRATEGY_TESTS,
    ...RESULTS_TESTS,
    ...EVENT_TESTS,
    ...COMPLEX_WORKFLOW_TESTS,
    ...EDGE_CASE_TESTS
]

// =============================================================================
// Test Categories for Organized Execution
// =============================================================================

export const TEST_CATEGORIES = {
    "Session Discovery": SESSION_DISCOVERY_TESTS,
    "Driver Data": DRIVER_LAP_TESTS.filter(t => t.category === "Driver Data"),
    "Lap Data": DRIVER_LAP_TESTS.filter(t => t.category === "Lap Data"),
    "Telemetry": TELEMETRY_TESTS,
    "Race Data": RACE_DATA_TESTS,
    "Strategy": STRATEGY_TESTS,
    "Results": RESULTS_TESTS,
    "Events": EVENT_TESTS,
    "Complex Workflow": COMPLEX_WORKFLOW_TESTS,
    "Edge Cases": EDGE_CASE_TESTS
}

// =============================================================================
// Priority Tests (Most Common User Queries)
// =============================================================================

export const PRIORITY_TESTS: ComprehensiveTestCase[] = [
    {
        prompt: "Compare times between Lando and Oscar in Abu Dhabi 2024 GP",
        expectedTools: ["get_sessions", "get_laps", "get_laps"],
        expectedDrivers: [4, 81],
        expectedYear: 2024,
        expectedCountry: "Abu Dhabi",
        expectedSession: "Race",
        description: "The original failing test case",
        category: "Priority"
    },
    {
        prompt: "Show Verstappen's lap times in Monaco 2024 qualifying",
        expectedTools: ["get_sessions", "get_laps"],
        expectedDrivers: [1],
        expectedYear: 2024,
        expectedCountry: "Monaco",
        expectedSession: "Qualifying",
        description: "Single driver lap times",
        category: "Priority"
    },
    {
        prompt: "What tyre strategy did Ferrari use in Monza 2024?",
        expectedTools: ["get_sessions", "get_stints"],
        expectedYear: 2024,
        expectedCountry: "Italy",
        expectedSession: "Race",
        description: "Team strategy query",
        category: "Priority"
    },
    {
        prompt: "Who won the Brazilian GP 2024?",
        expectedTools: ["get_sessions", "get_session_results"],
        expectedYear: 2024,
        expectedCountry: "Brazil",
        expectedSession: "Race",
        description: "Race results query",
        category: "Priority"
    }
]
