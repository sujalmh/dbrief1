/**
 * Visualizations are produced (production path)
 * ==============================================
 *
 * Full pipeline check without any LLM call: executor-shaped tool results
 * → the exact `visualization` SSE payload shape the chat route builds →
 * spec resolution (the same code `InlineCharts` runs in chat).
 *
 * Every row asserts a query shape ENDS UP with rendered charts (or
 * correctly with none). If any link in this chain regresses, chartable
 * answers silently lose their charts — this file catches that.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { resolveInlineChartSpecs } from "@/lib/visualization/inline-specs";

interface ToolResult {
    tool: string;
    args: Record<string, unknown>;
    success: boolean;
    data: unknown;
    error?: string | null;
}

/**
 * Mirrors the payload mapping in app/api/chat/route.ts
 * (`visualizationPayload = executionContext.results.map(...)`).
 */
function toVisualizationPayload(results: ToolResult[]): unknown {
    return results.map((result) => ({
        tool: result.tool,
        args: result.args,
        success: result.success,
        data: result.data || null,
        error: result.error || null,
    }));
}

/** Full production path: results → payload → inline specs. */
function producedCharts(results: ToolResult[], query: string): string[] {
    const payload = toVisualizationPayload(results);
    return resolveInlineChartSpecs({ visualizationData: payload, query }).map((s) => s.type);
}

const ARGS_2024_MONZA = { year: 2024, gp: "Monza" };

