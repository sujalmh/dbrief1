/**
 * Tests for the visualization-intelligence layer
 * ================================================
 *
 * Covers the deterministic data analyst pipeline that the
 * visualization planner relies on. These tests run without any LLM
 * call, so they're safe to run in any environment.
 */

import { describe, it, expect } from "vitest";
import {
    aggregateRows,
    buildLapProgression,
    buildDumbbell,
    detectIntents,
    findHighlight,
    buildChartSpec,
    validateChartSpec,
    selectChartType,
} from "@/lib/research/agents/visualization-intelligence";
import type { Evidence } from "@/lib/research/types";

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
    return {
        id: "E1",
        type: "qualifying",
        source: { tool: "get_qualifying", taskId: "T1", args: { year: 2024, gp: "Monaco" } },
        race: "Monaco",
        season: 2024,
        summary: "test",
        confidence: 0.9,
        timestamp: Date.now(),
        tags: [],
        data: { results: [] },
        ...overrides,
    };
}

describe("aggregateRows", () => {
    it("averages numeric values per group", () => {
        const rows = [
            { driver: "VER", time: 70.0 },
            { driver: "VER", time: 70.4 },
            { driver: "HAM", time: 71.0 },
            { driver: "HAM", time: 71.6 },
        ];
        const out = aggregateRows(rows, "driver", "time", "average");
        expect(out).toHaveLength(2);
        const ver = out.find((r) => r.key === "VER");
        const ham = out.find((r) => r.key === "HAM");
        expect(ver?.value).toBeCloseTo(70.2, 5);
        expect(ham?.value).toBeCloseTo(71.3, 5);
    });

    it("sorts ascending for time metrics", () => {
        const rows = [
            { driver: "VER", lap_time: "1:20.000" },
            { driver: "HAM", lap_time: "1:19.500" },
            { driver: "LEC", lap_time: "1:20.500" },
        ];
        const out = aggregateRows(rows, "driver", "lap_time", "average");
        // HAM should be first (fastest)
        expect(out[0]?.key).toBe("HAM");
    });

    it("sorts descending for ranking metrics", () => {
        const rows = [
            { driver: "VER", points: 100 },
            { driver: "HAM", points: 200 },
            { driver: "LEC", points: 50 },
        ];
        const out = aggregateRows(rows, "driver", "points", "sum");
        expect(out[0]?.key).toBe("HAM");
        expect(out[0]?.value).toBe(200);
    });

    it("truncates to topN and rolls the rest into 'Others'", () => {
        const rows = Array.from({ length: 15 }, (_, i) => ({
            driver: `D${i}`,
            points: 100 - i,
        }));
        const out = aggregateRows(rows, "driver", "points", "sum", { topN: 5 });
        // 5 + 1 'Others' = 6
        expect(out).toHaveLength(6);
        const others = out.find((r) => r.key === "Others");
        expect(others).toBeDefined();
        expect(others?.label).toContain("10 others");
    });

    it("returns [] for empty input", () => {
        expect(aggregateRows([], "driver", "time", "average")).toEqual([]);
    });
});

describe("buildLapProgression", () => {
    it("emits one row per lap with driver times", () => {
        const laps = [
            { driver: "VER", lap: 1, time: 70.0 },
            { driver: "VER", lap: 2, time: 70.5 },
            { driver: "HAM", lap: 1, time: 70.3 },
            { driver: "HAM", lap: 2, time: 70.8 },
        ];
        const out = buildLapProgression(laps, "driver", "lap", "time");
        expect(out).toHaveLength(2);
        expect(out[0]?.x).toBe(1);
        expect(out[0]?.VER).toBe(70.0);
        expect(out[0]?.HAM).toBe(70.3);
        expect(out[1]?.x).toBe(2);
    });

    it("applies moving average smoothing when requested", () => {
        const laps = Array.from({ length: 5 }, (_, i) => ({
            driver: "VER",
            lap: i + 1,
            time: 70 + (i % 2 === 0 ? 0 : 0.4), // 70, 70.4, 70, 70.4, 70
        }));
        const out = buildLapProgression(laps, "driver", "lap", "time", 1);
        // The middle laps should be smoothed, not exactly 70 or 70.4
        expect(out[1]?.VER).toBeCloseTo(70.133, 2);
    });
});

describe("buildDumbbell", () => {
    it("computes per-category left/right averages", () => {
        const rows = [
            { driver: "VER", season: "2023", value: 70.0 },
            { driver: "VER", season: "2024", value: 69.0 },
            { driver: "HAM", season: "2023", value: 70.5 },
            { driver: "HAM", season: "2024", value: 70.2 },
        ];
        const out = buildDumbbell(rows, "driver", "season", "2023", "2024");
        expect(out).toHaveLength(2);
        const ver = out.find((r) => r.category === "VER");
        expect(ver?.left).toBe(70.0);
        expect(ver?.right).toBe(69.0);
    });
});

