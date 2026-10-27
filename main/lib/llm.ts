/**
 * LLM Model Selection and Initialization
 * =======================================
 * Two modes only — nothing else:
 *
 *   1. "managed" — configured by the app owner via env vars
 *      (MANAGED_LLM_BASE_URL / MANAGED_LLM_MODEL / MANAGED_LLM_API_KEY,
 *      with LLM_* and legacy OPENCODE_* fallbacks). One fixed model
 *      (OpenCode Go gateway, DeepSeek V4.1 Flash) is used for BOTH planning
 *      and answering. Transient managed failures retry once on
 *      mimo-v2.6-flash; auth, quota, and model-not-found errors surface.
 *   2. "byok" — brought by the user via Settings (base URL + model
 *      identifier + API key in an httpOnly cookie).
 *
 * Both modes speak the OpenAI-compatible chat/completions API, so there
 * is a single client code path. The OpenCode gateway headers
 * (User-Agent + x-opencode-session) are only sent to opencode.ai URLs.
 */

import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import type { ChatOpenAICallOptions, ChatOpenAIFields } from "@langchain/openai";
import {
    getManagedApiKey,
    getManagedBaseUrl,
    getManagedModelId,
    MANAGED_DEFAULT_MODEL,
    normalizeBaseUrl,
    type AiMode,
} from "./providers";

export type { AiMode } from "./providers";

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

// Re-exported provider helpers and gateway URLs (managed default + legacy).
export { getManagedModelId, GO_BASE_URL, ZEN_BASE_URL } from "./providers";

/**
 * Client identification required by the OpenCode gateways.
 * Go/Zen monitor traffic for abuse: clients must send typical coding-agent
 * traffic, identify with their own user agent (not a generic SDK name),
 * and send a stable per-conversation `x-opencode-session` header so
 * requests can be routed + prompt-cached.
 * See: https://opencode.ai/docs/go ("Where can I use it?")
 */
export const OPENCODE_USER_AGENT = "dbrief1/1.0";
export const OPENCODE_SESSION_HEADER = "x-opencode-session";

// =============================================================================
// Hang protection (per-call timeouts)
// =============================================================================
//
// Upstream endpoints occasionally stall indefinitely (observed:
// structured-output requests hanging with no response and no error for
// 3+ minutes). Without a client-side timeout those stalls hang the SSE
// stream forever — the UI spins and the server holds the connection.
// Every route-adjacent LLM call passes one of these signals so a stall
// always surfaces as an AbortError (classified as `network`, i.e.
// non-recoverable → degraded mode / clear error) instead of a silent hang.
export const LLM_TIMEOUT_MS = {
    /** Intent analysis is advisory-only (the planner proceeds without it),
     * so keep this tight: a healthy call finishes in seconds, and every
     * second here delays the user's answer. */
    intent: 20_000,
    /** Single decide-and-plan call. */
    planner: 60_000,
    /** Full responder stream (long answers need headroom). */
    responder: 180_000,
    /** Session title/type generation (tiny 512-token call, bounded by
     * the 10s metadata rendezvous in the chat route — keep per-attempt
     * well under it so a hang fails fast into retry/fallback). */
    metadata: 8_000,
} as const;

/**
 * Extract plain text from a LangChain message content value.
 * Chat-completions models return a string; responses-API models return an
 * array of content blocks like {type: "text", text: "..."}.
 */
