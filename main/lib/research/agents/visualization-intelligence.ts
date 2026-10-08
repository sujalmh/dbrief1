/**
 * Visualization Intelligence
 * =========================
 *
 * The data-analyst layer that sits between raw tool output and chart specs.
 * The pipeline:
 *
 *   Research Question / Tool Results
 *      ↓
 *   1. detectIntents(...)       → what the user is actually asking
 *      ↓
 *   2. aggregate(...)           → roll 200 laps into "average pace, sorted"
 *      ↓
 *   3. selectChartType(...)     → which chart best answers the intent
 *      ↓
 *   4. buildChartSpec(...)      → validate axes, labels, highlight, topN
 *      ↓
 *   5. validateChartSpec(...)   → reject charts that fail the quality gate
 *
 * The frontend consumes the resulting `ChartSpec`s, which carry
 * pre-aggregated data plus intent metadata so the renderer never has to
 * guess what the chart means.
 */

import { z } from "zod";
import type { ChartSpec, Evidence } from "../types";
import { CHART_TYPES } from "./chart-catalog";

// =============================================================================
// Intent taxonomy
// =============================================================================
//
// A research question usually maps to one (or more) of these intents. Each
// intent knows which evidence types it consumes and which chart family fits
// it best. The planner uses these to translate an objective into a chart
// instead of letting the LLM invent random x/y fields.

export const IntentSchema = z.enum([
    "compare_drivers", // "Who was faster: VER or HAM?"
    "compare_teams", // "Mercedes vs Ferrari 2023"
    "rank_metric", // "Most wins, top 5 drivers"
    "championship_progression", // "How did the WDC evolve round by round?"
    "lap_progression", // "Show pace over a stint"
    "tyre_degradation", // "How did the mediums drop off?"
    "strategy_breakdown", // "What compounds were used?"
    "pit_stop_distribution", // "Pit stop time spread"
    "lap_time_distribution", // "Pace consistency"
    "qualifying_pace", // "Compare qualifying pace"
    "qualifying_vs_result", // "Did polesitters win?"
    "telemetry_compare", // "Speed traces of two drivers"
    "telemetry_single", // "Speed/throttle/brake for one lap"
    "telemetry_correlation", // "Tyre age vs lap time"
    "standings_breakdown", // "Points by driver"
    "race_control_timeline", // "Flags / SC during race"
    "weather_conditions", // "Air/track temp evolution"
    "correlation", // "Generic scatter/correlation"
    "summary_kpi", // "Just give me the headline number"
    "show", // Generic fallback
]);
export type VisualizationIntent = z.infer<typeof IntentSchema>;

// =============================================================================
// Intent detection (deterministic + LLM-hinted)
// =============================================================================

/**
 * Cheap, deterministic intent detection from the user's natural language
 * objective. Used as a baseline; the LLM planner can override if needed.
 */
export function detectIntents(objective: string): VisualizationIntent[] {
    const text = objective.toLowerCase();
    const intents: VisualizationIntent[] = [];

    // Order matters — earlier matches win for tie-breaking
    if (/(champion|standings|wdc|wcc|leaderboard|points? (progress|over|round|season))/i.test(text)) {
        intents.push("championship_progression", "standings_breakdown");
    }
    if (/(tyre|tire|compound|deg|strategy|strategy_breakdown|stint|medium|soft|hard)/i.test(text)) {
        intents.push("tyre_degradation", "strategy_breakdown");
    }
    if (/(pit ?stop)/i.test(text)) intents.push("pit_stop_distribution");
    if (/(telemetry|speed trace|throttle|brake|drs|rpm|gear)/i.test(text)) {
        intents.push("telemetry_compare", "telemetry_single");
    }
    if (/(qualifying|qualifying pace|pole ?sitter|pole position|q1|q2|q3)/i.test(text)) {
        intents.push("qualifying_pace", "qualifying_vs_result");
    }
    if (/(consistency|spread|distribution|standard deviation|variance)/i.test(text)) {
        intents.push("lap_time_distribution");
    }
    if (/(grid|start).*(finish|finish position|result)/i.test(text) || /(pole).*(convert|won|win)/i.test(text)) {
        intents.push("qualifying_vs_result");
    }
    if (/(weather|rain|temperature|humidity)/i.test(text)) intents.push("weather_conditions");
    if (/(safety car|virtual|red flag|yellow|flag)/i.test(text)) intents.push("race_control_timeline");
    if (/(compare|versus|vs\.?|against|better than|faster than)/i.test(text)) {
        if (!intents.includes("compare_drivers")) intents.push("compare_drivers");
    }
    if (/(rank|most|top|best|fastest|wins|podiums|poles)/i.test(text)) intents.push("rank_metric");

    if (intents.length === 0) intents.push("show");
    return dedupe(intents);
}

