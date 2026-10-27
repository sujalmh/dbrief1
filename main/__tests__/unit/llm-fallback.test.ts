/**
 * Managed-model fallback decision tests
 * =====================================
 * Offline-safe: exercises the fallback classifier and the retry wrapper with
 * stubbed generation methods. No network calls.
 */

import { AIMessage, AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { afterEach, describe, expect, it } from "vitest";
import {
    chatContentToText,
    getChatModel,
    MANAGED_FALLBACK_MODEL,
    shouldUseManagedFallback,
    type ManagedFallbackContext,
} from "@/lib/llm";
import { MANAGED_DEFAULT_MODEL } from "@/lib/providers";

const originalGenerate = ChatOpenAI.prototype._generate;
const originalStream = ChatOpenAI.prototype._streamResponseChunks;

afterEach(() => {
    ChatOpenAI.prototype._generate = originalGenerate;
    ChatOpenAI.prototype._streamResponseChunks = originalStream;
});

async function withManagedKey<T>(fn: () => Promise<T>): Promise<T> {
    const previous = process.env.MANAGED_LLM_API_KEY;
    process.env.MANAGED_LLM_API_KEY = "test-managed-key";
    try {
        return await fn();
    } finally {
        if (previous === undefined) delete process.env.MANAGED_LLM_API_KEY;
        else process.env.MANAGED_LLM_API_KEY = previous;
    }
}

const MANAGED: ManagedFallbackContext = {
    mode: "managed",
    primaryModel: MANAGED_DEFAULT_MODEL,
};

function httpError(status: number, message = `HTTP ${status}`): Error {
    return Object.assign(new Error(message), { status });
}

function namedError(name: string, message = name): Error {
    const error = new Error(message);
    error.name = name;
    return error;
}

describe("managed fallback model policy", () => {
    it("uses only the allowed flash pair", () => {
        expect(MANAGED_DEFAULT_MODEL).toBe("deepseek-v4.1-flash");
        expect(MANAGED_FALLBACK_MODEL).toBe("mimo-v2.6-flash");
        expect(MANAGED_FALLBACK_MODEL).not.toBe(MANAGED_DEFAULT_MODEL);
    });
});

describe("shouldUseManagedFallback", () => {
    it.each([408, 500, 502, 503, 504, 529])(
        "falls back on transient HTTP %i",
        (status) => {
            expect(shouldUseManagedFallback(httpError(status), MANAGED)).toBe(true);
        }
    );

    it("falls back on network and timeout errors", () => {
        const messages = [
            "connect ECONNRESET",
            "connect ECONNREFUSED",
            "getaddrinfo ENOTFOUND gateway",
            "fetch failed",
            "socket hang up",
            "request timed out",
            "upstream overloaded",
            "503 Service Unavailable",
            "502 Bad Gateway",
        ];
        for (const message of messages) {
            expect(shouldUseManagedFallback(new Error(message), MANAGED)).toBe(true);
        }

        expect(
            shouldUseManagedFallback(namedError("TimeoutError", "deadline"), MANAGED)
        ).toBe(true);
    });

    it("does not fall back on auth errors", () => {
        expect(shouldUseManagedFallback(httpError(401), MANAGED)).toBe(false);
        expect(shouldUseManagedFallback(httpError(403), MANAGED)).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Invalid API key provided"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Unauthorized request"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Forbidden: access denied"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("invalid_api_key"), MANAGED)
        ).toBe(false);
    });

    it("does not fall back on quota or rate-limit errors", () => {
        expect(shouldUseManagedFallback(httpError(402), MANAGED)).toBe(false);
        expect(shouldUseManagedFallback(httpError(429), MANAGED)).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("quota exceeded for today"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("402 Insufficient credits"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Rate limit reached"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Too many requests, slow down"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("rate_limit_exceeded"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("insufficient_quota"), MANAGED)
        ).toBe(false);
    });

    it("does not fall back on model-not-found errors", () => {
        expect(shouldUseManagedFallback(httpError(404), MANAGED)).toBe(false);
        expect(shouldUseManagedFallback(httpError(410), MANAGED)).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Model not found: deepseek-v4.1-flash"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("model_not_found"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("No endpoints found for model"), MANAGED)
        ).toBe(false);
    });

    it("does not fall back on invalid-request or bad-output errors", () => {
        expect(shouldUseManagedFallback(httpError(400), MANAGED)).toBe(false);
        expect(shouldUseManagedFallback(httpError(422), MANAGED)).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Invalid request: tools malformed"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("Output parser returned invalid JSON"), MANAGED)
        ).toBe(false);
        expect(
            shouldUseManagedFallback(new Error("context length exceeded"), MANAGED)
        ).toBe(false);
    });

    it("does not fall back on unknown errors", () => {
        expect(
            shouldUseManagedFallback(new Error("something unexpected happened"), MANAGED)
        ).toBe(false);
        expect(shouldUseManagedFallback({ code: "mystery" }, MANAGED)).toBe(false);
        expect(shouldUseManagedFallback(undefined, MANAGED)).toBe(false);
    });

    it("keeps BYOK unchanged", () => {
        expect(
            shouldUseManagedFallback(httpError(503), {
                mode: "byok",
                primaryModel: MANAGED_DEFAULT_MODEL,
            })
        ).toBe(false);
    });

    it("does not retry after the caller signal aborts", () => {
        expect(
            shouldUseManagedFallback(httpError(503), {
                ...MANAGED,
                signalAborted: true,
            })
        ).toBe(false);
        expect(
            shouldUseManagedFallback(namedError("AbortError", "aborted"), {
                ...MANAGED,
                signalAborted: true,
            })
        ).toBe(false);
    });

    it("does not retry when the primary is already the fallback model", () => {
        expect(
            shouldUseManagedFallback(httpError(503), {
                mode: "managed",
                primaryModel: MANAGED_FALLBACK_MODEL,
            })
        ).toBe(false);
    });

    it("does not retry a primary outside the allowed default", () => {
        expect(
            shouldUseManagedFallback(httpError(503), {
                mode: "managed",
                primaryModel: "some-other-model",
            })
        ).toBe(false);
    });

    it("lets auth or quota text win over a transient status", () => {
        expect(
            shouldUseManagedFallback(
                httpError(500, "upstream said invalid API key"),
                MANAGED
            )
        ).toBe(false);
        expect(
            shouldUseManagedFallback(
                httpError(502, "quota exceeded while calling provider"),
                MANAGED
            )
        ).toBe(false);
    });

    it("reads a status nested in response or cause", () => {
        const nestedResponse = Object.assign(new Error("upstream failed"), {
            response: { status: 503 },
        });
        expect(shouldUseManagedFallback(nestedResponse, MANAGED)).toBe(true);

        const nestedCause = new Error("request failed", {
            cause: httpError(504),
        });
        expect(shouldUseManagedFallback(nestedCause, MANAGED)).toBe(true);
    });
});

