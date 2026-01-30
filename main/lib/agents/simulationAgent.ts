/**
 * Simulation Agent
 * ================
 * A lightweight simulation agent for counterfactual and predictive simulation.
 * Generates synthetic outcomes using simple probabilistic logic and returns
 * results in a structured form for visualization and planner consumption.
 *
 * Design Intent:
 * - Provide numerical grounding for predictions
 * - Enable what-if analysis at any scale (lap, race, season)
 * - Act as a black-box numerical engine controlled by the planner
 *
 * Constraints:
 * - No real-world calibration required
 * - No external APIs or databases
 * - Stateless execution (no persistence)
 * - Deterministic structure, probabilistic values
 */

import { z } from "zod";

// =============================================================================
// Input Schema
// =============================================================================

/**
 * Schema for simulation request parameters
 */
export const SimulationParametersSchema = z.object({
    base_value: z.number().optional().describe("Base value for simulation"),
    variance: z.number().min(0).optional().describe("Variance factor for randomness"),
    seed: z.number().int().optional().describe("Random seed for reproducibility"),
});

export type SimulationParameters = z.infer<typeof SimulationParametersSchema>;

/**
 * Schema for the complete simulation request
 */
export const SimulationRequestSchema = z.object({
    scenario_id: z.string().min(1, "Scenario ID is required"),
    horizon: z.enum(["lap", "race", "season", "custom"]).describe("Simulation time horizon"),
    metric: z.enum(["time", "points", "score", "position", "gap"]).describe("Metric to simulate"),
    iterations: z.number().int().min(1).max(10000).describe("Number of simulation runs"),
    parameters: SimulationParametersSchema.optional(),
});

export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;

// =============================================================================
// Output Schemas
// =============================================================================

/**
 * Statistics computed from simulation results
 */
export const StatisticsSchema = z.object({
    mean: z.number(),
    min: z.number(),
    max: z.number(),
    variance: z.number(),
    std_dev: z.number(),
    percentiles: z.object({
        p5: z.number(),
        p25: z.number(),
        p50: z.number(),
        p75: z.number(),
        p95: z.number(),
    }),
});

export type Statistics = z.infer<typeof StatisticsSchema>;

/**
 * Schema for raw simulation results
 */
export const SimulationResultsSchema = z.object({
    scenario_id: z.string(),
    raw_values: z.array(z.number()),
    statistics: StatisticsSchema,
});

export type SimulationResults = z.infer<typeof SimulationResultsSchema>;

/**
 * Histogram bucket for visualization
 */
export const HistogramBucketSchema = z.object({
    range: z.string(),
    count: z.number().int().min(0),
});

/**
 * Schema for visualization payload
 */
export const VisualizationPayloadSchema = z.object({
    type: z.enum(["histogram", "line", "scatter"]),
    data: z.union([
        z.object({
            x: z.array(z.number()),
            y: z.array(z.number()),
        }),
        z.object({
            buckets: z.array(HistogramBucketSchema),
        }),
    ]),
});

export type VisualizationPayload = z.infer<typeof VisualizationPayloadSchema>;

/**
 * Schema for planner summary
 */
export const PlannerSummarySchema = z.object({
    scenario_id: z.string(),
    description: z.string(),
    key_metrics: z.record(z.string(), z.number()),
});

export type PlannerSummary = z.infer<typeof PlannerSummarySchema>;

/**
 * Combined output from runSimulation
 */
export const SimulationOutputSchema = z.object({
    results: SimulationResultsSchema,
    visualization: VisualizationPayloadSchema,
    summary: PlannerSummarySchema,
});

export type SimulationOutput = z.infer<typeof SimulationOutputSchema>;

// =============================================================================
// Seeded Random Number Generator
// =============================================================================

/**
 * Simple seeded PRNG using mulberry32 algorithm
 * Provides reproducible random numbers when a seed is provided
 */
