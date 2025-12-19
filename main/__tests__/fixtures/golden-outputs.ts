/**
 * Golden Output Fixtures
 * ======================
 * Known correct outputs for validation
 */

// Expected tool schemas for validation
export const TOOL_SCHEMAS = {
    get_laps: {
        required: ['year', 'gp', 'session'],
        optional: ['driver', 'lap_start', 'lap_end']
    },
    get_telemetry: {
        required: ['year', 'gp', 'session', 'driver'],
        optional: ['lap']
    },
    get_tyres: {
        required: ['year', 'gp', 'session'],
        optional: ['driver']
    },
    get_qualifying: {
        required: ['year', 'gp'],
        optional: []
    },
    get_race: {
        required: ['year', 'gp'],
        optional: []
    },
    get_results: {
        required: ['year', 'gp', 'session'],
        optional: []
    },
    get_fastest_lap: {
        required: ['year', 'gp', 'session'],
        optional: ['driver']
    },
    get_weather: {
        required: ['year', 'gp', 'session'],
        optional: []
    },
    get_events: {
        required: ['year'],
        optional: []
    },
    get_sessions: {
        required: ['year', 'gp'],
        optional: []
    }
}

// Valid values
export const VALID_YEARS = Array.from({ length: 76 }, (_, i) => 1950 + i) // 1950-2025

export const VALID_DRIVER_CODES = [
    'VER', 'HAM', 'LEC', 'SAI', 'NOR', 'PIA', 'RUS', 'PER',
    'ALO', 'STR', 'GAS', 'OCO', 'ALB', 'SAR', 'MAG', 'HUL',
    'ZHO', 'BOT', 'TSU', 'RIC', 'LAW', 'BEA', 'COL', 'DOO'
]

export const VALID_SESSIONS = ['FP1', 'FP2', 'FP3', 'Q', 'SQ', 'S', 'R']

export const VALID_GP_NAMES = [
    'Bahrain', 'Saudi Arabia', 'Australia', 'Japan', 'China',
    'Miami', 'Imola', 'Monaco', 'Canada', 'Spain', 'Austria',
    'Great Britain', 'Hungary', 'Belgium', 'Netherlands', 'Italy',
    'Azerbaijan', 'Singapore', 'United States', 'Mexico', 'Brazil',
    'Las Vegas', 'Qatar', 'Abu Dhabi'
]

// Sample golden data for 2023 Monaco GP
export const MONACO_2023_SAMPLE_LAPS = {
    session_name: '2023 Monaco Grand Prix - Race',
    total_laps: 78,
    sample_lap: {
        driver: 'VER',
        lap_number: 45,
        lap_time: '1:15.650',
        compound: 'HARD',
        sector1: '0:19.234',
        sector2: '0:33.456',
        sector3: '0:22.960'
    }
}

// Expected function call patterns
export interface ExpectedFunctionCall {
    tool: string
    args: Record<string, unknown>
}

export const EXPECTED_CALLS: Record<string, ExpectedFunctionCall[]> = {
    "Show Verstappen's lap times in the 2023 Monaco GP": [
        { tool: 'get_laps', args: { year: 2023, gp: 'Monaco', session: 'R', driver: 'VER' } }
    ],
    "Compare VER and HAM in Monaco 2024 Qualifying": [
        { tool: 'get_laps', args: { year: 2024, gp: 'Monaco', session: 'Q', driver: 'VER' } },
        { tool: 'get_laps', args: { year: 2024, gp: 'Monaco', session: 'Q', driver: 'HAM' } }
    ],
    "Get qualifying results for Silverstone 2024": [
        { tool: 'get_qualifying', args: { year: 2024, gp: 'Silverstone' } }
    ]
}

// Visualization validation rules
export const VISUALIZATION_RULES = {
    lap_times: {
        xAxis: ['lap', 'lap_number', 'Lap'],
        yAxis: ['time', 'lap_time', 'LapTime'],
        chartType: 'line'
    },
    telemetry: {
        xAxis: ['distance', 'Distance'],
        yAxis: ['speed', 'Speed', 'throttle', 'Throttle'],
        chartType: 'line'
    },
    comparison: {
        xAxis: ['driver', 'Driver', 'team', 'Team'],
        yAxis: ['time', 'value', 'count'],
        chartType: 'bar'
    }
}
