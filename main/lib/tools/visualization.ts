/**
 * Visualization Tool
 * ==================
 * Special tool that signals the frontend to create visualizations
 * from the data collected in previous steps.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";

/**
 * Create visualization tool
 * This tool doesn't actually execute anything - it's a marker for the frontend
 */
export const createVisualizationTool = tool(
    async ({ chart_type, data_source }) => {
        // Return metadata for the frontend to use
        return {
            action: "create_visualization",
            chart_type,
            data_source,
            message: `Visualization requested: ${chart_type} chart from ${data_source} data`
        };
    },
    {
        name: "create_visualization",
        description: "Create a data visualization chart from the data collected in previous steps. Use this as the FINAL step when visualization is requested.",
        schema: z.object({
            chart_type: z.enum(["lap_times", "telemetry", "comparison", "weather"]).describe("Type of chart to create"),
            data_source: z.string().describe("Which previous step's data to visualize (e.g., 'get_laps', 'get_telemetry')")
        }),
    }
);

/**
 * Visualization tools as a record
 */
export const visualizationTools: Record<string, StructuredTool> = {
    create_visualization: createVisualizationTool,
};
