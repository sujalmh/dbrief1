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

/** Standard mode should not turn one answer into a wall of charts. */
const MAX_STANDARD_CHARTS = 4;

function isShareQuery(query: string): boolean {
    return /\b(share|percentage|proportion|distribution|mix)\b/i.test(query);
}

function isConsistencyQuery(query: string): boolean {
    return /\b(consisten\w*|distribution|spread|median|box|variab\w*|outlier)\b/i.test(query);
}

function isPositionQuery(query: string): boolean {
    return /\b(position|place|gained|lost|overtak|bump|climb|drop)\b/i.test(query);
}

function uniqueDriverCount(rows: Array<Record<string, unknown>>): number {
    const key = DRIVER_KEYS.find((k) => rows.some((r) => r[k] != null));
    if (!key) return 0;
    return new Set(rows.map((r) => String(r[key] ?? ""))).size;
}

/** Parse "1:23.456", "0 days 00:10:00", or a numeric string to seconds. */
function parseTimeToSeconds(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const cleaned = value.trim().replace(/^0 days\s+/i, "");
    if (!cleaned) return null;
    const parts = cleaned.split(":").map((p) => Number(p));
    if (parts.some((p) => !Number.isFinite(p))) return null;
    if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
    if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
    return Number.isFinite(parts[0]) ? parts[0]! : null;
}

function quantile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const w = idx - lo;
    return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w;
}

function boxStats(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const median = quantile(sorted, 0.5);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const inRange = sorted.filter((v) => v >= lower && v <= upper);
    return {
        min: inRange[0] ?? sorted[0] ?? 0,
        q1,
        median,
        q3,
        max: inRange[inRange.length - 1] ?? sorted[sorted.length - 1] ?? 0,
        outliers: sorted.filter((v) => v < lower || v > upper),
    };
}

/** Remove charts that repeat the same type and the same first rows. */
function dedupeSpecs(specs: ChartSpec[]): ChartSpec[] {
    const seen = new Set<string>();
    return specs.filter((spec) => {
        const data = (spec.config as { data?: unknown })?.data;
        const signature = Array.isArray(data)
            ? `${spec.type}|${data.length}|${JSON.stringify(data.slice(0, 3))}`
            : `${spec.type}|${spec.id}`;
        if (seen.has(signature)) return false;
        seen.add(signature);
        return true;
    });
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
        // Non-data outputs (schedules, session lists, name lookups,
        // regulations, web results, simulations) have no chart renderer —
        // synthesizing from them produced empty/garbage charts under
        // text answers (e.g. a blank bar chart under "last race summary").
        if (NON_CHARTABLE_TOOLS.has(result.tool.toLowerCase())) continue;
        if (!result.success) continue;
        const rows = extractRows(result.data);
        if (rows.length === 0) continue;

        const intent = inferIntentFromTool(result.tool, rows, query);
        let spec: ChartSpec | null = null;

        if (intent === "standings_breakdown" && isShareQuery(query)) {
            spec = synthesizePointsPie(result, rows);
        } else if (intent === "strategy_breakdown" && isShareQuery(query)) {
            spec = synthesizeCompoundPie(result, rows);
        } else if (intent === "lap_progression") {
            const drivers = uniqueDriverCount(rows);
            if (isPositionQuery(query) && detectRoundPosShape(rows)) {
                spec = synthesizeBump(result, rows);
            } else if (drivers <= 1 && isConsistencyQuery(query)) {
                spec = synthesizeHistogram(result, rows);
            } else if (drivers > 1 && isConsistencyQuery(query)) {
                spec = synthesizeBoxPlot(result, rows);
            } else if (drivers === 2 && focus.length === 2) {
                const driverKey = DRIVER_KEYS.find((k) => rows.some((r) => r[k] != null));
                const timeKey = LAP_TIME_KEYS.find((k) => rows.some((r) => r[k] != null));
                if (driverKey && timeKey) {
                    spec = synthesizePaceDumbbell(result, rows, focus, driverKey, timeKey);
                }
                if (!spec) spec = synthesizeSwarm(result, rows);
            } else if (drivers > 1) {
                spec = synthesizeSwarm(result, rows);
            } else {
                spec = synthesizeOne(result, rows, intent, focus, query);
            }
        } else {
            spec = synthesizeOne(result, rows, intent, focus, query);
        }

        if (spec && hasChartData(spec)) specs.push(spec);
    }

    return dedupeSpecs(specs).slice(0, MAX_STANDARD_CHARTS);
}

