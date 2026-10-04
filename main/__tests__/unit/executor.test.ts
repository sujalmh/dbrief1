/**
 * Executor Unit Tests
 * ===================
 * Tests for step execution, timeout handling, and error aggregation
 */

import { describe, it, expect } from 'vitest'
import { executeSteps, aggregateContext, buildRefusalMessage, ExecutionContext } from '@/lib/executor'
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

        it('should row-truncate large results lists instead of nuking them', () => {
            // Regression test (E2E 2026-09-08): a 20-driver get_race payload
            // used to collapse to "[Data too large, truncated]", forcing the
            // responder to refuse a question it had the data for.
            const results = Array.from({ length: 20 }, (_, i) => ({
                Position: String(i + 1),
                Abbreviation: `D${i + 1}`,
            }))
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_race', args: {}, success: true, data: { session_name: 'Race', results }, durationMs: 100 }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            // Full classifications stay complete (cap is 25): P20 must be
            // visible so backmarker questions don't refuse or guess.
            expect(aggregated).toContain('D1')
            expect(aggregated).toContain('D20')
            expect(aggregated).not.toContain('truncated_from')
            expect(aggregated).not.toContain('Data too large, truncated')
        })

        it('should still row-truncate genuinely oversized lists', () => {
            const results = Array.from({ length: 30 }, (_, i) => ({
                Position: String(i + 1),
                Abbreviation: `D${i + 1}`,
            }))
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_race', args: {}, success: true, data: { session_name: 'Race', results }, durationMs: 100 }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('truncated_from')
            expect(aggregated).not.toContain('Data too large, truncated')
        })

        it('should keep full event schedules for date anchoring', () => {
            // Regression test (prod 2026-09-30): "what's the next race"
            // failed because the 25-event schedule was cut to the first 12,
            // so the responder anchored on July instead of October.
            const events = Array.from({ length: 25 }, (_, i) => ({
                round_number: i + 1,
                event_name: `GP${i + 1}`,
                event_date: `2026-${String(3 + Math.floor(i / 3)).padStart(2, '0')}-01T00:00:00`,
            }))
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_events', args: { year: 2026 }, success: true, data: { year: 2026, events }, durationMs: 100 }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('GP1')
            expect(aggregated).toContain('GP25')
            expect(aggregated).not.toContain('truncated_from')
        })

        it('should compact fat classification rows but keep every driver', () => {
            // Real get_race rows carry ~20 fields (headshot URLs, team
            // colors, empty broadcast fields). Compaction must drop the
            // bloat but keep all 20 drivers with their key fields.
            const results = Array.from({ length: 20 }, (_, i) => ({
                Position: i + 1,
                GridPosition: i + 1,
                Abbreviation: `D${i + 1}`,
                FullName: `Driver ${i + 1}`,
                TeamName: 'Team',
                HeadshotUrl: 'https://example.com/very/long/headshot/url.png',
                TeamColor: 'ff0000',
                BroadcastName: '',
                Time: '90:00.000',
                Points: 25 - i,
            }))
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_race', args: {}, success: true, data: { session_name: 'Race', results }, durationMs: 100 }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('D20')
            expect(aggregated).not.toContain('HeadshotUrl')
            expect(aggregated).not.toContain('Data too large, truncated')
        })

        it('should name telemetry sample counts unambiguously', () => {
            // telemetry_points (not total_points) so the responder does not
            // misread a sample count as championship points.
            const data = Array.from({ length: 60 }, (_, i) => ({ Distance: i * 10, Speed: 200 }));
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'get_telemetry', args: {}, success: true, data: { driver: 'VER', lap_number: 45, data }, durationMs: 100 }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('telemetry_points')
            expect(aggregated).not.toContain('total_points')
        })

        it('should trim regulation chunks instead of nuking them', () => {
            // Regression: retrieve_regulations payloads (~12k chars of full
            // regulation sections) tripped the generic 10k stub, so the
            // responder refused despite relevant docs being retrieved.
            const retrieved_documents = Array.from({ length: 5 }, (_, i) => ({
                source: 'sporting_2026.pdf',
                title: 'Sporting Regulations Issue 6',
                url: 'https://fia.com/sporting-2026',
                source_url: 'https://fia.com/sporting-2026',
                doc_type: 'regulation',
                section: 'Sporting',
                event: null,
                season: 2026,
                published_on: '2026-01-01',
                content: `Article ${i + 1} spine text. `.repeat(300),
                relevance_score: 0.9 - i * 0.1,
            }))
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'retrieve_regulations', args: {}, success: true, data: { retrieved_documents, used_subqueries: ['drs'] }, durationMs: 100 }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            expect(JSON.stringify({ retrieved_documents }).length).toBeGreaterThan(10000)
            expect(aggregated).toContain('Sporting Regulations Issue 6')
            expect(aggregated).toContain('https://fia.com/sporting-2026')
            expect(aggregated).toContain('relevance_score')
            expect(aggregated).toContain('Article 1 spine text.')
            expect(aggregated).not.toContain('Data too large, truncated')
        })

        it('should keep top regulation docs by relevance_score and drop the rest', () => {
            const retrieved_documents = [0.1, 0.9, 0.3, 0.7, 0.5, 0.95, 0.2].map((score, i) => ({
                source: `doc${i}.pdf`,
                title: `Doc ${i}`,
                content: 'Short chunk.',
                relevance_score: score,
            }))
            const context: ExecutionContext = {
                results: [
                    { step: 1, tool: 'retrieve_regulations', args: {}, success: true, data: { retrieved_documents }, durationMs: 100 }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            const order = ['Doc 5', 'Doc 1', 'Doc 3', 'Doc 4', 'Doc 2'].map((t) => aggregated.indexOf(t))
            expect(order.every((idx) => idx !== -1)).toBe(true)
            expect([...order].sort((a, b) => a - b)).toEqual(order)
            expect(aggregated).not.toContain('Doc 0')
            expect(aggregated).not.toContain('Doc 6')
            expect(aggregated).toContain('retrieved_documents_truncated_from')
            expect(aggregated).not.toContain('Data too large, truncated')
        })

        it('should pass small regulation payloads through intact', () => {
            const context: ExecutionContext = {
                results: [
                    {
                        step: 1, tool: 'retrieve_regulations', args: {}, success: true,
                        data: { retrieved_documents: [{ source: 'd.pdf', title: 'Decision', content: 'Short chunk.', relevance_score: 0.8 }] },
                        durationMs: 100,
                    }
                ],
                successCount: 1,
                failureCount: 0,
                totalDurationMs: 100
            }

            const aggregated = aggregateContext(context)

            expect(aggregated).toContain('Short chunk.')
            expect(aggregated).not.toContain('truncated')
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

    // ===================================================================
    // Cross-model tool name robustness (2026-07-14)
    // ===================================================================
    //
    // Free-tier open-source models on OpenRouter (Nemotron, Poolside, Cohere,
    // Llama) frequently hallucinate tool names that are close to but not
    // exactly the canonical name. The executor's resolveTool() helper
    // applies an alias table + fuzzy match. These tests lock that in.

    describe('Tool name alias resolution', () => {
        it('remaps get_lap_times to get_laps', async () => {
            const mockTool = createMockTool('get_laps', { laps: [] })
            const tools = { get_laps: mockTool }
            const steps: Step[] = [
                { description: 'Get laps', tool: 'get_lap_times', args: {} },
            ]
            const context = await executeSteps(steps, tools)
            expect(context.results[0].success).toBe(true)
            // The original hallucinated tool name is still recorded, but
            // the tool that ran was get_laps (visible via the data).
            expect(context.results[0].data).toEqual({ laps: [] })
        })

        it('remaps get_telemetry_data to get_telemetry', async () => {
            const mockTool = createMockTool('get_telemetry', { data: [] })
            const tools = { get_telemetry: mockTool }
            const steps: Step[] = [
                { description: 'Get telemetry', tool: 'get_telemetry_data', args: {} },
            ]
            const context = await executeSteps(steps, tools)
            expect(context.results[0].success).toBe(true)
        })

        it('remaps simulate to run_simulation', async () => {
            const mockTool = createMockTool('run_simulation', { ok: 1 })
            const tools = { run_simulation: mockTool }
            const steps: Step[] = [
                { description: 'Sim', tool: 'simulate', args: {} },
            ]
            const context = await executeSteps(steps, tools)
            expect(context.results[0].success).toBe(true)
        })

        it('remaps get_championship_standings to get_driver_standings', async () => {
            const mockTool = createMockTool('get_driver_standings', { standings: [] })
            const tools = { get_driver_standings: mockTool }
            const steps: Step[] = [
                { description: 'Standings', tool: 'get_championship_standings', args: {} },
            ]
            const context = await executeSteps(steps, tools)
            expect(context.results[0].success).toBe(true)
        })

        it('case-insensitive match: GET_LAPS -> get_laps', async () => {
            const mockTool = createMockTool('get_laps', { laps: [] })
            const tools = { get_laps: mockTool }
            const steps: Step[] = [
                { description: 'Get laps', tool: 'GET_LAPS', args: {} },
            ]
            const context = await executeSteps(steps, tools)
            expect(context.results[0].success).toBe(true)
        })

        it('fails gracefully for completely unknown tool names', async () => {
            const mockTool = createMockTool('get_laps', { laps: [] })
            const tools = { get_laps: mockTool }
            const steps: Step[] = [
                { description: 'No such tool', tool: 'fetch_lunch_order', args: {} },
            ]
            const context = await executeSteps(steps, tools)
            expect(context.results[0].success).toBe(false)
            expect(context.results[0].error).toContain('Unknown tool')
        })
    })

    describe('buildRefusalMessage', () => {
        it('lists failed steps', () => {
            const msg = buildRefusalMessage([{ step: 1, tool: 'get_race', error: 'boom' }], 'some reasoning');
            expect(msg).toContain('- Step 1 (get_race): boom');
        })

        it('falls back to plan reasoning when no steps failed', () => {
            const msg = buildRefusalMessage([], 'Year 2030 is beyond supported range 1950-2026.');
            expect(msg).toContain('Year 2030 is beyond supported range');
            expect(msg.trim().endsWith('1950-2026.')).toBe(true);
        })

        it('falls back to a default when neither is available', () => {
            expect(buildRefusalMessage([])).toContain('No execution steps were produced');
        })

        it('sanitizes server-side errors instead of blaming the query', () => {
            const msg = buildRefusalMessage([{ step: 1, tool: 'get_race', error: 'F1 API error 401: Invalid or missing API key' }]);
            expect(msg).not.toContain('API key');
            expect(msg).toContain('temporarily unavailable');
        })

        it('uses a service-down headline when all failures are server-side', () => {
            const msg = buildRefusalMessage([{ step: 1, tool: 'get_race', error: 'F1 API error 401: Invalid or missing API key' }]);
            expect(msg.startsWith('The F1 data service is temporarily unavailable')).toBe(true);
            expect(msg).not.toContain('verify the details');
        })

        it('keeps the verify-details headline for query-shaped failures', () => {
            const msg = buildRefusalMessage([{ step: 1, tool: 'get_race', error: 'F1 API error 404: Event XYZ not found' }]);
            expect(msg).toContain('verify the details');
            expect(msg).toContain('Event XYZ not found');
        })
    })
})
