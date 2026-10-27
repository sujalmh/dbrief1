/**
 * Telemetry and lap context fidelity
 * ==================================
 * These tests lock in the shapes the responder actually sees:
 *
 *   - get_telemetry_summary corner/sector detail survives the generic row cap
 *   - raw get_telemetry is reduced to compact corner/sector aggregates
 *   - multi-driver lap payloads are sampled and expose laps_omitted
 */

import { describe, it, expect } from "vitest";
import { aggregateContext, type ExecutionContext } from "@/lib/executor";

function makeContext(tool: string, args: Record<string, unknown>, data: unknown): ExecutionContext {
    return {
        results: [{ step: 1, tool, args, success: true, data, durationMs: 25 }],
        successCount: 1,
        failureCount: 0,
        totalDurationMs: 25,
    };
}

function telemetrySummaryPayload() {
    return {
        driver: "VER",
        lap_number: 45,
        lap_time: "1:35.123",
        compound: "MEDIUM",
        tyre_life: 12,
        speed_summary: { min: 80.4, max: 331.2, avg: 212.7 },
        throttle_summary: { min: 0, max: 100, avg: 71.5 },
        brake_summary: { min: 0, max: 100, avg: 14.2 },
        corner_min_speeds: Array.from({ length: 20 }, (_, i) => ({
            corner: i + 1,
            letter: i === 3 ? "A" : "",
            min_speed: 80 + i + 1,
        })),
        sector_speeds: {
            sector1_avg_speed: 211.5,
            sector2_avg_speed: 198.2,
            sector3_avg_speed: 244.7,
        },
        total_points_analyzed: 720,
    };
}

function rawTelemetryPayload() {
    const points = Array.from({ length: 101 }, (_, i) => {
        const distance = i * 10;
        const speed = distance === 200 ? 90 : distance === 600 ? 110 : distance === 900 ? 75 : 300;
        return {
            Distance: distance,
            Speed: speed,
            Throttle: speed === 300 ? 100 : 45,
            Brake: speed === 300 ? 0 : 100,
            nGear: speed === 300 ? 8 : 3,
            RPM: speed === 300 ? 12000 : 9000,
            DRS: 0,
        };
    });

    return {
        driver: "LEC",
        lap_number: 32,
        lap_time: "1:36.998",
        data: points,
        corners: [
            { Number: 1, Distance: 200, Letter: "", Angle: 0 },
            { Number: 2, Distance: 600, Letter: "", Angle: 12 },
            { Number: 3, Distance: 900, Letter: "", Angle: 20 },
        ],
        total_points: points.length,
        downsampled_from: 500,
    };
}

describe("telemetry context fidelity", () => {
    it("keeps every corner and sector speed from get_telemetry_summary", () => {
        const payload = telemetrySummaryPayload();
        const aggregated = aggregateContext(
            makeContext(
                "get_telemetry_summary",
                { year: 2026, gp: "United States", session: "R", driver: "VER" },
                payload
            )
        );

        expect(aggregated).toContain('"corner": 20');
        expect(aggregated).toContain('"min_speed": 100');
        expect(aggregated).toContain('"sector1_avg_speed": 211.5');
        expect(aggregated).toContain('"sector3_avg_speed": 244.7');
        expect(aggregated).not.toContain("corner_min_speeds_truncated_from");
        expect(aggregated).not.toContain("Showing first 12 of 20 corner_min_speeds");
    });

    it("derives compact corner minimum speeds and sector averages from raw telemetry", () => {
        const aggregated = aggregateContext(
            makeContext(
                "get_telemetry",
                { year: 2026, gp: "United States", session: "R", driver: "LEC" },
                rawTelemetryPayload()
            )
        );

        expect(aggregated).toContain('"telemetry_points": 101');
        expect(aggregated).toContain('"corner": 1');
        expect(aggregated).toContain('"min_speed": 90');
        expect(aggregated).toContain('"corner": 2');
        expect(aggregated).toContain('"min_speed": 110');
        expect(aggregated).toContain('"corner": 3');
        expect(aggregated).toContain('"min_speed": 75');
        expect(aggregated).toContain('"sector1_avg_speed"');
        expect(aggregated).toContain('"sector3_avg_speed"');
        expect(aggregated).toContain('"downsampled_from": 500');
        expect(aggregated).not.toContain('"Distance"');
    });

    it("marks sampled multi-driver lap payloads with laps_omitted", () => {
        const laps = Array.from({ length: 480 }, (_, i) => ({
            LapNumber: Math.floor(i / 2) + 1,
            Driver: i % 2 === 0 ? "VER" : "LEC",
            LapTime: `1:${String(20 + (i % 10)).padStart(2, "0")}.500`,
            Compound: i < 240 ? "MEDIUM" : "HARD",
            TyreLife: (i % 20) + 1,
            Sector1Time: "0:28.100",
            Sector2Time: "0:33.200",
            Sector3Time: "0:24.200",
            Position: i % 2 === 0 ? 1 : 2,
        }));

        const aggregated = aggregateContext(
            makeContext(
                "get_laps",
                { year: 2026, gp: "United States", session: "R" },
                { session_name: "Race", laps }
            )
        );

        expect(aggregated).toContain('"total_laps": 480');
        expect(aggregated).toContain('"laps_omitted"');
        const shown = aggregated.match(/Showing (\d+) of 480 laps/);
        expect(shown).not.toBeNull();
        expect(Number(shown![1])).toBeGreaterThan(0);
        expect(Number(shown![1])).toBeLessThanOrEqual(220);
    });
});
