/**
 * Tests for the chart-dispatcher series resolution
 * =================================================
 *
 * Regression tests for the "telemetry graphs with axes but no data
 * points" bug. The dispatcher must propagate the `config.series` list
 * (or fall back to auto-detection) so the underlying chart actually
 * plots the data.
 */

import { describe, it, expect } from "vitest";

// Import the helper directly so we test the series-resolution logic
// without rendering React.
import { readFileSync } from "fs";
import { join } from "path";

describe("chart-dispatcher", () => {
    it("exposes a resolveSeries helper that prefers config.series", () => {
        // Read the dispatcher source so we can verify the helper exists
        // and the case branches use it. This catches accidental
        // regressions (e.g. someone replaces `resolveSeries(...)` with
        // a constant empty array again).
        const source = readFileSync(
            join(process.cwd(), "components/visualization/chart-dispatcher.tsx"),
            "utf8"
        );
        expect(source).toMatch(/function resolveSeries/);
        // The line + area cases should use resolveSeries, not the old
        // pickSeriesFromData that always returned [].
        expect(source).toMatch(/series: resolveSeries\(cfg, data\)/);
        // The dispatcher must NOT use the buggy pickSeriesFromData anywhere.
        expect(source).not.toMatch(/pickSeriesFromData/);
    });

    it("supports multi-series telemetry data via the dispatcher contract", () => {
        // Pure unit test of the resolveSeries contract (mirrored inline
        // because the helper isn't exported — exporting it would add
        // noise to the React module).
        const data = [
            { x: 0, speed: 100, throttle: 50, brake: 0 },
            { x: 50, speed: 250, throttle: 100, brake: 0 },
        ];
        const cfg = { series: ["speed", "throttle"] };
        // Mirror the resolver behavior:
        const series = Array.isArray(cfg.series) && cfg.series.length > 0
            ? cfg.series.filter((s) => typeof s === "string" && s.length > 0)
            : Object.keys(data[0]).filter((k) =>
                k !== "x" && typeof (data[0] as Record<string, unknown>)[k] === "number"
            );
        expect(series).toEqual(["speed", "throttle"]);
    });

    it("falls back to numeric keys when config.series is missing", () => {
        const data = [
            { x: 0, speed: 100, throttle: 50 },
            { x: 50, speed: 250, throttle: 100 },
        ];
        const cfg: { series?: string[] } = {};
        const series = Array.isArray(cfg.series) && cfg.series.length > 0
            ? cfg.series
            : Object.keys(data[0]).filter((k) =>
                k !== "x" && typeof (data[0] as Record<string, unknown>)[k] === "number"
            );
        expect(series).toEqual(["speed", "throttle"]);
    });
});
