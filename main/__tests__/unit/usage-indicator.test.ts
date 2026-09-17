/**
 * Tests for the subtle sidebar usage indicator.
 * ============================================
 * Follows repo convention (source-contract tests, no DOM renderer):
 * the indicator must live on the profile avatar, stay invisible until
 * data loads, and surface the same numbers the quota API returns.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sidebar = readFileSync(join(process.cwd(), "components/layout/sidebar.tsx"), "utf8");
const indicator = readFileSync(join(process.cwd(), "components/layout/usage-indicator.tsx"), "utf8");

describe("usage indicator placement (subtle, near profile)", () => {
    it("renders inside the profile avatar block", () => {
        expect(sidebar).toMatch(/<UsageIndicator \/>/);
        // Avatar wrapper must be positioned so the dot can anchor to it.
        expect(sidebar).toMatch(/relative h-8 w-8 rounded-full/);
    });

    it("is invisible until quota data loads", () => {
        expect(indicator).toMatch(/if \(!quota \|\| !user\) return null/);
    });

    it("hides entirely when cloud sync is unavailable", () => {
        expect(indicator).toMatch(/if \(!user \|\| !cloudReady\)/);
    });
});

describe("usage indicator content (hover card)", () => {
    it("shows per-feature used-vs-cap rows with reset timing", () => {
        for (const row of ["Chats", "Deep research", "Simulations", "Tokens out"]) {
            expect(indicator).toContain(row);
        }
        expect(indicator).toMatch(/Resets in/);
    });

    it("calls out the shared network only when it binds", () => {
        expect(indicator).toMatch(/networkBinding/);
        expect(indicator).toMatch(/Shared network is the limit/);
    });

    it("reflects tier and paused state without new requests per row", () => {
        expect(indicator).toMatch(/quota\.tier === "byok" \? "BYOK" : "Free"/);
        expect(indicator).toMatch(/managedPaused/);
        // One fetch per turn at most: refresh keyed on message count.
        expect(indicator).toMatch(/turnCount/);
    });

    it("loads quota through the shared client with the BYOK flag", () => {
        expect(indicator).toMatch(/loadQuota\(!!apiKey\)/);
    });
});