function createSeededRandom(seed: number): () => number {
    let state = seed;
    return function () {
        state = (state + 0x6d2b79f5) | 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// =============================================================================
// Metric Configuration
// =============================================================================

/**
 * Default value ranges for each metric type
 * These provide sensible defaults without requiring domain-specific calibration
 */
const METRIC_DEFAULTS: Record<string, { base: number; variance: number }> = {
    time: { base: 90, variance: 15 },       // Lap time in seconds (~75-105s)
    points: { base: 12, variance: 8 },      // Points per race (0-25 scale)
    score: { base: 50, variance: 25 },      // Generic score (0-100 scale)
    position: { base: 10, variance: 5 },    // Grid/finish position (1-20)
    gap: { base: 0, variance: 30 },         // Time gap in seconds (-30 to +30)
};

// =============================================================================
// Core Simulation Functions
// =============================================================================

/**
 * Generate a single random value based on metric type
 *
 * @param metric - The type of metric to simulate
 * @param params - Optional parameters for customization
 * @param random - Random number generator function
 * @returns A random value appropriate for the metric
 */
export function generateRandomValue(
    metric: string,
    params: SimulationParameters | undefined,
    random: () => number
): number {
    const defaults = METRIC_DEFAULTS[metric] || { base: 50, variance: 25 };
    const base = params?.base_value ?? defaults.base;
    const variance = params?.variance ?? defaults.variance;

    // Generate value using normal distribution approximation (Box-Muller)
    const u1 = random();
    const u2 = random();
    const normalRandom = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    let value = base + normalRandom * variance;

    // Apply metric-specific constraints
    switch (metric) {
        case "time":
            // Lap times must be positive
            value = Math.max(1, value);
            break;
        case "points":
            // Points must be 0-25 (F1 scoring range)
            value = Math.max(0, Math.min(25, Math.round(value)));
            break;
        case "score":
            // Score must be 0-100
            value = Math.max(0, Math.min(100, value));
            break;
        case "position":
            // Position must be 1-20 integer
            value = Math.max(1, Math.min(20, Math.round(value)));
            break;
        case "gap":
            // Gap can be negative (ahead) or positive (behind)
            break;
    }

    return value;
}

/**
 * Run the simulation loop for N iterations
 *
 * @param request - The simulation request
 * @returns Array of simulated values
 */
export function runSimulationLoop(request: SimulationRequest): number[] {
    const random = request.parameters?.seed !== undefined
        ? createSeededRandom(request.parameters.seed)
        : Math.random;

    const values: number[] = [];

    for (let i = 0; i < request.iterations; i++) {
        const value = generateRandomValue(request.metric, request.parameters, random);
        values.push(value);
    }

    return values;
}

/**
 * Compute statistics from an array of values
 *
 * @param values - Array of simulation results
 * @returns Computed statistics object
 */
export function computeStatistics(values: number[]): Statistics {
    if (values.length === 0) {
        return {
            mean: 0,
            min: 0,
            max: 0,
            variance: 0,
            std_dev: 0,
            percentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
        };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = values.length;

    // Mean
    const sum = values.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;

    // Min/Max
    const min = sorted[0];
    const max = sorted[n - 1];

    // Variance and Standard Deviation
    const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((acc, v) => acc + v, 0) / n;
    const std_dev = Math.sqrt(variance);

    // Percentiles using linear interpolation
    const percentile = (p: number): number => {
        const index = (p / 100) * (n - 1);
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        if (lower === upper) return sorted[lower];
        const fraction = index - lower;
        return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
    };

    return {
        mean,
        min,
        max,
        variance,
        std_dev,
        percentiles: {
            p5: percentile(5),
            p25: percentile(25),
            p50: percentile(50),
            p75: percentile(75),
            p95: percentile(95),
        },
    };
}

/**
 * Build histogram buckets from values
 *
 * @param values - Array of values to bucket
 * @param bucketCount - Number of buckets (default 10)
 * @returns Array of histogram buckets
 */
function buildHistogramBuckets(
    values: number[],
    bucketCount: number = 10
): { range: string; count: number }[] {
    if (values.length === 0) return [];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const bucketSize = range / bucketCount || 1;

    const buckets: { range: string; count: number }[] = [];
    for (let i = 0; i < bucketCount; i++) {
        const bucketMin = min + i * bucketSize;
        const bucketMax = min + (i + 1) * bucketSize;
        const count = values.filter(
            (v) => v >= bucketMin && (i === bucketCount - 1 ? v <= bucketMax : v < bucketMax)
        ).length;
        buckets.push({
            range: `${bucketMin.toFixed(2)}-${bucketMax.toFixed(2)}`,
            count,
        });
    }

    return buckets;
}

/**
 * Build visualization payload from simulation values
 *
 * @param values - Array of simulated values
 * @param type - Type of visualization
 * @returns Visualization payload object
 */
export function buildVisualizationPayload(
    values: number[],
    type: "histogram" | "line" | "scatter" = "histogram"
): VisualizationPayload {
    if (type === "histogram") {
        return {
            type: "histogram",
            data: {
                buckets: buildHistogramBuckets(values),
            },
        };
    }

    // For line and scatter, use run index as x-axis
    return {
        type,
        data: {
            x: values.map((_, i) => i + 1),
            y: values,
        },
    };
}

/**
 * Build a neutral summary for planner consumption
 *
 * @param request - Original simulation request
 * @param stats - Computed statistics
 * @returns Planner summary object
 */
export function buildPlannerSummary(
    request: SimulationRequest,
    stats: Statistics
): PlannerSummary {
    const horizonLabel = request.horizon === "custom" ? "custom horizon" : `${request.horizon}-level`;
    const metricLabel = request.metric;

    const description =
        `Simulated ${request.iterations} iterations of ${metricLabel} ` +
        `at ${horizonLabel} for scenario "${request.scenario_id}". ` +
        `Results ranged from ${stats.min.toFixed(2)} to ${stats.max.toFixed(2)} ` +
        `with a mean of ${stats.mean.toFixed(2)} (±${stats.std_dev.toFixed(2)} std dev).`;

    return {
        scenario_id: request.scenario_id,
        description,
        key_metrics: {
            mean: Number(stats.mean.toFixed(4)),
            min: Number(stats.min.toFixed(4)),
            max: Number(stats.max.toFixed(4)),
            std_dev: Number(stats.std_dev.toFixed(4)),
            p50_median: Number(stats.percentiles.p50.toFixed(4)),
            p95: Number(stats.percentiles.p95.toFixed(4)),
        },
    };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main simulation function - entry point for the planner
 *
 * Orchestrates:
 * 1. Input validation
 * 2. Simulation loop execution
 * 3. Statistics computation
 * 4. Visualization payload generation
 * 5. Planner summary creation
 *
 * @param request - Simulation request object
 * @returns Complete simulation output with results, visualization, and summary
 * @throws Error if input validation fails
 */
export function runSimulation(request: SimulationRequest): SimulationOutput {
    // Validate input
    const parsed = SimulationRequestSchema.safeParse(request);
    if (!parsed.success) {
        throw new Error(`Invalid simulation request: ${parsed.error.message}`);
    }

    const validRequest = parsed.data;

    // Run simulation loop
    const rawValues = runSimulationLoop(validRequest);

    // Compute statistics
    const statistics = computeStatistics(rawValues);

    // Build outputs
    const results: SimulationResults = {
        scenario_id: validRequest.scenario_id,
        raw_values: rawValues,
        statistics,
    };

    const visualization = buildVisualizationPayload(rawValues, "histogram");
    const summary = buildPlannerSummary(validRequest, statistics);

    return {
        results,
        visualization,
        summary,
    };
}
