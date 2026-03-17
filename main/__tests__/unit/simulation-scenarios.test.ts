/**
 * Simulation Agent Scenario Tests
 * ===============================
 * Demonstrating diverse "what-if" scenarios using the Simulation Agent.
 */

import { describe, it, expect } from "vitest";
import { runSimulation } from "@/lib/agents/simulationAgent";

describe("Real-World Simulation Scenarios", () => {

    // Scenario 1: Abu Dhabi 2021 "What If"
    // What if the race finished without the late safety car?
    // Hamilton was AHEAD by ~15 seconds. Without SC, he maintains the gap and wins.
    // We simulate the final gap (positive = HAM ahead of VER).
    it("Scenario: Abu Dhabi 21 - No Safety Car (Hamilton Maintains Lead)", () => {
        const result = runSimulation({
            scenario_id: "abu-dhabi-21-no-sc",
            horizon: "race",
            metric: "gap",
            iterations: 1000,
            parameters: {
                base_value: 12.0,  // Hamilton ~12s ahead at finish without SC
                variance: 3.0,     // Some variance from traffic/tire deg
                seed: 2021
            }
        });

        const summary = result.summary;
        const stats = result.results.statistics;

        console.log("\nSimulation: Abu Dhabi 21 - No Safety Car");
        console.log(summary.description);

        // Assertions: Hamilton finishes ahead (positive gap)
        expect(stats.mean).toBeCloseTo(12.0, 0);  // Mean ~12s gap
        expect(stats.min).toBeGreaterThan(0);      // Even worst case, HAM still ahead
        expect(stats.percentiles.p5).toBeGreaterThan(5); // 95% of simulations: >5s lead
    });

    // Scenario 2: Mixed Conditions Qualifying
    // What if Q3 at Spa is wet? 
    // High variance in lap times compared to dry running.
    it("Scenario: Spa Q3 - Wet Conditions (Lap Time)", () => {
        const result = runSimulation({
            scenario_id: "spa-q3-wet",
            horizon: "lap",
            metric: "time",
            iterations: 1000,
            parameters: {
                base_value: 120.0, // 2:00.000 wet lap
                variance: 15.0,    // Massive 15s variance due to grip levels/traffic
                seed: 44
            }
        });

        const summary = result.summary;
        const stats = result.results.statistics;

        console.log("\nSimulation: Spa Q3 Wet (Lap Times)");
        console.log(summary.description);

        // In wet, we expect a huge spread
        const spread = stats.max - stats.min;
        expect(spread).toBeGreaterThan(60); // >1 minute spread possible with spins/mistakes? 
        // With normal distribution ±3-4 sigma, 15*8 = 120s range possible but unlikely.
        // Let's check std dev
        expect(stats.std_dev).toBeCloseTo(15, 0);
    });

    // Scenario 3: Reliability "What If"
    // What if a team's reliability improved?
    // Simulating "Average Points per Race" (0-25 scale).
    it("Scenario: Improved Average Race Points", () => {
        const result = runSimulation({
            scenario_id: "race-reliability-plus",
            horizon: "season",
            metric: "points",
            iterations: 1000,
            parameters: {
                base_value: 15,    // Average 3rd/4th place (15 pts)
                variance: 5,       // Performance variance
                seed: 16
            }
        });

        const summary = result.summary;
        const stats = result.results.statistics;

        console.log("\nSimulation: Improved Average Race Points");
        console.log(summary.description);

        expect(stats.percentiles.p50).toBeCloseTo(15, -1);
        expect(stats.max).toBeLessThanOrEqual(25); // Cannot exceed win points
    });

    // Scenario 4: Strategy Call - Pit Stop Delta
    // Simulating the "Pit Loss Time" distribution.
    // What if we have a slow stop?
    it("Scenario: Pit Stop Consistency Analysis", () => {
        const result = runSimulation({
            scenario_id: "pit-loss-distribution",
            horizon: "custom", // Single event
            metric: "time",
            iterations: 2000,
            parameters: {
                base_value: 24.5, // Avg pit loss
                variance: 1.5,    // Variance (includes entry/exit/stop)
                seed: 1
            }
        });

        console.log("\nSimulation: Pit Loss Time Distribution");
        console.log(result.summary.description);

        // Check the "Slow Stop" tail (95th percentile)
        console.log(`P95 (Slow Stop Risk): ${result.results.statistics.percentiles.p95.toFixed(2)}s`);
        expect(result.results.statistics.percentiles.p95).toBeGreaterThan(26.0);
    });
});
