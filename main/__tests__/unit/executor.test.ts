/**
 * Executor Unit Tests
 * ===================
 * Tests for step execution, timeout handling, and error aggregation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeSteps, aggregateContext, simplifyContext, ExecutionContext } from '@/lib/executor'
import { Step } from '@/lib/planner'
import { StructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'

// =============================================================================
// Mock Tools
// =============================================================================

function createMockTool(name: string, responseData: unknown, delay: number = 0, shouldFail: boolean = false): StructuredTool {
    return tool(
        async () => {
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay))
            }
            if (shouldFail) {
                throw new Error(`${name} failed`)
            }
            return JSON.stringify(responseData)
        },
        {
            name,
            description: `Mock ${name} tool`,
            schema: z.object({})
        }
    )
}

// =============================================================================
// Executor Tests
// =============================================================================

describe('Step Executor', () => {
    describe('Basic Execution', () => {
        it('should execute a single step successfully', async () => {
            const mockTool = createMockTool('get_laps', { laps: [1, 2, 3] })
            const tools = { get_laps: mockTool }
            const steps: Step[] = [
                { description: 'Get laps', tool: 'get_laps', args: {} }
            ]

            const context = await executeSteps(steps, tools)

            expect(context.successCount).toBe(1)
            expect(context.failureCount).toBe(0)
            expect(context.results[0].success).toBe(true)
            expect(context.results[0].data).toEqual({ laps: [1, 2, 3] })
        })

        it('should execute multiple steps', async () => {
            const tools = {
                get_laps: createMockTool('get_laps', { driver: 'VER', laps: [] }),
                get_tyres: createMockTool('get_tyres', { tyres: [] })
            }
            const steps: Step[] = [
                { description: 'Get laps', tool: 'get_laps', args: {} },
                { description: 'Get tyres', tool: 'get_tyres', args: {} }
            ]

            const context = await executeSteps(steps, tools)

            expect(context.successCount).toBe(2)
            expect(context.results).toHaveLength(2)
        })

        it('should handle unknown tools gracefully', async () => {
            const tools = {}
            const steps: Step[] = [
                { description: 'Unknown', tool: 'unknown_tool', args: {} }
            ]

            const context = await executeSteps(steps, tools)

            expect(context.failureCount).toBe(1)
            expect(context.results[0].error).toContain('Unknown tool')
        })

        it('should handle tool execution errors', async () => {
            const failingTool = createMockTool('get_laps', {}, 0, true)
            const tools = { get_laps: failingTool }
            const steps: Step[] = [
                { description: 'Get laps', tool: 'get_laps', args: {} }
            ]

            const context = await executeSteps(steps, tools)

            expect(context.failureCount).toBe(1)
            expect(context.results[0].success).toBe(false)
            expect(context.results[0].error).toContain('failed')
        })


    })

    describe('Progress Callbacks', () => {
        it('should call onUpdate for each step', async () => {
            const mockTool = createMockTool('test', { data: 'ok' })
            const tools = { test: mockTool }
            const steps: Step[] = [
                { description: 'Step 1', tool: 'test', args: {} },
                { description: 'Step 2', tool: 'test', args: {} }
            ]

            const updates: { step: number; status: string }[] = []
            await executeSteps(steps, tools, (step, status) => {
                updates.push({ step, status })
            })

            // Should have pending and running/success for each step
            expect(updates.length).toBeGreaterThanOrEqual(4)
        })
    })

    describe('Context Aggregation', () => {
        it('should aggregate successful results', () => {
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_laps', args: {}, success: true, data: { laps: [1, 2] }, durationMs: 100 },
                    { step: 2, tool: 'get_tyres', args: {}, success: true, data: { tyres: ['SOFT'] }, durationMs: 50 }
                ],
                successCount: 2,
                failureCount: 0,
                totalDurationMs: 150
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('2/2 steps succeeded')
            expect(aggregated).toContain('get_laps')
            expect(aggregated).toContain('get_tyres')
        })

        it('should include failed steps in aggregation', () => {
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_laps', args: {}, success: true, data: { laps: [] }, durationMs: 100 },
                    { step: 2, tool: 'get_tyres', args: {}, success: false, error: 'API error', durationMs: 50 }
                ],
                successCount: 1,
                failureCount: 1,
                totalDurationMs: 150
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('1/2 steps succeeded')
            expect(aggregated).toContain('FAILED')
            expect(aggregated).toContain('API error')
        })

        it('should simplify context correctly', () => {
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_laps', args: {}, success: true, data: { driver: 'VER' }, durationMs: 100 },
                    { step: 2, tool: 'get_laps', args: {}, success: true, data: { driver: 'HAM' }, durationMs: 50 }
                ],
                successCount: 2,
                failureCount: 0,
                totalDurationMs: 150
            }

            const simplified = simplifyContext(context)

            // Should have different keys for duplicate tools
            expect(Object.keys(simplified).length).toBe(2)
            expect(simplified['get_laps']).toEqual({ driver: 'VER' })
            expect(simplified['get_laps_2']).toEqual({ driver: 'HAM' })
        })

        it('should return empty message for no results', () => {
            const context: ExecutionContext = {
                results: [],
                successCount: 0,
                failureCount: 0,
                totalDurationMs: 0
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('No data was retrieved')
        })
    })

    describe('Timing', () => {
        it('should track execution duration', async () => {
            const slowTool = createMockTool('slow', { data: 'ok' }, 100)
            const tools = { slow: slowTool }
            const steps: Step[] = [
                { description: 'Slow step', tool: 'slow', args: {} }
            ]

            const context = await executeSteps(steps, tools)

            expect(context.results[0].durationMs).toBeGreaterThanOrEqual(100)
        })
    })
})