/** Tool outputs with no chart renderer — never synthesize from these. */
const NON_CHARTABLE_TOOLS = new Set([
    "get_events",
    "get_seasons",
    "get_sessions",
    "get_gp_names",
    "retrieve_regulations",
    "web_search",
    "fetch_web_pages",
    "run_simulation",
]);

/** True when a spec carries at least one plottable row. */
function hasChartData(spec: ChartSpec): boolean {
    const data = (spec.config as { data?: unknown })?.data;
    return Array.isArray(data) && data.length > 0;
}

/** Round/lap + position + driver shape → rank-flow data. */
interface RoundPosShape {
    round: string;
    pos: string;
    driver: string;
    /** True when the x key is lap-like (in-race) vs round-like (season). */
    lapLike: boolean;
}

const ROUND_KEYS = ["round", "round_number", "Round", "RoundNumber"];
const LAP_X_KEYS = ["lap", "lap_number", "Lap", "LapNumber"];
const POS_KEYS = ["position", "Position", "pos", "Pos", "finish", "Finish", "finish_position", "FinishPosition"];
const DRIVER_KEYS = ["driver", "Driver", "Abbreviation"];
const LAP_TIME_KEYS = ["lap_time", "LapTime", "time", "Time"];

function detectRoundPosShape(rows: Array<Record<string, unknown>>): RoundPosShape | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const round = ROUND_KEYS.find((k) => keys.has(k));
    const lapLikeKey = round ? null : LAP_X_KEYS.find((k) => keys.has(k));
    const roundKey = round ?? lapLikeKey;
    const pos = POS_KEYS.find((k) => keys.has(k));
    const driver = DRIVER_KEYS.find((k) => keys.has(k));
    if (!roundKey || !pos || !driver) return null;
    const xs = new Set<unknown>();
    for (const r of rows) {
        const v = toNumberSafe(r[roundKey]);
        if (v != null) xs.add(v);
    }
    // A single x value is a snapshot (standings/grid), not a progression.
    if (xs.size < 2) return null;
    return { round: roundKey, pos, driver, lapLike: lapLikeKey !== null };
}

function hasLapTimeColumn(rows: Array<Record<string, unknown>>): boolean {
    return rows.some((r) => LAP_TIME_KEYS.some((k) => r[k] !== undefined && r[k] !== null && r[k] !== ""));
}

function inferIntentFromTool(tool: string, rows: Array<Record<string, unknown>>, query = ""): string {
    // Round/lap + position + driver without lap times is rank-flow data
    // (season standings progression, in-race position trace) — detect it
    // by shape first so season-long get_race payloads don't collapse into
    // the single-GP grid-vs-finish scatter. Payloads that ALSO carry lap
    // times stay on their tool path (the bump is appended alongside).
    const shape = detectRoundPosShape(rows);
    if (shape && !hasLapTimeColumn(rows)) return "position_progression";

    const text = tool.toLowerCase();
    if (text.includes("telemetry")) return "telemetry_single";
    if (text.includes("laps")) return "lap_progression";
    if (text.includes("standings")) return "standings_breakdown";
    if (text.includes("qualifying")) return "qualifying_pace";
    if (hasFinishShape(rows)) {
        // Single-GP classification: a finishing-order bar by default.
        // Only draw the grid-vs-finish scatter when the question is
        // actually about grid movement (gains, starts, overtakes).
        return isGridGainQuery(query) ? "qualifying_vs_result" : "finishing_order";
    }
    if (text.includes("race")) return "qualifying_vs_result";
    if (text.includes("tyres") || text.includes("stints") || text.includes("stint")) return "strategy_breakdown";
    if (text.includes("weather")) return "weather_conditions";

    // Heuristic from data shape
    if (rows.length > 0) {
        const first = rows[0];
        if ("q3" in first || "Q3" in first) return "qualifying_pace";
        if ("points" in first) return "standings_breakdown";
        if (hasFinishShape(rows)) {
            return isGridGainQuery(query) ? "qualifying_vs_result" : "finishing_order";
        }
    }
    return "compare_drivers";
}

