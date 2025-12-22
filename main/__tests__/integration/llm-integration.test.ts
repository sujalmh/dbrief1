import { describe, it, expect, beforeAll } from 'vitest';
import { priorityPrompts, allTestPrompts } from '../fixtures/test-prompts';

/**
 * Integration tests for LLM-powered chat flow
 * Tests real OpenRouter API with qwen3-coder model
 * 
 * Run with: npm test -- __tests__/integration/llm-integration.test.ts --run
 */

const API_BASE_URL = 'http://localhost:3000';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

describe('LLM Integration Tests', () => {
    beforeAll(() => {
        if (!OPENROUTER_API_KEY) {
            throw new Error('OPENROUTER_API_KEY environment variable is required');
        }
    });

    describe('Priority Prompts', () => {
        it.each(priorityPrompts)('should handle: "%s"', async (prompt) => {
            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });

            expect(response.ok).toBe(true);
            const data = await response.json();

            // Verify response structure
            expect(data).toHaveProperty('response');
            expect(data).toHaveProperty('executionResults');

            // Check for NaN errors in execution results
            const hasNaNError = data.executionResults?.some((result: any) =>
                result.error?.includes('NaN') ||
                result.error?.includes('expected number, received NaN')
            );

            expect(hasNaNError).toBe(false);

            // Verify session_key is properly resolved (not a string placeholder)
            const hasUnresolvedDependency = data.executionResults?.some((result: any) =>
                JSON.stringify(result).includes('USE_FROM_STEP_')
            );

            expect(hasUnresolvedDependency).toBe(false);

            // Log results for debugging
            console.log(`\n✓ Prompt: "${prompt}"`);
            console.log(`  Steps executed: ${data.executionResults?.length || 0}`);
            console.log(`  Response length: ${data.response?.length || 0} chars`);

            if (data.executionResults) {
                data.executionResults.forEach((result: any, i: number) => {
                    const status = result.success ? '✓' : '✗';
                    console.log(`  ${status} Step ${i + 1}: ${result.tool || 'unknown'}`);
                    if (result.error) {
                        console.log(`    Error: ${result.error}`);
                    }
                });
            }
        }, 60000); // 60s timeout per test
    });

    describe('All Endpoint Coverage', () => {
        it.each(allTestPrompts.slice(0, 20))('should handle: "%s"', async (prompt) => {
            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });

            expect(response.ok).toBe(true);
            const data = await response.json();

            // Verify no NaN errors
            const hasNaNError = data.executionResults?.some((result: any) =>
                result.error?.includes('NaN') ||
                result.error?.includes('expected number, received NaN')
            );

            expect(hasNaNError).toBe(false);

            // Verify no unresolved dependencies
            const hasUnresolvedDependency = data.executionResults?.some((result: any) =>
                JSON.stringify(result).includes('USE_FROM_STEP_')
            );

            expect(hasUnresolvedDependency).toBe(false);

            console.log(`\n✓ "${prompt.substring(0, 50)}..."`);
        }, 60000);
    });

    describe('Dependency Resolution', () => {
        it('should properly resolve session_key from get_sessions to get_laps', async () => {
            const prompt = 'show me verstappen lap times in monaco 2024 race';

            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });

            const data = await response.json();

            // Find get_sessions step
            const sessionsStep = data.executionResults?.find((r: any) =>
                r.tool === 'get_sessions'
            );

            // Find get_laps step
            const lapsStep = data.executionResults?.find((r: any) =>
                r.tool === 'get_laps'
            );

            if (sessionsStep && lapsStep) {
                // Verify sessions returned data
                expect(sessionsStep.success).toBe(true);
                expect(sessionsStep.data).toBeDefined();

                // Verify laps step received numeric session_key
                expect(lapsStep.success).toBe(true);

                // The session_key should be a number, not a string placeholder
                const sessionKeyInRequest = lapsStep.args?.session_key;
                expect(typeof sessionKeyInRequest).toBe('number');
                expect(sessionKeyInRequest).not.toContain('USE_FROM_STEP');
            }
        }, 60000);

        it('should handle multi-driver comparisons with shared session_key', async () => {
            const prompt = 'compare lap times between verstappen and hamilton in bahrain 2024';

            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });

            const data = await response.json();

            // Should have 1 get_sessions + 2 get_laps (one per driver)
            const sessionsSteps = data.executionResults?.filter((r: any) =>
                r.tool === 'get_sessions'
            );
            const lapsSteps = data.executionResults?.filter((r: any) =>
                r.tool === 'get_laps'
            );

            expect(sessionsSteps?.length).toBeGreaterThanOrEqual(1);
            expect(lapsSteps?.length).toBeGreaterThanOrEqual(2);

            // All laps steps should have numeric session_key
            lapsSteps?.forEach((step: any) => {
                expect(typeof step.args?.session_key).toBe('number');
            });
        }, 60000);
    });

    describe('Error Handling', () => {
        it('should gracefully handle pre-2023 data requests', async () => {
            const prompt = 'show me verstappen data from 2022';

            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });

            const data = await response.json();

            // Should explain data is unavailable, not error
            expect(data.response).toBeDefined();
            expect(data.response.toLowerCase()).toContain('2023');
        }, 60000);

        it('should handle invalid country names gracefully', async () => {
            const prompt = 'show me data from the xyz grand prix 2024';

            const response = await fetch(`${API_BASE_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messages: [
                        {
                            role: 'user',
                            content: prompt,
                        },
                    ],
                }),
            });

            const data = await response.json();

            // Should not have NaN errors
            const hasNaNError = data.executionResults?.some((result: any) =>
                result.error?.includes('NaN')
            );

            expect(hasNaNError).toBe(false);
        }, 60000);
    });
});
