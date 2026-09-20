/**
 * Unit tests for the conversation export utility.
 * No React or browser APIs are exercised — we test the pure serializer.
 */

import { describe, it, expect } from "vitest"
import {
    exportToJson,
    exportToMarkdown,
} from "@/lib/utils/export-conversation"
import type { Message } from "@/lib/store"

const baseMessage: Omit<Message, "id" | "role" | "content" | "timestamp"> = {}

const sampleMessages: Message[] = [
    {
        id: "m_1",
        role: "user",
        content: "Who won Monaco 2024?",
        timestamp: Date.parse("2024-05-26T15:00:00Z"),
    },
    {
        id: "m_2",
        role: "assistant",
        content: "Charles Leclerc won the 2024 Monaco Grand Prix.",
        timestamp: Date.parse("2024-05-26T15:00:08Z"),
        reasoning: "The user asked about Monaco 2024; I'll check results.",
        steps: [
            { description: "Fetch results", tool: "get_results", status: "success" },
            { description: "Synthesize", tool: "synthesize", status: "success" },
        ],
        citations: [{ source: "FIA Results 2024-05-26", type: "results" }],
        evidence: [
            {
                id: "E1",
                type: "race",
                source: { tool: "get_results", taskId: "t1", args: {} },
                summary: "Leclerc P1, Piastri P2, Sainz P3",
                confidence: 0.95,
            },
        ],
        confidence: {
            overall: 0.95,
            factors: {
                sourceCount: 1,
                completeness: 1,
                conflicts: 0,
                missingData: [],
                dataQuality: 0.95,
            },
        },
    },
]

describe("exportToMarkdown", () => {
    it("includes a title, generated timestamp, and message count", () => {
        const md = exportToMarkdown(sampleMessages, {
            title: "Monaco 2024",
            generatedAt: "2024-05-26T16:00:00Z",
        })
        expect(md).toContain("# Monaco 2024")
        expect(md).toContain("Generated: 2024-05-26T16:00:00Z")
        expect(md).toContain("Messages: 2")
    })

    it("renders user and assistant messages with their roles", () => {
        const md = exportToMarkdown(sampleMessages, { generatedAt: "x" })
        expect(md).toMatch(/## 1\. User/)
        expect(md).toMatch(/## 2\. Race Engineer/)
        expect(md).toContain("Charles Leclerc won the 2024 Monaco Grand Prix.")
    })

    it("renders reasoning inside a collapsible block", () => {
        const md = exportToMarkdown(sampleMessages, { generatedAt: "x" })
        expect(md).toContain("<details><summary>Reasoning</summary>")
        expect(md).toContain("I'll check results.")
    })

    it("renders plan steps with status badges", () => {
        const md = exportToMarkdown(sampleMessages, { generatedAt: "x" })
        expect(md).toMatch(/1\. \*\*\[success\]\*\* Fetch results/)
        expect(md).toMatch(/2\. \*\*\[success\]\*\* Synthesize/)
    })

    it("renders evidence, confidence, and citations", () => {
        const md = exportToMarkdown(sampleMessages, { generatedAt: "x" })
        expect(md).toContain("Confidence: **95%**")
        expect(md).toContain("[E1] (race) Leclerc P1")
        expect(md).toContain("[results] FIA Results 2024-05-26")
    })

    it("falls back to the default title when none is provided", () => {
        const md = exportToMarkdown(sampleMessages, { generatedAt: "x" })
        expect(md).toContain("# Dbrief1 Conversation")
    })
})

describe("exportToJson", () => {
    it("returns a JSON string with the wrapper schema", () => {
        const json = exportToJson(sampleMessages, {
            title: "Monaco 2024",
            generatedAt: "2024-05-26T16:00:00Z",
        })
        const parsed = JSON.parse(json)
        expect(parsed.title).toBe("Monaco 2024")
        expect(parsed.generatedAt).toBe("2024-05-26T16:00:00Z")
        expect(parsed.messageCount).toBe(2)
        expect(parsed.messages).toHaveLength(2)
    })

    it("supports compact JSON via prettyJson: false", () => {
        const pretty = exportToJson(sampleMessages, { generatedAt: "x" })
        const compact = exportToJson(sampleMessages, {
            generatedAt: "x",
            prettyJson: false,
        })
        expect(pretty.length).toBeGreaterThan(compact.length)
    })
})
