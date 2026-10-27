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

    it("synthesizes a scatter chart for grid-gain questions", () => {
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
            "who gained positions in the race"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0];
        expect(spec?.type).toBe("scatter");
        const data = (spec?.config as { data: Array<{ x: number; y: number; group: string }> }).data;
        expect(data).toHaveLength(3);
        expect(data[0]?.x).toBe(1);
        expect(data[0]?.y).toBe(1);
    });

    it("synthesizes a classification ladder for plain results questions", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_race",
                    args: { year: 2024, gp: "Monaco" },
                    success: true,
                    data: {
                        results: [
                            { driver: "VER", grid: 1, finish: 1, team: "Red Bull" },
                            { driver: "HAM", grid: 5, finish: 2, team: "Mercedes" },
                            { driver: "LEC", grid: 3, finish: 4, team: "Ferrari" },
                        ],
                    },
                },
            ],
            "race results"
        );
        expect(specs).toHaveLength(1);
        const spec = specs[0];
        expect(spec?.type).toBe("position_ladder");
        expect(spec?.title).toContain("Finishing Order");
        const rows = (spec?.config as {
            data: Array<{ position: number; driver: string; grid?: number; team?: string }>;
            unit?: string;
        }).data;
        expect(rows.map((d) => d.driver)).toEqual(["VER", "HAM", "LEC"]);
        expect(rows[1]).toMatchObject({ position: 2, driver: "HAM", grid: 5, team: "Mercedes" });
    });

    it("maps FastAPI race rows to the classification ladder", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_race",
                args: { year: 2026, gp: "United States Grand Prix", session: "R" },
                success: true,
                data: {
                    results: [
                        { Abbreviation: "ANT", GridPosition: 1, Position: 1, GapToLeader: "0.000", PositionsGained: 0, TeamName: "Mercedes" },
                        { Abbreviation: "LEC", GridPosition: 4, Position: 2, GapToLeader: "+13.078", PositionsGained: 2, TeamName: "Ferrari" },
                        { Abbreviation: "VER", GridPosition: 2, Position: 3, GapToLeader: "+17.485", PositionsGained: -1, TeamName: "Red Bull" },
                    ],
                },
            }],
            "race results"
        );
        expect(specs.map((s) => s.type)).toEqual(["position_ladder"]);
        const rows = (specs[0]?.config as {
            data: Array<{ position: number; driver: string; grid?: number; team?: string; gap?: string; gained?: number }>;
        }).data;
        expect(rows[0]).toMatchObject({ position: 1, driver: "ANT", grid: 1, team: "Mercedes", gap: "0.000", gained: 0 });
        expect(rows[1]).toMatchObject({ position: 2, driver: "LEC", grid: 4, team: "Ferrari", gap: "+13.078", gained: 2 });
    });

    it("falls back to a position ladder when grid positions are missing", () => {
        const specs = synthesizeChartSpecs(
            [
                {
                    tool: "get_race",
                    args: { year: 2024, gp: "Monaco" },
                    success: true,
                    data: {
                        results: [
                            { driver: "VER", finish: 1, team: "Red Bull" },
                            { driver: "HAM", finish: 2, team: "Mercedes" },
                            { driver: "LEC", finish: 3, team: "Ferrari" },
                        ],
                    },
                },
            ],
            "race results"
        );
        expect(specs.map((s) => s.type)).toEqual(["position_ladder"]);
        const cfg = specs[0]?.config as { data: Array<{ driver: string; position: number }> };
        expect(cfg.data.map((d) => d.driver)).toEqual(["VER", "HAM", "LEC"]);
    });

    it("skips non-chartable tools (schedule, search, regulations)", () => {
        expect(
            synthesizeChartSpecs(
                [{
                    tool: "get_events", args: { year: 2026 }, success: true,
                    data: { events: [{ round_number: 1, event_name: "Bahrain GP" }] },
                }],
                "last race summary"
            )
        ).toEqual([]);
        expect(
            synthesizeChartSpecs(
                [{
                    tool: "web_search", args: { query: "x" }, success: true,
                    data: { results: [{ title: "t", url: "u", snippet: "s" }] },
                }],
                "last race summary"
            )
        ).toEqual([]);
        expect(
            synthesizeChartSpecs(
                [{
                    tool: "retrieve_regulations", args: {}, success: true,
                    data: { retrieved_documents: [{ title: "t", text: "x" }] },
                }],
                "what does the rule say"
            )
        ).toEqual([]);
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
        // One question-shaped chart, not a bar + pie + cards from the same rows.
        expect(specs).toHaveLength(1);
        const spec = specs[0];
        expect(spec?.type).toBe("horizontal_bar");
        const cfg = spec?.config as { unit?: string };
        expect(cfg.unit).toBe("pts");
    });

    it("uses wins when the question asks about wins", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_driver_standings",
                args: { year: 2024 },
                success: true,
                data: { standings: [{ driver: "VER", points: 437, wins: 9 }, { driver: "NOR", points: 374, wins: 4 }] },
            }],
            "who has the most wins"
        );
        expect(specs).toHaveLength(1);
        expect(specs[0]?.title).toContain("Wins");
        expect((specs[0]?.config as { unit?: string }).unit).toBe("wins");
    });

    it("uses points gap when the question asks about the gap", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_driver_standings",
                args: { year: 2026 },
                success: true,
                data: {
                    standings: [
                        { driver: "ANT", points: 365, points_gap_to_leader: 0 },
                        { driver: "RUS", points: 242, points_gap_to_leader: 123 },
                        { driver: "HAM", points: 241, points_gap_to_leader: 124 },
                    ],
                },
            }],
            "what is the points gap to the leader"
        );
        expect(specs).toHaveLength(1);
        expect(specs[0]?.title).toContain("Points Gap");
        const rows = (specs[0]?.config as { data: Array<{ key: string; value: number }> }).data;
        expect(rows.map((r) => r.value)).toEqual([0, 123, 124]);
    });

    it("deduplicates the same chart coming from duplicate tool results", () => {
        const result = {
            tool: "get_driver_standings",
            args: { year: 2024 },
            success: true,
            data: { standings: [{ driver: "VER", points: 437 }, { driver: "NOR", points: 374 }] },
        };
        const specs = synthesizeChartSpecs([result, result], "standings");
        expect(specs).toHaveLength(1);
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

    it("caps standings charts at the top 10 without an Others bar", () => {
        const standings = Array.from({ length: 15 }, (_, i) => ({
            driver: `D${i}`,
            points: 200 - i * 10,
        }));
        const specs = synthesizeChartSpecs(
            [{ tool: "get_driver_standings", args: { year: 2024 }, success: true, data: { standings } }],
            "standings"
        );
        const rows = (specs[0]?.config as { data: Array<{ key: string }> }).data;
        expect(rows).toHaveLength(10);
        expect(rows.some((r) => r.key === "Others")).toBe(false);
    });

    it("two-driver pace comparison uses a best-vs-average dumbbell", () => {
        const specs = synthesizeChartSpecs(
            [{
                tool: "get_laps",
                args: { year: 2024, gp: "Suzuka" },
                success: true,
                data: {
                    laps: [
                        { driver: "VER", lap_time: "1:32.8" },
                        { driver: "VER", lap_time: "1:32.6" },
                        { driver: "VER", lap_time: "1:32.4" },
                        { driver: "NOR", lap_time: "1:33.2" },
                        { driver: "NOR", lap_time: "1:33.0" },
                        { driver: "NOR", lap_time: "1:32.9" },
                    ],
                },
            }],
            "compare VER and NOR pace"
        );
        expect(specs.map((s) => s.type)).toEqual(["dumbbell"]);
        const cfg = specs[0]?.config as {
            data: Array<{ category: string; left: number; right: number; delta: number }>;
            leftLabel?: string;
            rightLabel?: string;
        };
        expect(cfg.leftLabel).toBe("Best");
        expect(cfg.rightLabel).toBe("Average");
        expect(cfg.data[0]?.category).toBe("VER");
        expect(cfg.data[0]?.left).toBeCloseTo(92.4, 1);
        expect(cfg.data[0]?.right).toBeCloseTo(92.6, 1);
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
