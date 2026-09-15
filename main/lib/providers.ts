/** Two AI modes: "managed" (owner-configured via env) or "byok" (user-supplied). */

export type AiMode = "managed" | "byok";

export interface ByokConfig {
    baseUrl: string;
    modelId: string;
    modelName: string;
}

/** Alias kept for old imports. */
export type Provider = AiMode;

export const MANAGED_DEFAULT_MODEL = "mimo-v2.5";
export const MANAGED_DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";

/** Legacy gateway URLs. */
export const ZEN_BASE_URL = "https://opencode.ai/zen/v1";
export const GO_BASE_URL = "https://opencode.ai/zen/go/v1";

export function getManagedModelId(): string {
    return (
        process.env.MANAGED_LLM_MODEL ||
        process.env.LLM_MODEL ||
        MANAGED_DEFAULT_MODEL
    );
}

export function getManagedBaseUrl(): string {
    const raw =
        process.env.MANAGED_LLM_BASE_URL ||
        process.env.LLM_BASE_URL ||
        MANAGED_DEFAULT_BASE_URL;
    return normalizeBaseUrl(raw);
}

export function getManagedApiKey(): string | undefined {
    return (
        process.env.MANAGED_LLM_API_KEY ||
        process.env.LLM_API_KEY ||
        process.env.OPENCODE_GO_API_KEY ||
        process.env.OPENCODE_ZEN_API_KEY ||
        undefined
    );
}

export function isManagedConfigured(): boolean {
    return !!getManagedApiKey();
}

export function normalizeBaseUrl(url: string): string {
    return (url || "").trim().replace(/\/+$/, "");
}

/** Returns an error string, or null when the BYOK config is valid. */
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
