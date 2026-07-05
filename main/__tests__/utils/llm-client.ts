/**
 * LLM Test Client for F1 Chatbot Testing
 * =======================================
 * Uses GLM 4.5 Air via OpenRouter (free tier) for testing
 */

import { ChatOpenAI } from "@langchain/openai"
import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env.local' })

// =============================================================================
// Configuration
// =============================================================================

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY

if (!OPENROUTER_API_KEY) {
    console.warn('⚠️  OPENROUTER_API_KEY not found in .env.local - LLM tests will fail')
}

// =============================================================================
// Model Factory
// =============================================================================

/**
 * Create a GLM 4.5 Air model via OpenRouter for testing.
 * This model uses internal reasoning tokens, so maxTokens must be high enough
 * to accommodate both reasoning and content output.
 */
export function createTestModel(temperature: number = 0): BaseChatModel {
    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY is required in .env.local')
    }

    return new ChatOpenAI({
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        apiKey: OPENROUTER_API_KEY,
        temperature,
        maxTokens: 16384,
        timeout: 90000,
        configuration: {
            baseURL: 'https://openrouter.ai/api/v1',
        },
    })
}

/**
 * Create a planner model with deterministic settings
 */
export function createTestPlannerModel(): BaseChatModel {
    return createTestModel(0) // temperature=0 for deterministic planning
}

/**
 * Create a responder model with some creativity
 */
export function createTestResponderModel(): BaseChatModel {
    return createTestModel(0.3) // slight creativity for natural responses
}

// =============================================================================
// Test Data Generators
// =============================================================================

/**
 * Generate mock lap data for testing
 */
export function generateMockLapData(driver: string, lapCount: number = 50): unknown[] {
    const laps = []
    for (let i = 1; i <= lapCount; i++) {
        laps.push({
            driver,
            lap_number: i,
            lap_time: `1:${(15 + Math.random() * 5).toFixed(3)}`,
            compound: i < 20 ? 'MEDIUM' : i < 40 ? 'HARD' : 'SOFT',
            sector1: `0:${(18 + Math.random() * 2).toFixed(3)}`,
            sector2: `0:${(33 + Math.random() * 3).toFixed(3)}`,
            sector3: `0:${(22 + Math.random() * 2).toFixed(3)}`
        })
    }
    return laps
}

/**
 * Generate mock telemetry data for testing
 */
export function generateMockTelemetryData(pointCount: number = 500): unknown[] {
    const data = []
    for (let i = 0; i < pointCount; i++) {
        const distance = i * 10 // Every 10m
        data.push({
            distance,
            Speed: 100 + Math.sin(i / 50) * 150 + Math.random() * 20,
            Throttle: Math.max(0, Math.min(100, 50 + Math.sin(i / 30) * 50 + Math.random() * 10)),
            Brake: Math.max(0, Math.min(100, Math.cos(i / 30) * 30 + Math.random() * 10)),
            nGear: Math.floor(1 + Math.random() * 7),
            DRS: i % 100 < 30 ? 1 : 0
        })
    }
    return data
}
