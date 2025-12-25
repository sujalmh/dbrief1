/**
 * Executor Context Budgeting Unit Tests
 * ======================================
 * Tests for the new context budgeting features added to executor.ts
 * including telemetry summarization, token estimation, and truncation
 */

import { describe, it, expect, vi } from 'vitest'
import { executeSteps, aggregateContext, ExecutionContext } from '@/lib/executor'
import { Step } from '@/lib/planner'
import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'

// =============================================================================
// Mock Tools for Testing
// =============================================================================

function createMockTool(name: string, responseData: unknown): StructuredTool {
    return tool(
        async () => JSON.stringify(responseData),
        {
            name,
            description: `Mock ${name} tool`,
            schema: z.object({})
        }
    )
}

// =============================================================================
// Telemetry Data Summarization Tests
// =============================================================================

describe('Telemetry Data Summarization', () => {
    it('should detect and summarize telemetry data with large data array', () => {
        const telemetryData = {
            driver: 'VER',
            lap_number: 15,
            lap_time: '1:25.123',
            data: Array.from({ length: 100 }, (_, i) => ({
                Distance: i * 100,
                Speed: 280 + Math.random() * 20,
                Throttle: 90 + Math.random() * 10,
                Brake: 0
            })),
            total_points: 100
        }

        const context: ExecutionContext = {
            results: [
                {
                    step: 1,
                    tool: 'get_telemetry',
                    success: true,
                    data: telemetryData,
                    durationMs: 1000
                }
            ],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 1000
        }

        const aggregated = aggregateContext(context)

        // Should contain summary statistics instead of raw data
        expect(aggregated).toContain('telemetry_summary')
        expect(aggregated).toContain('min')
        expect(aggregated).toContain('max')
        expect(aggregated).toContain('avg')
        // Should NOT contain the full data array
        expect(aggregated).not.toMatch(/\[.{1000,}\]/)
    })

    it('should calculate correct min/max/avg for telemetry channels', () => {
        const telemetryData = {
            driver: 'HAM',
            lap_number: 10,
            lap_time: '1:26.456',
            data: [
                { Speed: 100, Throttle: 50, Brake: 0 },
                { Speed: 200, Throttle: 75, Brake: 25 },
                { Speed: 150, Throttle: 100, Brake: 0 }
            ]
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_telemetry',
                success: true,
                data: telemetryData,
                durationMs: 500
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 500
        }

        const aggregated = aggregateContext(context)
        const parsed = JSON.parse(aggregated.match(/```json\n([\s\S]*?)\n```/)?.[1] || '{}')

        expect(parsed.telemetry_summary.Speed.min).toBe(100)
        expect(parsed.telemetry_summary.Speed.max).toBe(200)
        expect(parsed.telemetry_summary.Speed.avg).toBe(150)
    })

    it('should preserve essential metadata while removing raw data', () => {
        const telemetryData = {
            driver: 'LEC',
            lap_number: 5,
            lap_time: '1:24.789',
            data: Array.from({ length: 60 }, () => ({ Speed: 250 })),
            total_points: 60
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_telemetry',
                success: true,
                data: telemetryData,
                durationMs: 800
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 800
        }

        const aggregated = aggregateContext(context)

        expect(aggregated).toContain('LEC')
        expect(aggregated).toContain('1:24.789')
        expect(aggregated).toContain('lap_number')
    })

    it('should not summarize telemetry data with small data arrays', () => {
        const smallTelemetry = {
            driver: 'VER',
            lap_number: 1,
            data: [
                { Speed: 100 },
                { Speed: 110 }
            ]
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_telemetry',
                success: true,
                data: smallTelemetry,
                durationMs: 100
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 100
        }

        const aggregated = aggregateContext(context)

        // Small arrays should pass through unchanged
        expect(aggregated).toContain('"Speed":100')
    })
})

// =============================================================================
// Laps Data Summarization Tests
// =============================================================================