function dedupe<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
}

// =============================================================================
// Aggregation primitives
// =============================================================================
//
// These are the transformations the planner applies to raw tool output before
// it ever touches a chart. Every aggregation returns a stable, named data
// shape (e.g. "Sorted by value desc") so the renderer can rely on ordering.

export type AggregationKind =
    | "none"
    | "average"
    | "median"
    | "min"
    | "max"
    | "sum"
    | "count"
    | "podium_count"
    | "win_count"
    | "pole_count"
    | "dnf_count"
    | "moving_avg"
    | "delta_to_leader"
    | "top_n";

export interface AggregatedRow {
    key: string;            // group label (driver, race, lap, compound, ...)
    value: number;          // metric
    secondary?: number;     // optional secondary metric (dumbbell, scatter)
    label?: string;         // human-readable label (team, compound name, ...)
    extra?: Record<string, number | string>; // pass-through for tooltips
}

/**
 * Apply an aggregation across a numeric column grouped by `groupKey`.
 *
 * The caller is responsible for picking which numeric field to aggregate;
 * we don't try to be too clever here. Returns rows ordered per the
 * aggregation's natural convention (best first for rank-style, ascending
 * for times, etc.).
 */
export function aggregateRows(
    rows: Array<Record<string, unknown>>,
    groupKey: string,
    valueKey: string,
    kind: AggregationKind,
    options: { topN?: number; sort?: "asc" | "desc" } = {}
): AggregatedRow[] {
    if (rows.length === 0) return [];

    const groups = new Map<string, number[]>();
    const labels = new Map<string, string | undefined>();

    for (const row of rows) {
        const key = String(row[groupKey] ?? "Unknown");
        const val = toNumber(row[valueKey]);
        if (val === null) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(val);
        if (!labels.has(key)) {
            const label = row["label"] ?? row["team"] ?? row["TeamName"] ?? row["compound"] ?? row["Compound"];
            if (label != null) labels.set(key, String(label));
        }
    }

    let aggregated: AggregatedRow[] = [];

    for (const [key, values] of groups.entries()) {
        let v = 0;
        switch (kind) {
            case "none": v = values[0] ?? 0; break;
            case "average": v = mean(values); break;
            case "median": v = median(values); break;
            case "min": v = Math.min(...values); break;
            case "max": v = Math.max(...values); break;
            case "sum": v = values.reduce((a, b) => a + b, 0); break;
            case "count": v = values.length; break;
            case "moving_avg": v = mean(values); break; // pre-grouped upstream
            case "delta_to_leader": v = values[0] ?? 0; break; // pre-computed upstream
            case "podium_count":
            case "win_count":
            case "pole_count":
            case "dnf_count":
            case "top_n":
                v = values.length; // count is the most natural aggregation
                break;
        }
        aggregated.push({ key, value: round(v, 3), label: labels.get(key) });
    }

    // Sort convention
    const sortDir = options.sort ?? (isTimeMetric(valueKey) ? "asc" : "desc");
    aggregated.sort((a, b) => (sortDir === "asc" ? a.value - b.value : b.value - a.value));

    // Top-N truncation
    if (typeof options.topN === "number" && options.topN > 0 && aggregated.length > options.topN) {
        const head = aggregated.slice(0, options.topN);
        const tail = aggregated.slice(options.topN);
        const tailValue = tail.reduce((acc, r) => acc + r.value, 0);
        const tailCount = tail.length;
        const tailRow: AggregatedRow = {
            key: "Others",
            value: tail.length > 0 && (kind === "count" || kind === "win_count" || kind === "podium_count" || kind === "pole_count" || kind === "dnf_count")
                ? tailValue
                : round(tailValue / Math.max(1, tailCount), 3),
            label: `${tailCount} other${tailCount === 1 ? "" : "s"}`,
        };
        head.push(tailRow);
        aggregated = head;
    }

    return aggregated;
}

