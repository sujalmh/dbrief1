/**
 * Simulation Tools
 * ================
 * LangChain StructuredTool wrapper for the Simulation Agent.
 * Enables the planner to invoke simulations for "what-if" queries.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";
import { runSimulation, SimulationOutput } from "@/lib/agents/simulationAgent";

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
    async ({ scenario_id, horizon, metric, iterations, base_value, variance, seed }) => {
        try {
            const result: SimulationOutput = runSimulation({
                scenario_id,
                horizon,
                metric,
                iterations: iterations || 1000,
                parameters: {
                    base_value,
                    variance,
                    seed,
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
Examples:
- "What if the race finished under green flag?" → metric: "gap", base_value: negative (faster driver gains time)
- "What if pit stop was slow?" → metric: "time", base_value: 24, variance: 3
- "What if reliability improved?" → metric: "points", base_value: 15 (average race points)
Returns: Statistical summary with mean, min, max, percentiles.`,
        schema: z.object({
            scenario_id: z.string().describe("Unique identifier describing the scenario (e.g., 'abu-dhabi-21-green-flag')"),
            horizon: z.enum(["lap", "race", "season", "custom"]).describe("Time horizon for simulation"),
            metric: z.enum(["time", "points", "score", "position", "gap"]).describe("Metric to simulate. Use 'gap' for performance deltas, 'time' for lap times, 'points' for scoring"),
            iterations: z.number().int().min(100).max(10000).optional().default(1000).describe("Number of simulation runs (default: 1000)"),
            base_value: z.number().optional().describe("Base/expected value for the metric (e.g., -2.5 for 2.5s faster)"),
            variance: z.number().optional().describe("Standard deviation/variance for randomness"),
            seed: z.number().int().optional().describe("Random seed for reproducibility"),
        }),
    }
);

// =============================================================================
// Exports
// =============================================================================

export const simulationTools: Record<string, StructuredTool> = {
    run_simulation: runSimulationTool,
};

export function getSimulationTools(): Record<string, StructuredTool> {
    return simulationTools;
}
