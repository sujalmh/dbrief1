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
        // HAM moved to Ferrari: learned data beats the static Mercedes map.
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
});
