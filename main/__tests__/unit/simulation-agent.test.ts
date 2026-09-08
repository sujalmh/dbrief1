/**
 * Simulation Agent Unit Tests
 * ===========================
 * Tests for the simulation agent module
 */

import { describe, it, expect } from "vitest";
import {
    SimulationRequestSchema,
    SimulationResultsSchema,
    VisualizationPayloadSchema,
    PlannerSummarySchema,
    SimulationOutputSchema,
    generateRandomValue,
    runSimulationLoop,
    computeStatistics,
    buildVisualizationPayload,
    buildPlannerSummary,
    runSimulation,
} from "@/lib/agents/simulationAgent";

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("Schema Validation", () => {
    describe("SimulationRequestSchema", () => {
        it("should accept valid simulation request", () => {
            const input = {
                scenario_id: "test-scenario-001",
                horizon: "race",
                metric: "time",
                iterations: 1000,
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(true);
        });

        it("should accept request with parameters", () => {
            const input = {
                scenario_id: "test-scenario-002",
                horizon: "lap",
                metric: "points",
                iterations: 500,
                parameters: {
                    base_value: 10,
                    variance: 5,
                    seed: 42,
                },
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(true);
        });

        it("should reject empty scenario_id", () => {
            const input = {
                scenario_id: "",
                horizon: "race",
                metric: "time",
                iterations: 100,
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject invalid horizon", () => {
            const input = {
                scenario_id: "test",
                horizon: "invalid",
                metric: "time",
                iterations: 100,
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject invalid metric", () => {
            const input = {
                scenario_id: "test",
                horizon: "race",
                metric: "invalid-metric",
                iterations: 100,
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject zero iterations", () => {
            const input = {
                scenario_id: "test",
                horizon: "race",
                metric: "time",
                iterations: 0,
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject negative iterations", () => {
            const input = {
                scenario_id: "test",
                horizon: "race",
                metric: "time",
                iterations: -100,
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject iterations > 10000", () => {
            const input = {
                scenario_id: "test",
                horizon: "race",
                metric: "time",
                iterations: 10001,
            };

            const result = SimulationRequestSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should accept all valid horizons", () => {
            const horizons = ["lap", "race", "season", "custom"];

            horizons.forEach((horizon) => {
                const input = {
                    scenario_id: "test",
                    horizon,
                    metric: "time",
                    iterations: 100,
                };
                const result = SimulationRequestSchema.safeParse(input);
                expect(result.success).toBe(true);
            });
        });

        it("should accept all valid metrics", () => {
            const metrics = ["time", "points", "score", "position", "gap"];

            metrics.forEach((metric) => {
                const input = {
                    scenario_id: "test",
                    horizon: "race",
                    metric,
                    iterations: 100,
                };
                const result = SimulationRequestSchema.safeParse(input);
                expect(result.success).toBe(true);
            });
        });
    });

    describe("Output Schemas", () => {
        it("should validate SimulationResultsSchema", () => {
            const output = {
                scenario_id: "test",
                raw_values: [1.5, 2.5, 3.5],
                statistics: {
                    mean: 2.5,
                    min: 1.5,
                    max: 3.5,
                    variance: 0.67,
                    std_dev: 0.82,
                    percentiles: { p5: 1.5, p25: 2.0, p50: 2.5, p75: 3.0, p95: 3.5 },
                },
            };

            const result = SimulationResultsSchema.safeParse(output);
            expect(result.success).toBe(true);
        });

        it("should validate VisualizationPayloadSchema with histogram", () => {
            const output = {
                type: "histogram",
                data: {
                    buckets: [
                        { range: "0-10", count: 5 },
                        { range: "10-20", count: 10 },
                    ],
                },
            };

            const result = VisualizationPayloadSchema.safeParse(output);
            expect(result.success).toBe(true);
        });

        it("should validate VisualizationPayloadSchema with line/scatter", () => {
            const output = {
                type: "line",
                data: {
                    x: [1, 2, 3],
                    y: [10, 20, 30],
                },
            };

            const result = VisualizationPayloadSchema.safeParse(output);
            expect(result.success).toBe(true);
        });

        it("should validate PlannerSummarySchema", () => {
            const output = {
                scenario_id: "test",
                description: "Test simulation completed.",
                key_metrics: { mean: 50.5, min: 10.0, max: 90.0 },
            };

            const result = PlannerSummarySchema.safeParse(output);
            expect(result.success).toBe(true);
        });
    });
});

// =============================================================================
// Simulation Loop Tests
// =============================================================================

describe("Simulation Loop", () => {
    it("should return correct number of values", () => {
        const request = {
            scenario_id: "test",
            horizon: "race" as const,
            metric: "time" as const,
            iterations: 100,
        };

        const values = runSimulationLoop(request);
        expect(values).toHaveLength(100);
    });

    it("should produce reproducible results with seed", () => {
        const request = {
            scenario_id: "test",
            horizon: "race" as const,
            metric: "time" as const,
            iterations: 50,
            parameters: { seed: 12345 },
        };

        const values1 = runSimulationLoop(request);
        const values2 = runSimulationLoop(request);

        expect(values1).toEqual(values2);
    });

    it("should produce different results without seed", () => {
        const request = {
            scenario_id: "test",
            horizon: "race" as const,
            metric: "time" as const,
            iterations: 100,
        };

        const values1 = runSimulationLoop(request);
        const values2 = runSimulationLoop(request);

        // With 100 values, it's extremely unlikely to be identical
        expect(values1).not.toEqual(values2);
    });

    it("should handle single iteration", () => {
        const request = {
            scenario_id: "test",
            horizon: "lap" as const,
            metric: "time" as const,
            iterations: 1,
        };

        const values = runSimulationLoop(request);
        expect(values).toHaveLength(1);
        expect(typeof values[0]).toBe("number");
    });

    it("should handle max iterations (10000)", () => {
        const request = {
            scenario_id: "test",
            horizon: "season" as const,
            metric: "points" as const,
            iterations: 10000,
            parameters: { seed: 42 },
        };

        const values = runSimulationLoop(request);
        expect(values).toHaveLength(10000);
    });
});

// =============================================================================
// Metric-Specific Value Tests
// =============================================================================

describe("Metric Value Generation", () => {
    // Deterministic for testing (seeded model below)

    it("should generate positive time values", () => {
        for (let i = 0; i < 100; i++) {
            const value = generateRandomValue("time", undefined, Math.random);
            expect(value).toBeGreaterThan(0);
        }
    });

    it("should generate points in 0-25 range", () => {
        for (let i = 0; i < 100; i++) {
            const value = generateRandomValue("points", undefined, Math.random);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(25);
            expect(Number.isInteger(value)).toBe(true);
        }
    });

    it("should generate score in 0-100 range", () => {
        for (let i = 0; i < 100; i++) {
            const value = generateRandomValue("score", undefined, Math.random);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(100);
        }
    });

    it("should generate position in 1-20 range", () => {
        for (let i = 0; i < 100; i++) {
            const value = generateRandomValue("position", undefined, Math.random);
            expect(value).toBeGreaterThanOrEqual(1);
            expect(value).toBeLessThanOrEqual(20);
            expect(Number.isInteger(value)).toBe(true);
        }
    });

    it("should respect custom base_value and variance", () => {
        const params = { base_value: 100, variance: 5 };
        const values: number[] = [];

        for (let i = 0; i < 1000; i++) {
            values.push(generateRandomValue("score", params, Math.random));
        }

        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        // Mean should be close to base_value
        expect(mean).toBeGreaterThan(90);
        expect(mean).toBeLessThan(110);
    });
});

// =============================================================================
// Statistics Computation Tests
// =============================================================================

describe("computeStatistics", () => {
    it("should correctly compute mean", () => {
        const values = [10, 20, 30, 40, 50];
        const stats = computeStatistics(values);
        expect(stats.mean).toBe(30);
    });

    it("should correctly compute min and max", () => {
        const values = [5, 15, 10, 25, 20];
        const stats = computeStatistics(values);
        expect(stats.min).toBe(5);
        expect(stats.max).toBe(25);
    });

    it("should correctly compute variance and std_dev", () => {
        const values = [2, 4, 6, 8, 10];
        const stats = computeStatistics(values);
        // Mean = 6, variance = ((4+4+0+4+16)/5) = 8, std_dev = sqrt(8) ≈ 2.83
        expect(stats.variance).toBe(8);
        expect(stats.std_dev).toBeCloseTo(2.83, 1);
    });

    it("should correctly compute percentiles", () => {
        const values = Array.from({ length: 100 }, (_, i) => i + 1);
        const stats = computeStatistics(values);

        // For 1-100 range
        expect(stats.percentiles.p5).toBeCloseTo(5.95, 0);
        expect(stats.percentiles.p25).toBeCloseTo(25.75, 0);
        expect(stats.percentiles.p50).toBe(50.5);
        expect(stats.percentiles.p75).toBeCloseTo(75.25, 0);
        expect(stats.percentiles.p95).toBeCloseTo(95.05, 0);
    });

    it("should handle single value", () => {
        const values = [42];
        const stats = computeStatistics(values);

        expect(stats.mean).toBe(42);
        expect(stats.min).toBe(42);
        expect(stats.max).toBe(42);
        expect(stats.variance).toBe(0);
        expect(stats.std_dev).toBe(0);
        expect(stats.percentiles.p50).toBe(42);
    });

    it("should handle empty array", () => {
        const values: number[] = [];
        const stats = computeStatistics(values);

        expect(stats.mean).toBe(0);
        expect(stats.min).toBe(0);
        expect(stats.max).toBe(0);
        expect(stats.variance).toBe(0);
    });
});

// =============================================================================
// Visualization Payload Tests
// =============================================================================

describe("buildVisualizationPayload", () => {
    it("should create histogram with buckets", () => {
        const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const payload = buildVisualizationPayload(values, "histogram");

        expect(payload.type).toBe("histogram");
        expect("buckets" in payload.data).toBe(true);
        if ("buckets" in payload.data) {
            expect(payload.data.buckets.length).toBe(10);
            // Total count should equal number of values
            const totalCount = payload.data.buckets.reduce((sum, b) => sum + b.count, 0);
            expect(totalCount).toBe(10);
        }
    });

    it("should create line data with x/y arrays", () => {
        const values = [10, 20, 30];
        const payload = buildVisualizationPayload(values, "line");

        expect(payload.type).toBe("line");
        expect("x" in payload.data).toBe(true);
        if ("x" in payload.data) {
            expect(payload.data.x).toEqual([1, 2, 3]);
            expect(payload.data.y).toEqual([10, 20, 30]);
        }
    });

    it("should create scatter data with x/y arrays", () => {
        const values = [5, 15, 25];
        const payload = buildVisualizationPayload(values, "scatter");

        expect(payload.type).toBe("scatter");
        expect("x" in payload.data).toBe(true);
        if ("x" in payload.data) {
            expect(payload.data.x).toHaveLength(3);
            expect(payload.data.y).toHaveLength(3);
        }
    });

    it("should handle empty values for histogram", () => {
        const values: number[] = [];
        const payload = buildVisualizationPayload(values, "histogram");

        expect(payload.type).toBe("histogram");
        if ("buckets" in payload.data) {
            expect(payload.data.buckets).toEqual([]);
        }
    });
});

// =============================================================================
// Planner Summary Tests
// =============================================================================

describe("buildPlannerSummary", () => {
    const mockStats = {
        mean: 85.5,
        min: 70.0,
        max: 100.0,
        variance: 25.0,
        std_dev: 5.0,
        percentiles: { p5: 72, p25: 80, p50: 85, p75: 90, p95: 98 },
    };

    it("should include scenario_id in summary", () => {
        const request = {
            scenario_id: "my-scenario",
            horizon: "race" as const,
            metric: "time" as const,
            iterations: 1000,
        };

        const summary = buildPlannerSummary(request, mockStats);
        expect(summary.scenario_id).toBe("my-scenario");
    });

    it("should include description with key information", () => {
        const request = {
            scenario_id: "test",
            horizon: "race" as const,
            metric: "time" as const,
            iterations: 500,
        };

        const summary = buildPlannerSummary(request, mockStats);

        expect(summary.description).toContain("500 iterations");
        expect(summary.description).toContain("time");
        expect(summary.description).toContain("race-level");
        expect(summary.description).toContain("70.00");
        expect(summary.description).toContain("100.00");
        expect(summary.description).toContain("85.50");
    });

    it("should include key metrics", () => {
        const request = {
            scenario_id: "test",
            horizon: "lap" as const,
            metric: "points" as const,
            iterations: 100,
        };

        const summary = buildPlannerSummary(request, mockStats);

        expect(summary.key_metrics).toHaveProperty("mean");
        expect(summary.key_metrics).toHaveProperty("min");
        expect(summary.key_metrics).toHaveProperty("max");
        expect(summary.key_metrics).toHaveProperty("std_dev");
        expect(summary.key_metrics).toHaveProperty("p50_median");
        expect(summary.key_metrics).toHaveProperty("p95");
    });

    it("should handle custom horizon", () => {
        const request = {
            scenario_id: "test",
            horizon: "custom" as const,
            metric: "score" as const,
            iterations: 100,
        };

        const summary = buildPlannerSummary(request, mockStats);
        expect(summary.description).toContain("custom horizon");
    });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("runSimulation (integration)", () => {
    it("should return complete output for valid request", () => {
        const request = {
            scenario_id: "integration-test",
            horizon: "race" as const,
            metric: "time" as const,
            iterations: 100,
        };

        const output = runSimulation(request);

        expect(output).toHaveProperty("results");
        expect(output).toHaveProperty("visualization");
        expect(output).toHaveProperty("summary");
    });

    it("should validate output against all schemas", () => {
        const request = {
            scenario_id: "schema-test",
            horizon: "season" as const,
            metric: "points" as const,
            iterations: 500,
            parameters: { seed: 42 },
        };

        const output = runSimulation(request);

        const validation = SimulationOutputSchema.safeParse(output);
        expect(validation.success).toBe(true);
    });

    it("should throw for invalid input", () => {
        const invalidRequest = {
            scenario_id: "",
            horizon: "race",
            metric: "time",
            iterations: 100,
        };

        expect(() => runSimulation(invalidRequest as unknown as Parameters<typeof runSimulation>[0])).toThrow();
    });

    it("should complete 10000 iterations quickly (<500ms)", () => {
        const request = {
            scenario_id: "performance-test",
            horizon: "season" as const,
            metric: "points" as const,
            iterations: 10000,
            parameters: { seed: 42 },
        };

        const start = performance.now();
        const output = runSimulation(request);
        const duration = performance.now() - start;

        expect(output.results.raw_values).toHaveLength(10000);
        expect(duration).toBeLessThan(500);
    });

    it("should produce consistent results with seed", () => {
        const request = {
            scenario_id: "reproducibility-test",
            horizon: "race" as const,
            metric: "gap" as const,
            iterations: 100,
            parameters: { seed: 99999 },
        };

        const output1 = runSimulation(request);
        const output2 = runSimulation(request);

        expect(output1.results.raw_values).toEqual(output2.results.raw_values);
        expect(output1.results.statistics.mean).toEqual(output2.results.statistics.mean);
    });
});
