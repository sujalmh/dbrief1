/**
 * Tests for the Jev pre-classifier (lib/jev.ts).
 *
 * Why: the classifier sits in front of the full pipeline and can SKIP
 * expensive LLM calls, so the most important thing to test is *that the
 * gates are correct* — a false conversational fast-path would silently
 * drop a data question, and a classifier outage must never break chat.
 *
 * Network is fully mocked: no test hits https://opencode.ai/zen/v1/systemone.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    JEV_CONVERSATIONAL_REPLY,
    JEV_OFF_TOPIC_REPLY,
    buildJevState,
    classifyPrompt,
    isConversationalFastPath,
    isOffTopicRefusal,
    isRecencyRoute,
    type JevClassification,
} from "@/lib/jev";

function makeClassification(overrides: Partial<JevClassification> = {}): JevClassification {
    return {
        intent: "conversational",
        confidence: 0.95,
        probabilities: { conversational: 0.95, race_result: 0.05 },
        conversationalNoul: 0.8,
        recencyNoul: 0.1,
        meaningfulNoul: 0.9,
        inScopeNoul: 0.95,
        latencyMs: 900,
        model: "jev-1.13-free",
        ...overrides,
    };
}

const MANAGED_KEY_VARS = [
    "MANAGED_LLM_API_KEY",
    "LLM_API_KEY",
    "OPENCODE_GO_API_KEY",
    "OPENCODE_ZEN_API_KEY",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
    savedEnv = {};
    for (const k of MANAGED_KEY_VARS) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
    }
    process.env.MANAGED_LLM_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
    for (const k of MANAGED_KEY_VARS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function mockSystemOneResponse(body: unknown, ok = true, status = 200) {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok, status, json: async () => body });
    return fetchMock;
}

function validBody(overrides = {}) {
    return {
        model: "jev-1.13-free",
        answers: {
            intent: {
                type: "choice",
                choice: "conversational",
                probabilities: { conversational: 1 },
                confidence: 1,
            },
            is_conversational: { type: "noul", noul: 0.42 },
            is_recency: { type: "noul", noul: 0.2 },
            is_meaningful: { type: "noul", noul: 0.95 },
            is_in_scope: { type: "noul", noul: 0.95 },
            ...overrides,
        },
        usage: { input_tokens: 498, output_tokens: 102 },
    };
}

describe("isConversationalFastPath", () => {
    it("passes for high-confidence conversational with agreeing noul", () => {
        expect(isConversationalFastPath(makeClassification())).toBe(true);
    });

    it("blocks when choice confidence is low (avoids skipping data questions)", () => {
        expect(
            isConversationalFastPath(makeClassification({ confidence: 0.26 }))
        ).toBe(false);
    });

    it("blocks when the companion noul disagrees (false fast-path guard)", () => {
        expect(
            isConversationalFastPath(makeClassification({ conversationalNoul: 0.1 }))
        ).toBe(false);
    });

    it("blocks gibberish that defaults to conversational (meaningfulness gate)", () => {
        expect(
            isConversationalFastPath(
                makeClassification({ intent: "conversational", confidence: 0.99, conversationalNoul: 0.9, meaningfulNoul: 0.05 })
            )
        ).toBe(false);
    });

    it("blocks non-conversational intents even at full confidence", () => {
        expect(
            isConversationalFastPath(
                makeClassification({ intent: "recency_news", confidence: 1 })
            )
        ).toBe(false);
    });

    it("blocks null (classifier unavailable → full pipeline)", () => {
        expect(isConversationalFastPath(null)).toBe(false);
    });
});

describe("isRecencyRoute", () => {
    it("passes for confident recency_news choice", () => {
        expect(
            isRecencyRoute(
                makeClassification({ intent: "recency_news", confidence: 0.76, recencyNoul: 0.97 })
            )
        ).toBe(true);
    });

    it("passes on the recency noul alone when the choice is uncertain", () => {
        expect(
            isRecencyRoute(
                makeClassification({ intent: "race_result", confidence: 0.4, recencyNoul: 0.85 })
            )
        ).toBe(true);
    });

    it("noul does not override a confident data intent", () => {
        // Observed live: "Monaco 2024 qualifying" → race_result 1.0 + recency noul 0.73.
        expect(
            isRecencyRoute(
                makeClassification({ intent: "race_result", confidence: 1.0, recencyNoul: 0.85 })
            )
        ).toBe(false);
        // Observed live: "Who leads the championship" → standings 0.70 + noul 0.83.
        expect(
            isRecencyRoute(
                makeClassification({ intent: "standings", confidence: 0.7, recencyNoul: 0.83 })
            )
        ).toBe(false);
    });

    it("blocks telemetry/data queries (low recency noul, other intent)", () => {
        expect(
            isRecencyRoute(
                makeClassification({ intent: "race_result", confidence: 0.99, recencyNoul: 0.38 })
            )
        ).toBe(false);
    });

    it("blocks low-confidence recency choice with low noul (penalty-query split)", () => {
        expect(
            isRecencyRoute(
                makeClassification({ intent: "race_result", confidence: 0.41, recencyNoul: 0.34 })
            )
        ).toBe(false);
    });

    it("blocks null", () => {
        expect(isRecencyRoute(null)).toBe(false);
    });
});

describe("classifyPrompt (fail-open + request format)", () => {
    it("posts state + typed questions to the Zen systemone endpoint", async () => {
        const fetchMock = mockSystemOneResponse(validBody());
        const result = await classifyPrompt("Hey! How can you help with F1?", {
            sessionId: "sess-123",
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://opencode.ai/zen/v1/systemone");
        expect(init.method).toBe("POST");
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer test-key");
        expect(headers["x-opencode-session"]).toBe("sess-123");
        const body = JSON.parse(init.body as string);
        expect(body.model).toBe("jev-1.13-free");
        expect(body.state).toContain("How can you help");
        expect(body.questions.intent.type).toBe("choice");
        expect(body.questions.is_conversational.type).toBe("noul");
        expect(body.questions.is_recency.type).toBe("noul");
        expect(body.questions.is_meaningful.type).toBe("noul");
        expect(body.questions.is_in_scope.type).toBe("noul");

        expect(result).not.toBeNull();
        expect(result!.intent).toBe("conversational");
        expect(result!.confidence).toBe(1);
        expect(result!.conversationalNoul).toBeCloseTo(0.42);
    });

    it("returns null for empty input (no network call)", async () => {
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
        expect(await classifyPrompt("   ")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns null when no managed key is configured", async () => {
        for (const k of MANAGED_KEY_VARS) delete process.env[k];
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
        expect(await classifyPrompt("hello")).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns null on non-OK status (never throws)", async () => {
        mockSystemOneResponse({ error: "overloaded" }, false, 529);
        await expect(classifyPrompt("hello")).resolves.toBeNull();
    });

    it("returns null on malformed responses", async () => {
        mockSystemOneResponse({ garbage: true });
        await expect(classifyPrompt("hello")).resolves.toBeNull();
    });

    it("returns null when the choice is outside the known taxonomy", async () => {
        mockSystemOneResponse(
            validBody({
                intent: {
                    type: "choice",
                    choice: "something_brand_new",
                    probabilities: { something_brand_new: 1 },
                    confidence: 1,
                },
            })
        );
        await expect(classifyPrompt("hello")).resolves.toBeNull();
    });

    it("returns null when fetch itself throws (network down)", async () => {
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
        fetchMock.mockRejectedValue(new Error("fetch failed"));
        await expect(classifyPrompt("hello")).resolves.toBeNull();
    });

    it("clamps out-of-range probabilities into 0..1", async () => {
        mockSystemOneResponse(
            validBody({
                intent: {
                    type: "choice",
                    choice: "simulation",
                    probabilities: { simulation: 1.5 },
                    confidence: 2,
                },
                is_conversational: { type: "noul", noul: -0.5 },
                is_recency: { type: "noul", noul: 0.29 },
                is_meaningful: { type: "noul", noul: 0.9 },
            })
        );
        const result = await classifyPrompt("what if…");
        expect(result!.confidence).toBe(1);
        expect(result!.conversationalNoul).toBe(0);
    });
});

describe("conversational reply", () => {
    it("is a short warm capability message", () => {
        expect(JEV_CONVERSATIONAL_REPLY.length).toBeLessThan(300);
        expect(JEV_CONVERSATIONAL_REPLY).toMatch(/race results|telemetry|regulations|simulations/i);
    });

    it("off-topic reply redirects back to F1", () => {
        expect(JEV_OFF_TOPIC_REPLY.length).toBeLessThan(300);
        expect(JEV_OFF_TOPIC_REPLY).toMatch(/F1-only|Formula 1/i);
    });
});

describe("JEV_ENABLED kill-switch", () => {
    it("is enabled by default", async () => {
        const { isJevEnabled } = await import("@/lib/jev");
        delete process.env.JEV_ENABLED;
        expect(isJevEnabled()).toBe(true);
    });

    it("is disabled by false/0/off", async () => {
        const { isJevEnabled } = await import("@/lib/jev");
        for (const v of ["false", "FALSE", "0", "off", "disabled"]) {
            process.env.JEV_ENABLED = v;
            expect(isJevEnabled()).toBe(false);
        }
        delete process.env.JEV_ENABLED;
    });

    it("classifyPrompt returns null immediately when disabled (no network call)", async () => {
        process.env.JEV_ENABLED = "false";
        const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
        await expect(classifyPrompt("hello")).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        delete process.env.JEV_ENABLED;
    });
});

describe("buildJevState", () => {
    it("returns the bare message with no history", () => {
        expect(buildJevState("hello")).toBe("hello");
        expect(buildJevState("hello", [])).toBe("hello");
    });

    it("labels recent turns oldest-first with the current message last", () => {
        const state = buildJevState("and in 2023?", [
            { role: "user", content: "Who won Monaco 2024?" },
            { role: "assistant", content: "Charles Leclerc won." },
        ]);
        expect(state).toContain("user: Who won Monaco 2024?");
        expect(state).toContain("assistant: Charles Leclerc won.");
        expect(state.endsWith("Current message:\nand in 2023?")).toBe(true);
    });

    it("keeps only the last 4 turns and truncates long ones", () => {
        const history = Array.from({ length: 6 }, (_, i) => ({
            role: "user",
            content: `q${i} ` + "x".repeat(500),
        }));
        const state = buildJevState("now?", history);
        expect(state).not.toContain("q0");
        expect(state).toContain("q5");
        expect(state.length).toBeLessThan(2000);
    });

    it("drops non-user/assistant roles and blanks", () => {
        const state = buildJevState("hi", [
            { role: "system", content: "secret" },
            { role: "user", content: "   " },
        ]);
        expect(state).toBe("hi");
    });
});

describe("isOffTopicRefusal", () => {
    it("refuses clearly out-of-scope prompts", () => {
        expect(
            isOffTopicRefusal(makeClassification({ intent: "history_general", confidence: 0.5, inScopeNoul: 0.02 }))
        ).toBe(true);
    });

    it("refuses chit-chat-shaped off-topic before the fast-path (precedence)", () => {
        // Observed live: "What's the capital of France?" → conversational 0.88, scope 0.05.
        expect(
            isOffTopicRefusal(makeClassification({ confidence: 0.88, inScopeNoul: 0.05 }))
        ).toBe(true);
    });

    it("refuses middle-band chatty off-topic (jokes, trivia)", () => {
        // Observed live: "Tell me a joke" → conversational 1.00, scope 0.48.
        expect(
            isOffTopicRefusal(makeClassification({ inScopeNoul: 0.48 }))
        ).toBe(true);
    });

    it("passes greetings and F1 prompts", () => {
        expect(isOffTopicRefusal(makeClassification())).toBe(false);
        expect(
            isOffTopicRefusal(makeClassification({ intent: "race_result", confidence: 1, inScopeNoul: 0.98 }))
        ).toBe(false);
    });

    it("passes bare in-scope queries in the middle band (not chatty)", () => {
        // Observed live: "latest news" → recency_news 1.00, scope 0.48 → pipeline.
        expect(
            isOffTopicRefusal(makeClassification({ intent: "recency_news", confidence: 1, conversationalNoul: 0.03, inScopeNoul: 0.48 }))
        ).toBe(false);
    });

    it("fails toward the pipeline on ambiguity and outages", () => {
        expect(
            isOffTopicRefusal(makeClassification({ intent: "race_result", confidence: 0.9, inScopeNoul: 0.5 }))
        ).toBe(false);
        expect(isOffTopicRefusal(null)).toBe(false);
    });
});
