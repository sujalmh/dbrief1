/**
 * Tests for store persistence behavior (inline-charts build)
 * ==========================================================
 *
 * Charts render inline per message (t3code-style) — there is no side
 * panel, no global panel state, and no visualization toggle. The store
 * persists ONLY lightweight UI prefs (`settings`). Per-message
 * `visualizationData` / `chartSpecs` live on the message and in the
 * cloud store, never as globals.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { useChatStore } from "@/lib/store";

const storeSource = readFileSync(join(process.cwd(), "lib/store.ts"), "utf8");

describe("store persistence (inline charts)", () => {
    beforeEach(() => {
        useChatStore.setState({ messages: [] });
    });

    it("has no global panel state", () => {
        const state = useChatStore.getState() as unknown as Record<string, unknown>;
        expect("visualizationData" in state).toBe(false);
        expect("activeMessageId" in state).toBe(false);
        expect("isVisualizationCollapsed" in state).toBe(false);
        expect("visualizationWidth" in state).toBe(false);
        expect(typeof (state as { setVisualizationData?: unknown }).setVisualizationData).toBe("undefined");
        expect(typeof (state as { setActiveMessageId?: unknown }).setActiveMessageId).toBe("undefined");
        expect(typeof (state as { toggleVisualizationCollapse?: unknown }).toggleVisualizationCollapse).toBe("undefined");
        expect(typeof (state as { updateVisualizationWidth?: unknown }).updateVisualizationWidth).toBe("undefined");
    });

    it("does not reference the old panel in source", () => {
        // Live panel state/actions must be gone. Legacy key mentions
        // inside migrate() deletes + comments are expected (they clean
        // up snapshots saved by the old side-panel build). Per-message
        // `visualizationData?` / `updateMessageVisualization` stay —
        // charts live on their message.
        expect(storeSource).not.toMatch(/setVisualizationData/);
        expect(storeSource).not.toMatch(/setActiveMessageId/);
        expect(storeSource).not.toMatch(/toggleVisualizationCollapse\(/);
        expect(storeSource).not.toMatch(/updateVisualizationWidth\(/);
        // Global (non-optional) field declarations must be gone.
        expect(storeSource).not.toMatch(/^\s+visualizationData: unknown/m);
        expect(storeSource).not.toMatch(/^\s+activeMessageId: string/m);
        expect(storeSource).not.toMatch(/^\s+visualizationWidth: number/m);
        expect(storeSource).not.toMatch(/^\s+isVisualizationCollapsed: boolean/m);
    });

    it("keeps per-message visualization updaters", () => {
        const state = useChatStore.getState();
        expect(typeof state.updateMessageVisualization).toBe("function");
        expect(typeof state.setResearchChartSpecs).toBe("function");
    });

    it("clearMessages only clears messages", () => {
        useChatStore.getState().setMessages([
            {
                id: "m_1",
                role: "assistant",
                content: "hi",
                timestamp: 1,
                visualizationData: [{ tool: "get_laps", args: {}, success: true, data: {} }],
            },
        ]);
        useChatStore.getState().clearMessages();
        expect(useChatStore.getState().messages).toEqual([]);
    });

    it("dedupes identical degraded warnings (one outage = one badge)", () => {
        useChatStore.getState().setMessages([
            { id: "m_deg", role: "assistant", content: "hi", timestamp: 1 },
        ]);
        const warning = { stage: "intent_analysis", kind: "network", message: "unreachable" };
        // Backend emits one event per stage: the unavailable event AND the
        // post-answer degraded event for the same outage.
        useChatStore.getState().addMessageDegradedWarning("m_deg", warning);
        useChatStore.getState().addMessageDegradedWarning("m_deg", { ...warning });
        const stored = useChatStore.getState().messages.find((m) => m.id === "m_deg");
        expect(stored?.degradedWarnings).toHaveLength(1);

        // A genuinely different warning still appends.
        useChatStore.getState().addMessageDegradedWarning("m_deg", { ...warning, kind: "rate_limit" });
        expect(useChatStore.getState().messages.find((m) => m.id === "m_deg")?.degradedWarnings).toHaveLength(2);

        useChatStore.getState().clearMessages();
    });
});

describe("no visualization toggle (charts always render)", () => {
    it("has no visualizeEnabled in settings, defaults, or migrate", () => {
        // The v8 -> v9 migrate comment names the dropped legacy flag —
        // assert no LIVE declaration instead of no mention.
        expect(storeSource).not.toMatch(/^\s+visualizeEnabled: boolean/m);
        expect(storeSource).not.toMatch(/visualizeEnabled: false,/);
        expect(storeSource).not.toMatch(/visualizeEnabled: s\.visualizeEnabled/);
    });
});
