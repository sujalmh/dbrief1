/**
 * Placeholder Argument Guard Tests
 * ================================
 * The FastF1 backend fuzzy-matches unknown GP strings to *some* event
 * instead of failing, so placeholder args (e.g. gp="LAST_COMPLETED_GP",
 * observed in production) must fail closed before execution.
 */

import { describe, it, expect } from "vitest";
import { isPlaceholderLike, findPlaceholderArg, placeholderError } from "@/lib/args-guard";

describe("isPlaceholderLike", () => {
    it("flags the production placeholder", () => {
        expect(isPlaceholderLike("gp", "LAST_COMPLETED_GP")).toBe(true);
    });

    it("flags recency/unknown keywords in structured fields", () => {
        expect(isPlaceholderLike("gp", "latest")).toBe(true);
        expect(isPlaceholderLike("gp", "Last Race")).toBe(true);
        expect(isPlaceholderLike("gp", "TBD")).toBe(true);
        expect(isPlaceholderLike("driver", "unknown")).toBe(true);
        expect(isPlaceholderLike("session", "current")).toBe(true);
    });

    it("flags bare ALL-CAPS tokens (len>=4) in structured fields", () => {
        expect(isPlaceholderLike("gp", "SOMETHING")).toBe(true);
    });

    it("allows legitimate values", () => {
        // Real GP names (mixed case)
        expect(isPlaceholderLike("gp", "Abu Dhabi")).toBe(false);
        expect(isPlaceholderLike("gp", "Monaco")).toBe(false);
        expect(isPlaceholderLike("gp", "São Paulo")).toBe(false);
        // Driver codes (3-letter caps)
        expect(isPlaceholderLike("driver", "VER")).toBe(false);
        expect(isPlaceholderLike("driver", "ANT")).toBe(false);
        // Session codes + compounds (allowlisted caps)
        expect(isPlaceholderLike("session", "R")).toBe(false);
        expect(isPlaceholderLike("session", "FP1")).toBe(false);
        expect(isPlaceholderLike("session", "Q")).toBe(false);
        expect(isPlaceholderLike("compound", "SOFT")).toBe(false);
        // Free-text queries are only flagged for extreme snake tokens
        expect(isPlaceholderLike("query", "who won the last race")).toBe(false);
        expect(isPlaceholderLike("query", "2026 Spanish Grand Prix winner")).toBe(false);
        expect(isPlaceholderLike("query", "LAST_COMPLETED_GP")).toBe(true);
    });
});

describe("findPlaceholderArg", () => {
    it("finds nested placeholder args with dotted paths", () => {
        expect(findPlaceholderArg({ year: 2026, gp: "LAST_COMPLETED_GP", session: "R" }))
            .toEqual({ path: "gp", value: "LAST_COMPLETED_GP" });
    });

    it("returns null for clean args", () => {
        expect(findPlaceholderArg({ year: 2026, gp: "Spain", session: "R", driver: "VER" })).toBeNull();
        expect(findPlaceholderArg({})).toBeNull();
        expect(findPlaceholderArg(null)).toBeNull();
    });

    it("scans arrays", () => {
        expect(findPlaceholderArg({ urls: ["https://example.com", "LATEST_NEWS_URL"] })?.path)
            .toBe("urls[1]");
    });
});

describe("placeholderError", () => {
    it("names the tool, path, and remediation", () => {
        const msg = placeholderError("get_race", { path: "gp", value: "LAST_COMPLETED_GP" });
        expect(msg).toMatch(/Placeholder argument rejected/);
        expect(msg).toContain("get_race.gp");
        expect(msg).toContain("LAST_COMPLETED_GP");
        expect(msg).toContain("web_search");
    });
});