describe('Laps Data Summarization', () => {
    it('should detect and summarize laps data with many laps', () => {
        const lapsData = {
            session_name: 'Race',
            total_laps: 50,
            laps: Array.from({ length: 50 }, (_, i) => ({
                LapNumber: i + 1,
                LapTime: `1:${25 + i % 10}.${Math.floor(Math.random() * 1000)}`,
                Driver: 'VER',
                Compound: 'SOFT'
            }))
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_laps',
                success: true,
                data: lapsData,
                durationMs: 1200
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 1200
        }

        const aggregated = aggregateContext(context)

        // Should contain key laps summary
        expect(aggregated).toContain('key_laps')
        expect(aggregated).toContain('fastest')
        expect(aggregated).toContain('first')
        expect(aggregated).toContain('last')
        // Should note that full table was replaced
        expect(aggregated).toContain('replaced with key laps')
    })

    it('should identify fastest lap correctly', () => {
        const lapsData = {
            session_name: 'Qualifying',
            laps: [
                { LapNumber: 1, LapTime: '1:26.500', Driver: 'VER' },
                { LapNumber: 2, LapTime: '1:25.123', Driver: 'VER' },  // Fastest
                { LapNumber: 3, LapTime: '1:26.000', Driver: 'VER' }
            ]
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_laps',
                success: true,
                data: lapsData,
                durationMs: 300
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 300
        }

        const aggregated = aggregateContext(context)
        const parsed = JSON.parse(aggregated.match(/```json\n([\s\S]*?)\n```/)?.[1] || '{}')

        expect(parsed.key_laps.fastest.LapTime).toBe('1:25.123')
        expect(parsed.key_laps.fastest.LapNumber).toBe(2)
    })

    it('should preserve first and last laps', () => {
        const lapsData = {
            session_name: 'Race',
            laps: Array.from({ length: 30 }, (_, i) => ({
                LapNumber: i + 1,
                LapTime: `1:${25 + (i % 10)}.000`
            }))
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_laps',
                success: true,
                data: lapsData,
                durationMs: 900
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 900
        }

        const aggregated = aggregateContext(context)
        const parsed = JSON.parse(aggregated.match(/```json\n([\s\S]*?)\n```/)?.[1] || '{}')

        expect(parsed.key_laps.first.LapNumber).toBe(1)
        expect(parsed.key_laps.last.LapNumber).toBe(30)
    })

    it('should not summarize small lap datasets', () => {
        const smallLaps = {
            session_name: 'Sprint Shootout',
            laps: [
                { LapNumber: 1, LapTime: '1:26.000' },
                { LapNumber: 2, LapTime: '1:25.500' }
            ]
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_laps',
                success: true,
                data: smallLaps,
                durationMs: 100
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 100
        }

        const aggregated = aggregateContext(context)

        // Small datasets should pass through
        expect(aggregated).toContain('"LapNumber":1')
        expect(aggregated).not.toContain('key_laps')
    })
})

// =============================================================================
// Token Estimation Tests
// =============================================================================

describe('Token Estimation and Budgeting', () => {
    it('should estimate tokens based on character count', () => {
        // Create a context that's definitely over 150k tokens
        const hugeData = {
            data: Array.from({ length: 20000 }, (_, i) => ({
                index: i,
                value: Math.random() * 1000,
                description: 'This is a very long description that takes up many characters and tokens'
            }))
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'mock_tool',
                success: true,
                data: hugeData,
                durationMs: 1000
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 1000
        }

        const aggregated = aggregateContext(context)

        // Should be truncated
        expect(aggregated).toContain('[Context truncated due to size limits]')
    })

    it('should not truncate context within token budget', () => {
        const normalData = {
            results: [
                { position: 1, driver: 'VER', points: 575 },
                { position: 2, driver: 'PER', points: 285 }
            ]
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_results',
                success: true,
                data: normalData,
                durationMs: 200
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 200
        }

        const aggregated = aggregateContext(context)

        expect(aggregated).not.toContain('[Context truncated')
        expect(aggregated).toContain('VER')
        expect(aggregated).toContain('PER')
    })

    it('should preserve execution summary even after truncation', () => {
        const massiveData = {
            data: 'X'.repeat(1000000)  // 1MB of data
        }

        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'huge_tool',
                success: true,
                data: massiveData,
                durationMs: 5000
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 5000
        }

        const aggregated = aggregateContext(context)

        // Summary should always be at the start
        expect(aggregated).toMatch(/^\*\*Execution Summary\*\*/)
        expect(aggregated).toContain('1/1 steps succeeded')
    })
})

// =============================================================================
// Multiple Result Reduction Tests
// =============================================================================

