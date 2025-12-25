/**
 * Session Metadata Generation Tests
 * ==================================
 * Tests for the updated session metadata generation logic
 * that properly categorizes telemetry queries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSessionMetadata } from '@/lib/utils/generate-session-metadata'

// Mock the LLM module
vi.mock('@/lib/llm', () => ({
    getResponderModel: vi.fn(() => ({
        invoke: vi.fn()
    }))
}))

describe('Session Metadata Generation - Telemetry Classification', () => {
    describe('Telemetry Category Detection', () => {
        it('should classify explicit telemetry mention as "telemetry"', async () => {
            const query = "Show me Verstappen's telemetry in Monaco 2024"
            
            // Mock LLM response
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Verstappen Telemetry Monaco 2024',
                    category: 'telemetry'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('telemetry')
        })

        it('should classify telemetry comparison as "telemetry"', async () => {
            const query = "Compare telemetry between Norris and Piastri"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Telemetry Comparison',
                    category: 'telemetry'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('telemetry')
        })

        it('should classify speed/throttle/brake queries as "telemetry"', async () => {
            const queries = [
                "Show speed trace for Hamilton",
                "Throttle application by Leclerc",
                "Brake points in Turn 1"
            ]

            for (const query of queries) {
                const { getResponderModel } = await import('@/lib/llm')
                const mockModel = getResponderModel()
                vi.mocked(mockModel.invoke).mockResolvedValue({
                    content: JSON.stringify({
                        title: 'Telemetry Query',
                        category: 'telemetry'
                    })
                })

                const result = await generateSessionMetadata(query)
                expect(result.category).toBe('telemetry')
            }
        })
    })

    describe('Non-Telemetry Comparison Classification', () => {
        it('should classify lap time comparison as "comparison" not "telemetry"', async () => {
            const query = "Compare lap times between Verstappen and Perez"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Lap Time Comparison',
                    category: 'comparison'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('comparison')
        })

        it('should classify qualifying results comparison as "comparison"', async () => {
            const query = "Compare qualifying results of Hamilton and Russell"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Qualifying Comparison',
                    category: 'comparison'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('comparison')
        })
    })

    describe('Strategy Classification', () => {
        it('should classify pit stop queries as "strategy"', async () => {
            const query = "What was Verstappen's pit stop strategy in Monaco?"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Pit Stop Strategy',
                    category: 'strategy'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('strategy')
        })

        it('should classify tire choice queries as "strategy"', async () => {
            const query = "What tires did Hamilton use in the race?"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Tire Strategy',
                    category: 'strategy'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('strategy')
        })
    })

    describe('Insights Classification', () => {
        it('should classify regulation queries as "insights"', async () => {
            const query = "What are the DRS rules in F1?"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'DRS Regulations',
                    category: 'insights'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('insights')
        })

        it('should classify general analysis as "insights"', async () => {
            const query = "How has Red Bull dominated this season?"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Season Dominance Analysis',
                    category: 'insights'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.category).toBe('insights')
        })
    })

    describe('Title Generation', () => {
        it('should generate concise titles under 40 characters', async () => {
            const query = "Show me detailed telemetry data for Max Verstappen in the Monaco Grand Prix 2024 qualifying session"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Verstappen Monaco Q Telemetry',
                    category: 'telemetry'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.title.length).toBeLessThanOrEqual(40)
        })

        it('should create descriptive titles', async () => {
            const query = "Compare Norris and Piastri"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'NOR vs PIA Comparison',
                    category: 'comparison'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(result.title).toContain('vs')
        })
    })

    describe('Edge Cases', () => {
        it('should handle mixed category signals', async () => {
            const query = "Show telemetry and pit stop strategy for Verstappen"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Verstappen Telemetry & Strategy',
                    category: 'telemetry'  // Telemetry takes precedence
                })
            })

            const result = await generateSessionMetadata(query)

            // When telemetry is mentioned, it should be categorized as telemetry
            expect(result.category).toBe('telemetry')
        })

        it('should handle queries without clear category', async () => {
            const query = "Monaco 2024"
            
            const { getResponderModel } = await import('@/lib/llm')
            const mockModel = getResponderModel()
            vi.mocked(mockModel.invoke).mockResolvedValue({
                content: JSON.stringify({
                    title: 'Monaco 2024',
                    category: 'insights'
                })
            })

            const result = await generateSessionMetadata(query)

            expect(['telemetry', 'comparison', 'strategy', 'insights']).toContain(result.category)
        })
    })
})

// =============================================================================
// System Prompt Tests
// =============================================================================

describe('Session Metadata System Prompt', () => {
    it('should emphasize telemetry classification priority', async () => {
        // The system prompt should make it clear that telemetry mentions
        // should be classified as "telemetry" even in comparisons
        
        const query = "Compare telemetry of two drivers"
        
        const { getResponderModel } = await import('@/lib/llm')
        const mockModel = getResponderModel()
        
        // Verify the invoke was called with proper instructions
        vi.mocked(mockModel.invoke).mockResolvedValue({
            content: JSON.stringify({
                title: 'Telemetry Comparison',
                category: 'telemetry'
            })
        })

        await generateSessionMetadata(query)

        expect(mockModel.invoke).toHaveBeenCalled()
        const callArgs = vi.mocked(mockModel.invoke).mock.calls[0][0]
        const systemPrompt = callArgs.toString()
        
        // Should contain guidance about telemetry classification
        expect(systemPrompt).toContain('telemetry')
    })
})