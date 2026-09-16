/**
 * LLM Providers Unit Tests (OpenCode Zen / Go)
 * =============================================
 * Offline-safe: model construction performs no network calls.
 */

import { describe, it, expect } from "vitest";
import {
    getChatModel,
    getPlannerModel,
    isProviderConfigured,
    buildOpenCodeHeaders,
    OPENCODE_USER_AGENT,
    OPENCODE_SESSION_HEADER,
    ZEN_BASE_URL,
    GO_BASE_URL,
    ZEN_FREE_MODELS,
    GO_MODELS,
} from "@/lib/llm";

describe("OpenCode Zen provider", () => {
    it("exposes the Zen gateway base URL and free models", () => {
        expect(ZEN_BASE_URL).toBe("https://opencode.ai/zen/v1");
        expect(ZEN_FREE_MODELS).toContain("nemotron-3-ultra-free");
        expect(ZEN_FREE_MODELS).toContain("big-pickle");
    });

    it("creates a Zen chat model with an explicit API key", async () => {
        const model = await getChatModel(
            { provider: "zen", model: "nemotron-3-ultra-free" },
            "test-zen-key"
        );
        expect(model).toBeDefined();
        // @ts-expect-error - inspecting LangChain client config
        expect(model.clientConfig?.baseURL).toBe(ZEN_BASE_URL);
    });

    it("throws when no Zen key is available", async () => {
        const prev = process.env.OPENCODE_ZEN_API_KEY;
        delete process.env.OPENCODE_ZEN_API_KEY;
        try {
            await expect(
                getChatModel({ provider: "zen", model: "nemotron-3-ultra-free" })
            ).rejects.toThrow("OPENCODE_ZEN_API_KEY");
        } finally {
            if (prev !== undefined) process.env.OPENCODE_ZEN_API_KEY = prev;
        }
    });

    it("provides a free planner default", async () => {
        const model = await getPlannerModel("zen", "test-zen-key");
        expect(model).toBeDefined();
    });
});

describe("OpenCode Go provider", () => {
    it("exposes the Go gateway base URL and coding models", () => {
        expect(GO_BASE_URL).toBe("https://opencode.ai/zen/go/v1");
        expect(GO_MODELS).toContain("kimi-k2.7-code");
        expect(GO_MODELS).toContain("mimo-v2.5");
    });

    it("creates a Go chat model with an explicit API key", async () => {
        const model = await getChatModel({ provider: "go", model: "mimo-v2.5" }, "test-go-key");
        expect(model).toBeDefined();
        // @ts-expect-error - inspecting LangChain client config
        expect(model.clientConfig?.baseURL).toBe(GO_BASE_URL);
    });

    it("throws when no Go key is available", async () => {
        const prev = process.env.OPENCODE_GO_API_KEY;
        delete process.env.OPENCODE_GO_API_KEY;
        try {
            await expect(getChatModel({ provider: "go", model: "mimo-v2.5" })).rejects.toThrow(
                "OPENCODE_GO_API_KEY"
            );
        } finally {
            if (prev !== undefined) process.env.OPENCODE_GO_API_KEY = prev;
        }
    });
});

describe("isProviderConfigured", () => {
    it("reflects Zen/Go env keys", () => {
        const zenPrev = process.env.OPENCODE_ZEN_API_KEY;
        const goPrev = process.env.OPENCODE_GO_API_KEY;
        process.env.OPENCODE_ZEN_API_KEY = "x";
        delete process.env.OPENCODE_GO_API_KEY;
        try {
            expect(isProviderConfigured("zen")).toBe(true);
            expect(isProviderConfigured("go")).toBe(false);
        } finally {
            if (zenPrev !== undefined) process.env.OPENCODE_ZEN_API_KEY = zenPrev;
            else delete process.env.OPENCODE_ZEN_API_KEY;
            if (goPrev !== undefined) process.env.OPENCODE_GO_API_KEY = goPrev;
        }
    });
});

describe("OpenCode client identification", () => {
    it("builds headers with own user agent and stable session id", () => {
        expect(buildOpenCodeHeaders("sess-123")).toEqual({
            "User-Agent": OPENCODE_USER_AGENT,
            [OPENCODE_SESSION_HEADER]: "sess-123",
        });
        expect(OPENCODE_SESSION_HEADER).toBe("x-opencode-session");
        // Own agent name, not a generic SDK/HTTP-library name
        expect(OPENCODE_USER_AGENT).not.toMatch(/openai|axios|fetch|node/i);
    });

    it("omits the session header when no session id is given", () => {
        const headers = buildOpenCodeHeaders();
        expect(headers["User-Agent"]).toBe(OPENCODE_USER_AGENT);
        expect(headers[OPENCODE_SESSION_HEADER]).toBeUndefined();
    });

    it("sends UA + session headers on Zen requests", async () => {
        const model = (await getChatModel(
            { provider: "zen", model: "nemotron-3-ultra-free", sessionId: "sess-abc" },
            "test-zen-key"
        )) as unknown as { clientConfig?: { defaultHeaders?: Record<string, string> } };

        expect(model.clientConfig?.defaultHeaders?.["User-Agent"]).toBe(OPENCODE_USER_AGENT);
        expect(model.clientConfig?.defaultHeaders?.[OPENCODE_SESSION_HEADER]).toBe("sess-abc");
    });

    it("sends UA + session headers on Go requests", async () => {
        const model = (await getChatModel(
            { provider: "go", model: "mimo-v2.5", sessionId: "sess-abc" },
            "test-go-key"
        )) as unknown as { clientConfig?: { defaultHeaders?: Record<string, string> } };

        expect(model.clientConfig?.defaultHeaders?.["User-Agent"]).toBe(OPENCODE_USER_AGENT);
        expect(model.clientConfig?.defaultHeaders?.[OPENCODE_SESSION_HEADER]).toBe("sess-abc");
    });
});
