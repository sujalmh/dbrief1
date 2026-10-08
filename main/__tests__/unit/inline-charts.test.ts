/**
 * Inline in-chat charts — thorough coverage
 * ==========================================
 *
 * The side VisualizationPanel is gone: charts render inside each
 * assistant bubble via `InlineCharts` (t3code-style). This file covers:
 *
 *   A. Spec resolution (`lib/visualization/inline-specs.ts`)
 *   B. Dispatcher support for every chart type (incl. telemetry_multi)
 *   C. F1 scenarios end-to-end via `synthesizeChartSpecs`:
 *      telemetry, laps, standings, qualifying, grid-vs-finish,
 *      tyre strategy, driver comparison, weather fallback, multi-tool,
 *      failures/empty/invalid
 *   D. Deep-research passthrough for every ChartSpec type
 *   E. Component + store + handler + shell wiring (no panel leftovers)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
    looksLikeChartSpecs,
    resolveInlineChartSpecs,
} from "@/lib/visualization/inline-specs";
import { synthesizeChartSpecs } from "@/lib/visualization/smart-aggregator";
import { CHART_TYPES } from "@/lib/research/agents/chart-catalog";
import { validateChartSpec } from "@/lib/research/agents/visualization-intelligence";
import type { ChartSpec } from "@/lib/research/types";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

function makeSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
    return {
        id: "spec_1",
        type: "horizontal_bar",
        title: "Driver Comparison (2024)",
        dataSource: "E1",
        xField: "driver",
        yField: "points",
        config: {
            data: [
                { key: "VER", value: 437 },
                { key: "NOR", value: 374 },
            ],
            xAxisLabel: "Championship points",
            yAxisLabel: "Driver",
            unit: "pts",
        },
        ...overrides,
    };
}

// =============================================================================
// A. Spec resolution
// =============================================================================

describe("looksLikeChartSpecs", () => {
    it("detects ChartSpec arrays", () => {
        expect(looksLikeChartSpecs([makeSpec()])).toBe(true);
    });

    it("rejects raw tool results", () => {
        expect(
            looksLikeChartSpecs([
                { tool: "get_laps", args: {}, success: true, data: { laps: [] } },
            ])
        ).toBe(false);
    });

    it("rejects empty / non-array / malformed payloads", () => {
        expect(looksLikeChartSpecs([])).toBe(false);
        expect(looksLikeChartSpecs(null)).toBe(false);
        expect(looksLikeChartSpecs(undefined)).toBe(false);
        expect(looksLikeChartSpecs({})).toBe(false);
        expect(looksLikeChartSpecs([{ id: "x" }])).toBe(false);
        expect(looksLikeChartSpecs("specs")).toBe(false);
        // Missing dataSource → not specs
        expect(
            looksLikeChartSpecs([
                { id: "a", type: "line", xField: "x", yField: "y" },
            ])
        ).toBe(false);
    });
});

describe("resolveInlineChartSpecs", () => {
    it("prefers chartSpecs (deep research) over visualizationData", () => {
        const specs = [makeSpec({ id: "deep_1" })];
        const out = resolveInlineChartSpecs({
            chartSpecs: specs,
            visualizationData: [
                { tool: "get_laps", args: {}, success: true, data: { laps: [] } },
            ],
            query: "anything",
        });
        expect(out).toBe(specs);
    });

    it("passes through visualizationData that already is ChartSpec[]", () => {
        const specs = [makeSpec({ id: "stored_1" }), makeSpec({ id: "stored_2", type: "line" })];
        const out = resolveInlineChartSpecs({
            visualizationData: specs,
            query: "q",
        });
        expect(out).toBe(specs as unknown as ChartSpec[]);
    });

    it("synthesizes specs from raw tool results (standard mode)", () => {
        const out = resolveInlineChartSpecs({
            visualizationData: [
                {
                    tool: "get_driver_standings",
                    args: { year: 2024 },
                    success: true,
                    data: { standings: [{ driver: "VER", points: 100 }] },
                },
            ],
            query: "standings",
        });
        expect(out).toHaveLength(1);
        expect(out[0]?.type).toBe("horizontal_bar");
    });

    it("returns [] for missing / empty / invalid payloads", () => {
        expect(resolveInlineChartSpecs({})).toEqual([]);
        expect(resolveInlineChartSpecs({ query: "q" })).toEqual([]);
        expect(resolveInlineChartSpecs({ visualizationData: [] })).toEqual([]);
        expect(resolveInlineChartSpecs({ visualizationData: null })).toEqual([]);
        expect(resolveInlineChartSpecs({ visualizationData: "nope" })).toEqual([]);
        expect(resolveInlineChartSpecs({ chartSpecs: [], visualizationData: [] })).toEqual([]);
    });

    it("returns [] when synthesis throws instead of crashing chat", () => {
        const evil = [
            {
                tool: "get_laps",
                args: null as unknown as Record<string, unknown>,
                success: true,
                // Proxy that throws on property access
                data: new Proxy({}, { get() { throw new Error("boom"); } }),
            },
        ];
        expect(resolveInlineChartSpecs({ visualizationData: evil })).toEqual([]);
    });
});

// =============================================================================
// B. Dispatcher supports every chart type
// =============================================================================

describe("ChartDispatcher coverage", () => {
    const source = readSource("components/visualization/chart-dispatcher.tsx");

    it.each([
        "horizontal_bar",
        "bar",
        "line",
        "area",
        "telemetry_multi",
        "scatter",
        "stacked_bar",
        "swarm",
        "bump",
        "dumbbell",
        "box_plot",
        "histogram",
        "kpi",
        "heatmap",
    ])("handles %s", (type) => {
        expect(source).toContain(`"${type}"`);
    });

    it("maps telemetry_multi to the line renderer (not EmptyChart)", () => {
        // telemetry_multi shares the line/area branch…
        expect(source).toMatch(/case "telemetry_multi"/);
        // …and must not fall through to the heatmap/EmptyChart default.
        const telemetryIdx = source.indexOf('case "telemetry_multi"');
        const emptyIdx = source.indexOf("<EmptyChart");
        expect(telemetryIdx).toBeGreaterThan(-1);
        expect(emptyIdx).toBeGreaterThan(telemetryIdx);
        // The shared branch builds a LineOrAreaChart.
        const branch = source.slice(telemetryIdx - 400, telemetryIdx + 800);
        expect(branch).toMatch(/LineOrAreaChart/);
    });

    it("maps sortAsc for rank charts (finishing order, P1 first)", () => {
        const dispatcher = readSource("components/visualization/chart-dispatcher.tsx");
        expect(dispatcher).toMatch(/sortAsc/);
        expect(dispatcher).toMatch(/sortAsc\?: boolean/);
        expect(dispatcher).toMatch(/sortAsc: cfg\.sortAsc === true/);
        const charts = readSource("components/visualization/intelligent-charts.tsx");
        expect(charts).toMatch(/sortAsc\?: boolean/);
        expect(charts).toMatch(/spec\.sortAsc \? a\.value - b\.value : b\.value - a\.value/);
    });

    it("drops specs with no plottable rows", () => {
        // Schedule-shaped rows carry no driver/value columns — nothing
        // plottable, so nothing may render (even past the tool gate).
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_laps",
                    args: { year: 2024 },
                    success: true,
                    data: { laps: [{ foo: 1 }, { foo: 2 }] },
                },
            ],
            "laps"
        );
        expect(specs).toEqual([]);
    });

    it("propagates config.series (telemetry regression guard)", () => {
        expect(source).toMatch(/function resolveSeries/);
        expect(source).toMatch(/series: resolveSeries\(cfg, data\)/);
        expect(source).not.toMatch(/pickSeriesFromData/);
    });

    it("registers swarm + bump in the chart catalog and schemas", () => {
        expect(CHART_TYPES.has("swarm")).toBe(true);
        expect(CHART_TYPES.has("bump")).toBe(true);
        const dispatcher = readSource("components/visualization/chart-dispatcher.tsx");
        expect(dispatcher).toMatch(/case "swarm"/);
        expect(dispatcher).toMatch(/case "bump"/);
        expect(dispatcher).toMatch(/SwarmPlot/);
        expect(dispatcher).toMatch(/BumpChart/);
    });

    it("validates keyless series data (swarm dots, bump rows)", () => {
        const swarm = makeSpec({
            id: "v1", type: "swarm", title: "Pace distribution (2024)",
            xField: "driver", yField: "lap_time",
            config: { data: [{ driver: "VER", lap: 1, value: 92.5 }] },
        });
        expect(validateChartSpec(swarm).ok).toBe(true);
        const bump = makeSpec({
            id: "v2", type: "bump", title: "Position progression (2024)",
            xField: "x", yField: "VER",
            config: { data: [{ x: 1, VER: 1 }], series: ["VER"] },
        });
        expect(validateChartSpec(bump).ok).toBe(true);
    });

    it("intelligent-charts exports every renderer", () => {
        const charts = readSource("components/visualization/intelligent-charts.tsx");
        for (const name of [
            "HorizontalBarChart",
            "LineOrAreaChart",
            "ScatterPlot",
            "StackedBarChart",
            "SwarmPlot",
            "BumpChart",
            "DumbbellChart",
            "BoxPlot",
            "Histogram",
            "KpiCard",
            "EmptyChart",
            "ChartHeader",
            "computeBoxPlotData",
        ]) {
            expect(charts).toContain(`export function ${name}`);
        }
    });
});

// =============================================================================
// C. F1 scenarios via smart-aggregator
// =============================================================================

function specConfig(spec: ChartSpec | undefined) {
    return (spec?.config ?? {}) as {
        data?: Array<Record<string, unknown>>;
        series?: string[];
        xAxisLabel?: string;
        yAxisLabel?: string;
        unit?: string;
        intent?: string;
        highlight?: { key: string; value: number };
    };
}

function expectWellFormed(spec: ChartSpec) {
    expect(spec.id).toBeTruthy();
    expect(spec.title).toBeTruthy();
    expect(spec.title.length).toBeGreaterThan(3);
    const cfg = specConfig(spec);
    expect(Array.isArray(cfg.data)).toBe(true);
    expect(cfg.data!.length).toBeGreaterThan(0);
    expect(cfg.xAxisLabel).toBeTruthy();
    expect(cfg.yAxisLabel).toBeTruthy();
}

describe("F1 telemetry charts", () => {
    it("single-driver telemetry → line with speed/throttle/brake series", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_telemetry",
                    args: { year: 2024, gp: "Monza", driver: "VER" },
                    success: true,
                    data: {
                        data: [
                            { Distance: 0, Speed: 120, Throttle: 100, Brake: 0 },
                            { Distance: 100, Speed: 280, Throttle: 100, Brake: 0 },
                            { Distance: 200, Speed: 95, Throttle: 0, Brake: 100 },
                        ],
                    },
                },
            ],
            "VER telemetry at Monza"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0]!;
        expect(spec.type).toBe("line");
        expectWellFormed(spec);
        const cfg = specConfig(spec);
        expect(cfg.xAxisLabel).toBe("Distance (m)");
        expect(cfg.unit).toBe("km/h");
        expect(cfg.series).toEqual(expect.arrayContaining(["speed", "throttle", "brake"]));
        const rows = cfg.data as Array<{ x: number; speed: number | null }>;
        expect(rows[0]?.x).toBe(0);
        expect(rows[1]?.speed).toBe(280);
    });

    it("parses lowercase telemetry keys + string numbers", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_telemetry",
                    args: { year: 2023, gp: "Silverstone", driver: "HAM" },
                    success: true,
                    data: {
                        data: [
                            { distance: 0, speed: "150", throttle: "80", brake: "0" },
                            { distance: 50, speed: "300", throttle: "100", brake: "0" },
                        ],
                    },
                },
            ],
            "telemetry"
        );
        expect(specs).toHaveLength(1);
        expect(specs[0]?.type).toBe("line");
    });
});

describe("F1 lap progression charts", () => {
    it("get_laps → lap-time line in seconds", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_laps",
                    args: { year: 2024, gp: "Monaco", driver: "LEC" },
                    success: true,
                    data: {
                        laps: [
                            { lap_number: 1, lap_time: "1:23.456" },
                            { lap_number: 2, lap_time: "1:22.789" },
                            { lap_number: 3, lap_time: 82.1 },
                        ],
                    },
                },
            ],
            "LEC lap progression"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0]!;
        expect(spec.type).toBe("line");
        expectWellFormed(spec);
        expect(specConfig(spec).unit).toBe("s");
        expect(spec.title).toContain("Lap");
        const rows = specConfig(spec).data as Array<{ x: number; y: number }>;
        expect(rows[0]?.y).toBeCloseTo(83.456, 2);
        expect(rows[2]?.y).toBeCloseTo(82.1, 2);
    });
});

describe("F1 standings charts", () => {
    it("driver standings → horizontal_bar sorted desc in pts", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_driver_standings",
                    args: { year: 2024 },
                    success: true,
                    data: {
                        standings: [
                            { driver: "NOR", points: 374 },
                            { driver: "VER", points: 437 },
                            { driver: "LEC", points: 356 },
                        ],
                    },
                },
            ],
            "2024 final standings"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0]!;
        expect(spec.type).toBe("horizontal_bar");
        expectWellFormed(spec);
        expect(specConfig(spec).unit).toBe("pts");
        const rows = specConfig(spec).data as Array<{ key: string; value: number }>;
        expect(rows[0]?.key).toBe("VER");
        expect(rows[0]?.value).toBe(437);
    });

    it("constructor-style standings with Team/Points keys", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_constructor_standings",
                    args: { year: 2024 },
                    success: true,
                    data: {
                        standings: [
                            { Driver: "Red Bull", Points: 589 },
                            { Driver: "Ferrari", Points: 512 },
                        ],
                    },
                },
            ],
            "constructors"
        );
        expect(specs).toHaveLength(1);
        expect(specs[0]?.type).toBe("horizontal_bar");
    });
});

describe("F1 qualifying charts", () => {
    it("qualifying → horizontal_bar in seconds with focus in subtitle", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_qualifying",
                    args: { year: 2024, gp: "Monaco" },
                    success: true,
                    data: {
                        results: [
                            { driver: "VER", q3: "1:19.000" },
                            { driver: "HAM", q3: "1:19.500" },
                            { driver: "LEC", q3: "1:19.700" },
                        ],
                    },
                },
            ],
            "Compare VER and HAM in Monaco qualifying"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0]!;
        expect(spec.type).toBe("horizontal_bar");
        expectWellFormed(spec);
        expect(specConfig(spec).unit).toBe("s");
        expect(spec.subtitle).toContain("VER");
        const rows = specConfig(spec).data as Array<{ key: string; value: number }>;
        expect(rows.find((r) => r.key === "VER")?.value).toBeCloseTo(79, 2);
    });
});

describe("F1 grid-vs-finish charts", () => {
    it("race results → scatter with pos units + per-driver groups", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_race",
                    args: { year: 2024, gp: "Monza" },
                    success: true,
                    data: {
                        results: [
                            { driver: "VER", grid: 1, finish: 1 },
                            { driver: "HAM", grid: 5, finish: 2 },
                            { driver: "LEC", grid: 3, finish: 4 },
                        ],
                    },
                },
            ],
            "who gained positions"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0]!;
        expect(spec.type).toBe("scatter");
        expectWellFormed(spec);
        expect(specConfig(spec).unit).toBe("pos");
        expect(specConfig(spec).intent).toBe("qualifying_vs_result");
        const rows = specConfig(spec).data as Array<{ x: number; y: number; group: string }>;
        expect(rows).toHaveLength(3);
        expect(rows[1]).toMatchObject({ x: 5, y: 2, group: "HAM" });
    });
});

describe("F1 pace-distribution swarm charts", () => {
    const multiDriverLaps = [
        { lap_number: 1, lap_time: "1:32.800", driver: "VER" },
        { lap_number: 2, lap_time: "1:32.600", driver: "VER" },
        { lap_number: 3, lap_time: "1:32.500", driver: "VER" },
        { lap_number: 1, lap_time: "1:33.200", driver: "NOR" },
        { lap_number: 2, lap_time: "1:33.000", driver: "NOR" },
        { lap_number: 3, lap_time: "1:32.700", driver: "NOR" },
    ];

    it("multi-driver laps → progression line + pace swarm", () => {
        const specs = synthesizeChartSpecs(
            [{ tool: "get_laps", args: { year: 2024, gp: "Suzuka" }, success: true, data: { laps: multiDriverLaps } }],
            "compare VER and NOR race pace"
        );
        expect(specs.map((s) => s.type)).toEqual(["line", "swarm"]);
        const swarm = specs[1]!;
        expect(swarm.title).toContain("Pace Distribution");
        const dots = specConfig(swarm).data as Array<{ driver: string; lap: number; value: number }>;
        expect(dots).toHaveLength(6);
        expect(new Set(dots.map((d) => d.driver))).toEqual(new Set(["VER", "NOR"]));
        expect(dots[0]?.value).toBeCloseTo(92.8, 1);
        expect(specConfig(swarm).unit).toBe("s");
    });

    it("single-driver laps stay a lone line (no swarm)", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_laps", args: { year: 2024 }, success: true,
                data: { laps: multiDriverLaps.filter((l) => l.driver === "VER") },
            }],
            "VER laps"
        );
        expect(specs.map((s) => s.type)).toEqual(["line"]);
    });

    it("resolves inline with driver focus from the query", () => {
        const out = resolveInlineChartSpecs({
            visualizationData: [
                { tool: "get_laps", args: { year: 2024 }, success: true, data: { laps: multiDriverLaps } },
            ],
            query: "VER vs NOR",
        });
        expect(out.map((s) => s.type)).toEqual(["line", "swarm"]);
    });
});

describe("F1 position-progression bump charts", () => {
    const roundPositions = [
        { round: 1, driver: "VER", position: 1 },
        { round: 1, driver: "NOR", position: 3 },
        { round: 2, driver: "VER", position: 1 },
        { round: 2, driver: "NOR", position: 2 },
        { round: 3, driver: "VER", position: 1 },
        { round: 3, driver: "NOR", position: 3 },
    ];

    it("round + position + driver rows → bump (not grid-vs-finish scatter)", () => {
        const specs = synthesizeChartSpecs(
            [{ tool: "get_race", args: { year: 2024 }, success: true, data: { results: roundPositions } }],
            "standings progression"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0]!;
        expect(spec.type).toBe("bump");
        expect(spec.title).toContain("Position Progression");
        const cfg = specConfig(spec);
        expect(cfg.unit).toBe("pos");
        expect(cfg.series).toEqual(["VER", "NOR"]);
        expect(cfg.xAxisLabel).toBe("Round");
        const rows = cfg.data as Array<Record<string, number>>;
        expect(rows).toHaveLength(3);
        expect(rows[1]).toMatchObject({ x: 2, VER: 1, NOR: 2 });
    });

    it("in-race lap positions → bump with Lap axis", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_laps", args: { year: 2024, gp: "Monza" }, success: true,
                data: {
                    laps: [
                        { lap_number: 1, driver: "VER", position: 2 },
                        { lap_number: 2, driver: "VER", position: 1 },
                        { lap_number: 1, driver: "NOR", position: 1 },
                        { lap_number: 2, driver: "NOR", position: 2 },
                    ],
                },
            }],
            "track positions"
        );
        // No lap times → pure rank-flow data, not a progression line.
        expect(specs.map((s) => s.type)).toEqual(["bump"]);
        expect(specConfig(specs[0]).xAxisLabel).toBe("Lap");
    });

    it("lap times + positions → line + swarm + bump", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_laps", args: { year: 2024 }, success: true,
                data: {
                    laps: [
                        { lap_number: 1, lap_time: "1:32.0", driver: "VER", position: 2 },
                        { lap_number: 2, lap_time: "1:31.8", driver: "VER", position: 1 },
                        { lap_number: 1, lap_time: "1:32.4", driver: "NOR", position: 1 },
                        { lap_number: 2, lap_time: "1:32.1", driver: "NOR", position: 2 },
                    ],
                },
            }],
            "full race comparison"
        );
        expect(specs.map((s) => s.type)).toEqual(["line", "swarm", "bump"]);
    });

    it("single-round snapshots become finishing order, not bumps", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_race", args: { year: 2024, gp: "Monza" }, success: true,
                data: { results: [{ driver: "VER", position: 1 }, { driver: "NOR", position: 2 }] },
            }],
            "monza result"
        );
        // A one-point bump is meaningless — the classification bar wins.
        expect(specs.map((s) => s.type)).toEqual(["horizontal_bar"]);
        expect(specs[0]?.title).toContain("Finishing Order");
    });
});

describe("F1 tyre strategy charts", () => {
    const stintData = {
        results: [
            { driver: "VER", compound: "SOFT", laps: 12 },
            { driver: "VER", compound: "MEDIUM", laps: 25 },
            { driver: "HAM", compound: "MEDIUM", laps: 20 },
            { driver: "HAM", compound: "HARD", laps: 18 },
        ],
    };

    it.each(["get_tyres", "get_stints"])("%s → stacked_bar in laps", (tool) => {
        const specs = synthesizeChartSpecs(
            [{ tool, args: { year: 2024, gp: "Bahrain" }, success: true, data: stintData }],
            "tyre strategy"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0]!;
        expect(spec.type).toBe("stacked_bar");
        expectWellFormed(spec);
        const cfg = specConfig(spec);
        expect(cfg.unit).toBe("laps");
        expect(cfg.series).toEqual(expect.arrayContaining(["SOFT", "MEDIUM", "HARD"]));
        const rows = cfg.data as Array<Record<string, number | string>>;
        const ver = rows.find((r) => r.category === "VER");
        expect(ver?.SOFT).toBe(12);
        expect(ver?.MEDIUM).toBe(25);
    });
});

describe("F1 driver comparison + fallbacks", () => {
    it("generic comparison → horizontal_bar with focus marker", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_fastest_lap",
                    args: { year: 2024, gp: "Spa" },
                    success: true,
                    data: {
                        results: [
                            { driver: "VER", time: "1:44.200" },
                            { driver: "PIA", time: "1:44.800" },
                        ],
                    },
                },
            ],
            "VER vs PIA fastest lap"
        );
        expect(specs).toHaveLength(1);
        expect(specs[0]?.type).toBe("horizontal_bar");
        expectWellFormed(specs[0]!);
    });

    it("weather payload renders nothing (no weather renderer exists)", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_weather",
                    args: { year: 2024, gp: "Silverstone" },
                    success: true,
                    data: {
                        results: [
                            { driver: "N/A", time: "1:00.000" },
                        ],
                    },
                },
            ],
            "was it wet"
        );
        // A generic comparison bar from temperature rows would mislead.
        expect(specs).toEqual([]);
    });

    it("stringified JSON data is parsed", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_driver_standings",
                    args: { year: 2024 },
                    success: true,
                    data: JSON.stringify({ standings: [{ driver: "VER", points: 10 }] }),
                },
            ],
            "standings"
        );
        expect(specs).toHaveLength(1);
    });

    it("multiple tools → multiple specs in order", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_telemetry",
                    args: { driver: "VER" },
                    success: true,
                    data: { data: [{ Distance: 0, Speed: 100 }] },
                },
                {
                    tool: "get_driver_standings",
                    args: { year: 2024 },
                    success: true,
                    data: { standings: [{ driver: "VER", points: 100 }] },
                },
            ],
            "telemetry and standings"
        );
        expect(specs).toHaveLength(2);
        expect(specs.map((s) => s.type)).toEqual(["line", "horizontal_bar"]);
        // IDs unique per spec
        expect(new Set(specs.map((s) => s.id)).size).toBe(2);
    });

    it("skips failed + empty results", () => {
        expect(
            synthesizeChartSpecs(
                [
                    { tool: "get_race", args: {}, success: false, data: { results: [] } },
                    { tool: "get_laps", args: {}, success: true, data: { laps: [] } },
                    { tool: "get_qualifying", args: {}, success: true, data: null },
                ],
                "q"
            )
        ).toEqual([]);
    });

    it("caps very wide grids (top-N + Others)", () => {
        const results = Array.from({ length: 25 }, (_, i) => ({
            driver: `D${i}`,
            q3: `1:2${String(i).padStart(2, "0")}.000`,
        }));
        const specs = synthesizeChartSpecs(
            [{ tool: "get_qualifying", args: { year: 2024 }, success: true, data: { results } }],
            "q"
        );
        const rows = specConfig(specs[0]).data as Array<{ key: string }>;
        expect(rows.length).toBeLessThanOrEqual(21);
        expect(rows.some((r) => r.key === "Others")).toBe(true);
    });
});

// =============================================================================
// D. Deep-research passthrough for every ChartSpec type
// =============================================================================

describe("deep-research passthrough (every chart type renders inline)", () => {
    const cases: Array<{ type: ChartSpec["type"]; config: Record<string, unknown> }> = [
        {
            type: "horizontal_bar",
            config: { data: [{ key: "VER", value: 1 }], xAxisLabel: "X", yAxisLabel: "Y", unit: "pts" },
        },
        {
            type: "bar",
            config: { data: [{ key: "VER", value: 1 }], xAxisLabel: "X", yAxisLabel: "Y", unit: "pts" },
        },
        {
            type: "line",
            config: {
                data: [{ x: 1, VER: 70 }, { x: 2, VER: 71 }],
                series: ["VER"], xAxisLabel: "Lap", yAxisLabel: "Time", unit: "s",
            },
        },
        {
            type: "area",
            config: {
                data: [{ x: 1, VER: 70 }],
                series: ["VER"], xAxisLabel: "Lap", yAxisLabel: "Time", unit: "s",
            },
        },
        {
            type: "telemetry_multi",
            config: {
                data: [{ x: 0, speed: 100 }, { x: 10, speed: 200 }],
                series: ["speed"], xAxisLabel: "Distance (m)", yAxisLabel: "Speed", unit: "km/h",
            },
        },
        {
            type: "scatter",
            config: {
                data: [{ key: "VER", x: 1, y: 1, group: "VER" }],
                xAxisLabel: "Grid", yAxisLabel: "Finish", unit: "pos", intent: "qualifying_vs_result",
            },
        },
        {
            type: "stacked_bar",
            config: {
                data: [{ category: "VER", SOFT: 10 }],
                series: ["SOFT"], xAxisLabel: "Driver", yAxisLabel: "Laps", unit: "laps",
            },
        },
        {
            type: "swarm",
            config: {
                data: [
                    { driver: "VER", lap: 1, value: 92.5 },
                    { driver: "NOR", lap: 1, value: 93.0 },
                ],
                xAxisLabel: "Driver", yAxisLabel: "Lap time", unit: "s",
            },
        },
        {
            type: "bump",
            config: {
                data: [{ x: 1, VER: 1, NOR: 2 }, { x: 2, VER: 1, NOR: 3 }],
                series: ["VER", "NOR"], xAxisLabel: "Round", yAxisLabel: "Position", unit: "pos",
            },
        },
        {
            type: "dumbbell",
            config: {
                data: [{ category: "VER", left: 70, right: 69, delta: -1 }],
                xAxisLabel: "Time", yAxisLabel: "Driver", unit: "s",
            },
        },
        {
            type: "box_plot",
            config: {
                data: [{ category: "VER", min: 69, q1: 70, median: 70.5, q3: 71, max: 72 }],
                xAxisLabel: "Time", yAxisLabel: "Driver", unit: "s",
            },
        },
        {
            type: "histogram",
            config: {
                data: [{ bin: "70-71", count: 5 }],
                xAxisLabel: "Bin", yAxisLabel: "Count", unit: "",
            },
        },
        {
            type: "kpi",
            config: { data: [{ key: "Wins", value: 19 }], unit: "count" },
        },
        {
            type: "heatmap",
            config: { data: [], xAxisLabel: "X", yAxisLabel: "Y", unit: "" },
        },
    ];

    it.each(cases.map((c) => [c.type] as const))("passes through %s", (type) => {
        const spec = makeSpec({ id: `deep_${type}`, type, config: cases.find((c) => c.type === type)!.config });
        const out = resolveInlineChartSpecs({ chartSpecs: [spec], query: "q" });
        expect(out).toHaveLength(1);
        expect(out[0]?.type).toBe(type);
    });

    it("keeps multi-chart order stable", () => {
        const specs = [
            makeSpec({ id: "a", type: "line", config: { data: [{ x: 1 }] } }),
            makeSpec({ id: "b", type: "scatter", config: { data: [{ x: 1, y: 1 }] } }),
            makeSpec({ id: "c", type: "kpi", config: { data: [{ key: "K", value: 1 }] } }),
        ];
        expect(resolveInlineChartSpecs({ chartSpecs: specs }).map((s) => s.id)).toEqual(["a", "b", "c"]);
    });
});

// =============================================================================
// E. Wiring — no panel leftovers
// =============================================================================

describe("inline wiring", () => {
    it("message-bubble renders InlineCharts (no Show Chart / panel state)", () => {
        const source = readSource("components/chat/message-bubble.tsx");
        expect(source).toMatch(/InlineCharts/);
        expect(source).toMatch(/import\("@\/components\/visualization\/inline-charts"\)/);
        expect(source).toMatch(/<InlineCharts/);
        expect(source).toMatch(/messageId=\{message\.id\}/);
        expect(source).toMatch(/chartSpecs=\{message\.chartSpecs\}/);
        expect(source).toMatch(/visualizationData=\{message\.visualizationData\}/);
        expect(source).toMatch(/query=\{userQuery\}/);
        expect(source).not.toMatch(/handleShowChart/);
        expect(source).not.toMatch(/setActiveMessageId/);
        expect(source).not.toMatch(/Show Chart/);
        expect(source).not.toMatch(/BrainCircuit/);
        expect(source).not.toMatch(/setVisualizationData/);
        expect(source).not.toMatch(/toggleVisualizationCollapse/);
    });

    it("message-list derives per-message userQuery + scoped isStreaming", () => {
        const source = readSource("components/chat/message-list.tsx");
        expect(source).toMatch(/userQueryById/);
        expect(source).toMatch(/userQuery=\{/);
        expect(source).toMatch(/isStreaming=\{isLoading && isLastAssistant\}/);
    });

    it("inline-charts always renders (no toggle) + handles streaming/empty/multi", () => {
        const source = readSource("components/visualization/inline-charts.tsx");
        expect(source).not.toMatch(/visualizeEnabled/);
        expect(source).toMatch(/resolveInlineChartSpecs/);
        expect(source).toMatch(/inline-charts-loading/);
        expect(source).toMatch(/data-chart-type/);
        expect(source).toMatch(/ChartDispatcher/);
        expect(source).toMatch(/dynamic\(/);
    });

    it("charts never precede the response text", () => {
        const inline = readSource("components/visualization/inline-charts.tsx");
        expect(inline).toMatch(/contentStarted/);
        expect(inline).toMatch(/isStreaming && !contentStarted/);
        const bubble = readSource("components/chat/message-bubble.tsx");
        expect(bubble).toMatch(/contentStarted=\{message\.content\.trim\(\)\.length > 0\}/);
    });

    it("chat-shell has no side panel reserve", () => {
        const source = readSource("components/chat/chat-shell.tsx");
        expect(source).not.toMatch(/VisualizationPanel/);
        expect(source).not.toMatch(/visualizationWidth/);
        expect(source).not.toMatch(/isVisualizationCollapsed/);
        expect(source).not.toMatch(/paddingRight/);
        expect(source).not.toMatch(/activeMessageId/);
    });

    it("chat handler writes per-message data only (no toggle, no panel)", () => {
        const source = readSource("lib/hooks/use-chat-handler.ts");
        expect(source).toMatch(/updateMessageVisualization\(assistantMsgId/);
        expect(source).toMatch(/setResearchChartSpecs\(assistantMsgId/);
        expect(source).not.toMatch(/visualizeEnabled/);
        expect(source).not.toMatch(/isChartablePayload/);
        expect(source).not.toMatch(/setVisualizationData/);
        expect(source).not.toMatch(/setActiveMessageId/);
    });

    it("control-panel has a sliding Deep switch with On/Off status", () => {
        const source = readSource("components/chat/control-panel.tsx");
        expect(source).not.toMatch(/visualizeEnabled/);
        expect(source).not.toMatch(/BarChart3/);
        expect(source).toMatch(/\? "On" : "Off"/);
        expect(source).not.toMatch(/Deep on/);
        expect(source).not.toMatch(/Deep off/);
        // Fixed-size track, sliding knob, outlines on active + hover.
        expect(source).toMatch(/w-\[76px\]/);
        expect(source).toMatch(/translate-x-\[44px\]/);
        expect(source).toMatch(/hover:outline/);
        expect(source).toMatch(/outline-purple-300\/60/);
        expect(source).toMatch(/deepResearchMode/);
    });
});
