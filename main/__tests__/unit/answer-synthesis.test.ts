/**
 * Final-answer synthesis style + chart wiring
 * ============================================
 *
 * Covers the shared house-style contract for BOTH final-answer writers
 * (standard responder prompt + deep synthesizer):
 *
 *   - sanitizeAnswerText: em dashes become hyphens, emojis/symbols are
 *     stripped, everything else (citations, lap times, markdown) is
 *     untouched.
 *   - describeChartsForPrompt: exact "Chart N" list injected for the LLM.
 *   - Prompt wiring: route + synthesizer use the shared blocks.
 *   - Synthesizer behavior with a fake model: the system prompt carries
 *     the chart list + style rules, and the streamed answer is sanitized.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
    ANSWER_STYLE_PROMPT,
    CHART_GUIDANCE_STANDARD_PROMPT,
    CHART_GUIDANCE_DEEP_PROMPT,
    describeChartsForPrompt,
    sanitizeAnswerText,
} from "@/lib/synthesis/answer-style";
import { Synthesizer } from "@/lib/research/agents/synthesizer";
import { EvidenceStore } from "@/lib/research/evidence-store";
import { ResearchMemory } from "@/lib/research/memory";
import type { ChartSpec } from "@/lib/research/types";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

// =============================================================================
// Sanitizer
// =============================================================================

describe("sanitizeAnswerText", () => {
    it("replaces em dashes with hyphens", () => {
        expect(sanitizeAnswerText("Q3 — 1:19.000")).toBe("Q3 - 1:19.000");
        expect(sanitizeAnswerText("a—b—c")).toBe("a-b-c");
        expect(sanitizeAnswerText("verdict ― final")).toBe("verdict - final");
    });

    it("preserves en dashes (year ranges)", () => {
        expect(sanitizeAnswerText("2023–2024 season")).toBe("2023–2024 season");
    });

    it("strips emojis incl. ZWJ sequences and flags", () => {
        expect(sanitizeAnswerText("VER wins 🏁")).toBe("VER wins ");
        expect(sanitizeAnswerText("pit crew did great")).toBe("pit crew did great");
        expect(sanitizeAnswerText("firm result")).toBe("firm result");
        expect(sanitizeAnswerText("key point ✦ insight")).toBe("key point  insight");
        expect(sanitizeAnswerText("star ★ driver")).toBe("star  driver");
        expect(sanitizeAnswerText("Good ✅ Bad ❌")).toBe("Good  Bad ");
    });

    it("leaves citations, lap times, markdown, and numbers alone", () => {
        const text = "VER averaged 1:32.600 [E1] over **57 laps** (437 pts, -0.4s). See Chart 1: Pace - Suzuka.";
        expect(sanitizeAnswerText(text)).toBe(text);
    });

    it("handles empty and plain text", () => {
        expect(sanitizeAnswerText("")).toBe("");
        expect(sanitizeAnswerText("plain answer")).toBe("plain answer");
    });
});

// =============================================================================
// Chart list formatting
// =============================================================================

function makeSpec(overrides: Partial<ChartSpec> = {}): ChartSpec {
    return {
        id: "spec_1",
        type: "swarm",
        title: "Pace Distribution - Suzuka 2024",
        dataSource: "E1",
        xField: "driver",
        yField: "lap_time",
        config: {},
        ...overrides,
    };
}

describe("describeChartsForPrompt", () => {
    it("returns the no-charts sentence when empty", () => {
        expect(describeChartsForPrompt([])).toBe("No charts available for this response.");
    });

    it('formats exact "Chart N" references with type and evidence', () => {
        const out = describeChartsForPrompt([
            makeSpec({ title: "Pace Distribution - Suzuka 2024", type: "swarm", dataSource: "E1" }),
            makeSpec({ id: "s2", title: "Position Progression - 2024", type: "bump", dataSource: "E2" }),
        ]);
        expect(out).toBe(
            'Chart 1: "Pace Distribution - Suzuka 2024" (type: swarm, evidence: E1)\n' +
            'Chart 2: "Position Progression - 2024" (type: bump, evidence: E2)'
        );
    });
});

// =============================================================================
// Shared prompt blocks
// =============================================================================

describe("shared style blocks", () => {
    it("bans emojis and em dashes", () => {
        expect(ANSWER_STYLE_PROMPT).toMatch(/NEVER use emojis/);
        expect(ANSWER_STYLE_PROMPT).toMatch(/NEVER use em dashes/);
    });

    it("standard guidance visualizes by default with a relevance bar", () => {
        expect(CHART_GUIDANCE_STANDARD_PROMPT).toMatch(/render automatically/);
        expect(CHART_GUIDANCE_STANDARD_PROMPT).toMatch(/Visualize whenever possible/);
        expect(CHART_GUIDANCE_STANDARD_PROMPT).toMatch(/earn its place/);
        expect(CHART_GUIDANCE_STANDARD_PROMPT).toMatch(/Add only what the chart doesn't say/);
        expect(CHART_GUIDANCE_STANDARD_PROMPT).toMatch(/Do NOT paste the full data table/);
        expect(CHART_GUIDANCE_STANDARD_PROMPT).toMatch(/headline finding/);
        expect(CHART_GUIDANCE_STANDARD_PROMPT).toMatch(/team and driver colors/);
    });

    it("deep guidance demands exact, earned chart references", () => {
        expect(CHART_GUIDANCE_DEEP_PROMPT).toMatch(/"Chart N: <exact title>"/);
        expect(CHART_GUIDANCE_DEEP_PROMPT).toMatch(/Reference every chart/);
        expect(CHART_GUIDANCE_DEEP_PROMPT).toMatch(/earn its place/);
        expect(CHART_GUIDANCE_DEEP_PROMPT).toMatch(/Add only what the chart doesn't say/);
        expect(CHART_GUIDANCE_DEEP_PROMPT).toMatch(/team and driver colors/);
    });
});

// =============================================================================
// Prompt wiring
// =============================================================================

describe("synthesis prompt wiring", () => {
    it("standard responder uses the shared blocks", () => {
        const source = readSource("app/api/chat/route.ts");
        expect(source).toMatch(/ANSWER_STYLE_PROMPT/);
        expect(source).toMatch(/CHART_GUIDANCE_STANDARD_PROMPT/);
        expect(source).toMatch(/from "@\/lib\/synthesis\/answer-style"/);
    });

    it("deep synthesizer uses the shared blocks + sanitizer", () => {
        const source = readSource("lib/research/agents/synthesizer.ts");
        expect(source).toMatch(/ANSWER_STYLE_PROMPT/);
        expect(source).toMatch(/CHART_GUIDANCE_DEEP_PROMPT/);
        expect(source).toMatch(/describeChartsForPrompt\(chartSpecs\)/);
        expect(source).toMatch(/sanitizeAnswerText\(fullText\)/);
    });
});

// =============================================================================
// Synthesizer behavior (fake model — no LLM calls)
// =============================================================================

function fakeModel(canned: string, captured: { system?: string; calls?: number }) {
    return {
        stream: async function* (messages: Array<{ content?: unknown }>) {
            captured.calls = (captured.calls ?? 0) + 1;
            captured.system = String(messages[0]?.content ?? "");
            yield { content: canned };
        },
    } as unknown as BaseChatModel;
}

function seededStore(): EvidenceStore {
    const store = new EvidenceStore();
    store.add(
        {
            taskId: "T1",
            tool: "get_laps",
            args: { year: 2024, gp: "Suzuka" },
            success: true,
            data: { laps: [{ lap_number: 1, lap_time: "1:32.600", driver: "VER" }] },
            durationMs: 5,
        },
        {
            name: "get_laps",
            description: "lap times",
            category: "data",
            outputType: "laps",
            outputShape: "laps",
            requires: [],
            provides: ["laps"],
        }
    );
    return store;
}

const CONFIDENCE = {
    overall: 0.9,
    factors: { sourceCount: 1, completeness: 1, conflicts: 0, missingData: [], dataQuality: 0.9 },
};

describe("Synthesizer chart + style behavior", () => {
    it("injects the exact chart list and style rules into the system prompt", async () => {
        const captured: { system?: string } = {};
        const synth = new Synthesizer(fakeModel("VER was fastest [E1].", captured));
        const specs = [makeSpec()];
        const gen = synth.generate({
            objective: "Who had the best pace?",
            researchType: "comparative",
            evidenceStore: seededStore(),
            memory: new ResearchMemory(),
            confidence: CONFIDENCE,
            chartSpecs: specs,
        });
        const tokens: string[] = [];
        for await (const token of gen) tokens.push(token);
        expect(tokens.length).toBeGreaterThan(0);
        expect(captured.system).toContain('Chart 1: "Pace Distribution - Suzuka 2024" (type: swarm, evidence: E1)');
        expect(captured.system).toContain("NEVER use emojis");
        expect(captured.system).toContain("NEVER use em dashes");
        expect(captured.system).toContain('"Chart N: <exact title>"');
    });

    it("sanitizes the streamed answer (em dash, emoji) but keeps citations", async () => {
        const captured: { system?: string } = {};
        const synth = new Synthesizer(
            fakeModel("VER was fastest — 1:32.600 🏁 and consistent [E1].", captured)
        );
        let out = "";
        const gen = synth.generate({
            objective: "Who had the best pace?",
            researchType: "comparative",
            evidenceStore: seededStore(),
            memory: new ResearchMemory(),
            confidence: CONFIDENCE,
            chartSpecs: [makeSpec()],
        });
        for await (const token of gen) out += token;
        expect(out).not.toContain("—");
        expect(out).not.toContain("🏁");
        expect(out).toContain("VER was fastest - 1:32.600");
        expect(out).toContain("[E1]");
    });

    it("refuse-on-empty path never calls the model", async () => {
        const captured: { calls?: number } = {};
        const synth = new Synthesizer(fakeModel("should never stream", captured));
        let out = "";
        const gen = synth.generate({
            objective: "Anything?",
            researchType: "factual",
            evidenceStore: new EvidenceStore(),
            memory: new ResearchMemory(),
            confidence: CONFIDENCE,
            chartSpecs: [],
        });
        for await (const token of gen) out += token;
        expect(captured.calls ?? 0).toBe(0);
        expect(out).toMatch(/unable to retrieve any data/);
    });
});
