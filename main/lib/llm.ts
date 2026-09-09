/**
 * LLM Model Selection and Initialization
 * =======================================
 * Provides model selection logic for the F1 AI Chatbot orchestrator.
 * Supports multiple providers: Gemini, OpenRouter, Hugging Face,
 * OpenCode Zen (incl. free models), and OpenCode Go.
 * See: https://opencode.ai/docs/zen/ and https://opencode.ai/docs/go
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { PROVIDER_MAP, listProviders } from "./providers";
import { llmTimeouts, llmSampling, gatewayConfig } from "./config";

export type { Provider } from "./providers";
import type { Provider } from "./providers";

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Model Mappings (single source of truth: lib/providers.ts)
// =============================================================================

export interface ModelConfig {
    provider: Provider;
    model: string;
    reasoning?: boolean;
    temperature?: number;
    maxTokens?: number;
    /**
     * Stable per-conversation ID. Sent as `x-opencode-session` to the
     * OpenCode gateways for routing + prompt caching.
     * See: https://opencode.ai/docs/go ("Where can I use it?")
     */
    sessionId?: string;
}

// =============================================================================
// Model Mappings (single source of truth: lib/providers.ts)
// =============================================================================

// =============================================================================
// OpenCode Zen / Go (OpenAI-compatible gateways)
// https://opencode.ai/docs/zen/ https://opencode.ai/docs/go
// =============================================================================

/**
 * Free Zen models (chat/completions endpoint, $0/1M tokens).
 * Note: muse-spark-1.3-contributor-free is excluded — like its Go
 * sibling it only serves the /responses endpoint; use the Go provider
 * entry (which sets responsesApi) if you need the Contributor tier.
 *
 * Live view of the dynamic provider registry (see lib/providers.ts and
 * lib/config.ts `F1_PROVIDERS_JSON`) — never a frozen snapshot.
 */
export const ZEN_FREE_MODELS: string[] = liveModelList("zen");

/** Curated Go models, cheapest-first (requires Go subscription). Live view. */
export const GO_MODELS: string[] = liveModelList("go");

function liveModelList(providerId: string): string[] {
    return new Proxy([] as unknown as string[], {
        get: (_target, prop: string | symbol) => {
            const snapshot = (listProviders().find((p) => p.id === providerId)?.models.map((m) => m.id) ?? []) as unknown as Record<string | symbol, unknown>;
            const value = snapshot[prop];
            return typeof value === "function" ? (value as () => unknown).bind(snapshot) : value;
        },
    });
}

export const ZEN_BASE_URL = gatewayConfig.zenBaseUrl();
export const GO_BASE_URL = gatewayConfig.goBaseUrl();

/**
 * Client identification required by the OpenCode gateways.
 * Go/Zen monitor traffic for abuse: clients must send typical coding-agent
 * traffic, identify with their own user agent (not a generic SDK name),
 * and send a stable per-conversation `x-opencode-session` header so
 * requests can be routed + prompt-cached.
 * See: https://opencode.ai/docs/go ("Where can I use it?")
 *
 * Values come from lib/config.ts (`OPENCODE_USER_AGENT` /
 * `OPENCODE_SESSION_HEADER`) so deployments can re-identify without edits.
 */
export const OPENCODE_USER_AGENT = gatewayConfig.userAgent();
export const OPENCODE_SESSION_HEADER = gatewayConfig.sessionHeader();

// =============================================================================
// Hang protection (per-call timeouts)
// =============================================================================
//
// Upstream free-tier endpoints occasionally stall indefinitely (observed:
// OpenRouter strict-structured-output requests hanging with no response and
// no error for 3+ minutes). Without a client-side timeout those stalls hang
// the SSE stream forever — the UI spins and the server holds the connection.
// Every route-adjacent LLM call passes one of these signals so a stall
// always surfaces as an AbortError (classified as `network`, i.e.
// non-recoverable → degraded mode / clear error) instead of a silent hang.
export interface LlmTimeouts {
    intent: number;
    planner: number;
    responder: number;
    viz: number;
    sources: number;
    critic: number;
}

/**
 * Live view of lib/config.ts `llmTimeouts` (env: `LLM_TIMEOUT_*_MS`).
 * Reads are resolved per-access so tuning env vars takes effect without a
 * code change; defaults preserve the historical hang-protection budgets.
 */
export const LLM_TIMEOUT_MS: LlmTimeouts = new Proxy({} as LlmTimeouts, {
    get: (_target, prop: keyof LlmTimeouts) => {
        const getter = (llmTimeouts as unknown as Record<string, () => number>)[prop as string];
        return typeof getter === "function" ? getter() : undefined;
    },
});