describe('Multiple Results Context Management', () => {
    it('should reduce multiple telemetry results', () => {
        const context: ExecutionContext = {
            results: [
                {
                    step: 1,
                    tool: 'get_telemetry',
                    success: true,
                    data: {
                        driver: 'VER',
                        lap_number: 10,
                        data: Array.from({ length: 100 }, () => ({ Speed: 250 }))
                    },
                    durationMs: 800
                },
                {
                    step: 2,
                    tool: 'get_telemetry',
                    success: true,
                    data: {
                        driver: 'HAM',
                        lap_number: 10,
                        data: Array.from({ length: 100 }, () => ({ Speed: 245 }))
                    },
                    durationMs: 750
                }
            ],
            successCount: 2,
            failureCount: 0,
            totalDurationMs: 1550
        }

        const aggregated = aggregateContext(context)

        // Both should be summarized
        expect(aggregated).toContain('VER')
        expect(aggregated).toContain('HAM')
        expect(aggregated).toContain('telemetry_summary')
        // Count occurrences of telemetry_summary
        const summaryCount = (aggregated.match(/telemetry_summary/g) || []).length
        expect(summaryCount).toBe(2)
    })

    it('should handle mix of large and small results', () => {
        const context: ExecutionContext = {
            results: [
                {
                    step: 1,
                    tool: 'get_telemetry',
                    success: true,
                    data: {
                        driver: 'VER',
                        data: Array.from({ length: 100 }, () => ({ Speed: 250 }))
                    },
                    durationMs: 800
                },
                {
                    step: 2,
                    tool: 'get_results',
                    success: true,
                    data: {
                        results: [
                            { position: 1, driver: 'VER' },
                            { position: 2, driver: 'HAM' }
                        ]
                    },
                    durationMs: 200
                }
            ],
            successCount: 2,
            failureCount: 0,
            totalDurationMs: 1000
        }

        const aggregated = aggregateContext(context)

        // Telemetry should be summarized
        expect(aggregated).toContain('telemetry_summary')
        // Results should pass through
        expect(aggregated).toContain('"position":1')
    })
})

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('Context Budgeting Edge Cases', () => {
    it('should handle empty data objects', () => {
        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_telemetry',
                success: true,
                data: { driver: 'VER', data: [] },
                durationMs: 100
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 100
        }

        const aggregated = aggregateContext(context)

        expect(aggregated).toContain('VER')
        expect(aggregated).not.toThrow
    })

    it('should handle malformed telemetry data gracefully', () => {
        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'get_telemetry',
                success: true,
                data: { 
                    driver: 'VER',
                    data: [null, undefined, { broken: 'data' }]
                },
                durationMs: 100
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 100
        }

        expect(() => aggregateContext(context)).not.toThrow()
    })

    it('should handle failed results in context', () => {
        const context: ExecutionContext = {
            results: [
                {
                    step: 1,
                    tool: 'get_telemetry',
                    success: true,
                    data: { driver: 'VER', data: Array.from({ length: 60 }, () => ({ Speed: 250 })) },
                    durationMs: 800
                },
                {
                    step: 2,
                    tool: 'get_laps',
                    success: false,
                    error: 'API timeout',
                    durationMs: 5000
                }
            ],
            successCount: 1,
            failureCount: 1,
            totalDurationMs: 5800
        }

        const aggregated = aggregateContext(context)

        expect(aggregated).toContain('1/2 steps succeeded')
        expect(aggregated).toContain('FAILED')
        expect(aggregated).toContain('API timeout')
    })

    it('should handle results with no data field', () => {
        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: 'some_tool',
                success: true,
                data: null,
                durationMs: 100
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 100
        }

        expect(() => aggregateContext(context)).not.toThrow()
    })
})

// =============================================================================
// Integration with Execution Tests
// =============================================================================

describe('Context Budgeting in Full Execution Flow', () => {
    it('should reduce context when executing steps with large responses', async () => {
        const largeTelemetryTool = createMockTool('get_telemetry', {
            driver: 'VER',
            lap_number: 15,
            data: Array.from({ length: 200 }, (_, i) => ({
                Distance: i * 50,
                Speed: 250 + Math.random() * 30,
                Throttle: 80 + Math.random() * 20
            }))
        })

        const tools = { get_telemetry: largeTelemetryTool }
        const steps: Step[] = [
            { description: 'Get telemetry', tool: 'get_telemetry', args: {} }
        ]

        const context = await executeSteps(steps, tools)
        const aggregated = aggregateContext(context)

        expect(aggregated).toContain('telemetry_summary')
        expect(context.results[0].success).toBe(true)
    })
})