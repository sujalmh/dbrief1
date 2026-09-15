/** Offline-safe: model construction performs no network calls. */

import { describe, it, expect } from "vitest";
import {
    getChatModel,
    getPlannerModel,
    getResponderModel,
    isProviderConfigured,
    isManagedConfigured,
    buildOpenCodeHeaders,
    OPENCODE_USER_AGENT,
    OPENCODE_SESSION_HEADER,
    ZEN_BASE_URL,
    GO_BASE_URL,
} from "@/lib/llm";
import {
    getManagedBaseUrl,
    getManagedModelId,
    normalizeBaseUrl,
    validateByokConfig,
} from "@/lib/providers";

const MANAGED_KEY = "test-managed-key";
const BYOK_KEY = "test-byok-key";
const BYOK_BASE = "https://example.com/v1";

function applyEnv(vars: Record<string, string | undefined>) {
    const prev: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
        prev[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    return () => {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
    const restore = applyEnv(vars);
    try {
        fn();
    } finally {
        restore();
    }
}

async function withEnvAsync(
    vars: Record<string, string | undefined>,
    fn: () => Promise<void>
) {
    const restore = applyEnv(vars);
    try {
        await fn();
    } finally {
        restore();
    }
}

describe("managed mode", () => {
    it("resolves model + base URL from env (managed vars win)", () => {
        withEnv(
            {
                MANAGED_LLM_MODEL: "env-model",
                MANAGED_LLM_BASE_URL: "https://env.example/v1/",
                MANAGED_LLM_API_KEY: MANAGED_KEY,
            },
            () => {
                expect(getManagedModelId()).toBe("env-model");
                // Trailing slash is normalized away.
                expect(getManagedBaseUrl()).toBe("https://env.example/v1");
            }
        );
    });

    it("falls back to mimo-v2.5 + Go gateway by default", () => {
        withEnv(
            {
                MANAGED_LLM_MODEL: undefined,
                LLM_MODEL: undefined,
                MANAGED_LLM_BASE_URL: undefined,
                LLM_BASE_URL: undefined,
            },
            () => {
                expect(getManagedModelId()).toBe("mimo-v2.5");
                expect(getManagedBaseUrl()).toBe(GO_BASE_URL);
            }
        );
    });

    it("creates a managed chat model with the env key", async () => {
        await withEnvAsync({ MANAGED_LLM_API_KEY: MANAGED_KEY }, async () => {
            const model = await getChatModel({ mode: "managed" });
            expect(model).toBeDefined();
            // @ts-expect-error - inspecting LangChain client config
            expect(model.clientConfig?.baseURL).toBe(getManagedBaseUrl());
        });
    });

    it("throws when no managed key is available", async () => {
        const prev = {
            MANAGED_LLM_API_KEY: process.env.MANAGED_LLM_API_KEY,
            LLM_API_KEY: process.env.LLM_API_KEY,
            OPENCODE_GO_API_KEY: process.env.OPENCODE_GO_API_KEY,
            OPENCODE_ZEN_API_KEY: process.env.OPENCODE_ZEN_API_KEY,
        };
        delete process.env.MANAGED_LLM_API_KEY;
        delete process.env.LLM_API_KEY;
        delete process.env.OPENCODE_GO_API_KEY;
        delete process.env.OPENCODE_ZEN_API_KEY;
        try {
            await expect(getChatModel({ mode: "managed" })).rejects.toThrow(/managed|API key/i);
        } finally {
            for (const [k, v] of Object.entries(prev)) {
                if (v !== undefined) process.env[k] = v;
            }
        }
    });

    it("uses one model for both planner and responder", async () => {
        await withEnvAsync({ MANAGED_LLM_API_KEY: MANAGED_KEY }, async () => {
            const planner = await getPlannerModel("managed");
            const responder = await getResponderModel("managed", undefined, false);
            expect(planner).toBeDefined();
            expect(responder).toBeDefined();
        });
    });
});

describe("BYOK mode", () => {
    it("creates a model from base URL + identifier + key", async () => {
        const model = await getChatModel({
            mode: "byok",
            byokBaseUrl: BYOK_BASE,
            byokModel: "my-model",
            byokApiKey: BYOK_KEY,
        });
        expect(model).toBeDefined();
        // @ts-expect-error - inspecting LangChain client config
        expect(model.clientConfig?.baseURL).toBe(BYOK_BASE);
    });

    it("throws when base URL / model / key are missing", async () => {
        await expect(
            getChatModel({ mode: "byok", byokModel: "m", byokApiKey: BYOK_KEY })
        ).rejects.toThrow(/base URL/i);
        await expect(
            getChatModel({ mode: "byok", byokBaseUrl: BYOK_BASE, byokApiKey: BYOK_KEY })
        ).rejects.toThrow(/identifier/i);
        await expect(
            getChatModel({ mode: "byok", byokBaseUrl: BYOK_BASE, byokModel: "m" })
        ).rejects.toThrow(/API key/i);
    });

    it("rejects non-http base URLs", async () => {
        await expect(
            getChatModel({
                mode: "byok",
                byokBaseUrl: "ftp://example.com",
                byokModel: "m",
                byokApiKey: BYOK_KEY,
            })
        ).rejects.toThrow(/http/i);
    });
});

describe("validateByokConfig", () => {
    it("accepts a complete config", () => {
        expect(
            validateByokConfig({ baseUrl: BYOK_BASE, modelId: "m", modelName: "My" })
        ).toBeNull();
    });
    it("rejects missing/invalid fields", () => {
        expect(validateByokConfig({ modelId: "m" })).toMatch(/base url/i);
        expect(validateByokConfig({ baseUrl: "notaurl", modelId: "m" })).toMatch(/http/i);
        expect(validateByokConfig({ baseUrl: BYOK_BASE })).toMatch(/identifier/i);
    });
});

describe("normalizeBaseUrl", () => {
    it("trims whitespace and trailing slashes", () => {
        expect(normalizeBaseUrl("  https://x.example/v1///  ")).toBe("https://x.example/v1");
        expect(normalizeBaseUrl("")).toBe("");
    });
});

describe("isManagedConfigured", () => {
    it("reflects the managed env key", () => {
        withEnv({ MANAGED_LLM_API_KEY: "x", LLM_API_KEY: undefined, OPENCODE_GO_API_KEY: undefined, OPENCODE_ZEN_API_KEY: undefined }, () => {
            expect(isManagedConfigured()).toBe(true);
            expect(isProviderConfigured()).toBe(true);
        });
        withEnv({ MANAGED_LLM_API_KEY: undefined, LLM_API_KEY: undefined, OPENCODE_GO_API_KEY: undefined, OPENCODE_ZEN_API_KEY: undefined }, () => {
            expect(isManagedConfigured()).toBe(false);
        });
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

    it("sends UA + session headers on managed (opencode) requests", async () => {
        await withEnvAsync({ MANAGED_LLM_API_KEY: MANAGED_KEY }, async () => {
            const model = (await getChatModel(
                { mode: "managed", sessionId: "sess-abc" },
            )) as unknown as { clientConfig?: { defaultHeaders?: Record<string, string> } };

            // Managed default points at an opencode.ai gateway.
            expect(ZEN_BASE_URL).toContain("opencode.ai");
            expect(model.clientConfig?.defaultHeaders?.["User-Agent"]).toBe(OPENCODE_USER_AGENT);
            expect(model.clientConfig?.defaultHeaders?.[OPENCODE_SESSION_HEADER]).toBe("sess-abc");
        });
    });

    it("does NOT leak gateway headers to generic BYOK endpoints", async () => {
        const model = (await getChatModel({
            mode: "byok",
            byokBaseUrl: BYOK_BASE,
            byokModel: "m",
            byokApiKey: BYOK_KEY,
            sessionId: "sess-abc",
        })) as unknown as { clientConfig?: { defaultHeaders?: Record<string, string> } };

        expect(model.clientConfig?.defaultHeaders?.[OPENCODE_SESSION_HEADER]).toBeUndefined();
    });
});