/**
 * Build lap-by-lap data for line/area charts. Optionally applies a moving
 * average smoother to surface the pace trend vs. raw noise.
 */
export function buildLapProgression(
    laps: Array<Record<string, unknown>>,
    driverKey = "driver",
    lapKey = "lap",
    timeKey = "time",
    smoothing = 0
): Array<{ x: number; [k: string]: number | string }> {
    const drivers = new Set<string>();
    for (const lap of laps) drivers.add(String(lap[driverKey] ?? "?"));
    const sorted = [...drivers];
    sorted.sort();

    const maxLap = Math.max(...laps.map((l) => toNumber(l[lapKey]) ?? 0));
    const series: Record<number, { x: number; [k: string]: number | string }> = {};

    for (let lap = 1; lap <= maxLap; lap++) {
        const point: { x: number; [k: string]: number | string } = { x: lap };
        for (const driver of sorted) {
            const t = laps.find((l) => toNumber(l[lapKey]) === lap && String(l[driverKey]) === driver);
            if (t) {
                const v = toNumber(t[timeKey]);
                if (v != null) point[driver] = round(v, 3);
            }
        }
        series[lap] = point;
    }

    const flat: Array<{ x: number; [k: string]: number | string }> = Object.values(series);
    if (smoothing > 0) return applyMovingAverage(flat, sorted, smoothing);
    return flat;
}

function applyMovingAverage(
    points: Array<{ x: number; [k: string]: number | string }>,
    drivers: string[],
    window: number
): Array<{ x: number; [k: string]: number | string }> {
    return points.map((point, i) => {
        const smoothed: { x: number; [k: string]: number | string } = { x: point.x };
        for (const driver of drivers) {
            const slice = points
                .slice(Math.max(0, i - window), i + window + 1)
                .map((p) => p[driver])
                .filter((v): v is number => typeof v === "number");
            if (slice.length > 0) {
                smoothed[driver] = round(mean(slice), 3);
            }
        }
        return smoothed;
    });
}

/**
 * Build a dumbbell dataset: a left value and right value per category
 * (e.g. "VER 2023 vs 2024 average finish").
 */
export function buildDumbbell(
    rows: Array<Record<string, unknown>>,
    groupKey: string,
    valueKey: string,
    groupA: string,
    groupB: string
): Array<{ category: string; left: number; right: number; delta: number }> {
    const groups = new Map<string, Record<string, number[]>>();
    for (const row of rows) {
        const cat = String(row[groupKey] ?? "Unknown");
        const grp = String(row[valueKey] ?? ""); // we expect 'season' or similar
        const v = toNumber(row["value"] ?? row[valueKey]);
        if (v == null) continue;
        if (!groups.has(cat)) groups.set(cat, {});
        const entry = groups.get(cat)!;
        if (!entry[grp]) entry[grp] = [];
        entry[grp].push(v);
    }
    return Array.from(groups.entries()).map(([cat, grpMap]) => {
        const a = grpMap[groupA] ? mean(grpMap[groupA]) : 0;
        const b = grpMap[groupB] ? mean(grpMap[groupB]) : 0;
        return { category: cat, left: round(a, 3), right: round(b, 3), delta: round(b - a, 3) };
    });
}

/**
 * Find the row that most clearly "wins" or "loses" — used for chart
 * annotations (e.g. "VER averaged 0.18s faster than PER").
 */
export function findHighlight(
    rows: AggregatedRow[],
    mode: "max" | "min"
): { key: string; value: number; label?: string } | undefined {
    if (rows.length === 0) return undefined;
    const sorted = [...rows].sort((a, b) => (mode === "max" ? b.value - a.value : a.value - b.value));
    const top = sorted[0];
    if (!top) return undefined;
    return { key: top.key, value: top.value, label: top.label };
}

// =============================================================================
// Chart-type selection
// =============================================================================

interface ChartTypeDescriptor {
    type: string;
    intents: VisualizationIntent[];
    aggregation: AggregationKind;
    /** When true, this chart needs at least two distinct groups */
    multiSeries?: boolean;
    /** When true, this chart benefits from a highlight annotation */
    supportsHighlight?: boolean;
}

