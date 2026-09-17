/**
 * AI Provider Metadata (Single Source of Truth)
 * ==============================================
 * Defines every chat provider supported by the app: id, display labels,
 * available models, defaults, and the env var holding its API key.
 *
 * Consumed by:
 * - lib/llm.ts (planner/reasoning defaults, key lookup)
 * - components/chat/settings-modal.tsx + control-panel.tsx (dropdowns)
 */

export type Provider = "gemini" | "openrouter" | "huggingface" | "zen" | "go";

export interface ProviderModel {
    id: string;
    label: string;
    /**
     * True for models that only serve the /responses endpoint
     * (e.g. Muse Spark Contributor). The factory enables LangChain's
     * responses API for these. See: https://opencode.ai/docs/go/#endpoints
     */
    responsesApi?: boolean;
}

export interface ProviderMeta {
    id: Provider;
    /** Short label, e.g. "Gemini" */
    label: string;
    /** Dropdown label, e.g. "OpenCode Zen (free)" */
    menuLabel: string;
    models: ProviderModel[];
    /** Model selected when switching to this provider */
    defaultModel: string;
    /** Cheap model used for planning */
    plannerModel: string;
    /** Model used for deep-research reasoning */
    reasoningModel: string;
    /** Env var holding the API key (Settings key overrides it) */
    envKey: "GOOGLE_AI_API_KEY" | "OPENROUTER_API_KEY" | "HUGGINGFACE_API_KEY" | "OPENCODE_ZEN_API_KEY" | "OPENCODE_GO_API_KEY";
    docsUrl?: string;
    /**
     * Key verification for Settings → Test Key: a cheap list-models style
     * endpoint hit with the user's key. `auth: "bearer"` sends
     * `Authorization: Bearer <key>`; `auth: "query"` appends `?key=<key>`
     * (Gemini style). Optional so community providers registered at
     * runtime can omit it — the UI then explains testing is unsupported.
     */
    keyTest?: {
        url: string;
        auth: "bearer" | "query";
    };
}

export const PROVIDERS: ProviderMeta[] = [
    {
        id: "gemini",
        label: "Gemini",
        menuLabel: "Gemini",
        models: [
            { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
            { id: "gemini-2.0-flash-thinking-exp", label: "Gemini 2.0 Thinking" },
        ],
        defaultModel: "gemini-2.0-flash",
        plannerModel: "gemini-2.0-flash",
        reasoningModel: "gemini-2.0-flash-thinking-exp",
        envKey: "GOOGLE_AI_API_KEY",
        keyTest: {
            url: "https://generativelanguage.googleapis.com/v1beta/models",
            auth: "query",
        },
    },
    {
        id: "openrouter",
        label: "OpenRouter",
        menuLabel: "OpenRouter",
        models: [
            { id: "poolside/laguna-m.1:free", label: "Poolside Laguna M.1 (Free)" },
            { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "NVIDIA: Nemotron 3 Ultra (free)" },
            { id: "cohere/north-mini-code:free", label: "Cohere: North Mini Code (free)" },
        ],
        defaultModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
        plannerModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
        reasoningModel: "nvidia/nemotron-3-ultra-550b-a55b:free",
        envKey: "OPENROUTER_API_KEY",
        keyTest: {
            url: "https://openrouter.ai/api/v1/models",
            auth: "bearer",
        },
    },
    {
        id: "huggingface",
        label: "HuggingFace",
        menuLabel: "HuggingFace",
        models: [
            { id: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B" },
            { id: "mistralai/Mixtral-8x7B-Instruct-v0.1", label: "Mixtral 8x7B" },
        ],
        defaultModel: "mistralai/Mistral-7B-Instruct-v0.3",
        plannerModel: "mistralai/Mistral-7B-Instruct-v0.3",
        reasoningModel: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        envKey: "HUGGINGFACE_API_KEY",
        keyTest: {
            url: "https://huggingface.co/api/whoami-v2",
            auth: "bearer",
        },
    },
    {
        id: "zen",
        label: "Zen",
        menuLabel: "OpenCode Zen (free)",
        models: [
            { id: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra (Free)" },
            { id: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning (Free)" },
            { id: "mimo-v2.5-free", label: "MiMo V2.5 (Free)" },
            { id: "ling-3.0-flash-fin-free", label: "Ling 3.0 Flash Fin (Free)" },
            { id: "big-pickle", label: "Big Pickle (Free)" },
        ],
        defaultModel: "nemotron-3-ultra-free",
        plannerModel: "nemotron-3-ultra-free",
        reasoningModel: "mimo-v2.5-free",
        envKey: "OPENCODE_ZEN_API_KEY",
        docsUrl: "https://opencode.ai/docs/zen/",
        keyTest: {
            url: "https://opencode.ai/zen/v1/models",
            auth: "bearer",
        },
    },
    {
        id: "go",
        label: "Go",
        menuLabel: "OpenCode Go",
        models: [
            // Full catalog per https://opencode.ai/docs/go#endpoints
            // (OpenAI-compatible subset only: chat/completions + responses.
            // Anthropic-messages models — MiniMax M3/M2.7/M2.5, Qwen
            // 3.8/3.7 series — are intentionally omitted: our ChatOpenAI
            // client cannot speak that protocol).
            // Ordered cheapest-first (Go allowance); responses-only models
            // are flagged so the factory enables LangChain's responses API.
            { id: "muse-spark-1.3-contributor", label: "Muse Spark 1.3 Contributor (Cheapest)", responsesApi: true },
            { id: "muse-spark-1.2-contributor", label: "Muse Spark 1.2 Contributor (Cheapest)", responsesApi: true },
            { id: "mimo-v2.5", label: "MiMo V2.5" },
            { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
            { id: "longcat-2.0", label: "LongCat 2.0" },
            { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
            { id: "deepseek-v4-flash-vision-exp", label: "DeepSeek V4 Flash Vision" },
            { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
            { id: "glm-5.3-flash", label: "GLM 5.3 Flash" },
            { id: "glm-5.3", label: "GLM 5.3" },
            { id: "glm-5.2", label: "GLM 5.2" },
            { id: "glm-5.1", label: "GLM 5.1" },
            { id: "kimi-k3", label: "Kimi K3" },
            { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
            { id: "kimi-k2.6", label: "Kimi K2.6" },
            { id: "hy4-preview", label: "Hy4 Preview" },
            { id: "hy3", label: "Hy3" },
            { id: "omen-alpha", label: "Omen Alpha" },
            { id: "gpt-5.6-luna", label: "GPT 5.6 Luna", responsesApi: true },
            { id: "grok-4.6", label: "Grok 4.6", responsesApi: true },
        ],
        defaultModel: "mimo-v2.5",
        plannerModel: "mimo-v2.5",
        reasoningModel: "kimi-k2.7-code",
        envKey: "OPENCODE_GO_API_KEY",
        docsUrl: "https://opencode.ai/docs/go",
        keyTest: {
            url: "https://opencode.ai/zen/go/v1/models",
            auth: "bearer",
        },
    },
];

export const PROVIDER_MAP: Record<Provider, ProviderMeta> = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, p])
) as Record<Provider, ProviderMeta>;

/** Look up metadata for a stored provider id (unknown ids → undefined). */
export function getProviderMeta(id: string): ProviderMeta | undefined {
    return PROVIDERS.find((p) => p.id === id);
}
