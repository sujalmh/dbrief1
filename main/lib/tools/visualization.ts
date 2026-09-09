/**
 * Visualization Tool
 * ==================
 * Special tool that signals the frontend to create visualizations
 * from the data collected in previous steps.
 *
 * Note: this is a *marker* tool — the actual chart rendering happens
 * client-side in components/visualization/. The tool validates inputs
 * and returns structured metadata the frontend can act on. It also
 * rejects malformed chart types and data sources so the LLM gets
 * useful error feedback instead of silently echoing invalid input.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";

// Whitelist of chart types and data sources. Keeps the LLM from
// injecting arbitrary values that the frontend would have to defend
// against at render time.
const SUPPORTED_CHART_TYPES = [
    "lap_times",
    "telemetry",
    "comparison",
    "weather",
] as const;

const SUPPORTED_DATA_SOURCES = [
    "get_laps",
    "get_telemetry",
    "get_telemetry_summary",
    "get_results",
    "get_qualifying",
    "get_race",
    "get_driver_standings",
    "get_weather",
] as const;

export const createVisualizationTool = tool(
    async ({ chart_type, data_source }) => {
        // Defensive validation: reject unknown values with a clear
        // error message so the LLM can self-correct.
        if (!SUPPORTED_CHART_TYPES.includes(chart_type as (typeof SUPPORTED_CHART_TYPES)[number])) {
            return JSON.stringify({
                action: "create_visualization",
                success: false,
                error: `Unsupported chart_type '${chart_type}'. Supported: ${SUPPORTED_CHART_TYPES.join(", ")}`,
            });
        }
        if (!SUPPORTED_DATA_SOURCES.includes(data_source as (typeof SUPPORTED_DATA_SOURCES)[number])) {
            return JSON.stringify({
                action: "create_visualization",
                success: false,
                error: `Unsupported data_source '${data_source}'. Supported: ${SUPPORTED_DATA_SOURCES.join(", ")}`,
            });
        }

        // Return validated metadata for the frontend to use.
        return JSON.stringify({
            action: "create_visualization",
            success: true,
            chart_type,
            data_source,
            message: `Visualization requested: ${chart_type} chart from ${data_source} data`,
        });
    },
    {
        name: "create_visualization",
        description:
            "Create a data visualization chart from the data collected in previous steps. Use this as the FINAL step when visualization is requested.",
        schema: z.object({
            chart_type: z
                .enum(SUPPORTED_CHART_TYPES)
                .describe("Type of chart to create (one of: lap_times, telemetry, comparison, weather)"),
            data_source: z
                .enum(SUPPORTED_DATA_SOURCES)
                .describe(
                    "Which previous step's data to visualize (e.g., 'get_laps', 'get_telemetry')"
                ),
        }),
    }
);

/**
 * Get visualization tools as an array
 */
export function getVisualizationTools(): StructuredTool[] {
    return [createVisualizationTool];
}
