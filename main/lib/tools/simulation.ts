/**
 * Simulation Tools
 * ================
 * LangChain StructuredTool wrapper for the Simulation Agent.
 * Enables the planner to invoke simulations for "what-if" queries.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";
import { runSimulation, SimulationOutput } from "@/lib/agents/simulationAgent";
import { simulationConfig } from "@/lib/config";

// =============================================================================
// Simulation Tool
// =============================================================================

/**
 * Tool for running counterfactual and predictive simulations.
 * Used for "what-if" analysis such as:
 * - "What if Abu Dhabi 2021 didn't end under safety car?"
 * - "What if Spa Q3 was wet?"
 * - "How would reliability improvement affect season points?"
 */
export const runSimulationTool = tool(
    async ({ scenario_id, horizon, metric, iterations, base_value, variance, seed, reference_data, reference_field }) => {
        try {
            // If reference data is provided, derive base_value and variance from it.
            // This lets the planner chain historical observations (e.g., lap times
            // fetched via get_laps) into the simulation instead of guessing.
            let effectiveBase = base_value;
            let effectiveVariance = variance;
            const effectiveSeed = seed;

            if (reference_data != null) {
                const derived = deriveBaseAndVariance(reference_data, reference_field);
                if (derived != null) {
                    // Explicitly provided values take precedence; otherwise use derived.
                    if (effectiveBase === undefined) effectiveBase = derived.base;
                    if (effectiveVariance === undefined) effectiveVariance = derived.variance;
                }
            }

            const result: SimulationOutput = runSimulation({
                scenario_id,
                horizon,
                metric,
                iterations: iterations || simulationConfig.iterationsDefault(),
                parameters: {
                    base_value: effectiveBase,
                    variance: effectiveVariance,
                    seed: effectiveSeed,
                },
            });

            // Return FULL output for frontend visualization
            // The executor will pass result.data to the visualization handler
            // The LLM will receive the aggregated context (summary only)
            return JSON.stringify({
                scenario_id: result.summary.scenario_id,
                summary: result.summary.description,
                key_metrics: result.summary.key_metrics,

                // Include full visualization data for frontend
                visualization: result.visualization,

                // Include statistical data for charts
                statistics: result.results.statistics,
                raw_values: result.results.raw_values,

                // Echo the effective parameters so the synthesizer can explain
                // what the simulation was grounded on.
                parameters_used: {
                    base_value: effectiveBase,
                    variance: effectiveVariance,
                    derived_from_reference_data: reference_data != null,
                    reference_field: reference_field ?? null,
                },
            });
        } catch (error) {
            return JSON.stringify({
                error: error instanceof Error ? error.message : "Simulation failed",
            });
        }
    },
    {
        name: "run_simulation",
        description: `Run a counterfactual or predictive simulation. Use for "what-if" scenarios, hypothetical analysis, and outcome projections.
IMPORTANT: To ground simulations in REAL data, first fetch historical data (get_laps, get_race, get_results, etc.) and pass it via the 'reference_data' field with 'reference_field' naming the numeric field to derive base/variance from (e.g., "LapTime", "points", "gap"). This is strongly preferred over guessing base_value/variance.
Examples:
- "What if the race finished under green flag?" → fetch laps before SC, pass them as reference_data with reference_field="gap"
- "What if pit stop was slow?" → metric: "time", base_value: 24, variance: 3
- "What if reliability improved?" → metric: "points", fetch prior race results as reference_data
Returns: Statistical summary with mean, min, max, percentiles.`,
        schema: z.object({
            scenario_id: z.string().describe("Unique identifier describing the scenario (e.g., 'abu-dhabi-21-green-flag')"),
            horizon: z.enum(simulationConfig.horizons() as [string, ...string[]]).describe("Time horizon for simulation"),
            metric: z.enum(simulationConfig.metrics() as [string, ...string[]]).describe("Metric to simulate. Use 'gap' for performance deltas, 'time' for lap times, 'points' for scoring"),
            iterations: z.number().int().min(simulationConfig.iterationsMin()).max(simulationConfig.iterationsMax()).optional().default(simulationConfig.iterationsDefault()).describe(`Number of simulation runs (default: ${simulationConfig.iterationsDefault()})`),
            base_value: z.number().optional().describe("Base/expected value for the metric (e.g., -2.5 for 2.5s faster). If omitted and reference_data is provided, derived automatically."),
            variance: z.number().optional().describe("Standard deviation/variance for randomness. If omitted and reference_data is provided, derived automatically."),
            seed: z.number().int().optional().describe("Random seed for reproducibility"),
            reference_data: z.union([
                z.array(z.number()),
                z.record(z.string(), z.unknown()),
                z.string(),
            ]).optional().describe("Historical observations to ground the simulation. Can be an array of numbers, a tool result object (the planner will look for common array fields), or a JSON string. Use {{task_id.field}} template syntax to reference prior task outputs."),
            reference_field: z.string().optional().describe("Name of the numeric field inside reference_data to derive base/variance from (e.g., 'LapTime', 'points', 'gap'). Required when reference_data is an array of objects or a tool result object."),
        }),
    }
);

