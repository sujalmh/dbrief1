/**
 * AI Mode Configuration (Single Source of Truth)
 * ==============================================
 * The app supports exactly two modes — nothing else:
 *
 *   1. "managed" — set up by the app owner via env vars. The user
 *      picks nothing; the server uses one fixed model for both
 *      planning and answering (OpenCode Go gateway, MiMo V2.5).
 *   2. "byok" — brought by the user. They enter a base URL, a model
 *      identifier, a display name, and their own API key (the key
 *      itself lives in an httpOnly cookie, never in localStorage).
 *
 * Both modes speak the OpenAI-compatible chat/completions API, so the
 * backend needs only one client code path (see lib/llm.ts).
 */

export type AiMode = "managed" | "byok";

export interface ByokConfig {
    /** OpenAI-compatible base URL, e.g. "https://api.openai.com/v1" */
    baseUrl: string;
    /** Model identifier sent to the API, e.g. "gpt-4o-mini" */
    modelId: string;
    /** Friendly display name shown in the UI, e.g. "My GPT" */
    modelName: string;
}

/** Backwards-compatible alias: old code imported `Provider`. */
export type Provider = AiMode;

export const MANAGED_DEFAULT_MODEL = "mimo-v2.5";
export const MANAGED_DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";

/** Legacy gateway URLs (kept so old env setups keep working). */
export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const GO_BASE_URL = "https://opencode.ai/zen/go/v1";

/**
 * Managed model id resolved from env. Never hardcoded by callers:
 * set MANAGED_LLM_MODEL (or LLM_MODEL) to change it without a deploy.
 */
export function getManagedModelId(): string {
    return (
        process.env.MANAGED_LLM_MODEL ||
        process.env.LLM_MODEL ||
        MANAGED_DEFAULT_MODEL
    );
}

/**
 * Managed base URL resolved from env. Defaults to the Go gateway
 * (which serves mimo-v2.5).
 */
export function getManagedBaseUrl(): string {
    const raw =
        process.env.MANAGED_LLM_BASE_URL ||
        process.env.LLM_BASE_URL ||
        MANAGED_DEFAULT_BASE_URL;
    return normalizeBaseUrl(raw);
}

/**
 * Managed API key resolved from env. Supports the new MANAGED_*
 * names plus the legacy OpenCode keys for backwards compatibility.
 */
export function getManagedApiKey(): string | undefined {
    return (
        process.env.MANAGED_LLM_API_KEY ||
        process.env.LLM_API_KEY ||
        process.env.OPENCODE_GO_API_KEY ||
        process.env.OPENCODE_ZEN_API_KEY ||
        undefined
    );
}

/** True when the server can serve managed mode (key present). */
export function isManagedConfigured(): boolean {
    return !!getManagedApiKey();
}

/**
 * Normalize a user- or env-provided base URL:
 * trim whitespace, drop trailing slashes. Returns "" when empty.
 */
export function normalizeBaseUrl(url: string): string {
    return (url || "").trim().replace(/\/+$/, "");
}

/**
 * Validate a BYOK config. Returns an error string, or null when OK.
 * Keeps validation in one place so the settings UI and the API route
 * agree on what "valid" means.
 */
export function validateByokConfig(config: Partial<ByokConfig>): string | null {
    if (!config.baseUrl || !config.baseUrl.trim()) {
        return "Base URL is required";
    }
    const trimmed = config.baseUrl.trim();
    if (!/^https?:\/\/.+/i.test(trimmed)) {
        return "Base URL must start with http:// or https://";
    }
    if (!config.modelId || !config.modelId.trim()) {
        return "Model identifier is required";
    }
    if (config.modelId.length > 200) {
        return "Model identifier is too long";
    }
    if (config.baseUrl.length > 500) {
        return "Base URL is too long";
    }
    return null;
}
