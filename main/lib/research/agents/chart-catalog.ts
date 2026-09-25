/**
 * Chart Catalog
 * =============
 *
 * Single source of truth for the chart types we render. The LLM-facing
 * schema for `ChartSpec.type` is derived from this set so the planner and
 * the renderer can never disagree about what is supported.
 */

export const CHART_TYPES = new Set<string>([
    // Pre-existing types
    "line",
    "bar",
    "scatter",
    "heatmap",
    "histogram",
    // New intelligent types
    "horizontal_bar",
    "area",
    "stacked_bar",
    "dumbbell",
    "box_plot",
    "telemetry_multi",
    "kpi",
]);


