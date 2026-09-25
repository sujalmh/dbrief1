/**
 * Tests for full session persistence helpers (pure, no cloud needed)
 * =====================================================================
 * Covers: doc building (everything saved), size estimation, truncation
 * fallback when Storage is unavailable, and doc->message round-trip.
 */

import { describe, it, expect } from "vitest";
import {
    buildFullMessageDoc,
    docToMessage,
    estimateJsonBytes,
    truncateVisualizationPayload,
    truncateVizData,
    INLINE_BUDGET,
} from "@/lib/cf/serialization";
import type { Message } from "@/lib/store";

function assistantMessage(overrides: Partial<Message> = {}): Message {
    return {
        id: "m_1",
        role: "assistant",
        content: "Test answer",
        timestamp: 1700000000000,
        steps: [
            { description: "Get race", tool: "get_race", status: "success", args: { year: 2024, gp: "Monaco" } },
        ],
        citations: [{ source: "regs.pdf", type: "regulation", title: "Regs", url: null, source_url: "https://example.com/regs.pdf" }],
        visualizationData: [{ tool: "get_race", args: { year: 2024 }, success: true, data: { winner: "VER" } }],
        usage: {
            provider: "openrouter",
            model: "x/y",
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cost: 0.001,
        },
        degradedWarnings: [{ stage: "planner", kind: "rate_limit", message: "slow" }],
        reasoning: "why",
        researchType: "race_analysis",
        iterations: [{ iteration: 1, tasks: [{ id: "t1", description: "d", tool: "get_race", status: "success", args: { year: 2024 } }], reasoning: "r" }],
        evidence: [{ id: "E1", type: "race", source: { tool: "get_race", taskId: "t1", args: { year: 2024 } }, summary: "s", confidence: 0.9 }],
        confidence: { overall: 0.8, factors: { sourceCount: 1, completeness: 1, conflicts: 0, missingData: [], dataQuality: 0.9 } },
        reflections: [{ useful: true, answeredPart: "a", stillMissing: [], nextAction: "stop", reasoning: "r", iteration: 1 }],
        chartSpecs: [{ id: "c1", type: "bar", title: "T", dataSource: "E1", xField: "x", yField: "y", config: {} }],
        ...overrides,
    };
}

describe("session-io buildFullMessageDoc", () => {
    it("saves everything needed to resume (steps+args, viz, research, usage, warnings)", () => {
        const doc = buildFullMessageDoc("u1", assistantMessage());
        expect(doc.userId).toBe("u1");
        expect(doc.clientId).toBe("m_1");
        expect(doc.steps?.[0]?.args).toEqual({ year: 2024, gp: "Monaco" });
        expect(doc.visualizationData).toBeDefined();
        expect(doc.iterations?.[0]?.tasks[0]?.args).toEqual({ year: 2024 });
        expect(doc.evidence?.[0]?.source.tool).toBe("get_race");
        expect(doc.usage?.totalTokens).toBe(30);
        expect(doc.confidence?.overall).toBe(0.8);
        expect(doc.chartSpecs).toHaveLength(1);
        expect(doc.citations).toHaveLength(1);
    });

    it("caps runaway strings instead of blowing the 1MB doc limit", () => {
        const doc = buildFullMessageDoc("u1", assistantMessage({ content: "x".repeat(500_000) }));
        expect(estimateJsonBytes(doc)).toBeLessThan(INLINE_BUDGET);
    });

    it("round-trips doc -> message preserving resume fields", () => {
        const doc = buildFullMessageDoc("u1", assistantMessage());
        const msg = docToMessage("m_1", doc as unknown as Record<string, unknown>);
        expect(msg.id).toBe("m_1");
        expect(msg.steps?.[0]?.tool).toBe("get_race");
        expect(msg.visualizationData).toBeDefined();
        expect(msg.iterations).toHaveLength(1);
        expect(msg.evidence).toHaveLength(1);
        expect(msg.usage?.model).toBe("x/y");
    });

    it("persists the plan-decision trace even for no-tool direct replies", () => {
        const doc = buildFullMessageDoc(
            "u1",
            assistantMessage({
                steps: undefined,
                planTrace: { needsPlan: false, reasoning: "Greeting", replyPreview: "Hey!" },
            })
        );
        expect(doc.planTrace?.needsPlan).toBe(false);
        expect(doc.planTrace?.replyPreview).toBe("Hey!");
        const msg = docToMessage("m_1", doc as unknown as Record<string, unknown>);
        expect(msg.planTrace?.needsPlan).toBe(false);
        expect(msg.planTrace?.reasoning).toBe("Greeting");
    });

    it("persists the planner error that forced a fallback plan", () => {
        const doc = buildFullMessageDoc(
            "u1",
            assistantMessage({
                planTrace: {
                    needsPlan: true,
                    reasoning: "Fallback: could not determine specific intent",
                    plannerError: "Failed to parse planner response as JSON",
                },
            })
        );
        expect(doc.planTrace?.plannerError).toContain("Failed to parse");
        const msg = docToMessage("m_1", doc as unknown as Record<string, unknown>);
        expect(msg.planTrace?.plannerError).toContain("Failed to parse");
    });

    it("persists the client-measured response time for reopened sessions", () => {
        const doc = buildFullMessageDoc(
            "u1",
            assistantMessage({ usage: undefined, durationMs: 12400 })
        );
        expect(doc.durationMs).toBe(12400);
        const msg = docToMessage("m_1", doc as unknown as Record<string, unknown>);
        expect(msg.durationMs).toBe(12400);
        // Absent duration stays absent (legacy docs predate the field).
        const legacy = docToMessage("m_1", { role: "assistant", content: "hi", timestamp: 1 });
        expect(legacy.durationMs).toBeUndefined();
    });

    it("persists the refusal trace with failed steps", () => {
        const doc = buildFullMessageDoc(
            "u1",
            assistantMessage({
                refusal: {
                    reason: "all_steps_failed",
                    failedSteps: [{ step: 2, tool: "get_race", error: "Placeholder argument rejected" }],
                },
            })
        );
        expect(doc.refusal?.reason).toBe("all_steps_failed");
        expect(doc.refusal?.failedSteps).toHaveLength(1);
        const msg = docToMessage("m_1", doc as unknown as Record<string, unknown>);
        expect(msg.refusal?.failedSteps?.[0]?.tool).toBe("get_race");
    });
});

describe("session-io truncation fallback", () => {
    it("truncates telemetry point arrays head-only", () => {
        const points = Array.from({ length: 500 }, (_, i) => ({ t: i, v: i }));
        const { data, truncated } = truncateVizData({ data: points });
        expect(truncated).toBe(true);
        expect((data as { data: unknown[] }).data.length).toBeLessThan(500);
        expect((data as Record<string, unknown>).data_truncated_from).toBe(500);
    });

    it("leaves small payloads untouched", () => {
        const { payload, truncated } = truncateVisualizationPayload([
            { tool: "get_race", args: {}, success: true, data: { winner: "VER" } },
        ]);
        expect(truncated).toBe(false);
        expect(payload).toHaveLength(1);
    });
});
