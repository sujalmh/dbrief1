/**
 * Golden Output Fixtures
 * ======================
 * Known correct outputs for validation
 */

// Expected tool schemas for validation
// Expected tool schemas for validation
export const TOOL_SCHEMAS = {
    get_seasons: {
        required: [],
        optional: []
    },
    get_meetings: {
        required: ['year'],
        optional: ['country_name']
    },
    get_sessions: {
        required: ['year', 'country_name', 'session_name'], // Effectively required for the planner flow
        optional: ['meeting_key']
    },
    get_drivers: {
        required: ['session_key'],
        optional: ['driver_number', 'name_acronym']
    },
    get_laps: {
        required: ['session_key'],
        optional: ['driver_number', 'lap_number']
    },
    get_car_data: {
        required: ['session_key', 'driver_number'],
        optional: ['date_gte', 'date_lte']
    },
    get_location: {
        required: ['session_key', 'driver_number'],
        optional: ['date_gte', 'date_lte']
    },
    get_intervals: {
        required: ['session_key'],
        optional: ['driver_number']
    },
    get_position: {
        required: ['session_key'],
        optional: ['driver_number', 'position_lte']
    },
    get_race_control: {
        required: ['session_key'],
        optional: ['category', 'flag']
    },
    get_weather: {
        required: ['session_key'],
        optional: []
    },
    get_stints: {
        required: ['session_key'],
        optional: ['driver_number', 'compound']
    },
    get_pit_stops: {
        required: ['session_key'],
        optional: ['driver_number']
    },
    get_session_results: {
        required: ['session_key'],
        optional: ['position_lte']
    },
    get_starting_grid: {
        required: ['session_key'],
        optional: ['position_lte']
    },
    get_overtakes: {
        required: ['session_key'],
        optional: ['driver_number']
    },
    get_team_radio: {
        required: ['session_key'],
        optional: ['driver_number']
    },
    // Legacy mapping support or catch-all
    get_tyres: { // Maps to get_stints roughly or removed? Keeping for compatibility if test requests it, but planner shouldn't use it.
        required: ['session_key'],
        optional: ['driver_number']
    },
    // Note: get_qualifying, get_race, get_results, get_fastest_lap, get_events are likely legacy names replaced by above
    get_qualifying: { required: ['session_key'], optional: [] }, // Mapped to session results
    get_race: { required: ['session_key'], optional: [] },       // Mapped to session results
    get_events: { required: ['year'], optional: [] },            // Mapped to meetings
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
        { tool: 'get_sessions', args: { year: 2023, country_name: 'Monaco', session_name: 'Race' } },
        { tool: 'get_laps', args: { session_key: 'SESSION_KEY', driver_number: 1 } }
    ],
    "Compare VER and HAM in Monaco 2024 Qualifying": [
        { tool: 'get_sessions', args: { year: 2024, country_name: 'Monaco', session_name: 'Qualifying' } },
        { tool: 'get_laps', args: { session_key: 'SESSION_KEY', driver_number: 1 } },
        { tool: 'get_laps', args: { session_key: 'SESSION_KEY', driver_number: 44 } }
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
