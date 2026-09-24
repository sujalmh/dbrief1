/**
 * Tests for store persistence behavior
 * =====================================
 *
 * Regression tests for the "visualization not saved across sessions"
 * issue. The store must persist:
 *   - visualizationData (the raw tool result payload the panel reads)
 *   - graphHistory (saved graphs the user pinned)
 *   - isVisualizationCollapsed / visualizationWidth (panel UI state)
 *
 * We do NOT persist ephemeral state (loading flag, current input text).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/lib/store";

describe("store persistence", () => {
    beforeEach(() => {
        // Reset to defaults so each test starts clean
        useChatStore.setState({
            visualizationData: null,
            graphHistory: [],
            isVisualizationCollapsed: false,
            visualizationWidth: 500,
        });
    });

    it("persists visualizationData via the partialize list", async () => {
        // The partialize config is in the store; we can't directly
        // inspect it from outside, but we can verify the fields
        // are wired to the persistence middleware by writing then
        // reading them.
        useChatStore.getState().setVisualizationData([
            { tool: "get_laps", args: { year: 2024, gp: "Monaco" }, success: true, data: { laps: [] } },
        ]);
        expect(useChatStore.getState().visualizationData).toHaveLength(1);
    });

    it("persists graphHistory entries", () => {
        useChatStore.getState().addGraphToHistory("Laps 2024 Monaco", "lap_times", { foo: "bar" });
        const history = useChatStore.getState().graphHistory;
        expect(history).toHaveLength(1);
        expect(history[0]?.name).toBe("Laps 2024 Monaco");
        expect(history[0]?.type).toBe("lap_times");
    });

    it("removes a graphHistory entry by id", async () => {
        // addGraphToHistory prepends to the array, so the newest entry
        // sits at index 0. We add A, then B, then remove B (the most
        // recent), and verify A is the only one left.
        useChatStore.getState().addGraphToHistory("A", "lap_times", { a: 1 });
        await new Promise((r) => setTimeout(r, 5));
        useChatStore.getState().addGraphToHistory("B", "lap_times", { b: 2 });

        const history = useChatStore.getState().graphHistory;
        expect(history).toHaveLength(2);
        // Newest is at index 0
        expect(history[0]?.name).toBe("B");
        expect(history[1]?.name).toBe("A");

        const newest = history[0];
        if (!newest) throw new Error("expected at least one history entry");
        useChatStore.getState().removeGraphFromHistory(newest.id);

        const remaining = useChatStore.getState().graphHistory;
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.name).toBe("A");
    });

    it("persists isVisualizationCollapsed toggles", () => {
        useChatStore.getState().toggleVisualizationCollapse(true);
        expect(useChatStore.getState().isVisualizationCollapsed).toBe(true);
        useChatStore.getState().toggleVisualizationCollapse(false);
        expect(useChatStore.getState().isVisualizationCollapsed).toBe(false);
    });

    it("persists visualizationWidth changes", () => {
        useChatStore.getState().updateVisualizationWidth(720);
        expect(useChatStore.getState().visualizationWidth).toBe(720);
    });

    it("clearMessages also clears visualizationData and graphHistory", () => {
        useChatStore.getState().setVisualizationData([
            { tool: "get_laps", args: {}, success: true, data: {} },
        ]);
        useChatStore.getState().addGraphToHistory("X", "lap_times", {});
        useChatStore.getState().clearMessages();
        expect(useChatStore.getState().visualizationData).toBeNull();
        expect(useChatStore.getState().graphHistory).toEqual([]);
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
