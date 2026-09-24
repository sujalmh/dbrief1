/**
 * Tests for the usage status surfaces.
 * =====================================
 * Follows repo convention (source-contract tests, no DOM renderer).
 * Quota data flows one way: useQuota() (fetch + refresh) ->
 * QuotaCard (shared presentation) -> UsageIndicator (sidebar avatar
 * dot + desktop hover card) and QuotaStrip (always-visible composer
 * row + tap-to-expand, the usage surface on phones).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const sidebar = readFileSync(join(process.cwd(), "components/layout/sidebar.tsx"), "utf8");
const indicator = readFileSync(join(process.cwd(), "components/layout/usage-indicator.tsx"), "utf8");
const card = readFileSync(join(process.cwd(), "components/layout/quota-card.tsx"), "utf8");
const hook = readFileSync(join(process.cwd(), "lib/cf/use-quota.ts"), "utf8");
const strip = readFileSync(join(process.cwd(), "components/chat/quota-strip.tsx"), "utf8");
const chatInput = readFileSync(join(process.cwd(), "components/chat/chat-input.tsx"), "utf8");

describe("usage indicator placement (subtle, near profile)", () => {
    it("renders inside the profile avatar block", () => {
        expect(sidebar).toMatch(/<UsageIndicator \/>/);
        // Avatar wrapper must be positioned so the dot can anchor to it.
        expect(sidebar).toMatch(/relative h-8 w-8 rounded-full/);
    });

    it("is invisible until quota data loads", () => {
        expect(indicator).toMatch(/if \(!quota\) return null/);
    });

    it("reads quota from the shared hook (no per-component fetching)", () => {
        expect(indicator).toMatch(/useQuota\(\)/);
        expect(indicator).not.toMatch(/loadQuota/);
    });
});

describe("shared quota hook (single fetch for all surfaces)", () => {
    it("loads quota through the shared client with the BYOK flag", () => {
        expect(hook).toMatch(/loadQuota\(byok\)/);
        expect(hook).toMatch(/aiMode === "byok"/);
    });

    it("hides entirely when cloud sync is unavailable", () => {
        expect(hook).toMatch(/if \(!user \|\| !cloudReady\)/);
    });

    it("refreshes after each completed turn at most", () => {
        expect(hook).toMatch(/turnCount/);
    });

    it("collapses same-tick duplicate fetches into one call", () => {
        expect(hook).toMatch(/inflight/);
    });
});

describe("shared quota card (identical numbers everywhere)", () => {
    it("shows per-feature used-vs-cap rows with reset timing", () => {
        for (const row of ["Chats", "Deep research", "Simulations", "Tokens out"]) {
            expect(card).toContain(row);
        }
        expect(card).toMatch(/Resets in/);
    });

    it("calls out the shared network only when it binds", () => {
        expect(card).toMatch(/isNetworkBinding/);
        expect(card).toMatch(/Shared network is the limit/);
    });

    it("reflects tier and paused state", () => {
        expect(card).toMatch(/quota\.tier === "byok" \? "BYOK" : "Free"/);
        expect(card).toMatch(/managedPaused/);
    });

    it("is rendered by the avatar hover card on desktop", () => {
        expect(indicator).toMatch(/<QuotaCard quota=\{quota\} \/>/);
    });
});

describe("composer quota strip (phones + persistent desktop)", () => {
    it("renders inside the chat input section", () => {
        expect(chatInput).toMatch(/<QuotaStrip \/>/);
    });

    it("is invisible until quota data loads", () => {
        expect(strip).toMatch(/if \(!quota\) return null/);
    });

    it("shows a compact chats summary with reset timing", () => {
        expect(strip).toMatch(/chats/);
        expect(strip).toMatch(/resetLabel\(quota\.resetsAt\)/);
    });

    it("expands the shared card on tap (no hover needed)", () => {
        expect(strip).toMatch(/aria-expanded/);
        expect(strip).toMatch(/<QuotaCard quota=\{quota\} \/>/);
    });

    it("shares the hook so the strip never adds a second fetch", () => {
        expect(strip).toMatch(/useQuota\(\)/);
        expect(strip).not.toMatch(/loadQuota/);
    });
});
