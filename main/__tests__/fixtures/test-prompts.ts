/**
 * Comprehensive test prompts covering all 17 OpenF1 API endpoints
 * Organized by category with realistic user queries
 */

export const testPrompts = {
    // Priority tests - most common user queries
    priority: [
        "compare times between lando and oscar in monaco 2024 race",
        "compare times between lando and oscar in abu dhabi 2023 gp",
        "show me verstappen's fastest lap in monaco 2024",
        "what was hamilton's position in the last race of 2024",
        "compare verstappen and hamilton lap times in bahrain 2024",
    ],

    // Session discovery
    sessions: [
        "what sessions were held in monaco 2024",
        "show me all practice sessions from silverstone 2024",
        "when was the qualifying session in spa 2024",
    ],

    // Driver data
    drivers: [
        "who drove for red bull in 2024",
        "show me all drivers in the 2024 season",
        "what number is lando norris",
    ],

    // Lap times and performance
    laps: [
        "show me all laps from verstappen in monaco 2024 race",
        "what was norris's fastest lap in qualifying at silverstone 2024",
        "compare lap times between leclerc and sainz in monza 2024",
    ],

    // Pit stops
    pitstops: [
        "show me all pit stops in monaco 2024 race",
        "how many pit stops did verstappen make in bahrain 2024",
        "what was the fastest pit stop in the 2024 season",
    ],

    // Stints and tire strategy
    stints: [
        "what tire strategy did verstappen use in monaco 2024",
        "show me all stints from the monaco 2024 race",
        "compare tire strategies between mercedes drivers in silverstone 2024",
    ],

    // Telemetry
    carData: [
        "show me verstappen's speed data from monaco 2024 qualifying",
        "what was hamilton's top speed in monza 2024",
    ],

    position: [
        "show me position changes in monaco 2024 race",
        "what position was norris in lap 20 of silverstone 2024",
    ],

    // Race control and events
    raceControl: [
        "were there any safety cars in monaco 2024",
        "show me all race control messages from the last race",
        "what flags were shown in spa 2024",
    ],

    // Team radio
    teamRadio: [
        "show me verstappen's radio messages from monaco 2024",
        "what did hamilton say on the radio in the last race",
    ],

    // Weather
    weather: [
        "what was the weather like in silverstone 2024 race",
        "was it raining in spa 2024 qualifying",
    ],

    // Meetings
    meetings: [
        "show me all race meetings in 2024",
        "when was the monaco grand prix in 2024",
    ],

    // Multi-step complex queries
    complex: [
        "compare verstappen and hamilton's race pace in bahrain 2024, including pit stops and tire strategy",
        "show me the top 3 fastest laps in monaco 2024 qualifying",
        "who had the most pit stops in the 2024 season",
        "compare the tire strategies of the top 3 finishers in monaco 2024",
    ],

    // Edge cases
    edge: [
        "show me data from the 2022 season", // Should fail - pre-2023
        "what happened in the 2025 season", // Should fail - future
        "show me verstappen's data from a race that doesn't exist",
    ],
};

// Flatten all prompts for easy iteration
export const allTestPrompts = Object.values(testPrompts).flat();

// Priority prompts for quick testing
export const priorityPrompts = testPrompts.priority;