describe("managed fallback execution", () => {
    it("retries the real model after a transient generation failure", async () => {
        const seen: string[] = [];
        ChatOpenAI.prototype._generate = async function (
            this: ChatOpenAI
        ): Promise<ChatResult> {
            seen.push(this.model);
            if (this.model === MANAGED_DEFAULT_MODEL) {
                throw httpError(503, "503 Service Unavailable");
            }
            return {
                generations: [
                    { text: "fallback ok", message: new AIMessage("fallback ok") },
                ],
            };
        } as typeof ChatOpenAI.prototype._generate;

        await withManagedKey(async () => {
            const model = await getChatModel({ mode: "managed" });
            const result = await model.invoke([new HumanMessage("hi")]);
            expect(chatContentToText(result.content)).toBe("fallback ok");
            expect(seen).toEqual([MANAGED_DEFAULT_MODEL, MANAGED_FALLBACK_MODEL]);
        });
    });

    it("does not retry an auth failure", async () => {
        const seen: string[] = [];
        ChatOpenAI.prototype._generate = async function (
            this: ChatOpenAI
        ): Promise<ChatResult> {
            seen.push(this.model);
            throw httpError(401, "401 Unauthorized");
        } as typeof ChatOpenAI.prototype._generate;

        await withManagedKey(async () => {
            const model = await getChatModel({ mode: "managed" });
            await expect(model.invoke([new HumanMessage("hi")])).rejects.toThrow(
                /401/
            );
            expect(seen).toEqual([MANAGED_DEFAULT_MODEL]);
        });
    });

    it("falls back when the primary stream fails before its first chunk", async () => {
        const seen: string[] = [];
        ChatOpenAI.prototype._streamResponseChunks = async function* (
            this: ChatOpenAI
        ): AsyncGenerator<ChatGenerationChunk> {
            seen.push(this.model);
            if (this.model === MANAGED_DEFAULT_MODEL) {
                throw httpError(503, "503 Service Unavailable");
            }
            yield new ChatGenerationChunk({
                text: "fallback stream",
                message: new AIMessageChunk("fallback stream"),
            });
        } as typeof ChatOpenAI.prototype._streamResponseChunks;

        await withManagedKey(async () => {
            const model = await getChatModel({ mode: "managed" });
            const stream = await model.stream([new HumanMessage("hi")]);
            let text = "";
            for await (const chunk of stream) {
                text += chatContentToText(chunk.content);
            }
            expect(text).toBe("fallback stream");
            expect(seen).toEqual([MANAGED_DEFAULT_MODEL, MANAGED_FALLBACK_MODEL]);
        });
    });
});
