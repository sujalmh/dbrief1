/**
 * Test Helper Utilities
 * =====================
 * Assertion helpers for F1 chatbot testing
 */

import { Plan, Step } from '@/lib/planner'
import {
    TOOL_SCHEMAS,
    VALID_YEARS,
    VALID_DRIVER_CODES,
    VALID_SESSIONS,
    VALID_GP_NAMES
} from '../fixtures/golden-outputs'

// =============================================================================
// Plan Assertions
// =============================================================================

/**
 * Assert that a plan contains a specific tool
 */
export function assertPlanContainsTool(plan: Plan, toolName: string): Step | undefined {
    const step = plan.steps.find(s => s.tool === toolName)
    if (!step) {
        throw new Error(`Expected plan to contain tool "${toolName}", but got: [${plan.steps.map(s => s.tool).join(', ')}]`)
    }
    return step
}

/**
 * Assert that a plan does NOT contain a specific tool
 */
export function assertPlanDoesNotContainTool(plan: Plan, toolName: string): void {
    const step = plan.steps.find(s => s.tool === toolName)
    if (step) {
        throw new Error(`Expected plan to NOT contain tool "${toolName}", but it was found`)
    }
}

/**
 * Assert that plan arguments match expected values
 */
export function assertPlanArgs(
    step: Step,
    expected: Record<string, unknown>,
    strictMatch: boolean = false
): void {
    for (const [key, value] of Object.entries(expected)) {
        const actualValue = step.args[key]

        // Handle case-insensitive string matching for GP names
        if (typeof value === 'string' && typeof actualValue === 'string') {
            if (value.toLowerCase() !== actualValue.toLowerCase()) {
                throw new Error(
                    `Expected arg "${key}" to be "${value}", but got "${actualValue}"`
                )
            }
        } else if (actualValue !== value) {
            throw new Error(
                `Expected arg "${key}" to be ${JSON.stringify(value)}, but got ${JSON.stringify(actualValue)}`
            )
        }
    }

    if (strictMatch) {
        const extraKeys = Object.keys(step.args).filter(k => !(k in expected))
        if (extraKeys.length > 0) {
            throw new Error(`Unexpected extra arguments: ${extraKeys.join(', ')}`)
        }
    }
}

/**
 * Validate that plan arguments match the tool schema
 */
export function validatePlanSchema(plan: Plan): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    for (const step of plan.steps) {
        const schema = TOOL_SCHEMAS[step.tool as keyof typeof TOOL_SCHEMAS]
        if (!schema) {
            errors.push(`Unknown tool: ${step.tool}`)
            continue
        }

        // Check required args
        for (const required of schema.required) {
            if (!(required in step.args)) {
                errors.push(`Missing required arg "${required}" for tool "${step.tool}"`)
            }
        }

        // Validate year if present
        if ('year' in step.args) {
            const year = step.args.year as number
            if (!VALID_YEARS.includes(year)) {
                errors.push(`Invalid year ${year} for tool "${step.tool}"`)
            }
        }

        // Validate driver if present
        if ('driver' in step.args) {
            const driver = step.args.driver as string
            if (!VALID_DRIVER_CODES.includes(driver.toUpperCase())) {
                errors.push(`Invalid driver code "${driver}" for tool "${step.tool}"`)
            }
        }

        // Validate session if present
        if ('session' in step.args) {
            const session = step.args.session as string
            if (!VALID_SESSIONS.includes(session.toUpperCase())) {
                errors.push(`Invalid session "${session}" for tool "${step.tool}"`)
            }
        }
    }

    return { valid: errors.length === 0, errors }
}

// =============================================================================
// Response Assertions
// =============================================================================

/**
 * Check for hallucinated data in response
 */
