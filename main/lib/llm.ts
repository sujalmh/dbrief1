import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
    getManagedApiKey,
    getManagedBaseUrl,
    getManagedModelId,
    normalizeBaseUrl,
    type AiMode,
} from "./providers";

export type { AiMode } from "./providers";
export type Provider = AiMode;

export interface ModelConfig {
    mode: AiMode;
    byokBaseUrl?: string;
    byokModel?: string;
    byokApiKey?: string;
    temperature?: number;
    maxTokens?: number;
    sessionId?: string;
}

export { GO_BASE_URL, ZEN_BASE_URL } from "./providers";

export const OPENCODE_USER_AGENT = "f1-ai-chatbot/1.0";
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

export const LLM_TIMEOUT_MS = {
    intent: 20_000,
    planner: 45_000,
    responder: 180_000,
    viz: 8_000,
    sources: 8_000,
    critic: 10_000,
} as const;

export function chatContentToText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((block) => {
                if (typeof block === "string") return block;
                if (block && typeof block === "object") {
                    const text = (block as Record<string, unknown>).text;
                    if (typeof text === "string") return text;
                }
                return "";
            })
            .join("");
    }
    return JSON.stringify(content);
}

export function buildOpenCodeHeaders(sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
        "User-Agent": OPENCODE_USER_AGENT,
    };
    if (sessionId) {
        headers[OPENCODE_SESSION_HEADER] = sessionId;
    }
    return headers;
}

function isOpenCodeUrl(baseUrl: string): boolean {
    return baseUrl.toLowerCase().includes("opencode.ai");
}

async function createOpenAICompatibleModel(
    baseUrl: string,
    model: string,
    apiKey: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
    sessionId?: string
): Promise<BaseChatModel> {
    if (!apiKey) {
        throw new Error("API key is required. Check Settings (Managed / BYOK).");
    }
    if (!model) {
        throw new Error("Model is not configured. Check Settings (Managed / BYOK).");
    }
    if (!baseUrl) {
        throw new Error("Model URL is not configured. Check Settings (Managed / BYOK).");
    }

    const { ChatOpenAI } = await import("@langchain/openai");

    return new ChatOpenAI({
        model,
        apiKey,
        temperature,
        maxTokens,
        configuration: {
            baseURL: baseUrl,
            // Gateway headers must not leak to generic BYOK endpoints.
            ...(isOpenCodeUrl(baseUrl)
                ? { defaultHeaders: buildOpenCodeHeaders(sessionId) }
                : {}),
        },
    });
}

interface ResolvedLlm {
    baseUrl: string;
    model: string;
    apiKey: string;
}

export function resolveLlmConfig(config: ModelConfig): ResolvedLlm {
    if (config.mode === "byok") {
        const baseUrl = normalizeBaseUrl(config.byokBaseUrl || "");
        const model = (config.byokModel || "").trim();
        const apiKey = (config.byokApiKey || "").trim();
        if (!baseUrl) {
            throw new Error(
                "BYOK base URL is missing. Open Settings → BYOK and enter the model URL."
            );
        }
        if (!/^https?:\/\/.+/i.test(baseUrl)) {
            throw new Error("BYOK base URL must start with http:// or https://.");
        }
        if (!model) {
            throw new Error(
                "BYOK model identifier is missing. Open Settings → BYOK and enter the model identifier."
            );
        }
        if (!apiKey) {
            throw new Error(
                "BYOK API key is missing. Open Settings → BYOK and save your key."
            );
        }
        return { baseUrl, model, apiKey };
    }

    const apiKey = getManagedApiKey();
    if (!apiKey) {
        throw new Error(
            "The managed model is not configured on the server (missing API key). " +
                "Ask the app owner to set MANAGED_LLM_API_KEY, or switch to BYOK in Settings."
        );
    }
    return {
        baseUrl: getManagedBaseUrl(),
        model: getManagedModelId(),
        apiKey,
    };
}

export async function getChatModel(config: ModelConfig, apiKey?: string): Promise<BaseChatModel> {
    const { temperature = 0.7, maxTokens = 4096, sessionId } = config;
    const effective: ModelConfig =
        apiKey && !config.byokApiKey ? { ...config, byokApiKey: apiKey } : config;
    const resolved = resolveLlmConfig(effective);

    return createOpenAICompatibleModel(
        resolved.baseUrl,
        resolved.model,
        resolved.apiKey,
        temperature,
        maxTokens,
        sessionId
    );
}

/** Planner and responder share one model; planner uses deterministic settings. */
export async function getPlannerModel(
    mode: AiMode,
    byok?: { baseUrl?: string; model?: string; apiKey?: string },
    sessionId?: string
): Promise<BaseChatModel> {
    return getChatModel({
        mode,
        byokBaseUrl: byok?.baseUrl,
        byokModel: byok?.model,
        byokApiKey: byok?.apiKey,
        temperature: 0,
        maxTokens: 2048,
        sessionId,
    });
}

export async function getResponderModel(
    mode: AiMode,
    byokModelOrReasoning?: string | boolean | { baseUrl?: string; model?: string; apiKey?: string },
    reasoningOrApiKey?: boolean | string,
    apiKeyOrSession?: string,
    sessionId?: string
): Promise<BaseChatModel> {
    let byok: { baseUrl?: string; model?: string; apiKey?: string } | undefined;
    let reasoning = false;
    let explicitSession: string | undefined = sessionId;

    if (
        byokModelOrReasoning !== null &&
        typeof byokModelOrReasoning === "object"
    ) {
        byok = byokModelOrReasoning as { baseUrl?: string; model?: string; apiKey?: string };
        if (typeof reasoningOrApiKey === "boolean") reasoning = reasoningOrApiKey;
        if (typeof apiKeyOrSession === "string") explicitSession = apiKeyOrSession;
    } else {
        if (typeof byokModelOrReasoning === "string" && byokModelOrReasoning) {
            byok = { model: byokModelOrReasoning };
        }
        if (typeof reasoningOrApiKey === "boolean") {
            reasoning = reasoningOrApiKey;
        } else if (typeof reasoningOrApiKey === "string" && reasoningOrApiKey) {
            if (!byok) byok = {};
            byok.apiKey = reasoningOrApiKey;
        }
        if (typeof apiKeyOrSession === "string" && apiKeyOrSession) {
            if (!byok?.apiKey && apiKeyOrSession.length > 20) {
                byok = { ...(byok || {}), apiKey: apiKeyOrSession };
            } else {
                explicitSession = apiKeyOrSession;
            }
        }
    }

    return getChatModel({
        mode,
        byokBaseUrl: byok?.baseUrl,
        byokModel: byok?.model,
        byokApiKey: byok?.apiKey,
        temperature: reasoning ? 0.3 : 0.7,
        maxTokens: 8192,
        sessionId: explicitSession,
    });
}

export function isProviderConfigured(): boolean {
    return !!getManagedApiKey();
}

export function isManagedConfigured(): boolean {
    return !!getManagedApiKey();
}
