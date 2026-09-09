/**
 * Unit tests for the tire strategy simulator in simulationAgent.ts.
 *
 * Covers:
 *  - Validation (negative laps, bad compounds, total-laps mismatch)
 *  - Pit-stop time accounting
 *  - Realistic degradation caps (no 30s laps on long SOFT stints)
 *  - Head-to-head strategy comparison
 *  - Determinism with a seed
 */

import { describe, it, expect } from "vitest"
import {
    compareStrategies,
    simulateTireStrategy,
    validateTireStrategy,
} from "@/lib/agents/simulationAgent"

describe("validateTireStrategy", () => {
    it("accepts a well-formed 2-stop strategy", () => {
        const err = validateTireStrategy({
            totalLaps: 50,
            stints: [
                { compound: "MEDIUM", laps: 20 },
                { compound: "HARD", laps: 20 },
                { compound: "MEDIUM", laps: 10 },
            ],
        })
        expect(err).toBeNull()
    })

    it("rejects negative totalLaps", () => {
        const err = validateTireStrategy({
            totalLaps: -1,
            stints: [{ compound: "MEDIUM", laps: 1 }],
        })
        expect(err).toMatch(/totalLaps/)
    })

    it("rejects an unknown compound", () => {
        const err = validateTireStrategy({
            totalLaps: 10,
            stints: [{ compound: "MYSTERY", laps: 10 }],
        })
        expect(err).toMatch(/not recognized/)
    })

    it("rejects stints whose lap count does not sum to totalLaps", () => {
        const err = validateTireStrategy({
            totalLaps: 10,
            stints: [{ compound: "MEDIUM", laps: 5 }],
        })
        expect(err).toMatch(/must equal totalLaps/)
    })

    it("rejects zero-lap stints", () => {
        const err = validateTireStrategy({
            totalLaps: 5,
            stints: [
                { compound: "MEDIUM", laps: 5 },
                { compound: "HARD", laps: 0 },
            ],
        })
        expect(err).toMatch(/positive integer/)
    })
})

describe("simulateTireStrategy", () => {
    it("returns null on invalid input", () => {
        expect(
            simulateTireStrategy({
                totalLaps: -1,
                stints: [{ compound: "MEDIUM", laps: 1 }],
            })
        ).toBeNull()
    })

    it("returns a result with one entry per lap", () => {
        const result = simulateTireStrategy({
            totalLaps: 30,
            stints: [
                { compound: "MEDIUM", laps: 15 },
                { compound: "HARD", laps: 15 },
            ],
        })
        expect(result).not.toBeNull()
        expect(result!.laps).toHaveLength(30)
        expect(result!.pitStops).toBe(1)
    })

    it("flags the last lap of every non-final stint as a pit lap", () => {
        const result = simulateTireStrategy({
            totalLaps: 60,
            stints: [
                { compound: "MEDIUM", laps: 20 },
                { compound: "HARD", laps: 20 },
                { compound: "SOFT", laps: 20 },
            ],
        })
        const pitLaps = result!.laps.filter((l) => l.isPitLap)
        expect(pitLaps).toHaveLength(2)
        expect(pitLaps[0].lap).toBe(20)
        expect(pitLaps[1].lap).toBe(40)
    })

    it("never produces absurdly slow laps even on a long SOFT stint", () => {
        // Without the cap, a 30-lap SOFT stint would degrade by
        // 0.05 * 29 * 29 ≈ 42s on the last lap. The cap + pit logic
        // must keep total lap times in a realistic 80-120s window.
        const result = simulateTireStrategy({
            totalLaps: 30,
            stints: [{ compound: "SOFT", laps: 30 }],
            baseLapTime: 90,
        })
        for (const l of result!.laps) {
            expect(l.lapTime).toBeGreaterThan(85)
            expect(l.lapTime).toBeLessThan(120)
        }
    })

    it("is deterministic with a fixed seed", () => {
        const a = simulateTireStrategy({
            totalLaps: 30,
            stints: [{ compound: "MEDIUM", laps: 30 }],
            seed: 42,
        })
        const b = simulateTireStrategy({
            totalLaps: 30,
            stints: [{ compound: "MEDIUM", laps: 30 }],
            seed: 42,
        })
        expect(a!.totalTimeSeconds).toBe(b!.totalTimeSeconds)
    })

    it("summary includes the correct number of stints with valid lap ranges", () => {
        const result = simulateTireStrategy({
            totalLaps: 57,
            stints: [
                { compound: "MEDIUM", laps: 20 },
                { compound: "HARD", laps: 25 },
                { compound: "SOFT", laps: 12 },
            ],
        })
        expect(result!.stints).toHaveLength(3)
        expect(result!.stints[0].startLap).toBe(1)
        expect(result!.stints[0].endLap).toBe(20)
        expect(result!.stints[2].endLap).toBe(57)
    })
})

describe("compareStrategies", () => {
    it("ranks strategies by total time and reports deltas to optimal", () => {
        const result = compareStrategies([
            {
                name: "1-stop (M-H)",
                input: {
                    totalLaps: 50,
                    stints: [
                        { compound: "MEDIUM", laps: 25 },
                        { compound: "HARD", laps: 25 },
                    ],
                },
            },
            {
                name: "2-stop (M-H-M)",
                input: {
                    totalLaps: 50,
                    stints: [
                        { compound: "MEDIUM", laps: 18 },
                        { compound: "HARD", laps: 18 },
                        { compound: "MEDIUM", laps: 14 },
                    ],
                },
            },
        ])

        expect(result.every((r) => r.error === null)).toBe(true)
        const [first, second] = result as Array<{ name: string; totalTime: number; deltaToOptimal: number; error: null }>
        expect(first.deltaToOptimal).toBe(0)
        expect(second.deltaToOptimal).toBeGreaterThanOrEqual(0)
        expect(second.totalTime).toBeGreaterThanOrEqual(first.totalTime)
    })

    it("returns error entries for invalid strategies", () => {
        const result = compareStrategies([
            {
                name: "bad",
                input: {
                    totalLaps: 10,
                    stints: [{ compound: "MYSTERY", laps: 10 }],
                },
            },
        ])
        expect(result[0]).toMatchObject({ name: "bad", error: expect.any(String) })
    })
})