export function assertNoHallucination(
    response: string,
    validDrivers: string[] = VALID_DRIVER_CODES,
    validYear: number = 2024
): { hasHallucination: boolean; issues: string[] } {
    const issues: string[] = []

    // Check for future years mentioned as past
    const futureYearMatch = response.match(/in (\d{4})/gi)
    if (futureYearMatch) {
        for (const match of futureYearMatch) {
            const year = parseInt(match.replace(/\D/g, ''))
            if (year > validYear) {
                issues.push(`Potential hallucination: mentions future year ${year}`)
            }
        }
    }

    // Check for fabricated lap times (unrealistic values)
    const lapTimeMatch = response.match(/(\d+):(\d{2}\.\d{3})/g)
    if (lapTimeMatch) {
        for (const time of lapTimeMatch) {
            const [min, sec] = time.split(':')
            const totalSeconds = parseInt(min) * 60 + parseFloat(sec)
            // F1 lap times are typically 60-120 seconds
            if (totalSeconds < 50 || totalSeconds > 180) {
                issues.push(`Potentially fabricated lap time: ${time}`)
            }
        }
    }

    return { hasHallucination: issues.length > 0, issues }
}

/**
 * Check if response is a refusal/correction
 */
export function isRefusalResponse(response: string): boolean {
    const refusalPatterns = [
        /i can't|i cannot|i'm unable|i am unable/i,
        /i don't have|i do not have/i,
        /that data is not available/i,
        /invalid|not valid/i,
        /please provide|could you clarify/i,
        /i need more information/i,
        /that request is not possible/i
    ]

    return refusalPatterns.some(pattern => pattern.test(response))
}

/**
 * Check if response contains a clarifying question
 */
export function hasClarifyingQuestion(response: string): boolean {
    const questionPatterns = [
        /which (year|race|session|driver)/i,
        /what (year|race|session|driver)/i,
        /please specify/i,
        /could you clarify/i,
        /do you mean/i,
        /\?$/m
    ]

    return questionPatterns.some(pattern => pattern.test(response))
}

// =============================================================================
// Visualization Assertions
// =============================================================================

export interface ChartData {
    data: Array<Record<string, unknown>>
    xKey?: string
    yKey?: string
    chartType?: string
}

/**
 * Validate visualization data integrity
 */
export function assertVisualizationIntegrity(
    chartData: ChartData,
    expectedType: 'lap_times' | 'telemetry' | 'comparison'
): { valid: boolean; issues: string[] } {
    const issues: string[] = []

    // Check data is not empty
    if (!chartData.data || chartData.data.length === 0) {
        issues.push('Chart data is empty')
        return { valid: false, issues }
    }

    // Check for lap time charts
    if (expectedType === 'lap_times') {
        // X-axis should be lap number
        const hasLapKey = chartData.data[0] && ('lap' in chartData.data[0] || 'lap_number' in chartData.data[0])
        if (!hasLapKey) {
            issues.push('Lap time chart missing lap number on X-axis')
        }

        // Check for monotonic lap index
        const laps = chartData.data.map(d => d.lap || d.lap_number) as number[]
        for (let i = 1; i < laps.length; i++) {
            if (laps[i] < laps[i - 1]) {
                issues.push('Lap numbers are not monotonically increasing')
                break
            }
        }

        // Y-axis should be time
        const hasTimeKey = chartData.data[0] && ('time' in chartData.data[0] || 'lap_time' in chartData.data[0])
        if (!hasTimeKey) {
            issues.push('Lap time chart missing time value on Y-axis')
        }
    }

    // Check for telemetry charts
    if (expectedType === 'telemetry') {
        // X-axis should be distance
        const hasDistanceKey = chartData.data[0] && 'distance' in chartData.data[0]
        if (!hasDistanceKey) {
            issues.push('Telemetry chart missing distance on X-axis')
        }

        // Should have speed or throttle
        const hasDataChannel = chartData.data[0] && (
            'speed' in chartData.data[0] ||
            'throttle' in chartData.data[0] ||
            'brake' in chartData.data[0]
        )
        if (!hasDataChannel) {
            issues.push('Telemetry chart missing speed/throttle/brake data')
        }
    }

    return { valid: issues.length === 0, issues }
}

/**
 * Check that dataset lengths match expected
 */
