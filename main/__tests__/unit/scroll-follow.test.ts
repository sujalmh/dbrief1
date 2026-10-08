/**
 * Scroll-follow model (pure helpers).
 * =====================================
 * Follow the live edge only while the reader is already at the bottom;
 * a pill jumps back with smooth motion. Motion is instant while
 * streaming and always instant under reduced-motion.
 */

import { describe, it, expect } from "vitest";
import {
    FOLLOW_END_BAND_PX,
    computeIsAtEnd,
    resolveJumpBehavior,
    shouldAutoFollow,
} from "@/lib/chat/scroll-follow";

describe("computeIsAtEnd", () => {
    it("is at end when content fits without scrolling", () => {
        expect(computeIsAtEnd({ scrollTop: 0, scrollHeight: 400, clientHeight: 800 })).toBe(true);
    });

    it("is at end exactly at the bottom", () => {
        expect(computeIsAtEnd({ scrollTop: 600, scrollHeight: 1400, clientHeight: 800 })).toBe(true);
    });

    it(`stays at end inside the ${FOLLOW_END_BAND_PX}px band`, () => {
        expect(
            computeIsAtEnd({ scrollTop: 600 - FOLLOW_END_BAND_PX, scrollHeight: 1400, clientHeight: 800 })
        ).toBe(true);
        expect(
            computeIsAtEnd({ scrollTop: 600 - FOLLOW_END_BAND_PX - 1, scrollHeight: 1400, clientHeight: 800 })
        ).toBe(false);
    });

    it("supports a custom band", () => {
        expect(computeIsAtEnd({ scrollTop: 0, scrollHeight: 2000, clientHeight: 800 }, 5000)).toBe(true);
    });
});

describe("resolveJumpBehavior", () => {
    it("is smooth for user jumps, instant while streaming", () => {
        expect(resolveJumpBehavior(false, false)).toBe("smooth");
        expect(resolveJumpBehavior(true, false)).toBe("auto");
    });

    it("is always instant under reduced motion", () => {
        expect(resolveJumpBehavior(false, true)).toBe("auto");
        expect(resolveJumpBehavior(true, true)).toBe("auto");
    });
});

describe("shouldAutoFollow", () => {
    it("follows only while loading at the end", () => {
        expect(shouldAutoFollow(true, true)).toBe(true);
        expect(shouldAutoFollow(true, false)).toBe(false);
        expect(shouldAutoFollow(false, true)).toBe(false);
        expect(shouldAutoFollow(false, false)).toBe(false);
    });
});