/** Rows carry a per-driver finish/position column (single-GP classification). */
function hasFinishShape(rows: Array<Record<string, unknown>>): boolean {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const hasDriver = DRIVER_KEYS.some((k) => keys.has(k));
    const hasPos = POS_KEYS.some((k) => keys.has(k));
    return hasDriver && hasPos;
}

/** True when the question is about grid movement, not just the result. */
function isGridGainQuery(query: string): boolean {
    return /grid|start|gain|overtak|mover|climb|progress|come through|charge/i.test(query);
}

function synthesizeOne(
    result: RawResult,
    rows: Array<Record<string, unknown>>,
    intent: string,
    focus: string[],
    query: string
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
            // No plottable channels at all — render nothing instead of
            // empty axes.
            if (series.length === 0) return null;
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
            const data = rows
                .map((r) => ({
                    x: toNumberSafe(r["lap_number"] ?? r["LapNumber"] ?? r["lap"]),
                    y: toNumberSafe(r["lap_time"] ?? r["LapTime"] ?? r["time"]),
                }))
                .filter((d): d is { x: number; y: number } => d.x != null && d.y != null);
            // Lap rows without lap numbers/times plot a flat line at
            // (0,0) — render nothing instead.
            if (data.length === 0) return null;
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
            const driver = pick("driver", "Driver", "Abbreviation", "team", "Team", "team_name") ?? "driver";
            const isTeamTable = driver === "team" || driver === "team_name";
            const points = pick("points", "Points") ?? "points";
            const wins = pick("wins", "Wins");
            const gap = pick("points_gap_to_leader", "pointsGapToLeader", "gap_to_leader", "gap");
            const wantsWins = /\bwins?\b/i.test(query) && wins !== null;
            const wantsGap = !wantsWins && /\b(gap|behind|deficit)\b/i.test(query) && gap !== null;
            const metric = wantsWins ? wins! : wantsGap ? gap! : points;
            const aggregated = aggregateRows(rows, driver, metric, wantsGap ? "average" : "sum", {
                sort: wantsGap ? "asc" : "desc",
            }).slice(0, 10);
            const xAxisLabel = wantsWins
                ? "Wins"
                : wantsGap
                  ? "Points gap to leader"
                  : "Championship points";
            const topLabel = isTeamTable ? "Top 10 teams" : "Top 10 drivers";
            return {
                id: `standings_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "horizontal_bar",
                title: wantsWins
                    ? `Wins: ${argsSummary(result.args)}`
                    : wantsGap
                      ? `Points Gap to Leader: ${argsSummary(result.args)}`
                      : `Final Standings: ${argsSummary(result.args)}`,
                subtitle: wantsWins
                    ? `${topLabel} • race wins`
                    : wantsGap
                      ? `${topLabel} • lower is closer to the leader`
                      : isTeamTable
                        ? `${topLabel} • constructor points`
                        : `${topLabel} • championship points`,
                dataSource: result.tool,
                xField: driver,
                yField: metric,
                config: {
                    data: aggregated,
                    xAxisLabel,
                    yAxisLabel: isTeamTable ? "Team" : "Driver",
                    unit: wantsWins ? "wins" : "pts",
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
                    // Fastest (smallest) first — the renderer draws index 0
                    // at the top and converts absolute lap times into a
                    // gap-to-quickest scale so the spread is visible.
                    sortAsc: true,
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

        case "position_progression": {
            return synthesizeBump(result, rows);
        }

        case "finishing_order": {
            type FinishRow = {
                position: number;
                driver: string;
                name?: string;
                team?: string;
                time?: string;
                gap?: string;
                status?: string;
                points?: number;
                gained?: number;
                grid?: number;
            };
            const driver = pick("driver", "Driver", "Abbreviation") ?? "driver";
            const pos = pick("finish", "Finish", "finish_position", "FinishPosition", "position", "Position", "pos", "Pos") ?? "position";
            const team = pick("team", "Team", "TeamName", "team_name");
            const name = pick("name", "FullName", "driver_name", "DriverName");
            const time = pick("time", "Time");
            const gap = pick("gap", "GapToLeader", "gap_to_leader", "Gap");
            const status = pick("status", "Status", "ClassifiedPosition");
            const points = pick("points", "Points");
            const gained = pick("PositionsGained", "positions_gained", "positionsGained", "gained");
            const grid = pick("grid", "Grid", "GridPosition", "grid_position");
            const data: FinishRow[] = rows
                .map((r) => ({
                    position: toNumberSafe(r[pos]) ?? 0,
                    driver: String(r[driver] ?? "?"),
                    name: name ? String(r[name] ?? "") : undefined,
                    team: team ? String(r[team] ?? "") : undefined,
                    time: time ? String(r[time] ?? "") : undefined,
                    gap: gap ? String(r[gap] ?? "") : undefined,
                    status: status ? String(r[status] ?? "") : undefined,
                    points: points ? toNumberSafe(r[points]) ?? undefined : undefined,
                    gained: gained ? toNumberSafe(r[gained]) ?? undefined : undefined,
                    grid: grid ? toNumberSafe(r[grid]) ?? undefined : undefined,
                }))
                .filter((d) => Number.isFinite(d.position) && d.position > 0)
                .sort((a, b) => a.position - b.position);
            if (data.length === 0) return null;

            return {
                id: `finish_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "position_ladder",
                title: `Finishing Order: ${argsSummary(result.args)}`,
                subtitle: "Final classification",
                dataSource: result.tool,
                xField: "position",
                yField: "driver",
                config: {
                    data,
                    xAxisLabel: "Position",
                    yAxisLabel: "Driver",
                    unit: "pos",
                    intent,
                },
            };
        }

        case "weather_conditions": {
            const timeKey = pick("time", "Time", "session_time", "SessionTime");
            const air = pick("air_temp", "AirTemp", "air_temperature");
            const track = pick("track_temp", "TrackTemp", "track_temperature");
            if (!air && !track) return null;
            const series = [air ? "air_temp" : null, track ? "track_temp" : null].filter(
                (s): s is string => s !== null
            );
            const data = rows
                .map((r, i) => ({
                    x: parseTimeToSeconds(timeKey ? r[timeKey] : null) ?? i + 1,
                    air_temp: air ? toNumberSafe(r[air]) : null,
                    track_temp: track ? toNumberSafe(r[track]) : null,
                }))
                .filter((d) => d.air_temp != null || d.track_temp != null);
            if (data.length < 2) return null;
            return {
                id: `weather_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
                type: "line",
                title: `Weather: ${argsSummary(result.args)}`,
                subtitle: "Air and track temperature over the session",
                dataSource: result.tool,
                xField: "x",
                yField: series[0] ?? "air_temp",
                config: {
                    data,
                    xAxisLabel: "Session time (s)",
                    yAxisLabel: "Temperature (°C)",
                    unit: "°C",
                    series,
                    intent,
                },
            };
        }

        case "strategy_breakdown": {            // tyre compound usage: { driver: { SOFT: n, MEDIUM: n, HARD: n } }
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
            const time = pick("time", "Time", "lap_time", "LapTime");
            if (focus.length === 2 && time) {
                const pace = synthesizePaceDumbbell(result, rows, focus, driver, time);
                if (pace) return pace;
            }
            const metric = time ?? pick("q3", "Q3", "position", "Position", "points", "Points") ?? "value";
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

/**
 * Two-driver pace comparison: best lap vs average lap per driver.
 * A dumbbell shows both the peak and the typical pace; a bar of averages
 * hides the peak that decides qualifying or a fastest-lap question.
 */
function synthesizePaceDumbbell(
    result: RawResult,
    rows: Array<Record<string, unknown>>,
    focus: string[],
    driverKey: string,
    timeKey: string
): ChartSpec | null {
    const groups = new Map<string, number[]>();
    for (const row of rows) {
        const driver = String(row[driverKey] ?? "?");
        const value = toNumberSafe(row[timeKey]);
        if (value == null || value <= 0) continue;
        if (!groups.has(driver)) groups.set(driver, []);
        groups.get(driver)!.push(value);
    }
    const chosen = focus.map((code) => {
        const match = Array.from(groups.keys()).find((d) => d.toUpperCase() === code.toUpperCase());
        return match ?? null;
    });
    if (chosen.some((c) => c == null)) return null;
    if (chosen.length !== 2) return null;
    if ((chosen as string[]).some((driver) => (groups.get(driver)?.length ?? 0) < 2)) return null;
    const data = (chosen as string[]).map((driver) => {
        const values = groups.get(driver)!;
        const best = Math.min(...values);
        const average = values.reduce((a, b) => a + b, 0) / values.length;
        return { category: driver, left: best, right: average, delta: average - best };
    });
    if (data.some((d) => !Number.isFinite(d.left) || !Number.isFinite(d.right))) return null;
    return {
        id: `pace_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
        type: "dumbbell",
        title: `Pace Comparison: ${(chosen as string[]).join(" vs ")}`,
        subtitle: "Best lap vs average lap",
        dataSource: result.tool,
        xField: "category",
        yField: "right",
        config: {
            data,
            xAxisLabel: "Lap time",
            yAxisLabel: "Driver",
            unit: "s",
            leftLabel: "Best",
            rightLabel: "Average",
            intent: "compare_drivers",
        },
    };
}

