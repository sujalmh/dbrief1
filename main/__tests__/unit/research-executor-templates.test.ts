import { describe, it, expect } from 'vitest'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { ToolRegistry } from '@/lib/research/tool-registry'
import { EvidenceStore } from '@/lib/research/evidence-store'
import { ResearchMemory } from '@/lib/research/memory'
import { Executor } from '@/lib/research/agents/executor'
import { fetchWebPagesTool } from '@/lib/tools/search'
import type { ToolMetadata } from '@/lib/research/types'

const searchMeta = (name: string, outputType: any): ToolMetadata => ({
    name,
    description: `${name} stub`,
    category: 'search',
    outputType,
    outputShape: '{}',
    requires: [],
    provides: [outputType],
})

describe('Research executor template resolution', () => {
    it('drops unresolved template items from url arrays', async () => {
        let captured: unknown = null
        const fetchStub = tool(
            async (input) => {
                captured = input
                return JSON.stringify({ pages: [], errors: [] })
            },
            {
                name: 'fetch_web_pages',
                description: 'stub',
                schema: (fetchWebPagesTool as any).schema,
            }
        )
        const searchStub = tool(async () => JSON.stringify({ results: [], query: 'x' }), {
            name: 'web_search',
            description: 'stub',
            schema: z.object({ query: z.string() }),
        })
        const registry = new ToolRegistry()
        registry.register(searchStub, searchMeta('web_search', 'web_search'))
        registry.register(fetchStub, searchMeta('fetch_web_pages', 'web_fetch'))

        const ex = new Executor(registry, new EvidenceStore(), new ResearchMemory())
        const results = await ex.executeBatch([
            {
                id: 'task_1_1', description: 'search', tool: 'web_search',
                args: { query: 'x' }, dependsOn: [], status: 'pending', iteration: 1,
            },
            {
                id: 'task_1_2', description: 'fetch', tool: 'fetch_web_pages',
                args: { urls: ['{{task_1_1.results[0].url}}', '{{task_1_1.results[5].url}}'] },
                dependsOn: ['task_1_1'], status: 'pending', iteration: 1,
            },
        ])

        expect(results[1].success).toBe(true)
        expect(captured).toMatchObject({ urls: [] })
    })
})
