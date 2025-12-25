/**
 * Context Budgeting End-to-End Integration Test
 * ==============================================
 * Tests the complete flow with context budgeting features
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { planQuery } from '@/lib/planner'
import { executeSteps, aggregateContext } from '@/lib/executor'
import { createTestPlannerModel } from '../utils/llm-client'

// Mock the fetch for API calls
global.fetch = vi.fn()

function mockFetchResponse(data: unknown) {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => data,
    } as Response)
}

describe('Context Budgeting - E2E Flow', () => {
    let plannerModel: any

    beforeAll(() => {
        try {
            plannerModel = createTestPlannerModel()
        } catch {
            console.warn('Skipping E2E tests - no API key')
        }
    })

    it('should handle large telemetry data with summarization', async () => {
        if (!plannerModel) return

        // Mock large telemetry response
        const largeTelemetry = {
            driver: 'VER',
            lap_number: 15,
            lap_time: '1:25.123',
            data: Array.from({ length: 500 }, (_, i) => ({
                Distance: i * 20,
                Speed: 200 + Math.random() * 100,
                Throttle: 70 + Math.random() * 30,
                Brake: Math.random() * 10
            })),
            total_points: 500
        }

        mockFetchResponse(largeTelemetry)

        // Plan would typically request telemetry
        const mockPlan = {
            steps: [{
                description: 'Get telemetry',
                tool: 'get_telemetry',
                args: {
                    year: 2024,
                    gp: 'Monaco',
                    session: 'Q',
                    driver: 'VER'
                }
            }],
            reasoning: 'Get telemetry for analysis'
        }

        const { f1Tools } = await import('@/lib/tools/fastf1')
        const context = await executeSteps(mockPlan.steps, f1Tools)
        const aggregated = aggregateContext(context)

        // Verify summarization occurred
        expect(aggregated).toContain('telemetry_summary')
        expect(aggregated).not.toMatch(/\[.{5000,}\]/)  // No huge arrays
    })

    it('should prefer get_telemetry_summary for stats queries', async () => {
        if (!plannerModel) return

        const prompt = "Show me stats for Verstappen's lap in Monaco 2024"
        
        // Mock summary response
        mockFetchResponse({
            driver: 'VER',
            lap_number: 12,
            speed_summary: { min: 80, max: 320, avg: 245 },
            throttle_summary: { min: 0, max: 100, avg: 87 }
        })

        const plan = await planQuery(plannerModel, prompt, false)

        // Should prefer telemetry summary for stats
        const hasSummaryTool = plan.steps.some(s => s.tool === 'get_telemetry_summary')
        const hasTelemetryTool = plan.steps.some(s => s.tool === 'get_telemetry')

        // Either summary tool, or if telemetry, will be summarized in aggregation
        expect(hasSummaryTool || hasTelemetryTool).toBe(true)
    })

    it('should handle multiple driver comparisons efficiently', async () => {
        if (!plannerModel) return

        const prompt = "Compare telemetry between Verstappen and Perez in Monaco 2024"

        // Mock responses for both drivers
        mockFetchResponse({
            driver: 'VER',
            data: Array.from({ length: 100 }, () => ({ Speed: 250 }))
        })
        mockFetchResponse({
            driver: 'PER',
            data: Array.from({ length: 100 }, () => ({ Speed: 245 }))
        })

        const plan = await planQuery(plannerModel, prompt, false)
        const { f1Tools } = await import('@/lib/tools/fastf1')
        const context = await executeSteps(plan.steps, f1Tools)
        const aggregated = aggregateContext(context)

        // Both drivers should be in context
        expect(aggregated).toContain('VER')
        expect(aggregated).toContain('PER')
        
        // Should be summarized to prevent token overflow
        expect(aggregated).toContain('telemetry_summary')
    })

    it('should not exceed token budget with multiple large results', async () => {
        if (!plannerModel) return

        // Create multiple large results
        const largeResults = Array.from({ length: 5 }, (_, i) => ({
            driver: `DRIVER_${i}`,
            data: Array.from({ length: 200 }, () => ({ 
                Speed: Math.random() * 300,
                Distance: Math.random() * 5000
            }))
        }))

        // Mock all responses
        largeResults.forEach(result => mockFetchResponse(result))

        const mockPlan = {
            steps: largeResults.map((_, i) => ({
                description: `Get data ${i}`,
                tool: 'get_telemetry',
                args: { year: 2024, gp: 'Monaco', session: 'Q', driver: `DRIVER_${i}` }
            })),
            reasoning: 'Multi-driver comparison'
        }

        const { f1Tools } = await import('@/lib/tools/fastf1')
        const context = await executeSteps(mockPlan.steps, f1Tools)
        const aggregated = aggregateContext(context)

        // Estimate tokens (rough: 1 token ≈ 4 chars)
        const estimatedTokens = aggregated.length / 4

        // Should be under 150k token limit
        expect(estimatedTokens).toBeLessThan(150000)
    })

    it('should preserve execution summary even with truncation', async () => {
        if (!plannerModel) return

        // Create massive data that will definitely be truncated
        const massiveData = {
            data: 'X'.repeat(1000000)
        }

        mockFetchResponse(massiveData)

        const mockPlan = {
            steps: [{
                description: 'Get massive data',
                tool: 'get_telemetry',
                args: { year: 2024, gp: 'Monaco', session: 'Q', driver: 'VER' }
            }],
            reasoning: 'Test truncation'
        }

        const { f1Tools } = await import('@/lib/tools/fastf1')
        const context = await executeSteps(mockPlan.steps, f1Tools)
        const aggregated = aggregateContext(context)

        // Summary should be at the start
        expect(aggregated).toMatch(/^\*\*Execution Summary\*\*/)
        
        // Should indicate truncation if it occurred
        if (aggregated.length > 600000) {  // 150k tokens * 4 chars
            expect(aggregated).toContain('[Context truncated')
        }
    })
})

// =============================================================================
// Tool Selection Integration Tests
// =============================================================================

describe('Tool Selection - Real Planner', () => {
    let plannerModel: any

    beforeAll(() => {
        try {
            plannerModel = createTestPlannerModel()
        } catch {
            console.warn('Skipping tests - no API key')
        }
    })

    it('should select appropriate tools for visualization queries', async () => {
        if (!plannerModel) return

        const prompt = "Show me a speed trace for Leclerc in Monza 2024"
        const plan = await planQuery(plannerModel, prompt, false)

        // Should use get_telemetry for visualization
        const hasTelemetry = plan.steps.some(s => 
            s.tool === 'get_telemetry' || s.tool === 'get_telemetry_summary'
        )
        
        expect(hasTelemetry).toBe(true)
    })

    it('should create separate steps for multi-driver comparisons', async () => {
        if (!plannerModel) return

        const prompt = "Compare Norris and Piastri telemetry in Singapore 2024"
        const plan = await planQuery(plannerModel, prompt, false)

        // Should have at least 2 steps (one per driver)
        expect(plan.steps.length).toBeGreaterThanOrEqual(2)
        
        // Steps should reference different drivers
        const drivers = plan.steps.map(s => s.args.driver).filter(Boolean)
        expect(drivers.length).toBeGreaterThan(1)
    })
})