describe("detectIntents", () => {
    it("detects qualifying pace intents", () => {
        const intents = detectIntents("Compare qualifying pace between VER and LEC");
        expect(intents).toContain("qualifying_pace");
    });

    it("detects tyre degradation", () => {
        const intents = detectIntents("How did the mediums degrade over the stint?");
        expect(intents).toContain("tyre_degradation");
        expect(intents).toContain("strategy_breakdown");
    });

    it("detects telemetry intents", () => {
        const intents = detectIntents("Show me the speed trace and throttle of VER");
        expect(intents).toContain("telemetry_compare");
        expect(intents).toContain("telemetry_single");
    });

    it("falls back to 'show' when no specific intent matches", () => {
        const intents = detectIntents("Tell me about F1");
        expect(intents).toContain("show");
    });
});

describe("findHighlight", () => {
    it("returns the highest value for 'max' mode", () => {
        const rows = [
            { key: "A", value: 10 },
            { key: "B", value: 20 },
            { key: "C", value: 5 },
        ];
        const result = findHighlight(rows, "max");
        expect(result?.key).toBe("B");
    });

    it("returns the lowest value for 'min' mode", () => {
        const rows = [
            { key: "A", value: 10 },
            { key: "B", value: 5 },
            { key: "C", value: 20 },
        ];
        const result = findHighlight(rows, "min");
        expect(result?.key).toBe("B");
    });
});

describe("selectChartType", () => {
    it("returns horizontal_bar for compare_drivers", () => {
        expect(selectChartType("compare_drivers", 5)).toBe("horizontal_bar");
    });

    it("returns line for lap_progression", () => {
        expect(selectChartType("lap_progression", 2)).toBe("line");
    });

    it("returns scatter for qualifying_vs_result", () => {
        expect(selectChartType("qualifying_vs_result", 10)).toBe("scatter");
    });
});

describe("buildChartSpec", () => {
    it("produces a valid ChartSpec for qualifying pace", () => {
        const evidence = makeEvidence({
            data: {
                results: [
                    { driver: "VER", q3: "1:19.000" },
                    { driver: "HAM", q3: "1:19.300" },
                    { driver: "LEC", q3: "1:19.500" },
                ],
            },
        });
        const rows = (evidence.data as { results: Array<Record<string, unknown>> }).results;
        const spec = buildChartSpec({
            intent: "qualifying_pace",
            objective: "Compare qualifying pace",
            evidence,
            data: rows,
            xKey: "driver",
            yKey: "q3",
        });
        expect(spec.type).toBe("horizontal_bar");
        // Title should mention the metric and the race/year context
        expect(spec.title).toMatch(/qualifying time/i);
        expect(spec.title).toContain("2024");
        const { ok, reasons } = validateChartSpec(spec);
        expect(ok).toBe(true);
        expect(reasons).toEqual([]);
    });

    it("rejects specs with no data after aggregation", () => {
        const evidence = makeEvidence({
            data: { results: [] },
        });
        const spec = buildChartSpec({
            intent: "qualifying_pace",
            objective: "test",
            evidence,
            data: [],
            xKey: "driver",
            yKey: "q3",
        });
        const { ok } = validateChartSpec(spec);
        expect(ok).toBe(false);
    });
});

describe("validateChartSpec", () => {
    it("rejects generic titles", () => {
        const result = validateChartSpec({
            id: "x",
            type: "line",
            title: "Value",
            dataSource: "E1",
            xField: "x",
            yField: "y",
            config: { data: [{ key: "A", value: 1 }] },
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes("Generic title"))).toBe(true);
    });

    it("rejects duplicate categories", () => {
        const result = validateChartSpec({
            id: "x",
            type: "bar",
            title: "Driver comparison",
            dataSource: "E1",
            xField: "driver",
            yField: "value",
            config: {
                data: [
                    { key: "VER", value: 1 },
                    { key: "VER", value: 2 },
                ],
            },
        });
        expect(result.ok).toBe(false);
        expect(result.reasons.some((r) => r.includes("Duplicate"))).toBe(true);
    });

    it("accepts a well-formed spec", () => {
        const result = validateChartSpec({
            id: "x",
            type: "horizontal_bar",
            title: "Average qualifying position (2024)",
            dataSource: "E1",
            xField: "driver",
            yField: "value",
            config: {
                data: [
                    { key: "VER", value: 1 },
                    { key: "HAM", value: 2 },
                ],
            },
        });
        expect(result.ok).toBe(true);
    });
});