export function chatContentToText(content: unknown): string {
    if (content == null) return "";
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
    try {
        return JSON.stringify(content) ?? "";
    } catch {
        return "";
    }
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
// Managed-model fallback
// =============================================================================
//
// The managed plan is limited to flash models. If the primary managed model
// fails for a transient reason (network, timeout, 5xx, overloaded), retry once
// on mimo-v2.6-flash. Auth, quota, rate-limit, and model-not-found failures are
// never retried: those need a configuration or billing fix, and hiding them
// would send the user down the wrong path. BYOK never falls back.
//
// Streaming only falls back when the primary fails before its first chunk.
// Once tokens have reached the client, retrying would duplicate output.

export const MANAGED_FALLBACK_MODEL = "mimo-v2.6-flash";

const TRANSIENT_HTTP_STATUS = new Set([408, 500, 502, 503, 504, 529]);

const NON_RETRYABLE_PATTERNS = [
    /\b(?:400|401|402|403|404|410|422|429)\b/,
    /\brate[ _-]?limit(?:ed|ing)?\b/,
    /\btoo[ _-]?many[ _-]?requests\b/,
    /\bquota\b/,
    /\binsufficient[ _-]?quota\b/,
    /\binsufficient[ _-]?credits?\b/,
    /\b(?:daily|usage)[ _-]?limit\b/,
    /\bfree[ _-]models[ _-]per[ _-]day\b/,
    /\bapi[ _-]?key\b/,
    /\bunauthori[sz]ed\b/,
    /\bforbidden\b/,
    /\bauthentication\b/,
    /\bmodel[ _-]?not[ _-]?found\b/,
    /\bno endpoints found\b/,
    /\binvalid model\b/,
    /\bis not a valid model\b/,
    /\bbad[ _-]?request\b/,
    /\binvalid[ _-]?request\b/,
    /\bcontext[ _-]?length\b/,
    /\bcontent[ _-]?policy\b/,
];

const TRANSIENT_MESSAGE_PATTERNS = [
    /\btimeout\b/,
    /\btimed out\b/,
    /\betimedout\b/,
    /\beconnreset\b/,
    /\beconnrefused\b/,
    /\benotfound\b/,
    /\beai_again\b/,
    /\bfetch failed\b/,
    /\bsocket hang up\b/,
    /\bnetwork\b/,
    /\boverloaded\b/,
    /\bservice unavailable\b/,
    /\bbad gateway\b/,
    /\bgateway timeout\b/,
    /\binternal server error\b/,
    /\b5\d\d\b/,
    /\baborterror\b/,
    /\baborted\b/,
];

export interface ManagedFallbackContext {
    mode: AiMode;
    /** Model id used for the primary attempt. */
    primaryModel: string;
    /** True when the caller's signal has already fired (timeout or cancel). */
    signalAborted?: boolean;
}

/** Read an HTTP status from the error shapes used by provider SDKs. */
function errorStatus(err: unknown, depth = 0): number | undefined {
    if (!err || typeof err !== "object" || depth > 3) return undefined;
    const e = err as Record<string, unknown>;

    for (const candidate of [e.status, e.statusCode, e.code]) {
        if (typeof candidate === "number") return candidate;
    }

    if (e.response && typeof e.response === "object") {
        const response = e.response as Record<string, unknown>;
        if (typeof response.status === "number") return response.status;
    }

    if (e.error && typeof e.error === "object") {
        const inner = e.error as Record<string, unknown>;
        for (const candidate of [inner.status, inner.code]) {
            if (typeof candidate === "number") return candidate;
        }
    }

    return errorStatus(e.cause, depth + 1);
}

function errorMessage(err: unknown): string {
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
        const message = (err as Record<string, unknown>).message;
        if (typeof message === "string") return message;
    }
    try {
        return JSON.stringify(err) ?? "";
    } catch {
        return "";
    }
}

/**
 * Decide whether a failed managed-model call may be retried on
 * mimo-v2.6-flash. Only the allowed default pair is eligible; BYOK and any
 * other model configuration are left untouched. Errors that need an operator
 * or user fix (auth, quota, rate limit, model not found, invalid request) are
 * surfaced unchanged.
 */
export function shouldUseManagedFallback(
    error: unknown,
    context: ManagedFallbackContext
): boolean {
    if (context.mode !== "managed") return false;
    if (context.signalAborted) return false;
    if (context.primaryModel === MANAGED_FALLBACK_MODEL) return false;
    if (context.primaryModel !== MANAGED_DEFAULT_MODEL) return false;

    const message = errorMessage(error).toLowerCase();

    // Non-retryable classifications win over any transient-looking text.
    if (NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(message))) {
        return false;
    }

    const status = errorStatus(error);
    if (status !== undefined) return TRANSIENT_HTTP_STATUS.has(status);

    if (error instanceof Error) {
        const name = error.name.toLowerCase();
        if (name === "timeouterror" || name === "aborterror") return true;
    }

    return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * ChatOpenAI wrapper that retries a transient managed-model failure on the
 * allowed fallback model. All other model methods (bindTools,
 * withStructuredOutput, streamEvents) stay on the original model because this
 * class extends ChatOpenAI rather than wrapping it in a Runnable.
 */
class ManagedFallbackChatModel extends ChatOpenAI {
    private readonly fallbackModel: ChatOpenAI;

    constructor(fields: ChatOpenAIFields, fallbackModel: ChatOpenAI) {
        super(fields);
        this.fallbackModel = fallbackModel;
    }

    private canFallBack(error: unknown, signal?: AbortSignal): boolean {
        return shouldUseManagedFallback(error, {
            mode: "managed",
            primaryModel: this.model,
            signalAborted: signal?.aborted ?? false,
        });
    }

    private logFallback(): void {
        console.warn(
            `[llm] ${this.model} failed with a transient error; retrying with ${MANAGED_FALLBACK_MODEL}.`
        );
    }

    /**
     * `withStructuredOutput` rebuilds the model via `withConfig`. Preserve the
     * fallback on the rebuilt instance instead of silently dropping it.
     */
    override withConfig(config: Partial<ChatOpenAICallOptions>) {
        const next = new ManagedFallbackChatModel(
            { ...(this.fields ?? {}) },
            this.fallbackModel
        );
        next.defaultOptions = { ...this.defaultOptions, ...config };
        return next;
    }

