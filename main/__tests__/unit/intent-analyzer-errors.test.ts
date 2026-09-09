/**
 * Tests for the IntentAnalyzer's new error-handling behaviour.
 *
 * Background: the IntentAnalyzer used to silently fall back to a
 * deterministic heuristic on ANY LLM error. The bug was that rate
 * limits (a *terminal* error — the LLM will keep failing) were treated
 * the same as "the LLM gave back unparseable prose" (a *recoverable*
 * error — heuristic is fine). The fix is to distinguish the two and
 * throw a typed `IntentAnalyzerUnavailableError` for terminal errors
 * so callers can surface them to the user instead of producing a
 * degraded response with no warning.
 *
 * Test strategy: we test the error-classification behaviour by making
 * the fake model throw the right errors when `invoke()` is called. The
 * `withStructuredOutput(...)` call internally uses `invoke`, so the
 * real classification path runs and decides which branch (heuristic
 * vs. throw) to take.
 */

import { describe, it, expect } from "vitest";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { IntentAnalyzer, IntentAnalyzerUnavailableError } from "@/lib/research/agents/intent-analyzer";

class FakeModel extends BaseChatModel {
    public invokeImpl: (messages: any[]) => Promise<any>;
    public structuredInvokeImpl?: (messages: any[]) => Promise<any>;

    constructor(impl: (messages: any[]) => Promise<any>) {
        super({});
        this.invokeImpl = impl;
    }

    async invoke(messages: any): Promise<any> {
        return this.invokeImpl(messages);
    }

    // Override `withStructuredOutput` so we can control what happens on
    // the structured-output path independently of the manual invoke
    // path. The default LangChain implementation throws "strict mode
    // not supported" on a fake model, which would make every test take
    // the same code path regardless of what we want to test.
    withStructuredOutput(): any {
        const self = this;
        return {
            invoke: async (messages: any) => {
                if (self.structuredInvokeImpl) {
                    return self.structuredInvokeImpl(messages);
                }
                // Default: behave like a normal invoke.
                return self.invokeImpl(messages);
            },
        };
    }

    // The IntentAnalyzer calls `model.withStructuredOutput(...)`. We
    // delegate to the same invokeImpl so the error is thrown naturally.
    bindTools(): this {
        return this;
    }

    _llmType(): string {
        return "fake";
    }

    // _generate is an abstract method on BaseChatModel. We don't
    // actually call it (IntentAnalyzer only uses invoke() and
    // withStructuredOutput().invoke()), but TypeScript needs the method
    // to exist for FakeModel to be non-abstract. Throwing makes
    // accidental use fail loudly.
    async _generate(_messages: any, _options?: any): Promise<any> {
        throw new Error(
            "FakeModel._generate is not implemented — use .invoke() instead"
        );
    }
}

function rateLimitError(): Error {
    const err = new Error("429 Rate limit exceeded: free-models-per-day-high-balance.") as Error & {
        status?: number;
    };
    err.status = 429;
    return err;
}

function unauthorizedError(): Error {
    const err = new Error("401 Incorrect API key provided") as Error & { status?: number };
    err.status = 401;
    return err;
}

function networkError(): Error {
    return new Error("fetch failed: ECONNREFUSED");
}

function outputParserError(): Error {
    return new Error("OutputParserException: Could not parse LLM output");
}

describe("IntentAnalyzer — non-recoverable error handling (direct invoke path)", () => {
    it("throws IntentAnalyzerUnavailableError on 429 rate limit (the real bug)", async () => {
        const model = new FakeModel(async () => {
            throw rateLimitError();
        });
        const analyzer = new IntentAnalyzer(model as any);
        await expect(analyzer.analyze("Who won Monaco 2024?")).rejects.toBeInstanceOf(
            IntentAnalyzerUnavailableError
        );
    });

    it("throws IntentAnalyzerUnavailableError on 401 auth", async () => {
        const model = new FakeModel(async () => {
            throw unauthorizedError();
        });
        const analyzer = new IntentAnalyzer(model as any);
        await expect(analyzer.analyze("Who won Monaco 2024?")).rejects.toBeInstanceOf(
            IntentAnalyzerUnavailableError
        );
    });

    it("throws IntentAnalyzerUnavailableError on network error", async () => {
        const model = new FakeModel(async () => {
            throw networkError();
        });
        const analyzer = new IntentAnalyzer(model as any);
        await expect(analyzer.analyze("Who won Monaco 2024?")).rejects.toBeInstanceOf(
            IntentAnalyzerUnavailableError
        );
    });

    it("IntentAnalyzerUnavailableError carries a user-friendly message and the right kind", async () => {
        const model = new FakeModel(async () => {
            throw rateLimitError();
        });
        const analyzer = new IntentAnalyzer(model as any);

        let caught: unknown;
        try {
            await analyzer.analyze("test");
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(IntentAnalyzerUnavailableError);
        const e = caught as IntentAnalyzerUnavailableError;
        // The user message must mention something actionable —
        // waiting, switching, or settings — not a raw HTTP code.
        expect(e.userMessage).toMatch(/wait|switch|settings|provider|quota/i);
        // The cause preserves the original error for logging.
        expect(e.cause).toBeDefined();
    });
});

describe("IntentAnalyzer — recoverable errors still fall back to heuristic", () => {
    it("falls back to heuristic when LLM responds with garbage (parse failure)", async () => {
        // The IntentAnalyzer code classifies 'parse' / 'output parser'
        // / 'schema' / 'zod' errors as recoverable, so we should get a
        // valid heuristic result. The first `withStructuredOutput` call
        // will throw a parse-like error (recoverable), the code will
        // fall through to the manual invoke path, that will also throw,
        // and then the heuristic fallback runs.
        let callCount = 0;
        const model = new FakeModel(async () => {
            callCount++;
            return { content: "definitely not JSON" };
        });
        model.structuredInvokeImpl = async () => {
            callCount++;
            throw outputParserError();
        };
        const analyzer = new IntentAnalyzer(model as any);
        const result = await analyzer.analyze("Who won Monaco 2024?");
        // Heuristic should produce a valid IntentAnalysis even when
        // the LLM is completely useless.
        expect(result).toBeDefined();
        expect(result.intentType).toBeTruthy();
        expect(result.entities).toBeDefined();
        // Verify the LLM was actually called (and failed) — not just
        // that the heuristic produced a result by coincidence.
        expect(callCount).toBeGreaterThan(0);
    });
});
