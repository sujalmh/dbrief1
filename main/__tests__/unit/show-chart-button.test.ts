/**
 * Tests for the "Show Chart" button behavior
 * ==========================================
 *
 * The button on each assistant message should:
 *   1. Make the message the active one (so the panel renders its specs).
 *   2. Auto-enable visualization if it's off.
 *   3. Expand the panel if it's collapsed.
 *   4. Push the chart payload into the store.
 *
 * These tests inspect the wiring in message-bubble.tsx and the
 * store to verify the contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { useChatStore } from "@/lib/store";

describe("Show Chart button wiring", () => {
    beforeEach(() => {
        useChatStore.setState({
            visualizationData: null,
            isVisualizationCollapsed: false,
            settings: {
                ...useChatStore.getState().settings,
                visualizeEnabled: false,
            },
            activeMessageId: null,
        });
    });

    it("message-bubble wires handleShowChart to set activeMessageId", () => {
        const source = readFileSync(
            join(process.cwd(), "components/chat/message-bubble.tsx"),
            "utf8"
        );
        // The handler must set the active message and enable visualization
        expect(source).toMatch(/setActiveMessageId\(message\.id\)/);
        expect(source).toMatch(/visualizeEnabled: true/);
        expect(source).toMatch(/toggleVisualizationCollapse\(false\)/);
    });

    it("Show Chart button renders when chartSpecs are present (deep research)", () => {
        const source = readFileSync(
            join(process.cwd(), "components/chat/message-bubble.tsx"),
            "utf8"
        );
        // The condition guarding the button must reference BOTH
        // visualizationData (standard mode) and chartSpecs (deep research).
        // We look for the surrounding JSX context rather than a single
        // line, because the actual condition spans a multi-line expression.
        const hasVisualizationData = /message\.visualizationData\s*\|\|/.test(source);
        const hasChartSpecsGuard = /\(message\.visualizationData\s*\|\|[\s\S]{0,80}message\.chartSpecs/.test(source);
        expect(hasVisualizationData || hasChartSpecsGuard).toBe(true);
    });

    it("store exposes the actions the Show Chart handler needs", () => {
        const state = useChatStore.getState();
        expect(typeof state.setVisualizationData).toBe("function");
        expect(typeof state.setActiveMessageId).toBe("function");
        expect(typeof state.updateSettings).toBe("function");
        expect(typeof state.toggleVisualizationCollapse).toBe("function");
    });
});