const CHART_TYPE_DESCRIPTORS: ChartTypeDescriptor[] = [
    {
        type: "horizontal_bar",
        intents: ["compare_drivers", "compare_teams", "rank_metric", "standings_breakdown", "qualifying_pace"],
        aggregation: "average",
        supportsHighlight: true,
    },
    {
        type: "line",
        intents: ["lap_progression", "championship_progression"],
        aggregation: "none",
        multiSeries: true,
    },
    {
        type: "area",
        intents: ["championship_progression", "lap_progression"],
        aggregation: "sum",
        multiSeries: true,
    },
    {
        type: "scatter",
        intents: ["qualifying_vs_result", "telemetry_correlation", "correlation"],
        aggregation: "none",
    },
    {
        type: "stacked_bar",
        intents: ["strategy_breakdown"],
        aggregation: "count",
        multiSeries: true,
    },
    {
        type: "dumbbell",
        intents: ["compare_drivers", "compare_teams"],
        aggregation: "average",
    },
    {
        type: "box_plot",
        intents: ["lap_time_distribution", "pit_stop_distribution", "tyre_degradation"],
        aggregation: "none",
        multiSeries: true,
        supportsHighlight: true,
    },
    {
        type: "histogram",
        intents: ["lap_time_distribution", "pit_stop_distribution"],
        aggregation: "none",
    },
    {
        type: "telemetry_multi",
        intents: ["telemetry_compare", "telemetry_single"],
        aggregation: "none",
        multiSeries: true,
    },
    {
        // Appended last so first-match selection (buildChartSpec) and
        // multi-series preference (selectChartType) keep returning the
        // pre-existing types — the LLM planner can still choose these
        // via the CHART_TYPES catalog.
        type: "swarm",
        intents: ["lap_time_distribution"],
        aggregation: "none",
        multiSeries: true,
    },
    {
        type: "bump",
        intents: ["championship_progression"],
        aggregation: "none",
        multiSeries: true,
    },
];

export function selectChartType(
    intent: VisualizationIntent,
    groupCount: number
): string {
    const candidates = CHART_TYPE_DESCRIPTORS.filter((d) => d.intents.includes(intent));
    if (candidates.length === 0) return "horizontal_bar";
    // Prefer multi-series charts when there's data for them
    const prefer = groupCount > 1
        ? candidates.find((c) => c.multiSeries) ?? candidates[0]
        : candidates[0];
    return prefer.type;
}

// =============================================================================
// Spec building + validation
// =============================================================================

export interface BuildSpecInput {
    intent: VisualizationIntent;
    objective: string;
    evidence: Evidence;
    data: Array<Record<string, unknown>>;
    xKey: string;
    yKey: string;
    /** Optional secondary x for dumbbell / scatter */
    xKeySecondary?: string;
    /** Optional top-N truncation (default 10) */
    topN?: number;
    /** Optional driver/team subset to focus on (others get collapsed) */
    focusKeys?: string[];
}

export function buildChartSpec(input: BuildSpecInput): ChartSpec {
    const intent = input.intent;
    const descriptor =
        CHART_TYPE_DESCRIPTORS.find((d) => d.intents.includes(intent)) ?? CHART_TYPE_DESCRIPTORS[0];

    const chartType = descriptor.type;
    const useTopN = input.topN ?? defaultTopNForIntent(intent);

    // 1. Aggregate / smooth
    const aggregation = descriptor.aggregation;
    const aggregated = aggregateRows(
        input.data,
        input.xKey,
        input.yKey,
        aggregation,
        { topN: useTopN }
    );

    // Focus filter: if user asked about specific drivers, keep them + others
    const focusedAggregated = input.focusKeys && input.focusKeys.length > 0
        ? keepFocus(aggregated, input.focusKeys)
        : aggregated;

    // 2. Smart title + axis labels
    const { title, xAxisLabel, yAxisLabel } = smartLabels(intent, input);

    // 3. Insight (highlight best/worst performer)
    let insight: string | undefined;
    if (descriptor.supportsHighlight && focusedAggregated.length > 0) {
        const best = findHighlight(focusedAggregated, intent === "lap_time_distribution" || intent === "pit_stop_distribution" ? "min" : "max");
        if (best) {
            insight = formatInsight(intent, best);
        }
    }

    // 4. Config: which y-value(s) to plot + axis formatters
    const config: Record<string, unknown> = {
        data: focusedAggregated,
        xAxisLabel,
        yAxisLabel,
        unit: unitForMetric(intent, input.yKey),
        intent,
        aggregation,
        ...(insight ? { insight, highlight: extractHighlight(focusedAggregated) } : {}),
    };

    return {
        id: `${chartType}_${input.evidence.id}_${Math.random().toString(36).slice(2, 7)}`,
        type: chartType as ChartSpec["type"],
        title,
        dataSource: input.evidence.id,
        xField: input.xKey,
        yField: input.yKey,
        ...(input.xKeySecondary ? { groupField: input.xKeySecondary } : {}),
        config,
    };
}

