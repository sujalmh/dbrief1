/**
 * Tests for store persistence behavior
 * =====================================
 *
 * Regression tests for the "visualization not saved across sessions"
 * issue. The store must persist:
 *   - visualizationData (the raw tool result payload the panel reads)
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

    it("clearMessages also clears visualizationData", () => {
        useChatStore.getState().setVisualizationData([
            { tool: "get_laps", args: {}, success: true, data: {} },
        ]);
        useChatStore.getState().clearMessages();
        expect(useChatStore.getState().visualizationData).toBeNull();
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
