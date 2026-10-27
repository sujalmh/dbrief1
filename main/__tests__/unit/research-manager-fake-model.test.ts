/**
 * Deep-research manager precision rules (fake model)
 * ==================================================
 * Runs a complete ResearchManager turn with deterministic fake LLM output
 * and a local simulation tool, so the test exercises the real manager,
 * executor, evidence store, synthesizer, and critic without network calls.
 *
 * The fake synthesizer first returns an invalid [E99] citation. The test
 * asserts the synthesizer re-prompts, keeps the valid [E1] citation, and
 * never leaks an unresolved evidence reference to the client.
 */

import { describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ResearchManager } from "@/lib/research/manager";
import type { ResearchEvent } from "@/lib/research/types";

const OBJECTIVE = "What if the race had one more lap? Simulate the time gap.";

const CLASSIFICATION = {
    researchType: "predictive",
    strategy: "Run a deterministic local simulation for the race time gap.",
    reasoning: "The question is a counterfactual predictive request.",
};

const INTENT = {
    primaryIntent: "Simulate a one-lap extension and report the time gap.",
    intentType: "predictive",
    entities: {
        drivers: [],
        teams: [],
        grandPrix: [],
        years: [2026],
        sessions: ["R"],
        other: ["simulation", "time gap"],
    },
    temporalContext: "2026 season",
    comparisonAxis: null,
    dataNeeds: ["a grounded simulation of the race time gap"],
    ambiguities: [],
    suggestedTools: ["run_simulation"],
    requiresSimulation: true,
    requiresWebSearch: false,
    conversationContext: "New question, no prior context.",
};

const PLAN_WITH_SIMULATION = {
    tasks: [
        {
            description: "Run a deterministic simulation for the time gap",
            tool: "run_simulation",
            args: {
                scenario_id: "deep-precision-test",
                horizon: "race",
                metric: "time",
                iterations: 1000,
                base_value: 24,
                variance: 3,
                seed: 42,
            },
            dependsOn: [],
            rationale: "Local deterministic tool with explicit parameters.",
        },
    ],
    reasoning: "One deterministic task is enough for this check.",
};

const EMPTY_PLAN = {
    tasks: [],
    reasoning: "No tool can answer this objective.",
};

const REFLECTION = {
    useful: true,
    answeredPart: "The simulation output is in the evidence store.",
    stillMissing: [],
    nextAction: "stop",
    nextStrategy: null,
    reasoning: "The simulation evidence answers the objective.",
};

const CRITIC_OK = {
    grounded: true,
    issues: [],
    severity: "ok",
};

function messageText(messages: unknown[]): string {
    return messages
        .map((message) => {
            const content = (message as { content?: unknown }).content;
            return typeof content === "string" ? content : JSON.stringify(content ?? "");
        })
        .join("\n");
}

async function* streamOf(content: string): AsyncGenerator<{ content: string }> {
    yield { content };
}

interface FakeModelOptions {
    plan: unknown;
    finalAnswer: string;
    retryAnswer?: string;
    captureSynthesizerPrompts?: string[];
    onStream?: () => void;
}

function createFakeModel(options: FakeModelOptions) {
    let plannerCalls = 0;

    const invoke = vi.fn(async (messages: unknown[]) => {
        const text = messageText(messages);

        if (text.includes("You are the Intent Analyzer")) {
            return { content: JSON.stringify(INTENT) };
        }
        if (text.includes("You are the Planner")) {
            plannerCalls += 1;
            return { content: JSON.stringify(options.plan) };
        }
        if (text.includes("You are the Reasoner") && text.includes("Classify the question")) {
            return { content: JSON.stringify(CLASSIFICATION) };
        }
        if (text.includes("After each batch of tool executions, you reflect")) {
            return { content: JSON.stringify(REFLECTION) };
        }
        if (text.includes("You are the Critic")) {
            return { content: JSON.stringify(CRITIC_OK) };
        }

        throw new Error(`Unexpected fake-model invoke prompt: ${text.slice(0, 120)}`);
    });

    const stream = vi.fn(async (messages: unknown[]) => {
        const text = messageText(messages);
        if (!text.includes("You are the Synthesizer")) {
            throw new Error(`Unexpected fake-model stream prompt: ${text.slice(0, 120)}`);
        }
        options.onStream?.();
        if (options.captureSynthesizerPrompts) {
            options.captureSynthesizerPrompts.push(text);
        }
        const isRetry = messages.length > 2;
        const answer = isRetry && options.retryAnswer !== undefined
            ? options.retryAnswer
            : options.finalAnswer;
        return streamOf(answer);
    });

    const model = {
        invoke,
        stream,
        // Force every agent onto its deterministic manual-JSON fallback.
        withStructuredOutput: vi.fn(() => {
            throw new Error("structured output failed: unsupported by the fake model");
        }),
    };

    return {
        model: model as unknown as BaseChatModel,
        invoke,
        stream,
        plannerCalls: () => plannerCalls,
    };
}