// =============================================================================
// Helpers for deriving simulation parameters from reference data
// =============================================================================

/**
 * Derive a base value (mean) and variance (std dev) from reference data.
 *
 * Accepts:
 *   - number[]                          → compute mean/std directly
 *   - { results: [{ field: number }] }  → extract field from each item
 *   - { laps: [{ field: number }] }      → extract field from each item
 *   - JSON string of any of the above
 *   - string[] of numeric strings        → parse then compute
 *
 * Returns null if no numeric values could be extracted.
 */
function deriveBaseAndVariance(
    referenceData: unknown,
    referenceField?: string
): { base: number; variance: number } | null {
    let parsed: unknown = referenceData;

    // Parse JSON strings
    if (typeof parsed === "string") {
        const trimmed = parsed.trim();
        // Try JSON first
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            // Maybe a comma/space separated list of numbers
            const nums = trimmed
                .split(/[\s,]+/)
                .map((s) => Number(s))
                .filter((n) => Number.isFinite(n));
            if (nums.length > 0) {
                return computeMeanStd(nums);
            }
            return null;
        }
    }

    // Array of numbers → direct
    if (Array.isArray(parsed)) {
        const nums = extractNumbersFromArray(parsed, referenceField);
        if (nums.length > 0) return computeMeanStd(nums);
        return null;
    }

    // Object → look for configured array fields (results, laps, tyres, ...)
    if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>;
        // If the object itself has raw_values (simulation output), use those
        if (Array.isArray(obj.raw_values) && obj.raw_values.length > 0) {
            const nums = extractNumbersFromArray(obj.raw_values, referenceField);
            if (nums.length > 0) return computeMeanStd(nums);
        }
        for (const field of simulationConfig.referenceArrayFields()) {
            const val = obj[field];
            if (Array.isArray(val) && val.length > 0) {
                const nums = extractNumbersFromArray(val, referenceField);
                if (nums.length > 0) return computeMeanStd(nums);
            }
        }
        // Maybe the object is a single record with the field directly
        if (referenceField && typeof obj[referenceField] === "number") {
            return { base: obj[referenceField] as number, variance: 0 };
        }
    }

    return null;
}

/**
 * Extract an array of numbers from a mixed array.
 * - number[] → as-is
 * - object[] → extract the named field (or a heuristic best numeric field)
 * - string[] → parse
 */
function extractNumbersFromArray(arr: unknown[], field?: string): number[] {
    if (arr.length === 0) return [];

    // Already numbers
    if (typeof arr[0] === "number") {
        return arr as number[];
    }

    // Strings that look like numbers
    if (typeof arr[0] === "string") {
        const nums = arr
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n));
        if (nums.length > 0) return nums;
        return [];
    }

    // Array of objects — extract the named field or a heuristic numeric field
    if (typeof arr[0] === "object" && arr[0] !== null) {
        const objs = arr as Record<string, unknown>[];

        // If a field is specified, use it
        if (field) {
            const nums = objs
                .map((o) => o[field])
                .filter((v) => v !== undefined && v !== null)
                .map((v) => {
                    if (typeof v === "number") return v;
                    if (typeof v === "string") {
                        // Handle "1:23.456" lap time format → seconds
                        const lapMatch = v.match(/^(\d+):(\d{2})\.(\d{3})$/);
                        if (lapMatch) {
                            return parseInt(lapMatch[1], 10) * 60 + parseInt(lapMatch[2], 10) + parseInt(lapMatch[3], 10) / 1000;
                        }
                        return Number(v);
                    }
                    return NaN;
                })
                .filter((n) => Number.isFinite(n));
            if (nums.length > 0) return nums;
        }

        // Heuristic: find the first field that yields numbers across items
        const firstObj = objs[0];
        for (const key of Object.keys(firstObj)) {
            const nums = objs
                .map((o) => o[key])
                .filter((v) => typeof v === "number")
                .map((v) => v as number);
            if (nums.length === objs.length && nums.length > 0) {
                return nums;
            }
        }
    }

    return [];
}

/**
 * Compute mean and standard deviation from an array of numbers.
 * Returns variance = std_dev (so it can be plugged directly into the simulation).
 */
function computeMeanStd(nums: number[]): { base: number; variance: number } {
    const n = nums.length;
    const mean = nums.reduce((a, b) => a + b, 0) / n;
    const squaredDiffs = nums.map((v) => Math.pow(v - mean, 2));
    const variance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / n);
    return { base: mean, variance };
}

// =============================================================================
// Exports
// =============================================================================

export const simulationTools: Record<string, StructuredTool> = {
    run_simulation: runSimulationTool,
};

export function getSimulationTools(): Record<string, StructuredTool> {
    return simulationTools;
}