/**
 * Lap-time distribution for multi-driver data. A box plot is the right
 * family when the question is about consistency or spread; a line per lap
 * would be noise.
 */
function synthesizeBoxPlot(
    result: RawResult,
    rows: Array<Record<string, unknown>>
): ChartSpec | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const has = (k: string) => keys.has(k);
    const driver = DRIVER_KEYS.find(has);
    const time = LAP_TIME_KEYS.find(has);
    if (!driver || !time) return null;
    const groups = new Map<string, number[]>();
    for (const row of rows) {
        const d = String(row[driver] ?? "?");
        const v = toNumberSafe(row[time]);
        if (v == null || v <= 0) continue;
        if (!groups.has(d)) groups.set(d, []);
        groups.get(d)!.push(v);
    }
    if (groups.size < 2) return null;
    const data = Array.from(groups, ([category, values]) => ({
        category,
        ...boxStats(values),
    }));
    return {
        id: `box_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
        type: "box_plot",
        title: `Lap Time Distribution: ${argsSummary(result.args)}`,
        subtitle: `${groups.size} drivers • median and interquartile range`,
        dataSource: result.tool,
        xField: "category",
        yField: "value",
        config: {
            data,
            xAxisLabel: "Driver",
            yAxisLabel: "Lap time",
            unit: "s",
            intent: "lap_time_distribution",
        },
    };
}

/**
 * Single-driver lap-time histogram for consistency questions. A line chart
 * shows the order of laps; a histogram shows the shape of the pace.
 */
function synthesizeHistogram(
    result: RawResult,
    rows: Array<Record<string, unknown>>
): ChartSpec | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const has = (k: string) => keys.has(k);
    const time = LAP_TIME_KEYS.find(has);
    if (!time) return null;
    const values = rows
        .map((r) => toNumberSafe(r[time]))
        .filter((v): v is number => v != null && v > 0);
    if (values.length < 5) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binCount = Math.min(12, Math.max(5, Math.ceil(Math.sqrt(values.length))));
    const width = (max - min) / binCount || 1;
    const data = Array.from({ length: binCount }, (_, i) => ({
        bin: (min + i * width).toFixed(1),
        count: 0,
    }));
    for (const value of values) {
        const idx = Math.min(binCount - 1, Math.floor((value - min) / width));
        data[idx]!.count += 1;
    }
    return {
        id: `hist_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
        type: "histogram",
        title: `Lap Time Distribution: ${argsSummary(result.args)}`,
        subtitle: `${values.length} laps • ${binCount} bins`,
        dataSource: result.tool,
        xField: "bin",
        yField: "count",
        config: {
            data,
            xAxisLabel: "Lap time (s)",
            yAxisLabel: "Laps",
            unit: "laps",
            intent: "lap_time_distribution",
        },
    };
}

