/**
 * Smart Aggregator
 * ================
 *
 * Deterministic, single-mode counterpart to the deep-research
 * visualization planner. Standard mode doesn't go through the
 * LLM/evidence pipeline, but it should still:
 *
 *   - aggregate before plotting
 *   - pick the right chart family for the question
 *   - produce a meaningful title and axis labels
 *   - truncate to top-N (or focus on user-mentioned drivers)
 *
 * The aggregator takes raw tool results, normalizes them, and emits a
 * `ChartSpec[]` that the new dispatcher can render.
 */

import type { ChartSpec } from "@/lib/research/types";
import { aggregateRows } from "@/lib/research/agents/visualization-intelligence";

// =============================================================================
// Aggregation + spec synthesis
// =============================================================================

export interface RawResult {
    tool: string;
    args: Record<string, unknown>;
    success: boolean;
    data: unknown;
}

/**
 * Build a flat list of data rows from a tool result.
 */
function extractRows(data: unknown): Array<Record<string, unknown>> {
    if (data == null) return [];
    let parsed: unknown = data;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return [];
        }
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    const obj = parsed as Record<string, unknown>;
    for (const field of ["results", "laps", "tyres", "standings", "data", "retrieved_documents"]) {
        if (Array.isArray(obj[field])) {
            return (obj[field] as Array<Record<string, unknown>>).filter((r) => typeof r === "object" && r !== null);
        }
    }
    return [];
}

/**
 * Detect the user's intended focus from the query (e.g. "VER and HAM",
 * "compare Verstappen to Perez"). Used to highlight specific drivers in
 * the resulting chart.
 */
export function detectFocus(query: string): string[] {
    if (!query) return [];
    const text = query.toUpperCase();
    const codes = [
        "VER", "PER", "HAM", "RUS", "LEC", "SAI", "NOR", "PIA",
        "ALO", "STR", "GAS", "OCO", "ALB", "SAR", "TSU", "RIC",
        "MAG", "HUL", "BOT", "ZHO",
    ];
    const found = codes.filter((c) => new RegExp(`\\b${c}\\b`).test(text));
    return Array.from(new Set(found));
}

/**
 * Synthesize a smart ChartSpec[] from the raw tool results of a standard
 * (non-research) query. This is the equivalent of what the deep-research
 * planner does, but with no LLM call.
 */
export function synthesizeChartSpecs(
    results: RawResult[],
    query: string
): ChartSpec[] {
    const focus = detectFocus(query);
    const specs: ChartSpec[] = [];

    for (const result of results) {
        if (!result.success) continue;
        const rows = extractRows(result.data);
        if (rows.length === 0) continue;

        const intent = inferIntentFromTool(result.tool, rows);
        const spec = synthesizeOne(result, rows, intent, focus);
        if (spec) specs.push(spec);
    }

    return specs;
}

function inferIntentFromTool(tool: string, rows: Array<Record<string, unknown>>): string {
    const text = tool.toLowerCase();
    if (text.includes("telemetry")) return "telemetry_single";
    if (text.includes("laps")) return "lap_progression";
    if (text.includes("standings")) return "standings_breakdown";
    if (text.includes("qualifying")) return "qualifying_pace";
    if (text.includes("race")) return "qualifying_vs_result";
    if (text.includes("tyres")) return "strategy_breakdown";
    if (text.includes("weather")) return "weather_conditions";

    // Heuristic from data shape
    if (rows.length > 0) {
        const first = rows[0];
        if ("q3" in first || "Q3" in first) return "qualifying_pace";
        if ("points" in first) return "standings_breakdown";
        if ("position" in first && "driver" in first) return "qualifying_vs_result";
    }
    return "compare_drivers";
}