export function assertDatasetLength(
    data: unknown[],
    minLength: number,
    maxLength?: number
): void {
    if (data.length < minLength) {
        throw new Error(`Expected at least ${minLength} data points, got ${data.length}`)
    }
    if (maxLength && data.length > maxLength) {
        throw new Error(`Expected at most ${maxLength} data points, got ${data.length}`)
    }
}

// =============================================================================
// Response Quality Scoring
// =============================================================================

import type { ResponseQualityTestCase } from '../fixtures/test-prompts'

export interface QualityScore {
    toolScore: number
    argScore: number
    relevanceScore: number
    hallucinationScore: number
    overall: number
    details: string[]
}

/**
 * Score the quality of a plan against a test case expectation.
 * All scores are 0-1 where 1 is perfect.
 */
export function scoreResponseQuality(
    plan: Plan,
    testCase: ResponseQualityTestCase
): QualityScore {
    const details: string[] = []

    // Tool Selection Score: what fraction of expected tools appear in the plan?
    const planTools = plan.steps.map(s => s.tool)
    const toolHits = testCase.expectedTools.filter(t =>
        planTools.some(pt => pt === t || pt.includes(t.replace('get_', '')))
    )
    const toolScore = testCase.expectedTools.length > 0
        ? toolHits.length / testCase.expectedTools.length
        : (plan.steps.length > 0 ? 1 : 0)
    if (toolScore < 1) {
        const missing = testCase.expectedTools.filter(t => !toolHits.includes(t))
        details.push(`Missing tools: [${missing.join(', ')}], got: [${planTools.join(', ')}]`)
    }

    // Argument Correctness Score: do the plan args match expected patterns?
    let argMatches = 0
    let argTotal = 0
    for (const pattern of testCase.expectedArgPatterns) {
        for (const [key, expectedVal] of Object.entries(pattern)) {
            argTotal++
            const matchingStep = plan.steps.find(s => {
                const actual = s.args[key]
                if (actual === undefined) return false
                if (typeof expectedVal === 'string' && typeof actual === 'string') {
                    return actual.toLowerCase() === expectedVal.toLowerCase()
                }
                return actual === expectedVal
            })
            if (matchingStep) {
                argMatches++
            } else {
                details.push(`No step matched arg ${key}=${JSON.stringify(expectedVal)}`)
            }
        }
    }
    const argScore = argTotal > 0 ? argMatches / argTotal : 1

    // Relevance Score: check if plan reasoning or steps reference expected keywords
    const planText = JSON.stringify(plan).toLowerCase()
    const relevanceHits = testCase.expectedResponseContains.filter(
        keyword => planText.includes(keyword.toLowerCase())
    )
    const relevanceScore = testCase.expectedResponseContains.length > 0
        ? relevanceHits.length / testCase.expectedResponseContains.length
        : 1

    // Hallucination Score: check for forbidden terms in plan
    let hallucinationScore = 1
    if (testCase.expectedResponseNotContains) {
        const badHits = testCase.expectedResponseNotContains.filter(
            keyword => planText.includes(keyword.toLowerCase())
        )
        if (badHits.length > 0) {
            hallucinationScore = 0
            details.push(`Plan contains forbidden terms: [${badHits.join(', ')}]`)
        }
    }

    const overall = (toolScore * 0.4 + argScore * 0.3 + relevanceScore * 0.2 + hallucinationScore * 0.1)

    return { toolScore, argScore, relevanceScore, hallucinationScore, overall, details }
}

/**
 * Assert that a string contains all specified keywords (case-insensitive)
 */
export function assertResponseContains(text: string, keywords: string[]): void {
    const lower = text.toLowerCase()
    const missing = keywords.filter(k => !lower.includes(k.toLowerCase()))
    if (missing.length > 0) {
        throw new Error(`Response missing expected keywords: [${missing.join(', ')}]`)
    }
}

/**
 * Assert that a string does NOT contain any of the specified keywords (case-insensitive)
 */
