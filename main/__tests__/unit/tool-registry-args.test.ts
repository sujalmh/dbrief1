import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createToolRegistry } from '@/lib/research/tool-registry'

const PREV_TINYFISH = process.env.TINYFISH_API_KEY

beforeEach(() => {
    process.env.TINYFISH_API_KEY = 'test-key'
})

afterEach(() => {
    if (PREV_TINYFISH === undefined) delete process.env.TINYFISH_API_KEY
    else process.env.TINYFISH_API_KEY = PREV_TINYFISH
})

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
        expect(prompt).toContain('get_constructor_standings')
    })

    it('lists fetch args without inventing names', () => {
        const prompt = createToolRegistry(true).toPromptString(true)
        expect(prompt).toMatch(/fetch_web_pages[\s\S]{0,400}urls/)
    })

    it('omits web tools when TinyFish is not configured', () => {
        delete process.env.TINYFISH_API_KEY
        const prompt = createToolRegistry(true).toPromptString(true)
        expect(prompt).not.toContain('web_search')
        expect(prompt).not.toContain('fetch_web_pages')
        expect(prompt).toContain('run_simulation')
    })
})
