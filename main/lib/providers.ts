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
    },
    {
        id: "go",
        label: "Go",
        menuLabel: "OpenCode Go",
        models: [
            { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
            { id: "kimi-k3", label: "Kimi K3" },
            { id: "mimo-v2.5", label: "MiMo V2.5" },
            { id: "glm-5.3-flash", label: "GLM 5.3 Flash" },
            { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
        ],
        defaultModel: "mimo-v2.5",
        plannerModel: "mimo-v2.5",
        reasoningModel: "kimi-k2.7-code",
        envKey: "OPENCODE_GO_API_KEY",
        docsUrl: "https://opencode.ai/docs/go",
    },
];

export const PROVIDER_MAP: Record<Provider, ProviderMeta> = Object.fromEntries(
    PROVIDERS.map((p) => [p.id, p])
) as Record<Provider, ProviderMeta>;

/** Look up metadata for a stored provider id (unknown ids → undefined). */
export function getProviderMeta(id: string): ProviderMeta | undefined {
    return PROVIDERS.find((p) => p.id === id);
}
