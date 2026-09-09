/**
 * Tests for the smart-aggregator (standard-mode visualization synthesizer)
 * ======================================================================
 *
 * The smart-aggregator takes raw tool results (the kind the standard
 * chat endpoint emits) and produces ChartSpec[] without calling an LLM.
 * It is the standard-mode counterpart to the deep-research planner.
 */

import { describe, it, expect } from "vitest";
import { synthesizeChartSpecs, detectFocus } from "@/lib/visualization/smart-aggregator";

describe("detectFocus", () => {
    it("finds 3-letter driver codes in the query", () => {
        expect(detectFocus("Compare VER and HAM")).toEqual(["VER", "HAM"]);
    });

    it("returns empty for a query with no driver codes", () => {
        expect(detectFocus("How was the race?")).toEqual([]);
    });

    it("is case-insensitive", () => {
        expect(detectFocus("ver vs pia")).toEqual(["VER", "PIA"]);
    });

    it("deduplicates", () => {
        expect(detectFocus("VER and VER again")).toEqual(["VER"]);
    });
});

describe("synthesizeChartSpecs", () => {
    it("returns [] for empty results", () => {
        expect(synthesizeChartSpecs([], "anything")).toEqual([]);
    });

    it("skips failed tool results", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_qualifying",
                    args: { year: 2024, gp: "Monaco" },
                    success: false,
                    data: null,
                },
            ],
            "test"
        );
        expect(specs).toEqual([]);
    });

    it("synthesizes a horizontal bar chart for qualifying results", () => {
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
            "Monaco qualifying"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0];
        expect(spec?.type).toBe("horizontal_bar");
        expect(spec?.title).toContain("Qualifying");
        expect(spec?.title).toContain("2024");
        // After top-N aggregation, the data has 3 driver rows; sort
        // is descending by value (Lec 79.7s, Ham 79.5s, Ver 79.0s)
        // because q3 isn't classified as a time metric. We just check
        // the rows are present and well-formed.
        const data = (spec?.config as { data: Array<{ key: string; value: number }> }).data;
        expect(data).toHaveLength(3);
        const ver = data.find((d) => d.key === "VER");
        const ham = data.find((d) => d.key === "HAM");
        const lec = data.find((d) => d.key === "LEC");
        expect(ver?.value).toBeCloseTo(79, 3);
        expect(ham?.value).toBeCloseTo(79.5, 3);
        expect(lec?.value).toBeCloseTo(79.7, 3);
        // Units + axis labels present
        const cfg = spec?.config as { xAxisLabel?: string; yAxisLabel?: string; unit?: string };
        expect(cfg.xAxisLabel).toBeTruthy();
        expect(cfg.yAxisLabel).toBe("Driver");
        expect(cfg.unit).toBe("s");
    });

    it("synthesizes a scatter chart for grid vs finish", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_race",
                    args: { year: 2024, gp: "Monaco" },
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
            "race results"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0];
        expect(spec?.type).toBe("scatter");
        const data = (spec?.config as { data: Array<{ x: number; y: number; group: string }> }).data;
        expect(data).toHaveLength(3);
        expect(data[0]?.x).toBe(1);
        expect(data[0]?.y).toBe(1);
    });

    it("synthesizes a line chart for telemetry", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_telemetry",
                    args: { year: 2024, gp: "Monaco", driver: "VER" },
                    success: true,
                    data: {
                        data: [
                            { Distance: 0, Speed: 100, Throttle: 50, Brake: 0 },
                            { Distance: 50, Speed: 250, Throttle: 100, Brake: 0 },
                        ],
                    },
                },
            ],
            "telemetry"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0];
        expect(spec?.type).toBe("line");
        const cfg = spec?.config as { xAxisLabel?: string; unit?: string };
        expect(cfg.xAxisLabel).toBe("Distance (m)");
        expect(cfg.unit).toBe("km/h");
    });

    it("synthesizes a standings horizontal bar", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_driver_standings",
                    args: { year: 2024 },
                    success: true,
                    data: {
                        standings: [
                            { driver: "VER", points: 437 },
                            { driver: "HAM", points: 374 },
                            { driver: "LEC", points: 356 },
                        ],
                    },
                },
            ],
            "final standings"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0];
        expect(spec?.type).toBe("horizontal_bar");
        const cfg = spec?.config as { unit?: string };
        expect(cfg.unit).toBe("pts");
    });

    it("respects top-N aggregation for many drivers", () => {
        const results = Array.from({ length: 25 }, (_, i) => ({
            driver: `D${i}`,
            q3: `1:2${i.toString().padStart(2, "0")}.000`,
        }));
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_qualifying",
                    args: { year: 2024, gp: "Monaco" },
                    success: true,
                    data: { results },
                },
            ],
            "test"
        );
        const data = (specs[0]?.config as { data: Array<{ key: string }> }).data;
        // Top 20 + Others = 21
        expect(data.length).toBeLessThanOrEqual(21);
        expect(data.some((d) => d.key === "Others")).toBe(true);
    });

    it("marks focus drivers in subtitles", () => {
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
                        ],
                    },
                },
            ],
            "Compare VER and HAM"
        );
        const subtitle = (specs[0]?.config as { data?: unknown }).data
            ? (specs[0] as { subtitle?: string }).subtitle
            : undefined;
        expect(subtitle).toContain("VER");
    });
});
