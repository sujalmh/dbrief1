/**
 * FastF1 Tools Unit Tests
 * ========================
 * Tests for the new get_telemetry_summary tool and tool descriptions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { f1Tools } from '@/lib/tools/fastf1'

// =============================================================================
// Mock fetch for API calls
// =============================================================================

global.fetch = vi.fn()

function mockFetchResponse(data: unknown, status: number = 200) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: status === 200,
        status,
        json: async () => data,
    } as Response)
}

// =============================================================================
// Tool Schema Tests
// =============================================================================

describe('FastF1 Tools - Tool Availability', () => {
    it('should include get_telemetry_summary tool', () => {
        expect(f1Tools).toHaveProperty('get_telemetry_summary')
    })

    it('should have get_telemetry tool', () => {
        expect(f1Tools).toHaveProperty('get_telemetry')
    })

    it('should have all expected F1 tools', () => {
        const expectedTools = [
            'get_laps',
            'get_fastest_lap',
            'get_telemetry',
            'get_telemetry_summary',
            'get_weather',
            'get_race_control',
            'get_driver_standings'
        ]

        for (const tool of expectedTools) {
            expect(f1Tools).toHaveProperty(tool)
        }
    })
})

// =============================================================================
// get_telemetry_summary Tool Tests
// =============================================================================

describe('get_telemetry_summary Tool', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('should call correct API endpoint', async () => {
        const mockSummary = {
            driver: 'VER',
            lap_number: 15,
            lap_time: '1:25.123',
            speed_summary: { min: 80, max: 320, avg: 240 },
            throttle_summary: { min: 0, max: 100, avg: 85 },
            brake_summary: { min: 0, max: 100, avg: 15 }
        }

        mockFetchResponse(mockSummary)

        const tool = f1Tools.get_telemetry_summary
        const result = await tool.invoke({
            year: 2024,
            gp: 'Monaco',
            session: 'Q',
            driver: 'VER',
            lap: 'fastest'
        })

        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('/f1/telemetry/summary'),
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'Content-Type': 'application/json'
                }),
                body: expect.stringContaining('VER')
            })
        )

        const parsedResult = JSON.parse(result)
        expect(parsedResult.driver).toBe('VER')
        expect(parsedResult.speed_summary).toBeDefined()
    })

    it('should accept lap number as string', async () => {
        const mockSummary = {
            driver: 'HAM',
            lap_number: 10,
            lap_time: '1:26.456',
            speed_summary: { min: 75, max: 310, avg: 235 }
        }

        mockFetchResponse(mockSummary)

        const tool = f1Tools.get_telemetry_summary
        await tool.invoke({
            year: 2024,
            gp: 'Monaco',
            session: 'R',
            driver: 'HAM',
            lap: '10'
        })

        expect(global.fetch).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                body: expect.stringContaining('"lap":"10"')
            })
        )
    })

    it('should accept lap number as number', async () => {
        const mockSummary = {
            driver: 'LEC',
            lap_number: 5,
            speed_summary: { min: 80, max: 315, avg: 242 }
        }

        mockFetchResponse(mockSummary)

        const tool = f1Tools.get_telemetry_summary
        await tool.invoke({
            year: 2024,
            gp: 'Monza',
            session: 'R',
            driver: 'LEC',
            lap: 5
        })

        expect(global.fetch).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                body: expect.stringContaining('"lap":"5"')
            })
        )
    })

    it('should default to fastest lap when lap not specified', async () => {
        const mockSummary = {
            driver: 'NOR',
            lap_number: 12,
            speed_summary: { min: 78, max: 305, avg: 238 }
        }

        mockFetchResponse(mockSummary)

        const tool = f1Tools.get_telemetry_summary
        await tool.invoke({
            year: 2024,
            gp: 'Silverstone',
            session: 'Q',
            driver: 'NOR'
        })

        expect(global.fetch).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                body: expect.stringContaining('"lap":"fastest"')
            })
        )
    })

    it('should have appropriate description mentioning LLM optimization', () => {
        const tool = f1Tools.get_telemetry_summary
        expect(tool.description).toContain('statistical summary')
        expect(tool.description).toContain('token-efficient')
    })
})

// =============================================================================
// get_telemetry Tool Description Tests
// =============================================================================

describe('get_telemetry Tool Updates', () => {
    it('should have warning about large data in description', () => {
        const tool = f1Tools.get_telemetry
        expect(tool.description).toContain('WARNING')
        expect(tool.description).toContain('large data arrays')
    })

    it('should reference get_telemetry_summary in description', () => {
        const tool = f1Tools.get_telemetry
        expect(tool.description).toContain('get_telemetry_summary')
    })
})

// =============================================================================
// Tool Schema Validation Tests
// =============================================================================

describe('Tool Schema Validation', () => {
    it('get_telemetry_summary should accept valid inputs', async () => {
        mockFetchResponse({ driver: 'VER' })

        const tool = f1Tools.get_telemetry_summary

        // Should not throw with valid inputs
        await expect(tool.invoke({
            year: 2024,
            gp: 'Monaco',
            session: 'Q',
            driver: 'VER',
            lap: 'fastest'
        })).resolves.toBeDefined()
    })

    it('get_telemetry_summary should handle optional lap parameter', async () => {
        mockFetchResponse({ driver: 'HAM' })

        const tool = f1Tools.get_telemetry_summary

        await expect(tool.invoke({
            year: 2024,
            gp: 'Spa',
            session: 'R',
            driver: 'HAM'
            // lap is optional
        })).resolves.toBeDefined()
    })
})

// =============================================================================
// Response Format Tests
// =============================================================================

describe('Telemetry Summary Response Format', () => {
    it('should return JSON string with summary statistics', async () => {
        const mockSummary = {
            driver: 'VER',
            lap_number: 15,
            lap_time: '1:25.123',
            compound: 'SOFT',
            tyre_life: 3,
            speed_summary: {
                min: 80.5,
                max: 320.3,
                avg: 241.2
            },
            throttle_summary: {
                min: 0.0,
                max: 100.0,
                avg: 86.4
            },
            brake_summary: {
                min: 0.0,
                max: 98.5,
                avg: 12.3
            },
            corner_min_speeds: [
                { corner: 1, letter: 'A', min_speed: 78.2 },
                { corner: 2, letter: 'B', min_speed: 145.6 }
            ],
            sector_speeds: {
                sector1_avg_speed: 235.4,
                sector2_avg_speed: 198.7,
                sector3_avg_speed: 275.8
            },
            total_points_analyzed: 5432
        }

        mockFetchResponse(mockSummary)

        const tool = f1Tools.get_telemetry_summary
        const result = await tool.invoke({
            year: 2024,
            gp: 'Monaco',
            session: 'Q',
            driver: 'VER'
        })

        const parsed = JSON.parse(result)

        expect(parsed).toHaveProperty('speed_summary')
        expect(parsed).toHaveProperty('throttle_summary')
        expect(parsed).toHaveProperty('brake_summary')
        expect(parsed.speed_summary).toHaveProperty('min')
        expect(parsed.speed_summary).toHaveProperty('max')
        expect(parsed.speed_summary).toHaveProperty('avg')
    })

    it('should include lap metadata in response', async () => {
        const mockSummary = {
            driver: 'HAM',
            lap_number: 8,
            lap_time: '1:26.789',
            compound: 'MEDIUM',
            tyre_life: 12,
            speed_summary: { min: 75, max: 310, avg: 235 }
        }

        mockFetchResponse(mockSummary)

        const tool = f1Tools.get_telemetry_summary
        const result = await tool.invoke({
            year: 2024,
            gp: 'Bahrain',
            session: 'R',
            driver: 'HAM',
            lap: 8
        })

        const parsed = JSON.parse(result)

        expect(parsed.driver).toBe('HAM')
        expect(parsed.lap_number).toBe(8)
        expect(parsed.lap_time).toBe('1:26.789')
        expect(parsed.compound).toBe('MEDIUM')
        expect(parsed.tyre_life).toBe(12)
    })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Tool Error Handling', () => {
    it('should handle API errors gracefully', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            ok: false,
            status: 404,
            json: async () => ({ error: 'Session not found' }),
        } as Response)

        const tool = f1Tools.get_telemetry_summary

        await expect(tool.invoke({
            year: 2024,
            gp: 'InvalidGP',
            session: 'Q',
            driver: 'VER'
        })).rejects.toThrow()
    })

    it('should handle network errors', async () => {
        (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
            new Error('Network error')
        )

        const tool = f1Tools.get_telemetry_summary

        await expect(tool.invoke({
            year: 2024,
            gp: 'Monaco',
            session: 'Q',
            driver: 'VER'
        })).rejects.toThrow()
    })
})

// =============================================================================
// Comparison with get_telemetry Tests
// =============================================================================

describe('get_telemetry vs get_telemetry_summary', () => {
    it('get_telemetry should return full data array', async () => {
        const mockTelemetry = {
            driver: 'VER',
            lap_number: 10,
            data: Array.from({ length: 100 }, (_, i) => ({
                Distance: i * 100,
                Speed: 250,
                Throttle: 90
            }))
        }

        mockFetchResponse(mockTelemetry)

        const tool = f1Tools.get_telemetry
        const result = await tool.invoke({
            year: 2024,
            gp: 'Monaco',
            session: 'R',
            driver: 'VER'
        })

        const parsed = JSON.parse(result)
        expect(parsed.data).toBeInstanceOf(Array)
        expect(parsed.data.length).toBeGreaterThan(0)
    })

    it('get_telemetry_summary should return aggregated stats only', async () => {
        const mockSummary = {
            driver: 'VER',
            lap_number: 10,
            speed_summary: { min: 80, max: 320, avg: 240 }
        }

        mockFetchResponse(mockSummary)

        const tool = f1Tools.get_telemetry_summary
        const result = await tool.invoke({
            year: 2024,
            gp: 'Monaco',
            session: 'R',
            driver: 'VER'
        })

        const parsed = JSON.parse(result)
        expect(parsed).not.toHaveProperty('data')
        expect(parsed).toHaveProperty('speed_summary')
    })
})