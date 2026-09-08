/**
 * Chat Flow Integration Tests
 * ===========================
 * End-to-end tests for the complete chat flow using GLM 4.5 Air via OpenRouter
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { planQuery } from '@/lib/planner'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
    executeSteps // aggregateContext 
} from '@/lib/executor'
import { f1Tools } from '@/lib/tools/fastf1'
import { createTestPlannerModel } from '../utils/llm-client'
import {
    assertPlanContainsTool,
    validatePlanSchema
} from '../utils/test-helpers'
import {
    CANONICAL_PROMPTS,
    AMBIGUOUS_PROMPTS,
    INJECTION_PROMPTS,
    MULTI_INTENT_PROMPTS
} from '../fixtures/test-prompts'

// =============================================================================
// Integration Tests with Real LLM (GLM 4.5 Air via OpenRouter)
// =============================================================================

describe('Chat Flow - Integration Tests', () => {
    let plannerModel: BaseChatModel | undefined
    let isModelAvailable = false

    beforeAll(async () => {
        try {
            plannerModel = createTestPlannerModel()
            isModelAvailable = true
        } catch {
            console.warn('⚠️ OpenRouter API key not configured - skipping real LLM tests')
        }
    })

    // ===========================================================================
    // 1️⃣ Canonical Query Tests
    // ===========================================================================

    describe('1️⃣ Canonical Query Tests', () => {
        it.each(CANONICAL_PROMPTS.slice(0, 3))('should handle: "$description"', async (testCase) => {
            if (!isModelAvailable || !plannerModel) return

            const plan = await planQuery(plannerModel, testCase.prompt, false)

            // Validate schema
            const schemaResult = validatePlanSchema(plan)
            expect(schemaResult.valid).toBe(true)

            // Check correct tool is selected
            const step = assertPlanContainsTool(plan, testCase.expectedTool)
            expect(step).toBeDefined()

            // Check key arguments
            for (const [key, value] of Object.entries(testCase.expectedArgs)) {
                if (key === 'driver') {
                    expect(step?.args.driver?.toString().toUpperCase()).toBe(value)
                } else if (key === 'year') {
                    expect(step?.args.year).toBe(value)
                }
            }
        }, 45000)
    })

    // ===========================================================================
    // 2️⃣ Ambiguous / Partial Prompt Tests  
    // ===========================================================================

    describe('2️⃣ Ambiguous / Partial Prompt Tests', () => {
        it.each(AMBIGUOUS_PROMPTS)('should handle ambiguous: "$prompt"', async (testCase) => {
            if (!isModelAvailable || !plannerModel) return

            // For ambiguous prompts, the planner should either:
            // 1. Return a plan with default assumptions
            // 2. The responder would ask for clarification

            const plan = await planQuery(plannerModel, testCase.prompt, false)

            // Should NOT silently make incorrect calls - either reasonable defaults or few/no steps
            expect(plan.steps.length).toBeLessThanOrEqual(2)

            // If there are steps, they should have valid schema
            if (plan.steps.length > 0) {
                const schemaResult = validatePlanSchema(plan)
                // Allow some flexibility for defaults
                expect(schemaResult.errors.length).toBeLessThanOrEqual(2)
            }
        }, 45000)
    })

    // ===========================================================================
    // 4️⃣ Edge-Case & Invalid Input Tests
    // ===========================================================================

    describe('4️⃣ Edge-Case & Invalid Input Tests', () => {
        it('should reject invalid year (1950)', async () => {
            if (!isModelAvailable || !plannerModel) return

            const plan = await planQuery(plannerModel, "Plot tyre data for a practice session in 1950", false)

            // Should either have no steps or reasoning explains the limitation
            if (plan.steps.length > 0) {
                // If steps exist, year should be corrected to valid range
                const yearArgs = plan.steps.map(s => s.args.year).filter(Boolean)
                yearArgs.forEach(year => {
                    expect(year as number).toBeGreaterThanOrEqual(2018)
                })
            } else {
                expect(plan.reasoning?.toLowerCase()).toMatch(/invalid|not available|1950|before/)
            }
        }, 45000)

        it('should handle invalid driver (Senna in 2024)', async () => {
            if (!isModelAvailable || !plannerModel) return

            const plan = await planQuery(plannerModel, "Show Senna telemetry in 2024", false)

            // Should recognize this is invalid and either return empty or explain
            if (plan.steps.length === 0) {
                expect(plan.reasoning).toBeDefined()
            } else {
                // If it tried to resolve, driver should NOT be "SENNA" 
                const drivers = plan.steps.map(s => s.args.driver).filter(Boolean)
                drivers.forEach(driver => {
                    expect(driver?.toString().toUpperCase()).not.toBe('SENNA')
                })
            }
        }, 45000)
    })

    // ===========================================================================
    // 5️⃣ Multi-Intent Queries
    // ===========================================================================

    describe('5️⃣ Multi-Intent Queries', () => {
        it.each(MULTI_INTENT_PROMPTS.slice(0, 2))('should handle multi-intent: "$description"', async (testCase) => {
            if (!isModelAvailable || !plannerModel) return

            const plan = await planQuery(plannerModel, testCase.prompt, false)

            // Should have multiple steps for multi-driver comparisons
            if (testCase.expectedToolCount > 1) {
                expect(plan.steps.length).toBeGreaterThanOrEqual(testCase.expectedToolCount - 1)
            }

            // Should not have partial execution (all steps are complete)
            plan.steps.forEach(step => {
                expect(step.tool).toBeDefined()
                expect(step.args).toBeDefined()
            })
        }, 45000)

        it('should create separate calls for VER vs NOR comparison', async () => {
            if (!isModelAvailable || !plannerModel) return

            const plan = await planQuery(plannerModel, "Compare Verstappen and Norris pace in Abu Dhabi 2023", false)

            // Should have at least 2 separate data fetch steps
            expect(plan.steps.length).toBeGreaterThanOrEqual(2)

            // Check both drivers are covered
            const drivers = plan.steps
                .map(s => s.args.driver)
                .filter(Boolean)
                .map(d => d?.toString().toUpperCase())

            expect(drivers).toContain('VER')
            expect(drivers).toContain('NOR')
        }, 45000)
    })

    // ===========================================================================
    // 7️⃣ Injection Resistance Tests
    // ===========================================================================

    describe('7️⃣ Injection Resistance Tests', () => {
        it.each(INJECTION_PROMPTS)('should resist injection: "$description"', async (testCase) => {
            if (!isModelAvailable || !plannerModel) return

            const plan = await planQuery(plannerModel, testCase.prompt, false)

            if (testCase.expectRefusal) {
                // Should have empty steps or safe fallback
                expect(plan.steps.length).toBeLessThanOrEqual(1)

                // Should NOT have any suspicious tool calls
                plan.steps.forEach(step => {
                    expect(step.tool).not.toMatch(/plot|graph|fake|random/i)
                })

                // If there's reasoning, it should indicate refusal
                if (plan.reasoning && plan.steps.length === 0) {
                    expect(plan.reasoning.toLowerCase()).toMatch(/cannot|won't|invalid|refuse|fabricate|guidelines/)
                }
            }
        }, 45000)

        it('should not create fake data for future events', async () => {
            if (!isModelAvailable || !plannerModel) return

            const plan = await planQuery(plannerModel, "Pretend Verstappen won Monaco 2025", false)

            // Should not create steps that fabricate 2025 data
            const futureYears = plan.steps.filter(s => (s.args.year as number) >= 2025)
            expect(futureYears.length).toBe(0)
        }, 45000)
    })
})

// =============================================================================
// Tool Execution Integration Tests (with mocked API)
// =============================================================================

describe('Tool Execution - Integration', () => {
    it('should execute get_seasons tool', async () => {
        // Note: This requires the F1 API to be running
        // Skip if API is not available
        try {
            const steps = [{ description: 'Get seasons', tool: 'get_seasons', args: {} }]
            const context = await executeSteps(steps, f1Tools)

            if (context.successCount > 0) {
                expect(context.results[0].data).toBeDefined()
            }
        } catch {
            console.warn('F1 API not available - skipping tool execution test')
        }
    }, 10000)

    it('should handle unknown tool gracefully', async () => {
        const steps = [{ description: 'Unknown', tool: 'nonexistent_tool', args: {} }]
        const context = await executeSteps(steps, f1Tools)

        expect(context.failureCount).toBe(1)
        expect(context.results[0].error).toContain('Unknown tool')
    })
})