/**
 * Pace-distribution swarm (one dot per lap) for multi-driver lap data.
 * Returns null unless at least two drivers share lap-time rows - single
 * stints stay a plain progression line.
 */
function synthesizeSwarm(
    result: RawResult,
    rows: Array<Record<string, unknown>>
): ChartSpec | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const has = (k: string) => keys.has(k);
    const driver = DRIVER_KEYS.find(has);
    const lap = LAP_X_KEYS.find(has);
    const time = LAP_TIME_KEYS.find(has);
    if (!driver || !lap || !time) return null;

    const dots: Array<{ driver: string; lap: number; value: number }> = [];
    for (const r of rows) {
        const d = String(r[driver] ?? "?");
        const l = toNumberSafe(r[lap]);
        const v = toNumberSafe(r[time]);
        if (l == null || v == null || v <= 0) continue;
        dots.push({ driver: d, lap: l, value: v });
    }
    const drivers = Array.from(new Set(dots.map((d) => d.driver)));
    if (drivers.length < 2 || dots.length < 4) return null;

    // Full races render thousands of dots — stride-sample past the cap.
    const MAX_SWARM_DOTS = 1500;
    let shown = dots;
    let stride = 1;
    if (dots.length > MAX_SWARM_DOTS) {
        stride = Math.ceil(dots.length / MAX_SWARM_DOTS);
        shown = dots.filter((_, i) => i % stride === 0);
    }
    return {
        id: `swarm_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
        type: "swarm",
        title: `Pace Distribution: ${argsSummary(result.args)}`,
        subtitle: stride > 1
            ? `${drivers.length} drivers • showing every ${stride}th lap (${shown.length} of ${dots.length} laps)`
            : `${drivers.join(", ")} • every lap plotted`,
        dataSource: result.tool,
        xField: "driver",
        yField: time,
        config: {
            data: shown,
            xAxisLabel: "Driver",
            yAxisLabel: "Lap time",
            unit: "s",
            intent: "lap_time_distribution",
        },
    };
}

/**
 * Rank-flow bump chart from round/lap + position + driver rows.
 * Null when the shape doesn't fit (snapshots, missing columns).
 */
function synthesizeBump(
    result: RawResult,
    rows: Array<Record<string, unknown>>
): ChartSpec | null {
    const shape = detectRoundPosShape(rows);
    if (!shape) return null;
    const byDriver = new Map<string, Map<number, number>>();
    for (const r of rows) {
        const d = String(r[shape.driver] ?? "?");
        const x = toNumberSafe(r[shape.round]);
        const p = toNumberSafe(r[shape.pos]);
        if (x == null || p == null || p <= 0) continue;
        if (!byDriver.has(d)) byDriver.set(d, new Map());
        // Keep the best (lowest) position when a driver has several rows
        // for the same x (e.g. sprint + GP sharing a round number).
        const prev = byDriver.get(d)!.get(x);
        if (prev == null || p < prev) byDriver.get(d)!.set(x, p);
    }
    if (byDriver.size === 0) return null;
    const avg = (m: Map<number, number>) =>
        Array.from(m.values()).reduce((a, b) => a + b, 0) / m.size;
    const series = Array.from(byDriver.keys())
        .sort((a, b) => avg(byDriver.get(a)!) - avg(byDriver.get(b)!))
        .slice(0, 20);
    const xs = Array.from(
        new Set(series.flatMap((d) => Array.from(byDriver.get(d)!.keys())))
    ).sort((a, b) => a - b);
    if (xs.length < 2 || series.length === 0) return null;
    const data = xs.map((x) => {
        const row: Record<string, number | string> = { x };
        for (const d of series) {
            const v = byDriver.get(d)!.get(x);
            if (v != null) row[d] = v;
        }
        return row;
    });
    return {
        id: `bump_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
        type: "bump",
        title: `Position Progression: ${argsSummary(result.args)}`,
        subtitle: shape.lapLike
            ? "Track position every lap (P1 at top)"
            : "Championship position by round (P1 at top)",
        dataSource: result.tool,
        xField: "x",
        yField: series[0] ?? shape.pos,
        config: {
            data,
            series,
            xAxisLabel: shape.lapLike ? "Lap" : "Round",
            yAxisLabel: "Position",
            unit: "pos",
            intent: "position_progression",
        },
    };
}