    override async _generate(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun
    ): Promise<ChatResult> {
        try {
            return await super._generate(messages, options, runManager);
        } catch (error) {
            if (!this.canFallBack(error, options.signal)) throw error;
            this.logFallback();
            return this.fallbackModel._generate(messages, options, runManager);
        }
    }

    override async *_streamResponseChunks(
        messages: BaseMessage[],
        options: this["ParsedCallOptions"],
        runManager?: CallbackManagerForLLMRun
    ): AsyncGenerator<ChatGenerationChunk> {
        const primaryStream = super._streamResponseChunks(
            messages,
            options,
            runManager
        );

        let first: IteratorResult<ChatGenerationChunk>;
        try {
            first = await primaryStream.next();
        } catch (error) {
            if (!this.canFallBack(error, options.signal)) throw error;
            this.logFallback();
            yield* this.fallbackModel._streamResponseChunks(
                messages,
                options,
                runManager
            );
            return;
        }

        if (first.done) return;
        yield first.value;
        yield* primaryStream;
    }
}

// =============================================================================
// Model Factory (single OpenAI-compatible code path)
// =============================================================================

/** True for opencode.ai gateway URLs (need the UA + session headers). */
function isOpenCodeUrl(baseUrl: string): boolean {
    return baseUrl.toLowerCase().includes("opencode.ai");
}

function buildOpenAICompatibleFields(
    baseUrl: string,
    model: string,
    apiKey: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
    sessionId?: string
): ChatOpenAIFields {
    if (!apiKey) {
        throw new Error("API key is required. Check Settings (Managed / BYOK).");
    }
    if (!model) {
        throw new Error("Model is not configured. Check Settings (Managed / BYOK).");
    }
    if (!baseUrl) {
        throw new Error("Model URL is not configured. Check Settings (Managed / BYOK).");
    }

    return {
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
    };
}

function createOpenAICompatibleModel(
    baseUrl: string,
    model: string,
    apiKey: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
    sessionId?: string,
    fallbackModelId?: string
): BaseChatModel {
    const fields = buildOpenAICompatibleFields(
        baseUrl,
        model,
        apiKey,
        temperature,
        maxTokens,
        sessionId
    );

    if (!fallbackModelId || fallbackModelId === model) {
        return new ChatOpenAI(fields);
    }

    const fallbackFields = buildOpenAICompatibleFields(
        baseUrl,
        fallbackModelId,
        apiKey,
        temperature,
        maxTokens,
        sessionId
    );

    return new ManagedFallbackChatModel(
        fields,
        new ChatOpenAI(fallbackFields)
    );
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
export async function getChatModel(config: ModelConfig): Promise<BaseChatModel> {
    const { temperature = 0.7, maxTokens = 4096, sessionId } = config;
    const resolved = resolveLlmConfig(config);

    // Only the managed default gets a fallback. BYOK, a managed model set to
    // something else, and the fallback model itself are left untouched.
    const fallbackModelId =
        config.mode === "managed" && resolved.model === MANAGED_DEFAULT_MODEL
            ? MANAGED_FALLBACK_MODEL
            : undefined;

    return createOpenAICompatibleModel(
        resolved.baseUrl,
        resolved.model,
        resolved.apiKey,
        temperature,
        maxTokens,
        sessionId,
        fallbackModelId
    );
}

/**
 * Get the planner model. Always the SAME model as the responder —
 * there is no separate planner picker anymore. Deterministic settings
 * (temp 0) for planning. The token cap covers both the 5-step quick plan
 * and the deep-research 25-step plan, whose JSON can exceed 2K tokens.
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
        maxTokens: 4096,
        sessionId,
    });
}

/**
 * Get the responder model — same underlying model as the planner,
 * with answer-friendly sampling settings. `_reasoning` is retained in the
 * signature for callers that pass it, but factual answers now always use a
 * low temperature (0.1) regardless of mode.
 */
export async function getResponderModel(
    mode: AiMode,
    byok?: { baseUrl?: string; model?: string; apiKey?: string },
    _reasoning: boolean = false,
    sessionId?: string
): Promise<BaseChatModel> {
    // Kept for API compatibility; factual answers always use low temperature.
    void _reasoning;
    return getChatModel({
        mode,
        byokBaseUrl: byok?.baseUrl,
        byokModel: byok?.model,
        byokApiKey: byok?.apiKey,
        // Factual F1 answers: very low temperature. Creative sampling was the
        // single largest source of paraphrased/wrong numbers in prod.
        temperature: 0.1,
        maxTokens: 8192,
        sessionId,
    });
}

/**
 * Check if the managed mode is configured on the server.
 * (BYOK readiness is per-user: base URL + model + cookie key.)
 */
export function isManagedConfigured(): boolean {
    return !!getManagedApiKey();
}