/**
 * Extract plain text from a LangChain message content value.
 * Chat-completions models return a string; responses-API models return an
 * array of content blocks like {type: "text", text: "..."}.
 */
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

/**
 * Build the extra headers for OpenCode gateway requests.
 * Values are read live from config so re-identification needs no redeploy.
 */
export function buildOpenCodeHeaders(sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
        "User-Agent": gatewayConfig.userAgent(),
    };
    const sessionHeader = gatewayConfig.sessionHeader();
    if (sessionId) {
        headers[sessionHeader] = sessionId;
    }
    return headers;
}

// =============================================================================
// Model Factory Functions
// =============================================================================

/**
 * Create a Gemini chat model
 */
function createGeminiModel(
    model: string,
    temperature: number = llmSampling.defaultTemperature(),
    maxTokens: number = llmSampling.defaultMaxTokens(),
    userApiKey?: string
): BaseChatModel {
    const apiKey = userApiKey || process.env[PROVIDER_MAP.gemini.envKey];
    if (!apiKey) {
        throw new Error("API key is required. Please provide it in Settings.");
    }

    return new ChatGoogleGenerativeAI({
        model,
        apiKey,
        temperature,
        maxOutputTokens: maxTokens,
    });
}

/**
 * Create an OpenRouter chat model
 * Uses the LangChain ChatOpenAI with OpenRouter base URL
 */
async function createOpenRouterModel(
    model: string,
    temperature: number = llmSampling.defaultTemperature(),
    maxTokens: number = llmSampling.defaultMaxTokens(),
    userApiKey?: string
): Promise<BaseChatModel> {
    const apiKey = userApiKey || process.env[PROVIDER_MAP.openrouter.envKey];
    if (!apiKey) {
        throw new Error("API key is required. Please provide it in Settings.");
    }

    // Dynamic import to avoid bundling issues
    const { ChatOpenAI } = await import("@langchain/openai");

    return new ChatOpenAI({
        model,
        apiKey,
        temperature,
        maxTokens,
        configuration: {
            baseURL: gatewayConfig.openRouterBaseUrl(),
        },
    });
}

/**
 * Create an OpenCode Zen chat model (OpenAI-compatible gateway).
 * Free models available; key from settings or OPENCODE_ZEN_API_KEY.
 * See: https://opencode.ai/docs/zen/
 */
async function createZenModel(
    model: string,
    temperature: number = llmSampling.defaultTemperature(),
    maxTokens: number = llmSampling.defaultMaxTokens(),
    userApiKey?: string,
    sessionId?: string,
    responsesApi: boolean = false
): Promise<BaseChatModel> {
    const apiKey = userApiKey || process.env[PROVIDER_MAP.zen.envKey];
    if (!apiKey) {
        throw new Error("API key is required. Add it in Settings or set OPENCODE_ZEN_API_KEY.");
    }

    const { ChatOpenAI } = await import("@langchain/openai");

    return new ChatOpenAI({
        model,
        apiKey,
        temperature,
        maxTokens,
        useResponsesApi: responsesApi,
        configuration: {
            baseURL: gatewayConfig.zenBaseUrl(),
            defaultHeaders: buildOpenCodeHeaders(sessionId),
        },
    });
}

/**
 * Create an OpenCode Go chat model (OpenAI-compatible gateway).
 * Requires a $10/mo Go subscription; key from settings or OPENCODE_GO_API_KEY.
 * See: https://opencode.ai/docs/go
 */
async function createGoModel(
    model: string,
    temperature: number = llmSampling.defaultTemperature(),
    maxTokens: number = llmSampling.defaultMaxTokens(),
    userApiKey?: string,
    sessionId?: string,
    responsesApi: boolean = false
): Promise<BaseChatModel> {
    const apiKey = userApiKey || process.env[PROVIDER_MAP.go.envKey];
    if (!apiKey) {
        throw new Error("API key is required. Add it in Settings or set OPENCODE_GO_API_KEY.");
    }

    const { ChatOpenAI } = await import("@langchain/openai");

    return new ChatOpenAI({
        model,
        apiKey,
        temperature,
        maxTokens,
        useResponsesApi: responsesApi,
        configuration: {
            baseURL: gatewayConfig.goBaseUrl(),
            defaultHeaders: buildOpenCodeHeaders(sessionId),
        },
    });
}
/**
 * Create a Hugging Face chat model
 */