/**
 * Pie of championship-point share among the top drivers (plus "Others").
 */
function synthesizePointsPie(
    result: RawResult,
    rows: Array<Record<string, unknown>>
): ChartSpec | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const has = (k: string) => keys.has(k);
    const driver = ["driver", "Driver", "Abbreviation"].find(has);
    const points = ["points", "Points"].find(has);
    if (!driver || !points) return null;
    const aggregated = aggregateRows(rows, driver, points, "sum", { topN: 6 });
    if (aggregated.length === 0) return null;
    const data = aggregated.map((r) => ({ key: r.key, value: r.value }));
    return {
        id: `pie_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
        type: "pie",
        title: `Points Share: ${argsSummary(result.args)}`,
        subtitle: "Share of championship points (top drivers)",
        dataSource: result.tool,
        xField: driver,
        yField: points,
        config: {
            data,
            xAxisLabel: driver,
            yAxisLabel: points,
            unit: "pts",
            donut: true,
        },
    };
}

/**
 * Pie of tyre-compound laps for a strategy breakdown.
 */
function synthesizeCompoundPie(
    result: RawResult,
    rows: Array<Record<string, unknown>>
): ChartSpec | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
    const has = (k: string) => keys.has(k);
    const compound = ["compound", "Compound"].find(has);
    if (!compound) return null;
    const lapsKey = ["laps", "Laps", "stint_length"].find(has) ?? "laps";
    const map = new Map<string, number>();
    for (const r of rows) {
        const c = String(r[compound] ?? "?");
        const l = toNumberSafe(r[lapsKey]) ?? 1;
        map.set(c, (map.get(c) ?? 0) + l);
    }
    const data = Array.from(map, ([k, v]) => ({ key: k, value: v }));
    if (data.length === 0) return null;
    return {
        id: `pie_${result.tool}_${Math.random().toString(36).slice(2, 6)}`,
        type: "pie",
        title: `Compound Mix: ${argsSummary(result.args)}`,
        subtitle: "Laps run on each tyre compound",
        dataSource: result.tool,
        xField: compound,
        yField: lapsKey,
        config: {
            data,
            xAxisLabel: compound,
            yAxisLabel: lapsKey,
            unit: "laps",
        },
    };
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
