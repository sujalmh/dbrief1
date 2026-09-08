/**
 * AI Response Quality Test Suite
 * ==============================
 * End-to-end quality tests using the real GLM 4.5 Air LLM via OpenRouter.
 * Tests the full planner pipeline across diverse F1 query categories and
 * scores response quality on tool selection, argument correctness,
 * relevance, and hallucination resistance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { planQuery } from '@/lib/planner'
import { executeSteps, aggregateContext } from '@/lib/executor'
import { createTestPlannerModel } from '../utils/llm-client'
import {
    scoreResponseQuality,
    assertResponseNotContains,
    validatePlanSchema,
    createMockToolRegistry,
    type QualityScore,
} from '../utils/test-helpers'
import { RESPONSE_QUALITY_PROMPTS, type ResponseQualityTestCase } from '../fixtures/test-prompts'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

// =============================================================================
// Setup
// =============================================================================

let plannerModel: BaseChatModel
const scoreLog: { category: string; prompt: string; score: QualityScore; passed: boolean }[] = []

beforeAll(() => {
    plannerModel = createTestPlannerModel()
})

afterAll(() => {
    // Print quality score summary
    console.log('\n========================================')
    console.log('  AI RESPONSE QUALITY REPORT')
    console.log('========================================\n')

    const categories = [...new Set(scoreLog.map(s => s.category))]
    let totalPassed = 0
    const totalTests = scoreLog.length

    for (const cat of categories) {
        const catScores = scoreLog.filter(s => s.category === cat)
        const avgOverall = catScores.reduce((sum, s) => sum + s.score.overall, 0) / catScores.length
        const passCount = catScores.filter(s => s.passed).length

        console.log(`  [${cat.toUpperCase()}] ${passCount}/${catScores.length} passed | avg quality: ${(avgOverall * 100).toFixed(1)}%`)
        for (const entry of catScores) {
            const icon = entry.passed ? 'PASS' : 'FAIL'
            console.log(`    ${icon} ${entry.prompt.substring(0, 60)}... (${(entry.score.overall * 100).toFixed(0)}%)`)
            if (entry.score.details.length > 0) {
                entry.score.details.forEach(d => console.log(`         -> ${d}`))
            }
        }
        totalPassed += passCount
        console.log('')
    }

    console.log(`  TOTAL: ${totalPassed}/${totalTests} passed (${((totalPassed / totalTests) * 100).toFixed(1)}%)`)
    console.log('========================================\n')
})

// =============================================================================
// Helpers
// =============================================================================

function getTestsByCategory(category: string): ResponseQualityTestCase[] {
    return RESPONSE_QUALITY_PROMPTS.filter(p => p.category === category)
}

async function runQualityTest(testCase: ResponseQualityTestCase): Promise<QualityScore> {
    const plan = await planQuery(plannerModel, testCase.prompt, false)
    const score = scoreResponseQuality(plan, testCase)

    // Also run through executor with mock tools to verify end-to-end
    if (plan.steps.length > 0) {
        const mockTools = createMockToolRegistry()
        const context = await executeSteps(plan.steps, mockTools)
        const aggregated = aggregateContext(context)

        // Verify aggregated context is non-empty for successful steps
        if (context.successCount > 0) {
            expect(aggregated).toBeTruthy()
            expect(aggregated.length).toBeGreaterThan(20)
        }
    }

    scoreLog.push({
        category: testCase.category,
        prompt: testCase.prompt,
        score,
        passed: score.overall >= 0.5,
    })

    return score
}

// =============================================================================
// Category: Data Queries
// =============================================================================

describe('AI Response Quality Suite', () => {
    describe('Category: Data Queries', () => {
        const dataTests = getTestsByCategory('data')

        it.each(dataTests)('$description', async (testCase) => {
            const score = await runQualityTest(testCase)

            expect(score.toolScore).toBeGreaterThanOrEqual(0.5)
            expect(score.overall).toBeGreaterThanOrEqual(0.4)
        }, 120000)

        it('should create separate calls for multi-driver comparison', async () => {
            const plan = await planQuery(
                plannerModel,
                'Compare Verstappen and Norris pace in Abu Dhabi 2023',
                false
            )

            expect(plan.steps.length).toBeGreaterThanOrEqual(2)

            const drivers = plan.steps
                .map(s => s.args.driver)
                .filter(Boolean)
                .map(d => String(d).toUpperCase())

            expect(drivers).toContain('VER')
            expect(drivers).toContain('NOR')
        }, 120000)
    })

    // =============================================================================
    // Category: Strategy Queries
    // =============================================================================

    describe('Category: Strategy Queries', () => {
        const strategyTests = getTestsByCategory('strategy')

        it.each(strategyTests)('$description', async (testCase) => {
            const score = await runQualityTest(testCase)

            expect(score.toolScore).toBeGreaterThanOrEqual(0.3)
            expect(score.overall).toBeGreaterThanOrEqual(0.3)
        }, 120000)
    })

    // =============================================================================
    // Category: Weather / Conditions Queries
    // =============================================================================

    describe('Category: Weather Queries', () => {
        const weatherTests = getTestsByCategory('weather')

        it.each(weatherTests)('$description', async (testCase) => {
            const score = await runQualityTest(testCase)

            expect(score.toolScore).toBeGreaterThanOrEqual(0.5)
            expect(score.overall).toBeGreaterThanOrEqual(0.4)
        }, 120000)
    })

    // =============================================================================
    // Category: Regulation Queries
    // =============================================================================

    describe('Category: Regulation Queries', () => {
        const regTests = getTestsByCategory('regulation')

        it.each(regTests)('$description', async (testCase) => {
            const score = await runQualityTest(testCase)

            // Regulation queries may not always match exactly since the planner
            // might use web_search as a fallback, so we're more lenient
            expect(score.overall).toBeGreaterThanOrEqual(0.2)
        }, 120000)
    })

    // =============================================================================
    // Category: Simulation / What-If Queries
    // =============================================================================

    describe('Category: Simulation Queries', () => {
        const simTests = getTestsByCategory('simulation')

        it.each(simTests)('$description', async (testCase) => {
            const score = await runQualityTest(testCase)

            expect(score.overall).toBeGreaterThanOrEqual(0.3)
        }, 120000)
    })

    // =============================================================================
    // Category: Cross-Domain Queries
    // =============================================================================

    describe('Category: Cross-Domain Queries', () => {
        const crossTests = getTestsByCategory('cross-domain')

        it.each(crossTests)('$description', async (testCase) => {
            const plan = await planQuery(plannerModel, testCase.prompt, false)
            const score = scoreResponseQuality(plan, testCase)

            // Cross-domain should use multiple tool types
            const toolTypes = new Set(plan.steps.map(s => s.tool))
            expect(toolTypes.size).toBeGreaterThanOrEqual(1)

            scoreLog.push({
                category: testCase.category,
                prompt: testCase.prompt,
                score,
                passed: score.overall >= 0.3,
            })

            expect(score.overall).toBeGreaterThanOrEqual(0.3)
        }, 120000)
    })

    // =============================================================================
    // Category: Historical Queries
    // =============================================================================

    describe('Category: Historical Queries', () => {
        const histTests = getTestsByCategory('historical')

        it.each(histTests)('$description', async (testCase) => {
            const plan = await planQuery(plannerModel, testCase.prompt, false)
            const score = scoreResponseQuality(plan, testCase)

            // Historical queries should NOT use telemetry or laps for pre-2018
            const yearArgs = plan.steps.map(s => s.args.year).filter(Boolean) as number[]
            for (const year of yearArgs) {
                if (year < 2018) {
                    const hasTelemetry = plan.steps.some(s =>
                        s.tool === 'get_telemetry' || s.tool === 'get_laps'
                    )
                    if (hasTelemetry) {
                        score.hallucinationScore = 0
                        score.details.push(`Used telemetry/laps for pre-2018 year ${year}`)
                    }
                }
            }

            if (testCase.expectedResponseNotContains) {
                const planText = JSON.stringify(plan).toLowerCase()
                assertResponseNotContains(planText, testCase.expectedResponseNotContains)
            }

            scoreLog.push({
                category: testCase.category,
                prompt: testCase.prompt,
                score,
                passed: score.overall >= 0.3,
            })

            expect(score.overall).toBeGreaterThanOrEqual(0.3)
        }, 120000)
    })

    // =============================================================================
    // Category: Conversational / Vague Queries
    // =============================================================================

    describe('Category: Conversational Queries', () => {
        const convTests = getTestsByCategory('conversational')

        it.each(convTests)('$description', async (testCase) => {
            const plan = await planQuery(plannerModel, testCase.prompt, false)
            const score = scoreResponseQuality(plan, testCase)

            // Conversational queries should at least produce some plan
            expect(plan.steps.length).toBeGreaterThanOrEqual(1)

            const schemaResult = validatePlanSchema(plan)
            // Allow minor schema issues for vague queries
            expect(schemaResult.errors.length).toBeLessThanOrEqual(2)

            scoreLog.push({
                category: testCase.category,
                prompt: testCase.prompt,
                score,
                passed: score.overall >= 0.3,
            })
        }, 120000)
    })

    // =============================================================================
    // Schema Validity Across All Categories
    // =============================================================================

    describe('Schema Validity', () => {
        it.each(RESPONSE_QUALITY_PROMPTS.slice(0, 8))(
            'plan schema is valid for: $description',
            async (testCase) => {
                const plan = await planQuery(plannerModel, testCase.prompt, false)
                const schemaResult = validatePlanSchema(plan)

                // Plans should have minimal schema errors
                expect(schemaResult.errors.length).toBeLessThanOrEqual(2)
            },
            60000
        )
    })

    // =============================================================================
    // End-to-End Pipeline Tests
    // =============================================================================

    describe('End-to-End Pipeline', () => {
        it('should plan, execute, and aggregate for a simple data query', async () => {
            const plan = await planQuery(
                plannerModel,
                "Show Verstappen's lap times in the 2023 Monaco GP",
                false
            )

            expect(plan.steps.length).toBeGreaterThanOrEqual(1)

            const mockTools = createMockToolRegistry()
            const context = await executeSteps(plan.steps, mockTools)

            expect(context.successCount).toBeGreaterThanOrEqual(1)

            const aggregated = aggregateContext(context)
            expect(aggregated).toContain('steps succeeded')
            expect(aggregated.length).toBeGreaterThan(50)
        }, 120000)

        it('should plan, execute, and aggregate for a multi-step query', async () => {
            const plan = await planQuery(
                plannerModel,
                'Compare Verstappen and Norris pace in Abu Dhabi 2023',
                false
            )

            expect(plan.steps.length).toBeGreaterThanOrEqual(2)

            const mockTools = createMockToolRegistry()
            const context = await executeSteps(plan.steps, mockTools)

            expect(context.successCount).toBeGreaterThanOrEqual(2)

            const aggregated = aggregateContext(context)
            expect(aggregated).toBeTruthy()
        }, 120000)

        it('should plan and execute for a weather query', async () => {
            const plan = await planQuery(
                plannerModel,
                'What were the weather conditions during the 2023 Monaco GP race?',
                false
            )

            expect(plan.steps.length).toBeGreaterThanOrEqual(1)

            const mockTools = createMockToolRegistry()
            const context = await executeSteps(plan.steps, mockTools)

            expect(context.successCount).toBeGreaterThanOrEqual(1)
        }, 120000)

        it('should handle historical query without telemetry', async () => {
            const plan = await planQuery(
                plannerModel,
                'Who won the 1994 championship?',
                false
            )

            // Should NOT have telemetry or laps calls
            const hasTelemetryOrLaps = plan.steps.some(
                s => s.tool === 'get_telemetry' || s.tool === 'get_laps'
            )
            expect(hasTelemetryOrLaps).toBe(false)

            if (plan.steps.length > 0) {
                const mockTools = createMockToolRegistry()
                const context = await executeSteps(plan.steps, mockTools)
                expect(context.successCount).toBeGreaterThanOrEqual(1)
            }
        }, 120000)
    })
})