export function assertResponseNotContains(text: string, blacklist: string[]): void {
    const lower = text.toLowerCase()
    const found = blacklist.filter(k => lower.includes(k.toLowerCase()))
    if (found.length > 0) {
        throw new Error(`Response contains forbidden terms: [${found.join(', ')}]`)
    }
}

/**
 * Create mock F1 API tools that return realistic data without requiring the FastAPI server.
 * These are tool-level mocks (not LLM mocks).
 */
export function createMockToolRegistry(): Record<string, any> {
    const { tool } = require('@langchain/core/tools')
    const { z } = require('zod')

    const mockTool = (name: string, response: unknown) => tool(
        async () => JSON.stringify(response),
        { name, description: `Mock ${name}`, schema: z.object({}).passthrough() }
    )

    return {
        get_seasons: mockTool('get_seasons', { seasons: Array.from({ length: 76 }, (_, i) => 1950 + i) }),
        get_events: mockTool('get_events', { events: [{ name: 'Monaco Grand Prix', round: 6, country: 'Monaco' }] }),
        get_sessions: mockTool('get_sessions', { sessions: ['FP1', 'FP2', 'FP3', 'Q', 'R'] }),
        get_results: mockTool('get_results', { results: [{ position: 1, driver: 'VER', team: 'Red Bull', time: '1:32:45.123' }] }),
        get_qualifying: mockTool('get_qualifying', { results: [{ position: 1, driver: 'VER', q1: '1:10.123', q2: '1:09.456', q3: '1:08.789' }] }),
        get_race: mockTool('get_race', { results: [{ position: 1, driver: 'VER', team: 'Red Bull', laps: 78, time: '1:32:45.123' }] }),
        get_laps: mockTool('get_laps', {
            session_name: 'Race', laps: Array.from({ length: 50 }, (_, i) => ({
                driver: 'VER', lap_number: i + 1, LapTime: `1:${(15 + Math.random() * 5).toFixed(3)}`, compound: 'HARD'
            }))
        }),
        get_fastest_lap: mockTool('get_fastest_lap', { driver: 'VER', lap_number: 45, lap_time: '1:15.234' }),
        get_telemetry: mockTool('get_telemetry', {
            driver: 'VER', lap_number: 45, lap_time: '1:15.234',
            data: Array.from({ length: 100 }, (_, i) => ({ distance: i * 50, Speed: 200 + Math.sin(i / 10) * 100, Throttle: 80, Brake: 0 }))
        }),
        get_telemetry_summary: mockTool('get_telemetry_summary', { driver: 'VER', speed: { min: 80, max: 320, avg: 210 }, throttle: { avg: 75 } }),
        get_weather: mockTool('get_weather', { air_temp: 25, track_temp: 42, humidity: 55, rainfall: false }),
        get_race_control: mockTool('get_race_control', { messages: [{ time: '14:30', category: 'Flag', message: 'GREEN FLAG' }] }),
        get_tyres: mockTool('get_tyres', { stints: [{ driver: 'VER', compound: 'MEDIUM', start_lap: 1, end_lap: 20 }, { driver: 'VER', compound: 'HARD', start_lap: 21, end_lap: 55 }] }),
        get_driver_standings: mockTool('get_driver_standings', { standings: [{ position: 1, driver: 'VER', points: 575, wins: 19 }] }),
        retrieve_regulations: mockTool('retrieve_regulations', { retrieved_documents: [{ source: 'fia_2025_sporting.pdf', type: 'sporting', content: 'Safety car procedures...' }], used_subqueries: ['safety car rules'] }),
        run_simulation: mockTool('run_simulation', { results: { raw_values: [1, 2, 3], statistics: { mean: 2, min: 1, max: 3 } }, visualization: { type: 'histogram', data: { buckets: [] } }, summary: { scenario_id: 'test', description: 'Simulation complete', key_metrics: { mean: 2 } } }),
        web_search: mockTool('web_search', { results: [{ title: 'F1 News', url: 'https://example.com', snippet: 'Latest F1 news...' }] }),
    }
}