function synthesizeOne(
    result: RawResult,
    rows: Array<Record<string, unknown>>,
    intent: string,
    focus: string[]
): ChartSpec | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);

    const has = (k: string) => keys.has(k);
    const pick = (...opts: string[]): string | null => opts.find((o) => has(o)) ?? null;

    switch (intent) {
        case "telemetry_single":
        case "telemetry_compare": {
            // Multi-line chart over distance, channel-by-channel
            const data = rows.map((r) => ({
                x: toNumberSafe(r["Distance"] ?? r["distance"]) ?? 0,
                speed: toNumberSafe(r["Speed"] ?? r["speed"]),
                throttle: toNumberSafe(r["Throttle"] ?? r["throttle"]),
                brake: toNumberSafe(r["Brake"] ?? r["brake"]),
            }));
            const series: string[] = [];
            if (data.some((d) => d.speed != null)) series.push("speed");
            if (data.some((d) => d.throttle != null)) series.push("throttle");
            if (data.some((d) => d.brake != null)) series.push("brake");
            return {
                id: `telemetry_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "line",
                title: `Telemetry: ${argsSummary(result.args)}`,
                subtitle: "Speed, throttle, brake across the lap",
                dataSource: result.tool,
                xField: "x",
                yField: "speed",
                config: {
                    data,
                    xAxisLabel: "Distance (m)",
                    yAxisLabel: "Speed (km/h) / Throttle / Brake",
                    unit: "km/h",
                    intent,
                    series,
                },
            };
        }

        case "lap_progression": {
            const data = rows.map((r) => ({
                x: toNumberSafe(r["lap_number"] ?? r["LapNumber"] ?? r["lap"]) ?? 0,
                y: toNumberSafe(r["lap_time"] ?? r["LapTime"] ?? r["time"]) ?? 0,
            }));
            return {
                id: `laps_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "line",
                title: `Lap Time Progression: ${argsSummary(result.args)}`,
                subtitle: "Lap time across the stint",
                dataSource: result.tool,
                xField: "x",
                yField: "y",
                config: {
                    data,
                    xAxisLabel: "Lap",
                    yAxisLabel: "Lap Time",
                    unit: "s",
                    intent,
                },
            };
        }

        case "standings_breakdown": {
            const driver = pick("driver", "Driver", "Abbreviation") ?? "driver";
            const points = pick("points", "Points") ?? "points";
            const aggregated = aggregateRows(rows, driver, points, "sum", { topN: 20 });
            return {
                id: `standings_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "horizontal_bar",
                title: `Final Standings: ${argsSummary(result.args)}`,
                subtitle: "Total championship points",
                dataSource: result.tool,
                xField: driver,
                yField: points,
                config: {
                    data: aggregated,
                    xAxisLabel: "Championship points",
                    yAxisLabel: driver,
                    unit: "pts",
                    intent,
                    highlight: aggregated[0] ? { key: aggregated[0].key, value: aggregated[0].value } : undefined,
                },
            };
        }

        case "qualifying_pace": {
            const driver = pick("driver", "Driver", "Abbreviation") ?? "driver";
            const time = pick("q3", "Q3", "time", "Time", "best_time") ?? "q3";
            const aggregated = aggregateRows(rows, driver, time, "min", { topN: 20 });
            return {
                id: `qual_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "horizontal_bar",
                title: `Qualifying Pace: ${argsSummary(result.args)}`,
                subtitle: focus.length > 0
                    ? `Focus: ${focus.join(", ")} • Fastest qualifying time (lower is faster)`
                    : "Fastest qualifying time per driver (lower is faster)",
                dataSource: result.tool,
                xField: driver,
                yField: time,
                config: {
                    data: aggregated,
                    xAxisLabel: "Qualifying time (s)",
                    yAxisLabel: "Driver",
                    unit: "s",
                    intent,
                    highlight: aggregated[0] ? { key: aggregated[0].key, value: aggregated[0].value } : undefined,
                },
            };
        }

        case "qualifying_vs_result": {
            // Build scatter rows: grid position vs finish position
            const data = rows.map((r) => ({
                x: toNumberSafe(r["grid"] ?? r["GridPosition"] ?? r["position"]) ?? 0,
                y: toNumberSafe(r["finish"] ?? r["FinishPosition"] ?? r["Position"] ?? r["position"]) ?? 0,
                group: String(r["driver"] ?? r["Driver"] ?? r["Abbreviation"] ?? "?"),
            }));
            return {
                id: `gridfinish_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "scatter",
                title: `Grid vs Finish: ${argsSummary(result.args)}`,
                subtitle: "Each point is a driver; below the line = positions gained",
                dataSource: result.tool,
                xField: "x",
                yField: "y",
                config: {
                    data,
                    xAxisLabel: "Grid position",
                    yAxisLabel: "Finish position",
                    unit: "pos",
                    intent,
                },
            };
        }

        case "strategy_breakdown": {
            // tyre compound usage: { driver: { SOFT: n, MEDIUM: n, HARD: n } }
            const driver = pick("driver", "Driver") ?? "driver";
            const compound = pick("compound", "Compound") ?? "compound";
            const data = new Map<string, Record<string, number | string>>();
            for (const row of rows) {
                const d = String(row[driver] ?? "?");
                const c = String(row[compound] ?? "?");
                const laps = toNumberSafe(row["laps"] ?? row["Laps"] ?? row["stint_length"]) ?? 1;
                if (!data.has(d)) data.set(d, { category: d });
                const entry = data.get(d)!;
                entry[c] = ((entry[c] as number) ?? 0) + laps;
            }
            const series = Array.from(
                new Set(rows.map((r) => String(r[compound] ?? "?")))
            );
            return {
                id: `strategy_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "stacked_bar",
                title: `Tyre Strategy: ${argsSummary(result.args)}`,
                subtitle: "Stint length by compound per driver",
                dataSource: result.tool,
                xField: "category",
                yField: series[0] ?? "laps",
                config: {
                    data: Array.from(data.values()),
                    xAxisLabel: "Driver",
                    yAxisLabel: "Laps on compound",
                    unit: "laps",
                    intent,
                    series,
                },
            };
        }

        case "compare_drivers":
        default: {
            // Default: best driver on a single numeric metric
            const driver = pick("driver", "Driver", "Abbreviation") ?? "driver";
            const metric = pick("time", "Time", "lap_time", "LapTime", "q3", "Q3", "position", "Position", "points", "Points") ?? "value";
            const aggregated = aggregateRows(rows, driver, metric, "average", { topN: 10 });
            // Mark focus drivers so the renderer highlights them
            const data = aggregated.map((r) => ({
                ...r,
                label: focus.length > 0
                    ? (focus.includes(r.key.toUpperCase()) ? "★ focus" : undefined)
                    : r.label,
            }));
            return {
                id: `compare_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "horizontal_bar",
                title: `Driver Comparison: ${argsSummary(result.args)}`,
                subtitle: focus.length > 0 ? `Focus: ${focus.join(", ")}` : "Average across the session",
                dataSource: result.tool,
                xField: driver,
                yField: metric,
                config: {
                    data,
                    xAxisLabel: metricLabel(metric, intent),
                    yAxisLabel: "Driver",
                    unit: metricUnit(metric),
                    intent,
                    highlight: aggregated[0] ? { key: aggregated[0].key, value: aggregated[0].value } : undefined,
                },
            };
        }
    }
}

function toNumberSafe(v: unknown): number | null {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
        const trimmed = v.trim();
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

function metricLabel(metric: string, intent: string): string {
    if (intent === "qualifying_pace" || /time|lap|q3/i.test(metric)) return "Qualifying time (s)";
    if (/position/i.test(metric)) return "Average position";
    if (/point/i.test(metric)) return "Points";
    return "Value";
}

function metricUnit(metric: string): string {
    if (/time|lap|q3/i.test(metric)) return "s";
    if (/position/i.test(metric)) return "pos";
    if (/point/i.test(metric)) return "pts";
    return "";
}

function argsSummary(args: Record<string, unknown>): string {
    const year = args.year ?? args.season;
    const gp = args.gp ?? args.grand_prix;
    const session = args.session;
    const driver = args.driver;
    const parts: string[] = [];
    if (year) parts.push(String(year));
    if (gp) parts.push(String(gp));
    if (session) parts.push(String(session).toUpperCase());
    if (driver) parts.push(String(driver));
    return parts.length > 0 ? parts.join(" • ") : "F1";
}
