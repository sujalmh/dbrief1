/**
 * Verification Test: Season Points Success
 * ========================================
 * Verifies that the new get_driver_standings tool fixes the season points failure.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { planQuery } from '@/lib/planner'
import { createTestPlannerModel } from '../utils/llm-client'
import { assertPlanContainsTool, assertPlanArgs } from '../utils/test-helpers'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

describe('Verification: Season Points Success', () => {
    let plannerModel: BaseChatModel | undefined

    beforeAll(() => {
        try {
            plannerModel = createTestPlannerModel()
        } catch {
            console.warn('Skipping tests - no API key')
        }
    })

    it('should select get_driver_standings for "Verstappen season points 2023"', async () => {
        if (!plannerModel) return

        const prompt = "Show Verstappen's season points for 2023"
        const plan = await planQuery(plannerModel, prompt, false)

        console.log('Plan for Specific Prompt:', JSON.stringify(plan, null, 2))

        const step = assertPlanContainsTool(plan, 'get_driver_standings')
        assertPlanArgs(step!, { year: 2023, driver: 'VER' })

        // Should be efficient (1 step)
        expect(plan.steps.length).toBe(1)
    }, 60000)

    it('should select get_driver_standings for "Who won the 2022 championship?"', async () => {
        if (!plannerModel) return

        const prompt = "Who won the 2022 championship?"
        const plan = await planQuery(plannerModel, prompt, false)

        console.log('Plan for Championship Prompt:', JSON.stringify(plan, null, 2))

        const step = assertPlanContainsTool(plan, 'get_driver_standings')
        assertPlanArgs(step!, { year: 2022 })
        // Might filter by position 1, or get all and filter in response
    }, 60000)
})
