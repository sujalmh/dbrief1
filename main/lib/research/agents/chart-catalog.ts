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

export type ChartTypeId =
    | "line"
    | "bar"
    | "scatter"
    | "heatmap"
    | "histogram"
    | "horizontal_bar"
    | "area"
    | "stacked_bar"
    | "dumbbell"
    | "box_plot"
    | "telemetry_multi"
    | "kpi";

/**
 * Render contract — what data shape each chart expects.
 * The renderer uses this to dispatch and to fail fast on bad input.
 */
export interface ChartContract {
    /** Minimum number of distinct categories required */
    minCategories: number;
    /** Whether the chart can plot a single series */
    singleSeries: boolean;
    /** Whether the chart supports multiple overlapping series */
    multiSeries: boolean;
    /** The default Y-axis unit displayed next to tick values */
    defaultUnit: string;
}

export const CHART_CONTRACT: Record<ChartTypeId, ChartContract> = {
    line: { minCategories: 2, singleSeries: true, multiSeries: true, defaultUnit: "" },
    bar: { minCategories: 1, singleSeries: true, multiSeries: false, defaultUnit: "" },
    horizontal_bar: { minCategories: 1, singleSeries: true, multiSeries: true, defaultUnit: "" },
    area: { minCategories: 2, singleSeries: true, multiSeries: true, defaultUnit: "" },
    stacked_bar: { minCategories: 1, singleSeries: false, multiSeries: true, defaultUnit: "" },
    scatter: { minCategories: 2, singleSeries: false, multiSeries: true, defaultUnit: "" },
    heatmap: { minCategories: 2, singleSeries: false, multiSeries: false, defaultUnit: "" },
    histogram: { minCategories: 1, singleSeries: true, multiSeries: false, defaultUnit: "" },
    dumbbell: { minCategories: 2, singleSeries: true, multiSeries: false, defaultUnit: "" },
    box_plot: { minCategories: 1, singleSeries: false, multiSeries: true, defaultUnit: "" },
    telemetry_multi: { minCategories: 2, singleSeries: true, multiSeries: true, defaultUnit: "" },
    kpi: { minCategories: 1, singleSeries: true, multiSeries: false, defaultUnit: "" },
};
