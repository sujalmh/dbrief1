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
import { PROVIDER_MAP } from "./providers";

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
 */
export const ZEN_FREE_MODELS: string[] = PROVIDER_MAP.zen.models.map((m) => m.id);

/** Curated Go models, cheapest-first (requires Go subscription). */
export const GO_MODELS: string[] = PROVIDER_MAP.go.models.map((m) => m.id);

export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const GO_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * Client identification required by the OpenCode gateways.
 * Go/Zen monitor traffic for abuse: clients must send typical coding-agent
 * traffic, identify with their own user agent (not a generic SDK name),
 * and send a stable per-conversation `x-opencode-session` header so
 * requests can be routed + prompt-cached.
 * See: https://opencode.ai/docs/go ("Where can I use it?")
 */
export const OPENCODE_USER_AGENT = "f1-ai-chatbot/1.0";
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

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
 */
export function buildOpenCodeHeaders(sessionId?: string): Record<string, string> {
    const headers: Record<string, string> = {
        "User-Agent": OPENCODE_USER_AGENT,
    };
    if (sessionId) {
        headers[OPENCODE_SESSION_HEADER] = sessionId;
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
    temperature: number = 0.7,
    maxTokens: number = 4096,
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
    temperature: number = 0.7,
    maxTokens: number = 4096,
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
            baseURL: "https://openrouter.ai/api/v1",
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
    temperature: number = 0.7,
    maxTokens: number = 4096,
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
            baseURL: ZEN_BASE_URL,
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
    temperature: number = 0.7,
    maxTokens: number = 4096,
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
            baseURL: GO_BASE_URL,
            defaultHeaders: buildOpenCodeHeaders(sessionId),
        },
    });
}
/**
 * Create a Hugging Face chat model
 */
async function createHuggingFaceModel(
    model: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
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
            baseURL: "https://api-inference.huggingface.co/v1",
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
    const { provider, model, temperature = 0.7, maxTokens = 4096, sessionId } = config;
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
 * @param sessionId - Optional stable per-conversation ID (x-opencode-session)
 * @returns LangChain chat model for planning
 */
export async function getPlannerModel(provider: Provider, apiKey?: string, sessionId?: string): Promise<BaseChatModel> {
    const model = PROVIDER_MAP[provider].plannerModel;

    return getChatModel({
        provider,
        model,
        temperature: 0, // Deterministic for planning
        maxTokens: 2048,
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
        temperature: reasoning ? 0.3 : 0.7, // Lower temp for reasoning
        maxTokens: 8192, // Higher limit for detailed responses
        sessionId,
    }, apiKey);
}

/**
 * Check if API key is configured for a provider
 */
export function isProviderConfigured(provider: Provider): boolean {
    return !!process.env[PROVIDER_MAP[provider].envKey];
}