// =============================================================================
// Smart labels
// =============================================================================

const INTENT_LABELS: Record<
    VisualizationIntent,
    { x?: string; y: string; unit: string; aggregation: AggregationKind }
> = {
    compare_drivers: { x: "Driver", y: "Average metric", unit: "auto", aggregation: "average" },
    compare_teams: { x: "Team", y: "Average metric", unit: "auto", aggregation: "average" },
    rank_metric: { x: "Driver", y: "Ranked metric", unit: "count", aggregation: "sum" },
    championship_progression: { x: "Round", y: "Championship points", unit: "points", aggregation: "sum" },
    lap_progression: { x: "Lap", y: "Lap time", unit: "s", aggregation: "moving_avg" },
    tyre_degradation: { x: "Tyre age (laps)", y: "Lap time", unit: "s", aggregation: "average" },
    strategy_breakdown: { x: "Compound", y: "Laps on compound", unit: "laps", aggregation: "sum" },
    pit_stop_distribution: { x: "Driver", y: "Pit stop time", unit: "s", aggregation: "median" },
    lap_time_distribution: { x: "Driver", y: "Lap time", unit: "s", aggregation: "min" },
    qualifying_pace: { x: "Driver", y: "Qualifying time", unit: "s", aggregation: "min" },
    qualifying_vs_result: { x: "Grid position", y: "Finish position", unit: "pos", aggregation: "none" },
    telemetry_compare: { x: "Distance (m)", y: "Speed / Throttle / Brake", unit: "mixed", aggregation: "none" },
    telemetry_single: { x: "Distance (m)", y: "Speed / Throttle / Brake", unit: "mixed", aggregation: "none" },
    telemetry_correlation: { x: "Tyre age (laps)", y: "Lap time", unit: "s", aggregation: "average" },
    standings_breakdown: { x: "Driver", y: "Championship points", unit: "points", aggregation: "sum" },
    race_control_timeline: { x: "Lap", y: "Event", unit: "event", aggregation: "none" },
    weather_conditions: { x: "Time", y: "Temperature (°C)", unit: "°C", aggregation: "none" },
    correlation: { x: "X", y: "Y", unit: "auto", aggregation: "none" },
    summary_kpi: { x: "Metric", y: "Value", unit: "auto", aggregation: "none" },
    show: { x: "X", y: "Y", unit: "auto", aggregation: "none" },
};

export function smartLabels(
    intent: VisualizationIntent,
    input: BuildSpecInput
): { title: string; xAxisLabel: string; yAxisLabel: string } {
    const labelInfo = INTENT_LABELS[intent] ?? INTENT_LABELS.show;
    const evidenceContext = evidenceContextString(input.evidence);

    const focusSuffix =
        input.focusKeys && input.focusKeys.length > 0
            ? ` — ${input.focusKeys.slice(0, 3).join(" vs ")}${input.focusKeys.length > 3 ? " et al." : ""}`
            : "";

    const aggregationSuffix = labelInfo.aggregation === "average"
        ? " (average)"
        : labelInfo.aggregation === "sum"
            ? " (total)"
            : labelInfo.aggregation === "min"
                ? " (fastest)"
                : labelInfo.aggregation === "median"
                    ? " (median)"
                    : "";

    const title = `${labelInfo.y}${aggregationSuffix}${focusSuffix}\n${evidenceContext}`;
    const xAxisLabel = labelInfo.x ?? input.xKey;
    const yAxisLabel = labelInfo.y;

    return { title, xAxisLabel, yAxisLabel };
}

function evidenceContextString(evidence: Evidence): string {
    const parts: string[] = [];
    if (evidence.season) parts.push(String(evidence.season));
    if (evidence.race) parts.push(evidence.race);
    if (evidence.driver && !parts.length) parts.push(evidence.driver);
    return parts.join(" • ");
}

