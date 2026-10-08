/**
 * Response loading state (rotating pit-wall status lines).
 * ==========================================================
 * While the answer streams in, the bubble shows bouncing dots plus a
 * rotating status line — live pipeline text when available, F1-voiced
 * flavor lines otherwise. No emojis, no em dashes, complete sentences.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { LOADING_LINES, LOADING_LINE_INTERVAL_MS } from "@/components/chat/message-bubble";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("loading lines", () => {
    it("has a varied set of F1-voiced lines", () => {
        expect(LOADING_LINES.length).toBeGreaterThanOrEqual(6);
        expect(LOADING_LINES[0]).toMatch(/thinking/i);
    });

    it("uses house style (ellipsis endings, no emojis or em dashes)", () => {
        const emoji = /[🀀-🫿☀-➿⬀-⭿]/u;
        for (const line of LOADING_LINES) {
            expect(line.endsWith("…"), `"${line}"`).toBe(true);
            expect(line.includes("—"), `"${line}"`).toBe(false);
            expect(emoji.test(line), `"${line}"`).toBe(false);
            expect(line.length, `"${line}"`).toBeLessThanOrEqual(60);
        }
    });

    it("rotates on a calm interval", () => {
        expect(LOADING_LINE_INTERVAL_MS).toBeGreaterThanOrEqual(1500);
        expect(LOADING_LINE_INTERVAL_MS).toBeLessThanOrEqual(4000);
    });
});

describe("loading block wiring", () => {
    const source = readSource("components/chat/message-bubble.tsx");

    it("rotates flavor only when no live pipeline status exists", () => {
        expect(source).toMatch(/LOADING_LINES\[flavorIndex % LOADING_LINES\.length\]/);
        expect(source).toMatch(/statusLine \?\? LOADING_LINES/);
        expect(source).toMatch(/setInterval/);
        expect(source).toMatch(/LOADING_LINE_INTERVAL_MS/);
    });

    it("animates with bouncing dots and a polite live region", () => {
        expect(source).toMatch(/animate-bounce/);
        expect(source).toMatch(/animationDelay/);
        expect(source).toMatch(/aria-live="polite"/);
    });

    it("has no awaiting graph or static placeholder left", () => {
        expect(source).not.toMatch(/RadioWave/);
        expect(source).not.toMatch(/AWAITING DATA/);
        expect(existsSync(join(process.cwd(), "components/chat/radio-wave.tsx"))).toBe(false);
    });
});
