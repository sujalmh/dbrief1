/**
 * LLM Test Client for Dbrief1 Testing
 * =======================================
 * Uses the cheapest OpenCode Go model (Muse Spark 1.3 Contributor:
 * $0.10/1M in, $0.20/1M out — highest request allowance on Go).
 * It only serves the /responses endpoint, so the client enables
 * LangChain's responses API. Key: OPENCODE_GO_API_KEY in
 * main/.env.local or the repo-root .env.
 * See: https://opencode.ai/docs/go/#usage-limits
 */

import { ChatOpenAI } from "@langchain/openai"
import { BaseChatModel } from "@langchain/core/language_models/chat_models"
import { config } from 'dotenv'

// Load environment variables (repo-root .env is the fallback for local dev)
config({ path: '.env.local' })
config({ path: '../.env' })

// =============================================================================
// Configuration
// =============================================================================

const GO_API_KEY = process.env.OPENCODE_GO_API_KEY

if (!GO_API_KEY) {
    console.warn('⚠️  OPENCODE_GO_API_KEY not found in .env.local - LLM tests will fail')
}

// =============================================================================
// Model Factory
// =============================================================================

/**
 * Create the cheapest Go model for testing.
 * maxTokens stays high to accommodate reasoning + content output.
 */
export function createTestModel(temperature: number = 0): BaseChatModel {
    if (!GO_API_KEY) {
        throw new Error('OPENCODE_GO_API_KEY is required in .env.local')
    }

    return new ChatOpenAI({
        model: 'muse-spark-1.3-contributor',
        apiKey: GO_API_KEY,
        temperature,
        maxTokens: 16384,
        timeout: 90000,
        useResponsesApi: true,
        configuration: {
            baseURL: 'https://opencode.ai/zen/go/v1',
            // Required by Go: own user agent + stable per-conversation session
            // for routing and prompt caching. See: https://opencode.ai/docs/go/
            defaultHeaders: {
                'User-Agent': 'dbrief1/1.0',
                'x-opencode-session': 'f1-local-tests',
            },
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
