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
 * Create a GLM 4.5 Air model via OpenRouter for testing
 * This is the FREE model specified by the user
 */
export function createTestModel(temperature: number = 0): BaseChatModel {
    if (!OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY is required in .env.local')
    }

    return new ChatOpenAI({
        model: 'z-ai/glm-4.5-air:free',
        apiKey: OPENROUTER_API_KEY,
        temperature,
        maxTokens: 4096,
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
// Mock LLM for Unit Tests (No API calls)
// =============================================================================

export interface MockLLMConfig {
    responses: Map<RegExp, string>
    fallbackResponse: string
}

export class MockLLM {
    private responses: Map<RegExp, string>
    private fallbackResponse: string
    private callLog: string[] = []

    constructor(config: MockLLMConfig) {
        this.responses = config.responses
        this.fallbackResponse = config.fallbackResponse
    }

    async invoke(prompt: string): Promise<string> {
        this.callLog.push(prompt)

        for (const [pattern, response] of this.responses) {
            if (pattern.test(prompt)) {
                return response
            }
        }

        return this.fallbackResponse
    }

    getCallLog(): string[] {
        return this.callLog
    }

    clearCallLog(): void {
        this.callLog = []
    }
}

/**
 * Create a mock LLM that returns predetermined plan responses
 */
export function createMockPlannerLLM(): MockLLM {
    return new MockLLM({
        responses: new Map([
            [/verstappen.*lap.*monaco/i, JSON.stringify({
                steps: [
                    { description: "Get Verstappen lap times", tool: "get_laps", args: { year: 2023, gp: "Monaco", session: "R", driver: "VER" } }
                ],
                reasoning: "Fetching lap times for VER at Monaco"
            })],
            [/hamilton.*tyre.*imola/i, JSON.stringify({
                steps: [
                    { description: "Get Hamilton tyre data", tool: "get_tyres", args: { year: 2020, gp: "Imola", session: "R", driver: "HAM" } }
                ],
                reasoning: "Fetching tyre stint data for HAM at Imola"
            })],
            [/compare.*ferrari.*red bull.*monza/i, JSON.stringify({
                steps: [
                    { description: "Get Leclerc laps", tool: "get_laps", args: { year: 2021, gp: "Monza", session: "R", driver: "LEC" } },
                    { description: "Get Sainz laps", tool: "get_laps", args: { year: 2021, gp: "Monza", session: "R", driver: "SAI" } },
                    { description: "Get Verstappen laps", tool: "get_laps", args: { year: 2021, gp: "Monza", session: "R", driver: "VER" } },
                    { description: "Get Perez laps", tool: "get_laps", args: { year: 2021, gp: "Monza", session: "R", driver: "PER" } }
                ],
                reasoning: "Fetching lap data for Ferrari and Red Bull drivers for comparison"
            })],
            [/qualifying.*silverstone/i, JSON.stringify({
                steps: [
                    { description: "Get qualifying results", tool: "get_qualifying", args: { year: 2024, gp: "Silverstone" } }
                ],
                reasoning: "Fetching qualifying results for Silverstone"
            })],
            [/telemetry.*leclerc.*bahrain/i, JSON.stringify({
                steps: [
                    { description: "Get Leclerc telemetry", tool: "get_telemetry", args: { year: 2023, gp: "Bahrain", session: "R", driver: "LEC", lap: "fastest" } }
                ],
                reasoning: "Fetching fastest lap telemetry for LEC at Bahrain"
            })],
            [/senna.*2024/i, JSON.stringify({
                steps: [],
                reasoning: "Cannot provide Senna data for 2024 - driver not racing in this era"
            })],
            // Historical year patterns (use ergast tools)
            [/\b2017\b.*(?:standings|points|championship)/i, JSON.stringify({
                steps: [{ description: "Get 2017 driver standings", tool: "get_driver_standings", args: { year: 2017 } }],
                reasoning: "Fetching 2017 season standings via Ergast API"
            })],
            [/\b2010\b.*(?:standings|points|championship)/i, JSON.stringify({
                steps: [{ description: "Get 2010 driver standings", tool: "get_driver_standings", args: { year: 2010 } }],
                reasoning: "Fetching 2010 season standings via Ergast API"
            })],
            [/\b2000\b.*(?:standings|points|championship)/i, JSON.stringify({
                steps: [{ description: "Get 2000 driver standings", tool: "get_driver_standings", args: { year: 2000 } }],
                reasoning: "Fetching 2000 season standings via Ergast API"
            })],
            [/\b1994\b/i, JSON.stringify({
                steps: [{ description: "Get 1994 driver standings", tool: "get_driver_standings", args: { year: 1994 } }],
                reasoning: "1994 season - using Ergast API for standings"
            })],
            [/\b1950\b|first.*season/i, JSON.stringify({
                steps: [{ description: "Get 1950 driver standings", tool: "get_driver_standings", args: { year: 1950 } }],
                reasoning: "1950 season - first F1 championship, fetching standings via Ergast API"
            })],
            [/\b(19\d{2}|200\d|201[0-7])\b.*(?:telemetry|lap.*times)/i, JSON.stringify({
                steps: [],
                reasoning: "Telemetry and lap-by-lap data not available for pre-2018 seasons. Only standings and race results available."
            })],
            [/ignore.*rules|fake.*data|made-up|pretend/i, JSON.stringify({
                steps: [],
                reasoning: "I cannot fabricate data or ignore my guidelines"
            })]
        ]),
        fallbackResponse: JSON.stringify({
            steps: [{ description: "Get events", tool: "get_events", args: { year: 2024 } }],
            reasoning: "Fallback to listing events"
        })
    })
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
