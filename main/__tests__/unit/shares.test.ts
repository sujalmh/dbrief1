/**
 * Tests for share-link helpers (pure, no D1 I/O).
 * ==============================================
 * Token shape gating (cheap reject before any query) and snapshot
 * stripping (public snapshots must never carry usage/cost, evidence
 * payloads, chart dumps, or traces).
 */

import { describe, it, expect } from "vitest";
import { isShareToken, toSharedMessage, countSharedExchanges, MAX_LINKS_PER_SESSION } from "@/lib/cf/shares";

describe("isShareToken", () => {
    it("accepts well-formed tokens", () => {
        expect(isShareToken("sh_" + "a".repeat(32))).toBe(true);
        expect(isShareToken("sh_0123456789abcdef0123456789abcdef")).toBe(true);
    });

    it("rejects malformed input without touching D1", () => {
        for (const bad of [
            "",
            "sh_",
            "sh_short",
            "s_0123456789abcdef0123456789abcdef",
            "sh_0123456789abcdef0123456789abcdefEXTRA",
            "sh_0123456789ABCDEF0123456789ABCDEF",
            "sh_!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
            null,
            undefined,
            42,
            {},
        ]) {
            expect(isShareToken(bad)).toBe(false);
        }
    });
});

describe("toSharedMessage", () => {
    it("keeps readable content with role and timestamp", () => {
        const m = toSharedMessage({
            id: "m_1",
            role: "assistant",
            content: "Verstappen won.",
            timestamp: 1700000000000,
            data_json: "{}",
        });
        expect(m).toMatchObject({
            id: "m_1",
            role: "assistant",
            content: "Verstappen won.",
            timestamp: 1700000000000,
        });
        expect(m).not.toHaveProperty("usage");
        expect(m).not.toHaveProperty("visualizationData");
        expect(m).not.toHaveProperty("evidence");
    });

    it("carries sanitized citations through", () => {
        const m = toSharedMessage({
            id: "m_2",
            role: "assistant",
            content: "Per the regs.",
            timestamp: 1,
            data_json: JSON.stringify({
                citations: [{ source: "sporting-regs", type: "regulation" }],
                usage: { provider: "managed", cost: 0.01 },
                visualizationData: { huge: true },
            }),
        });
        expect(m.citations).toHaveLength(1);
        expect(m.citations?.[0]).toMatchObject({ source: "sporting-regs" });
        expect(m).not.toHaveProperty("usage");
    });

    it("survives corrupt data_json with text intact", () => {
        const m = toSharedMessage({
            id: "m_3",
            role: "user",
            content: "Hello?",
            timestamp: 2,
            data_json: "{not-json",
        });
        expect(m.content).toBe("Hello?");
        expect(m.citations).toBeUndefined();
    });

    it("normalizes unknown roles to user", () => {
        const m = toSharedMessage({
            id: "m_4",
            role: "system",
            content: "x",
            timestamp: 3,
        });
        expect(m.role).toBe("user");
    });
});

describe("share limits", () => {
    it("bounds links per session", () => {
        expect(MAX_LINKS_PER_SESSION).toBeGreaterThan(0);
        expect(MAX_LINKS_PER_SESSION).toBeLessThanOrEqual(20);
    });
});

describe("countSharedExchanges", () => {
    it("counts one Q&A pair as one, not two", () => {
        expect(countSharedExchanges([{ role: "user" }, { role: "assistant" }])).toBe(1);
    });

    it("counts a trailing unanswered question", () => {
        expect(
            countSharedExchanges([{ role: "user" }, { role: "assistant" }, { role: "user" }])
        ).toBe(2);
        expect(countSharedExchanges([{ role: "user" }])).toBe(1);
    });

    it("counts zero for empty snapshots", () => {
        expect(countSharedExchanges([])).toBe(0);
    });
});
