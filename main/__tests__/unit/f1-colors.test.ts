/**
 * Tests for data-driven driver/team colors.
 * =========================================
 * The static grid is only a fallback: colors learned from live API
 * payloads (Abbreviation + TeamName + TeamColor rows) must win, invalid
 * data must be ignored, and season-tagged entries must be preferred for
 * their season.
 */

import { describe, it, expect } from "vitest";
import {
    getDriverColor,
    learnColorsFromPayload,
    resolveTeamColor,
    getDriverPattern,
    seasonFromPayload,
} from "@/lib/f1-colors";

const results2025 = [
    {
        tool: "get_race",
        args: { year: 2025, gp: "Monaco", session: "R" },
        success: true,
        data: {
            results: [
                { Abbreviation: "HAM", FullName: "Lewis Hamilton", TeamName: "Ferrari", TeamColor: "e8002d" },
                { Abbreviation: "LEC", FullName: "Charles Leclerc", TeamName: "Ferrari", TeamColor: "E8002D" },
                { Abbreviation: "VER", FullName: "Max Verstappen", TeamName: "Red Bull Racing", TeamColor: "3671C6" },
            ],
        },
    },
];

describe("f1-colors learned registry", () => {
    it("learns driver colors from results payloads (hash-less hex normalized)", () => {
        expect(learnColorsFromPayload(results2025)).toBeGreaterThan(0);
        // HAM is Ferrari in the static 2025 grid too — live data agrees.
        expect(getDriverColor("HAM")).toBe("#E8002D");
        expect(getDriverColor("Lewis Hamilton")).toBe("#E8002D");
        expect(getDriverColor("VER", 2025)).toBe("#3671C6");
    });

    it("resolves team colors with learned priority", () => {
        learnColorsFromPayload(results2025);
        expect(resolveTeamColor("Ferrari")).toBe("#E8002D");
        // Static fallback still works for unseen teams.
        expect(resolveTeamColor("McLaren")).toBe("#FF8700");
        expect(resolveTeamColor(undefined)).toBeNull();
    });

    it("keeps static fallback for drivers never seen live", () => {
        expect(getDriverColor("NOR")).toBe("#FF8700");
        expect(getDriverColor("Lando Norris")).toBe("#FF8700");
    });

    it("returns white for unknown drivers and empty input", () => {
        expect(getDriverColor("XYZ")).toBe("#FFFFFF");
        expect(getDriverColor("")).toBe("#FFFFFF");
    });

    it("ignores rows with missing/invalid colors", () => {
        const before = getDriverColor("ALO");
        const learned = learnColorsFromPayload([
            { Abbreviation: "ALO", TeamName: "Aston Martin", TeamColor: "not-a-color" },
            { Abbreviation: "STR" },
        ]);
        expect(learned).toBe(0);
        expect(getDriverColor("ALO")).toBe(before);
    });

    it("extracts season from envelope args", () => {
        expect(seasonFromPayload(results2025)).toBe(2025);
        expect(seasonFromPayload([{ tool: "x", args: {}, success: true, data: {} }])).toBeUndefined();
        expect(seasonFromPayload(null)).toBeUndefined();
    });

    it("highlight pattern includes learned codes", () => {
        learnColorsFromPayload(results2025);
        const pattern = getDriverPattern();
        expect("HAM".split(pattern)).toHaveLength(3); // ["", "HAM", ""]
        expect("VER".split(pattern)).toHaveLength(3);
    });

    it("highlights 2025-grid codes from the static baseline", () => {
        const pattern = getDriverPattern();
        for (const code of ["ANT", "BEA", "BOR", "HAD", "LAW", "COL"]) {
            expect(code.split(pattern)).toHaveLength(3);
        }
    });
});

describe("f1-colors per-season registry (swaps + new drivers)", () => {
    const tsu2024 = [
        {
            tool: "get_race",
            args: { year: 2024, gp: "Monza" },
            success: true,
            data: {
                results: [
                    { Abbreviation: "TSU", FullName: "Yuki Tsunoda", TeamName: "RB", TeamColor: "6692ff" },
                ],
            },
        },
    ];

    it("prefers the exact season after a mid-season swap", () => {
        expect(learnColorsFromPayload(tsu2024)).toBeGreaterThan(0);
        // 2024 seat was RB blue; static 2025 says Red Bull navy.
        expect(getDriverColor("TSU", 2024)).toBe("#6692FF");
        expect(getDriverColor("Yuki Tsunoda", 2024)).toBe("#6692FF");
    });

    it("latest observed seat beats the stale static grid (no season)", () => {
        learnColorsFromPayload(tsu2024);
        // No season asked: latest learned (RB) wins over static RBR.
        expect(getDriverColor("TSU")).toBe("#6692FF");
    });

    it("future seasons fall back to the latest seat, not stale static", () => {
        learnColorsFromPayload(tsu2024);
        expect(getDriverColor("TSU", 2026)).toBe("#6692FF");
    });

    it("learns new drivers on known teams even without a color key", () => {
        expect(
            learnColorsFromPayload([
                {
                    tool: "get_race",
                    args: { year: 2025, gp: "Monza" },
                    success: true,
                    data: {
                        results: [
                            { Abbreviation: "ANT", FullName: "Kimi Antonelli", TeamName: "Mercedes" },
                        ],
                    },
                },
            ])
        ).toBeGreaterThan(0);
        expect(getDriverColor("ANT")).toBe("#00D2BE");
        expect(getDriverColor("Kimi Antonelli", 2025)).toBe("#00D2BE");
        expect("ANT".split(getDriverPattern())).toHaveLength(3);
    });

    it("still ignores explicitly invalid colors", () => {
        const before = getDriverColor("TSU", 2024);
        const learned = learnColorsFromPayload([
            { Abbreviation: "TSU", TeamName: "RB", TeamColor: "not-a-color", args: { year: 2024 } },
        ]);
        expect(learned).toBe(0);
        expect(getDriverColor("TSU", 2024)).toBe(before);
    });
});