function unitForMetric(intent: VisualizationIntent, yKey: string): string {
    const info = INTENT_LABELS[intent];
    if (info) return info.unit;
    if (/time|lap/i.test(yKey)) return "s";
    if (/position|pos/i.test(yKey)) return "pos";
    if (/point/i.test(yKey)) return "pts";
    return "";
}

function defaultTopNForIntent(intent: VisualizationIntent): number {
    if (intent === "rank_metric" || intent === "standings_breakdown") return 10;
    if (intent === "qualifying_pace") return 20;
    if (intent === "compare_drivers" || intent === "compare_teams") return 8;
    return 0; // no truncation by default
}

function keepFocus(rows: AggregatedRow[], focus: string[]): AggregatedRow[] {
    const focusSet = new Set(focus.map((s) => s.toUpperCase()));
    const head: AggregatedRow[] = [];
    const tail: AggregatedRow[] = [];
    for (const row of rows) {
        if (focusSet.has(row.key.toUpperCase())) head.push(row);
        else tail.push(row);
    }
    if (tail.length === 0) return head;
    const tailAvg = round(tail.reduce((acc, r) => acc + r.value, 0) / tail.length, 3);
    head.push({ key: "Others", value: tailAvg, label: `${tail.length} other${tail.length === 1 ? "" : "s"}` });
    return head;
}

function formatInsight(
    intent: VisualizationIntent,
    best: { key: string; value: number; label?: string }
): string {
    switch (intent) {
        case "compare_drivers":
        case "qualifying_pace":
        case "lap_time_distribution":
            return `${best.key} leads with ${best.value.toFixed(3)}s`;
        case "rank_metric":
        case "standings_breakdown":
            return `${best.key} leads with ${best.value}`;
        default:
            return `${best.key} is the highlight (${best.value})`;
    }
}

function extractHighlight(rows: AggregatedRow[]): { key: string; value: number } | undefined {
    if (rows.length === 0) return undefined;
    const top = [...rows].sort((a, b) => b.value - a.value)[0];
    return top ? { key: top.key, value: top.value } : undefined;
}

// =============================================================================
// Spec validation
// =============================================================================

/**
 * Reject specs that don't pass the data-analyst quality gate. We do not
 * render charts that fail — the planner retries with a different intent or
 * drops the chart entirely.
 */
export function validateChartSpec(spec: ChartSpec): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (!CHART_TYPES.has(spec.type)) reasons.push(`Unsupported chart type: ${spec.type}`);

    const data = (spec.config as { data?: AggregatedRow[] })?.data;
    if (!Array.isArray(data) || data.length === 0) {
        reasons.push("No data after aggregation");
    }
    if (!spec.xField) reasons.push("Missing x field");
    if (!spec.yField) reasons.push("Missing y field");

    // Reject duplicate keys (caused by upstream double-counting).
    // Series-style data (swarm dots, bump rows) carries no `key` at
    // all — only run the check when keys are actually present.
    if (Array.isArray(data)) {
        const keys = data.map((d) => d.key).filter((k) => k !== undefined);
        if (keys.length > 0 && new Set(keys).size !== keys.length) {
            reasons.push("Duplicate categories in data");
        }
    }

    // Reject generic axis labels
    if (/^value$|^time \/ position$/i.test(spec.title)) {
        reasons.push("Generic title; please regenerate");
    }

    return { ok: reasons.length === 0, reasons };
}

// =============================================================================
// Math helpers
// =============================================================================

function toNumber(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
        const trimmed = v.trim();
        if (!trimmed) return null;
        // "MM:SS.sss" lap time
        if (trimmed.includes(":")) {
            const [m, s] = trimmed.split(":");
            const minutes = parseInt(m, 10);
            const seconds = parseFloat(s);
            if (Number.isFinite(minutes) && Number.isFinite(seconds)) return minutes * 60 + seconds;
        }
        const n = parseFloat(trimmed);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
    }
    return sorted[mid] ?? 0;
}

function round(v: number, decimals: number): number {
    const m = Math.pow(10, decimals);
    return Math.round(v * m) / m;
}

function isTimeMetric(metric: string): boolean {
    return /time|lap|pit|duration|seconds/i.test(metric);
}
