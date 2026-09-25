/**
 * Tests for the per-message stats footer helpers (pure, no rendering)
 * =====================================================================
 * Covers: compact wall-clock duration formatting shown for both AI
 * modes in the UsageFooter.
 */

import { describe, it, expect } from "vitest";
import { fmtDuration } from "@/components/chat/usage-footer";

describe("fmtDuration", () => {
    it("keeps one decimal under 10s", () => {
        expect(fmtDuration(0)).toBe("0.0s");
        expect(fmtDuration(4213)).toBe("4.2s");
        expect(fmtDuration(9999)).toBe("10.0s");
    });

    it("rounds to whole seconds under a minute", () => {
        expect(fmtDuration(10000)).toBe("10s");
        expect(fmtDuration(45000)).toBe("45s");
    });

    it("switches to minutes and hours for long runs", () => {
        expect(fmtDuration(60000)).toBe("1m");
        expect(fmtDuration(150000)).toBe("2m 30s");
        expect(fmtDuration(3600000)).toBe("1h");
        expect(fmtDuration(5400000)).toBe("1h 30m");
    });

    it("rejects garbage instead of rendering it", () => {
        expect(fmtDuration(-5)).toBe("");
        expect(fmtDuration(NaN)).toBe("");
        expect(fmtDuration(Infinity)).toBe("");
    });
});