async function runManager(
    fake: ReturnType<typeof createFakeModel>,
    options: { maxIterations?: number; maxTasks?: number } = {}
): Promise<ResearchEvent[]> {
    const manager = new ResearchManager(
        fake.model,
        fake.model,
        {
            deepResearch: true,
            webSearch: true,
            maxTasks: options.maxTasks ?? 5,
            maxIterations: options.maxIterations ?? 1,
        }
    );

    const events: ResearchEvent[] = [];
    for await (const event of manager.run(OBJECTIVE)) {
        events.push(event);
    }
    return events;
}

function reportText(events: ResearchEvent[]): string {
    return events
        .filter((event): event is Extract<ResearchEvent, { type: "token" }> => event.type === "token")
        .map((event) => event.content)
        .join("");
}

describe("ResearchManager precision rules with a fake model", () => {
    it("collects evidence, re-prompts invalid citations, and streams only valid refs", async () => {
        const synthesizerPrompts: string[] = [];
        const fake = createFakeModel({
            plan: PLAN_WITH_SIMULATION,
            finalAnswer:
                "The simulation projects a mean of 24.00 seconds [E1], with a spurious range [E99].",
            retryAnswer: "The simulation projects a mean of 24.00 seconds [E1].",
            captureSynthesizerPrompts: synthesizerPrompts,
        });

        const events = await runManager(fake);
        const text = reportText(events);

        // One real tool execution produced one evidence item.
        const evidence = events.filter(
            (event): event is Extract<ResearchEvent, { type: "evidence" }> => event.type === "evidence"
        );
        expect(evidence).toHaveLength(1);
        expect(evidence[0].evidence.id).toBe("E1");
        expect(evidence[0].evidence.source.tool).toBe("run_simulation");
        expect(evidence[0].evidence.data).toBeTruthy();

        // The synthesizer saw the precision rules and the evidence context.
        expect(synthesizerPrompts).toHaveLength(2);
        expect(synthesizerPrompts[0]).toContain(
            "Quote numbers exactly as they appear in the evidence."
        );
        expect(synthesizerPrompts[0]).toContain(
            "Do not add a sentence that counts rows or teams."
        );
        expect(synthesizerPrompts[0]).toContain(
            "Do not claim a chart shows strategy, tyres, weather, or pit stops unless that data is in the evidence."
        );
        expect(synthesizerPrompts[0]).toContain("### Evidence [E1]");
        expect(synthesizerPrompts[1]).toContain("[E99]");

        // The valid citation survives and the invalid one never reaches the client.
        const refs = text.match(/\[E\d+\]/g) ?? [];
        expect(text).toContain("[E1]");
        expect(text).not.toContain("[E99]");
        expect(refs.length).toBeGreaterThan(0);
        expect(refs.every((ref) => ref === "[E1]")).toBe(true);

        // The critic ran and the manager reported one evidenced task.
        const verification = events.find(
            (event): event is Extract<ResearchEvent, { type: "verification" }> =>
                event.type === "verification"
        );
        expect(verification?.result.severity).toBe("ok");

        const done = events.find(
            (event): event is Extract<ResearchEvent, { type: "done" }> => event.type === "done"
        );
        expect(done).toBeDefined();
        expect(done?.result.evidenceCount).toBe(1);
        expect(done?.result.tasksExecuted).toBe(1);
    });

    it("refuses without calling the synthesizer when no evidence is collected", async () => {
        const fake = createFakeModel({
            plan: EMPTY_PLAN,
            finalAnswer: "This answer should never be generated.",
        });

        const events = await runManager(fake, { maxIterations: 2 });
        const text = reportText(events);

        expect(fake.stream).not.toHaveBeenCalled();
        expect(text).toContain("unable to retrieve any data");
        expect(text).not.toMatch(/\[E\d+\]/);

        const done = events.find(
            (event): event is Extract<ResearchEvent, { type: "done" }> => event.type === "done"
        );
        expect(done?.result.evidenceCount).toBe(0);
        expect(done?.result.tasksExecuted).toBe(0);
    });
});