describe("production path produces charts", () => {
    it("telemetry answers produce a line chart", () => {
        expect(
            producedCharts(
                [{
                    tool: "get_telemetry", args: { ...ARGS_2024_MONZA, driver: "VER" },
                    success: true,
                    data: { data: [{ Distance: 0, Speed: 120, Throttle: 100, Brake: 0 }, { Distance: 100, Speed: 280, Throttle: 100, Brake: 0 }] },
                }],
                "VER telemetry"
            )
        ).toEqual(["line"]);
    });

    it("multi-driver lap answers produce line + swarm", () => {
        const laps = [
            { lap_number: 1, lap_time: "1:32.8", driver: "VER" },
            { lap_number: 2, lap_time: "1:32.6", driver: "VER" },
            { lap_number: 1, lap_time: "1:33.2", driver: "NOR" },
            { lap_number: 2, lap_time: "1:33.0", driver: "NOR" },
        ];
        expect(
            producedCharts(
                [{ tool: "get_laps", args: { year: 2024, gp: "Suzuka" }, success: true, data: { laps } }],
                "compare VER and NOR"
            )
        ).toEqual(["line", "swarm"]);
    });

    it("lap answers with positions produce line + swarm + bump", () => {
        const laps = [
            { lap_number: 1, lap_time: "1:32.0", driver: "VER", position: 2 },
            { lap_number: 2, lap_time: "1:31.8", driver: "VER", position: 1 },
            { lap_number: 1, lap_time: "1:32.4", driver: "NOR", position: 1 },
            { lap_number: 2, lap_time: "1:32.1", driver: "NOR", position: 2 },
        ];
        expect(
            producedCharts(
                [{ tool: "get_laps", args: { year: 2024 }, success: true, data: { laps } }],
                "full race comparison"
            )
        ).toEqual(["line", "swarm", "bump"]);
    });

    it("standings answers produce a horizontal bar chart", () => {
        expect(
            producedCharts(
                [{
                    tool: "get_driver_standings", args: { year: 2024 }, success: true,
                    data: { standings: [{ driver: "VER", points: 437 }, { driver: "NOR", points: 374 }] },
                }],
                "2024 standings"
            )
        ).toEqual(["horizontal_bar"]);
    });

    it("qualifying answers produce a qualifying chart", () => {
        expect(
            producedCharts(
                [{
                    tool: "get_qualifying", args: ARGS_2024_MONZA, success: true,
                    data: { results: [{ driver: "VER", q3: "1:19.000" }, { driver: "NOR", q3: "1:19.500" }] },
                }],
                "Monza qualifying"
            )
        ).toEqual(["horizontal_bar"]);
    });

    it("race grid/finish answers produce a scatter chart", () => {
        expect(
            producedCharts(
                [{
                    tool: "get_race", args: ARGS_2024_MONZA, success: true,
                    data: { results: [{ driver: "VER", grid: 1, finish: 1 }, { driver: "NOR", grid: 4, finish: 2 }] },
                }],
                "who gained"
            )
        ).toEqual(["scatter"]);
    });

    it("plain race results produce a finishing-order bar, not a scatter", () => {
        expect(
            producedCharts(
                [{
                    tool: "get_race", args: ARGS_2024_MONZA, success: true,
                    data: { results: [{ driver: "VER", grid: 1, finish: 1 }, { driver: "NOR", grid: 4, finish: 2 }] },
                }],
                "Monza results"
            )
        ).toEqual(["horizontal_bar"]);
    });

    it("schedule and news answers produce no charts", () => {
        expect(
            producedCharts(
                [
                    {
                        tool: "get_events", args: { year: 2026 }, success: true,
                        data: { events: [{ round_number: 16, event_name: "Bahrain GP" }] },
                    },
                    {
                        tool: "web_search", args: { query: "x" }, success: true,
                        data: { results: [{ title: "t", url: "u", snippet: "s" }] },
                    },
                ],
                "last race summary"
            )
        ).toEqual([]);
    });

    it("tyre and stint answers produce a stacked bar chart", () => {
        const stints = {
            results: [
                { driver: "VER", compound: "SOFT", laps: 12 },
                { driver: "VER", compound: "MEDIUM", laps: 25 },
            ],
        };
        for (const tool of ["get_tyres", "get_stints"]) {
            expect(
                producedCharts(
                    [{ tool, args: { year: 2024, gp: "Bahrain" }, success: true, data: stints }],
                    "tyre strategy"
                )
            ).toEqual(["stacked_bar"]);
        }
    });

    it("round-by-round position answers produce a bump chart", () => {
        expect(
            producedCharts(
                [{
                    tool: "get_race", args: { year: 2024 }, success: true,
                    data: {
                        results: [
                            { round: 1, driver: "VER", position: 1 },
                            { round: 1, driver: "NOR", position: 3 },
                            { round: 2, driver: "VER", position: 1 },
                            { round: 2, driver: "NOR", position: 2 },
                        ],
                    },
                }],
                "standings progression"
            )
        ).toEqual(["bump"]);
    });

    it("deep-research chart_specs pass through untouched", () => {
        const specs = [
            {
                id: "deep_swarm", type: "swarm", title: "Pace - Suzuka", dataSource: "E1",
                xField: "driver", yField: "lap_time", config: { data: [{ driver: "VER", lap: 1, value: 92 }] },
            },
            {
                id: "deep_bump", type: "bump", title: "Progression - 2024", dataSource: "E2",
                xField: "x", yField: "VER", config: { data: [{ x: 1, VER: 1 }], series: ["VER"] },
            },
        ];
        const out = resolveInlineChartSpecs({
            chartSpecs: specs as Parameters<typeof resolveInlineChartSpecs>[0]["chartSpecs"],
            query: "q",
        });
        expect(out.map((s) => s.type)).toEqual(["swarm", "bump"]);
    });

    it("failed and empty results produce no charts (clean chat, no crash)", () => {
        expect(
            producedCharts(
                [{ tool: "get_laps", args: {}, success: false, data: null, error: "boom" }],
                "laps"
            )
        ).toEqual([]);
        expect(producedCharts([], "anything")).toEqual([]);
        expect(
            producedCharts(
                [{ tool: "get_telemetry", args: {}, success: true, data: { data: [] } }],
                "telemetry"
            )
        ).toEqual([]);
    });

    it("route emits the visualization payload in the shape InlineCharts reads", () => {
        const source = readFileSync(join(process.cwd(), "app/api/chat/route.ts"), "utf8");
        // The mapping must keep tool/args/success/data for synthesis.
        expect(source).toMatch(/tool: result\.tool/);
        expect(source).toMatch(/args: result\.args/);
        expect(source).toMatch(/success: result\.success/);
        expect(source).toMatch(/sendEvent\("visualization", \{ data: visualizationPayload \}\)/);
        // Deep path forwards chart specs + visualization payload.
        expect(source).toMatch(/sendEvent\("chart_specs", \{ specs: ev\.specs \}\)/);
        expect(source).toMatch(/sendEvent\("visualization", \{ data: ev\.data \}\)/);
    });
});
