/**
 * Tests for the LLM error classifier.
 *
 * Why: the IntentAnalyzer / Planner / Responder / Synthesizer all share
 * the same "is this an LLM call failure we should fall back from, or
 * an LLM call failure we should surface?" decision. This helper is the
 * single source of truth for that decision, so the most important
 * thing to test is *that the decision is correct* — not the exact
 * string formatting.
 */

import { describe, it, expect } from "vitest";
import { classifyLlmError, isNonRecoverable, type LlmErrorKind } from "@/lib/utils/llm-errors";

describe("classifyLlmError", () => {
    describe("non-recoverable: rate limit / quota", () => {
        it("classifies 429 status as rate_limit", () => {
            const err = Object.assign(new Error("Rate limit exceeded"), { status: 429 });
            const cls = classifyLlmError(err, "Test");
            expect(cls.kind).toBe("rate_limit");
            expect(cls.recoverable).toBe(false);
        });

        it("classifies 'free-models-per-day' message as rate_limit (the real bug)", () => {
            // The exact wording from the user's bug report.
            const err = new Error("429 Rate limit exceeded: free-models-per-day-high-balance.");
            const cls = classifyLlmError(err, "Test");
            expect(cls.kind).toBe("rate_limit");
            expect(cls.recoverable).toBe(false);
            expect(cls.userMessage).toMatch(/rate-limit|quota|wait/i);
        });

        it("classifies 'quota' as rate_limit", () => {
            const cls = classifyLlmError(new Error("Quota exceeded"), "Test");
            expect(cls.kind).toBe("rate_limit");
            expect(cls.recoverable).toBe(false);
        });

        it("classifies 'too many requests' as rate_limit", () => {
            const cls = classifyLlmError(new Error("Too many requests"), "Test");
            expect(cls.kind).toBe("rate_limit");
            expect(cls.recoverable).toBe(false);
        });
    });

    describe("non-recoverable: auth", () => {
        it("classifies 401 as auth", () => {
            const err = Object.assign(new Error("Unauthorized"), { status: 401 });
            const cls = classifyLlmError(err, "Test");
            expect(cls.kind).toBe("auth");
            expect(cls.recoverable).toBe(false);
        });

        it("classifies 'invalid api key' as auth", () => {
            const cls = classifyLlmError(
                new Error("Incorrect API key provided: invalid_api_key"),
                "Test"
            );
            expect(cls.kind).toBe("auth");
            expect(cls.recoverable).toBe(false);
        });
    });

    describe("non-recoverable: model not found", () => {
        it("classifies 404 as model_not_found", () => {
            const err = Object.assign(new Error("Not found"), { status: 404 });
            const cls = classifyLlmError(err, "Test");
            expect(cls.kind).toBe("model_not_found");
            expect(cls.recoverable).toBe(false);
        });

        it("classifies OpenRouter 'is not a valid model ID' as model_not_found", () => {
            // Exact wording observed E2E 2026-09-08 (retired model slug).
            const cls = classifyLlmError(
                new Error("400 google/gemini-2.0-flash is not a valid model ID"),
                "Test"
            );
            expect(cls.kind).toBe("model_not_found");
            expect(cls.recoverable).toBe(false);
            expect(cls.userMessage).toMatch(/no longer available|different model/i);
        });
    });

    describe("non-recoverable: billing / quota", () => {
        it("classifies 402 insufficient credits as quota with billing guidance", () => {
            // Exact wording observed E2E 2026-09-08 (paid model, empty balance).
            const err = Object.assign(
                new Error("402 Insufficient credits. Add more using https://openrouter.ai/settings/credits"),
                { status: 402 }
            );
            const cls = classifyLlmError(err, "Test");
            expect(cls.kind).toBe("quota");
            expect(cls.recoverable).toBe(false);
            expect(cls.userMessage).toMatch(/credit|:free/i);
        });
    });

    describe("non-recoverable: network", () => {
        it("classifies 'fetch failed' as network", () => {
            const cls = classifyLlmError(new Error("fetch failed"), "Test");
            expect(cls.kind).toBe("network");
            expect(cls.recoverable).toBe(false);
        });

        it("classifies ECONNRESET as network", () => {
            const cls = classifyLlmError(new Error("read ECONNRESET"), "Test");
            expect(cls.kind).toBe("network");
            expect(cls.recoverable).toBe(false);
        });
    });

    describe("non-recoverable: overloaded", () => {
        it("classifies 503 as overloaded", () => {
            const err = Object.assign(new Error("Service Unavailable"), { status: 503 });
            const cls = classifyLlmError(err, "Test");
            expect(cls.kind).toBe("overloaded");
            expect(cls.recoverable).toBe(false);
        });
    });

    describe("recoverable: bad output (this is the heuristic-fallback case)", () => {
        it("classifies output parser errors as recoverable", () => {
            const cls = classifyLlmError(new Error("OutputParserException: no JSON"), "Test");
            expect(cls.kind).toBe("bad_output");
            expect(cls.recoverable).toBe(true);
        });

        it("classifies 'parse' errors as recoverable", () => {
            const cls = classifyLlmError(new Error("Failed to parse JSON"), "Test");
            expect(cls.kind).toBe("bad_output");
            expect(cls.recoverable).toBe(true);
        });

        it("classifies zod schema errors as recoverable", () => {
            const cls = classifyLlmError(new Error("ZodError: invalid_type"), "Test");
            expect(cls.kind).toBe("bad_output");
            expect(cls.recoverable).toBe(true);
        });
    });

    describe("safety net: unknown errors default to non-recoverable", () => {
        it("treats an unrecognised error as non-recoverable (so we surface, not swallow)", () => {
            // Regression: prior to this helper, ANY error from an LLM call
            // was silently swallowed. We explicitly want unknown errors
            // to surface — the heuristic-fallback path is opt-in for
            // known-recoverable cases only.
            const cls = classifyLlmError(new Error("Some new provider error we don't know yet"), "Test");
            expect(cls.recoverable).toBe(false);
        });
    });

    describe("isNonRecoverable", () => {
        it("returns the inverse of recoverable", () => {
            const cls = classifyLlmError(new Error("429 rate limit"), "Test");
            expect(isNonRecoverable(cls)).toBe(!cls.recoverable);
        });
    });

    describe("status extraction", () => {
        it("reads status from .status", () => {
            const err = Object.assign(new Error("x"), { status: 429 });
            expect(classifyLlmError(err, "Test").kind).toBe("rate_limit");
        });
        it("reads status from .statusCode", () => {
            const err = Object.assign(new Error("x"), { statusCode: 401 });
            expect(classifyLlmError(err, "Test").kind).toBe("auth");
        });
        it("reads status from .response.status", () => {
            const err = Object.assign(new Error("x"), { response: { status: 503 } });
            expect(classifyLlmError(err, "Test").kind).toBe("overloaded");
        });
    });

    describe("user messages are friendly (no jargon)", () => {
        it("rate-limit message tells the user what to do", () => {
            const cls = classifyLlmError(new Error("429 too many requests"), "Test");
            expect(cls.userMessage).toMatch(/wait|switch|settings/i);
        });
        it("auth message points the user to Settings", () => {
            const cls = classifyLlmError(new Error("401 unauthorized"), "Test");
            expect(cls.userMessage).toMatch(/settings|key/i);
        });
    });
});

// Re-export the type so it stays used in the test file even if all
// tests use a string literal instead of the type alias.
const _kind: LlmErrorKind = "rate_limit";
void _kind;