async function createHuggingFaceModel(
    model: string,
    temperature: number = llmSampling.defaultTemperature(),
    maxTokens: number = llmSampling.defaultMaxTokens(),
    userApiKey?: string
): Promise<BaseChatModel> {
    const apiKey = userApiKey || process.env[PROVIDER_MAP.huggingface.envKey];
    if (!apiKey) {
        throw new Error("API key is required. Please provide it in Settings.");
    }

    // HuggingFace inference uses OpenAI-compatible API
    // so we use ChatOpenAI with HF endpoint for instruction-tuned models
    const { ChatOpenAI } = await import("@langchain/openai");

    return new ChatOpenAI({
        model,
        apiKey,
        temperature,
        maxTokens,
        configuration: {
            baseURL: gatewayConfig.huggingFaceBaseUrl(),
        },
    });
}

// =============================================================================
// Main Model Selection
// =============================================================================

/**
 * Get a chat model based on provider and configuration
 *
 * @param config - Model configuration
 * @param apiKey - Optional API key from user settings (takes precedence over env vars)
 * @returns LangChain chat model instance
 */
export async function getChatModel(config: ModelConfig, apiKey?: string): Promise<BaseChatModel> {
    const { provider, model, temperature = llmSampling.defaultTemperature(), maxTokens = llmSampling.defaultMaxTokens(), sessionId } = config;
    // Responses-only models (flagged in providers.ts) need LangChain's
    // responses API instead of chat/completions.
    const responsesApi =
        PROVIDER_MAP[provider].models.find((m) => m.id === model)?.responsesApi ?? false;

    switch (provider) {
        case "gemini":
            return createGeminiModel(model, temperature, maxTokens, apiKey);

        case "openrouter":
            return await createOpenRouterModel(model, temperature, maxTokens, apiKey);

        case "huggingface":
            return await createHuggingFaceModel(model, temperature, maxTokens, apiKey);

        case "zen":
            return await createZenModel(model, temperature, maxTokens, apiKey, sessionId, responsesApi);

        case "go":
            return await createGoModel(model, temperature, maxTokens, apiKey, sessionId, responsesApi);

        default:
            throw new Error(`Unsupported provider: ${provider}`);
    }
}

/**
 * Get the planner model (always cheap/fast)
 * Uses a fixed cheap model regardless of user selection
 *
 * @param provider - The user's selected provider
 * @param apiKey - Optional API key from user settings
 * @param modelId - Optional model id override. When provided, the planner
 *   uses this exact model (the ControlPanel "Model (Planner)" picker).
 *   When omitted, falls back to the provider's built-in cheap planner
 *   model from providers.ts so the feature is fully opt-in.
 * @param sessionId - Optional stable per-conversation ID (x-opencode-session)
 * @returns LangChain chat model for planning
 */
export async function getPlannerModel(provider: Provider, apiKey?: string, modelId?: string, sessionId?: string): Promise<BaseChatModel> {
    const meta = PROVIDER_MAP[provider];
    const model = modelId || meta.plannerModel;

    return getChatModel({
        provider,
        model,
        temperature: llmSampling.plannerTemperature(), // Deterministic for planning
        maxTokens: llmSampling.plannerMaxTokens(),
        sessionId,
    }, apiKey);
}

/**
 * Get the responder model based on reasoning flag
 *
 * @param provider - The user's selected provider
 * @param model - The user's selected model (used if not reasoning)
 * @param reasoning - Whether to use a reasoning-capable model
 * @param apiKey - Optional API key from user settings
 * @param sessionId - Optional stable per-conversation ID (x-opencode-session)
 * @returns LangChain chat model for response generation
 */
export async function getResponderModel(
    provider: Provider,
    model: string,
    reasoning: boolean,
    apiKey?: string,
    sessionId?: string
): Promise<BaseChatModel> {
    // If reasoning is enabled, use the reasoning model for this provider
    const selectedModel = reasoning ? PROVIDER_MAP[provider].reasoningModel : model;

    return getChatModel({
        provider,
        model: selectedModel,
        reasoning,
        temperature: reasoning ? llmSampling.responderReasoningTemperature() : llmSampling.defaultTemperature(),
        maxTokens: llmSampling.responderMaxTokens(), // Higher limit for detailed responses
        sessionId,
    }, apiKey);
}

/**
 * Check if API key is configured for a provider
 */
export function isProviderConfigured(provider: Provider): boolean {
    return !!process.env[PROVIDER_MAP[provider].envKey];
}
