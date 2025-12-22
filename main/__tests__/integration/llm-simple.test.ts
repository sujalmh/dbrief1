import { describe, it, expect } from 'vitest';
import { priorityPrompts } from '../fixtures/test-prompts';

/**
 * Simple integration tests for LLM chat flow
 * Tests the streaming API with real prompts
 * 
 * Run with: npm test -- __tests__/integration/llm-simple.test.ts --run
 */

const API_BASE_URL = 'http://localhost:3000';

async function testChatPrompt(prompt: string) {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            message: prompt,
            provider: 'openrouter',
            model: 'qwen/qwen-2.5-coder-32b-instruct',
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`API returned ${response.status}: ${error}`);
    }

    // Parse streaming response
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let executionResults: any[] = [];
    let fullResponse = '';
    let hasError = false;
    let errorMessage = '';

    if (reader) {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.event === 'visualization') {
                            executionResults = parsed.data.data || [];
                        }

                        if (parsed.event === 'token') {
                            fullResponse += parsed.data.content;
                        }

                        if (parsed.event === 'error') {
                            hasError = true;
                            errorMessage = parsed.data.message;
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        }
    }

    return {
        executionResults,
        fullResponse,
        hasError,
        errorMessage,
    };
}

describe('LLM Integration - Simple Tests', () => {
    it('should handle Monaco 2024 comparison without NaN errors', async () => {
        const result = await testChatPrompt('compare times between lando and oscar in monaco 2024 race');

        // Should not have errors
        expect(result.hasError).toBe(false);

        // Should have execution results
        expect(result.executionResults.length).toBeGreaterThan(0);

        // Check for NaN errors in execution results
        const hasNaNError = result.executionResults.some((r: any) =>
            r.error?.includes('NaN') ||
            r.error?.includes('expected number, received NaN')
        );

        expect(hasNaNError).toBe(false);

        // Should have a response
        expect(result.fullResponse.length).toBeGreaterThan(0);

        console.log(`✓ Monaco 2024: ${result.executionResults.length} steps, ${result.fullResponse.length} chars response`);
    }, 60000);

    it('should handle Abu Dhabi 2023 comparison without NaN errors', async () => {
        const result = await testChatPrompt('compare times between lando and oscar in abu dhabi 2023 gp');

        expect(result.hasError).toBe(false);
        expect(result.executionResults.length).toBeGreaterThan(0);

        const hasNaNError = result.executionResults.some((r: any) =>
            r.error?.includes('NaN') ||
            r.error?.includes('expected number, received NaN')
        );

        expect(hasNaNError).toBe(false);
        expect(result.fullResponse.length).toBeGreaterThan(0);

        console.log(`✓ Abu Dhabi 2023: ${result.executionResults.length} steps, ${result.fullResponse.length} chars response`);
    }, 60000);

    it('should properly resolve session_key dependencies', async () => {
        const result = await testChatPrompt('show me verstappen lap times in bahrain 2024 race');

        expect(result.hasError).toBe(false);

        // Find get_sessions and get_laps steps
        const sessionsStep = result.executionResults.find((r: any) => r.tool === 'get_sessions');
        const lapsStep = result.executionResults.find((r: any) => r.tool === 'get_laps');

        if (sessionsStep && lapsStep) {
            // Sessions should have succeeded
            expect(sessionsStep.success).toBe(true);

            // Laps should have succeeded (meaning session_key was resolved)
            expect(lapsStep.success).toBe(true);

            // Should not have unresolved placeholders
            const hasUnresolvedDep = JSON.stringify(lapsStep).includes('USE_FROM_STEP');
            expect(hasUnresolvedDep).toBe(false);
        }

        console.log(`✓ Dependency resolution: ${result.executionResults.length} steps executed`);
    }, 60000);
});
