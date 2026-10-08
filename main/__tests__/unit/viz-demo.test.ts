/**
 * Viz gallery coverage
 * ====================
 * The `/viz` gallery page must demo every chart type the dispatcher
 * handles, plus both data paths (pre-planned `chartSpecs` and raw
 * `visualizationData` synthesis). This guards against adding a chart
 * type without adding a demo for it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const pageSource = readFileSync(join(process.cwd(), "app/viz/page.tsx"), "utf8");

describe("viz gallery coverage", () => {
    it.each([
        "horizontal_bar",
        "bar",
        "line",
        "area",
        "telemetry_multi",
        "scatter",
        "stacked_bar",
        "swarm",
        "bump",
        "dumbbell",
        "box_plot",
        "histogram",
        "kpi",
        "heatmap",
    ])("demos %s", (type) => {
        expect(pageSource).toContain(`type: "${type}"`);
    });

    it("covers both data paths (chartSpecs + raw visualizationData)", () => {
        expect(pageSource).toContain("chartSpecs:");
        expect(pageSource).toContain("visualizationData:");
        expect(pageSource).toContain("get_telemetry");
        expect(pageSource).toContain("get_driver_standings");
    });

    it("renders inside real MessageBubbles with queries", () => {
        expect(pageSource).toContain("<MessageBubble");
        expect(pageSource).toContain("userQuery={");
        expect(pageSource).toContain("readOnly");
    });

    it("has no visualization toggle (charts always render)", () => {
        expect(pageSource).not.toContain("visualizeEnabled");
    });
});
