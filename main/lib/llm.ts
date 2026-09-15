/**
 * LLM Model Selection and Initialization
 * =======================================
 * Two modes only — nothing else:
 *
 *   1. "managed" — configured by the app owner via env vars
 *      (MANAGED_LLM_BASE_URL / MANAGED_LLM_MODEL / MANAGED_LLM_API_KEY,
 *      with LLM_* and legacy OPENCODE_* fallbacks). One fixed model is
 *      used for BOTH planning and answering.
 *   2. "byok" — brought by the user via Settings (base URL + model
 *      identifier + API key in an httpOnly cookie).
 *
 * Both modes speak the OpenAI-compatible chat/completions API, so there
 * is a single client code path. The OpenCode gateway headers
 * (User-Agent + x-opencode-session) are only sent to opencode.ai URLs.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
    getManagedApiKey,
    getManagedBaseUrl,
    getManagedModelId,
    normalizeBaseUrl,
    type AiMode,
} from "./providers";

export type { AiMode } from "./providers";
/** Backwards-compatible alias for old imports (`Provider`). */
export type Provider = AiMode;

export interface ModelConfig {
    mode: AiMode;
    /** BYOK only: OpenAI-compatible base URL. */
    byokBaseUrl?: string;
    /** BYOK only: model identifier sent to the API. */
    byokModel?: string;
    /** BYOK only: API key (resolved server-side from the httpOnly cookie). */
    byokApiKey?: string;
    temperature?: number;
    maxTokens?: number;
    /**
     * Stable per-conversation ID. Sent as `x-opencode-session` to the
     * OpenCode gateways for routing + prompt caching.
     * See: https://opencode.ai/docs/go ("Where can I use it?")
     */
    sessionId?: string;
}

/** Backwards-compatible shape: old callers passed { provider, model }. */
export interface LegacyModelConfig {
    provider: AiMode;
    model: string;
    temperature?: number;
    maxTokens?: number;
    sessionId?: string;
}

export const MANAGED_BASE_URL = "https://opencode.ai/zen/go/v1";
// Re-exported for tests / legacy imports.
export { GO_BASE_URL, ZEN_BASE_URL } from "./providers";

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

// =============================================================================
// Hang protection (per-call timeouts)
// =============================================================================
//
// Upstream free-tier endpoints occasionally stall indefinitely. Without a
// client-side timeout those stalls hang the SSE stream forever — the UI
// spins and the server holds the connection. Every route-adjacent LLM call
// passes one of these signals so a stall always surfaces as an AbortError.
export const LLM_TIMEOUT_MS = {
    /** Intent analysis is advisory-only, so keep this tight. */
    intent: 20_000,
    /** Single decide-and-plan call. */
    planner: 45_000,
    /** Full responder stream (long answers need headroom). */
    responder: 180_000,
    /** Visualization planner call. */
    viz: 8_000,
    /** LLM-picked sources call. */
    sources: 8_000,
    /** Critic review call. */
    critic: 10_000,
} as const;

/**
 * Extract plain text from a LangChain message content value.
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
// Model Factory (single OpenAI-compatible code path)
// =============================================================================

/** True for opencode.ai gateway URLs (need the UA + session headers). */
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
            // Only the OpenCode gateways need (and accept) these headers.
            // Sending them to arbitrary BYOK endpoints would leak session
            // ids and risk rejection by strict providers.
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

/**
 * Resolve a ModelConfig to a concrete { baseUrl, model, apiKey } triple.
 * Managed values come from env; BYOK values come from the caller
 * (which resolved them from the request body + httpOnly cookie).
 */
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

// =============================================================================
// Main Model Selection
// =============================================================================

/**
 * Get a chat model for the given mode.
 */
export async function getChatModel(config: ModelConfig, apiKey?: string): Promise<BaseChatModel> {
    const { temperature = 0.7, maxTokens = 4096, sessionId } = config;
    // Backwards compat: some callers still pass the key as a 2nd arg
    // instead of inside the config (pre-BYOK-cookie flow).
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

/**
 * Get the planner model. Always the SAME model as the responder —
 * there is no separate planner picker anymore. Deterministic settings
 * (temp 0) for planning.
 */
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

/**
 * Get the responder model — same underlying model as the planner,
 * with answer-friendly sampling settings. The `reasoning` flag only
 * adjusts temperature, never the model id.
 */
export async function getResponderModel(
    mode: AiMode,
    byokModelOrReasoning?: string | boolean | { baseUrl?: string; model?: string; apiKey?: string },
    reasoningOrApiKey?: boolean | string,
    apiKeyOrSession?: string,
    sessionId?: string
): Promise<BaseChatModel> {
    // Support both the new signature
    //   getResponderModel(mode, { baseUrl, model, apiKey }, reasoning, sessionId)
    // and legacy call shapes from old code/tests:
    //   getResponderModel(provider, model, reasoning, apiKey, sessionId)
    //   getResponderModel(provider, apiKey?, modelId?, sessionId?)
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
        // Legacy: (mode, model|string, reasoning|apiKey, apiKey|session, session)
        if (typeof byokModelOrReasoning === "string" && byokModelOrReasoning) {
            // Old callers passed a model id for OpenRouter-style providers.
            // In the two-mode world the model is fixed (managed) or comes
            // from BYOK settings — a bare model id with no base URL is only
            // meaningful as a BYOK model override.
            byok = { model: byokModelOrReasoning };
        }
        if (typeof reasoningOrApiKey === "boolean") {
            reasoning = reasoningOrApiKey;
        } else if (typeof reasoningOrApiKey === "string" && reasoningOrApiKey) {
            if (!byok) byok = {};
            byok.apiKey = reasoningOrApiKey;
        }
        if (typeof apiKeyOrSession === "string" && apiKeyOrSession) {
            // Could be an API key or a session id — prefer treating it as
            // a session id when it doesn't look like a key. Keys are long;
            // session ids are UUIDs/short. When ambiguous, treat as key if
            // BYOK still lacks one, else as session.
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

/**
 * Check if the managed mode is configured on the server.
 * (BYOK readiness is per-user: base URL + model + cookie key.)
 */
export function isProviderConfigured(): boolean {
    return !!getManagedApiKey();
}

/** Preferred name going forward. */
export function isManagedConfigured(): boolean {
    return !!getManagedApiKey();
}
