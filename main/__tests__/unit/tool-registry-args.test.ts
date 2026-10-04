import { describe, it, expect } from 'vitest'
import { createToolRegistry } from '@/lib/research/tool-registry'

describe('ToolRegistry prompt args', () => {
    it('lists exact web_search arg names', () => {
        const prompt = createToolRegistry(true).toPromptString(true)
        expect(prompt).toContain('recency_minutes')
        expect(prompt).toContain('after_date')
        expect(prompt).not.toContain('recency_days')
    })

    it('lists exact FastF1 arg names', () => {
        const prompt = createToolRegistry(true).toPromptString(true)
        expect(prompt).toContain('year')
        expect(prompt).toContain('gp')
    })

    it('lists fetch args without inventing names', () => {
        const prompt = createToolRegistry(true).toPromptString(true)
        expect(prompt).toMatch(/fetch_web_pages[\s\S]{0,400}urls/)
    })
})
