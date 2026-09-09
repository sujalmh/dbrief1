/**
 * AI Provider Metadata (Single Source of Truth)
 * ==============================================
 * Defines every chat provider supported by the app: id, display labels,
 * available models, defaults, and the env var holding its API key.
 *
 * Fully dynamic: the built-in catalog below is only the default. Providers
 * can be extended/overridden without a code change via the
 * `F1_PROVIDERS_JSON` env var (array of provider objects merged by `id`),
 * or at runtime via `registerProvider()` (e.g. fetched from a model
 * catalog endpoint). `PROVIDERS` / `PROVIDER_MAP` are live getters so
 * overrides are always reflected.
 *
 * Consumed by:
 * - lib/llm.ts (planner/reasoning defaults, key lookup)
 * - components/chat/settings-modal.tsx + control-panel.tsx (dropdowns)
 */

import { envJson } from "./config";

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
}

export const BUILTIN_PROVIDERS: ProviderMeta[] = [
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
    },
];

// =============================================================================
// Dynamic registry: built-ins + F1_PROVIDERS_JSON env overrides + runtime
// registrations. Env entries merge by provider `id` (matching ids override
// individual fields and append unknown models); runtime registrations via
// registerProvider() take precedence over both.
// =============================================================================

type ProviderOverride = Partial<ProviderMeta> & { id: Provider; models?: ProviderModel[] };

let runtimeProviders: ProviderMeta[] = [];

function mergeProviders(base: ProviderMeta[], overrides: ProviderOverride[]): ProviderMeta[] {
    if (overrides.length === 0) return base.map((p) => ({ ...p, models: [...p.models] }));
    const byId = new Map<string, ProviderMeta>(
        base.map((p) => [p.id, { ...p, models: [...p.models] }])
    );
    for (const override of overrides) {
        const existing = byId.get(override.id);
        if (!existing) {
            byId.set(override.id, {
                id: override.id,
                label: override.label ?? override.id,
                menuLabel: override.menuLabel ?? override.label ?? override.id,
                models: [...(override.models ?? [])],
                defaultModel: override.defaultModel ?? override.models?.[0]?.id ?? "",
                plannerModel: override.plannerModel ?? override.models?.[0]?.id ?? "",
                reasoningModel: override.reasoningModel ?? override.models?.[0]?.id ?? "",
                envKey: override.envKey ?? "OPENROUTER_API_KEY",
                ...(override.docsUrl ? { docsUrl: override.docsUrl } : {}),
            });
            continue;
        }
        const mergedModels = [...existing.models];
        for (const model of override.models ?? []) {
            if (!mergedModels.some((m) => m.id === model.id)) mergedModels.push(model);
        }
        byId.set(override.id, {
            ...existing,
            ...Object.fromEntries(
                Object.entries(override).filter(([, v]) => v !== undefined && v !== "models")
            ),
            models: mergedModels,
        } as ProviderMeta);
    }
    return [...byId.values()];
}

function buildProviders(): ProviderMeta[] {
    const envOverrides = envJson<ProviderOverride[]>("F1_PROVIDERS_JSON", []);
    const merged = mergeProviders(BUILTIN_PROVIDERS, Array.isArray(envOverrides) ? envOverrides : []);
    if (runtimeProviders.length === 0) return merged;
    return mergeProviders(merged, runtimeProviders);
}

/** Register (or override) a provider at runtime. */
export function registerProvider(provider: ProviderMeta): void {
    runtimeProviders = [provider, ...runtimeProviders.filter((p) => p.id !== provider.id)];
}

/** Clear runtime provider registrations (used by tests). */
export function resetProviders(): void {
    runtimeProviders = [];
}

/**
 * Live provider catalog (built-ins + `F1_PROVIDERS_JSON` env overrides +
 * runtime registrations). Proxied so every read (`map`, `find`, `length`,
 * iteration, spread) reflects the current configuration — consumers never
 * see a stale hardcoded snapshot.
 */
export const PROVIDERS: ProviderMeta[] = new Proxy([] as unknown as ProviderMeta[], {
    get: (_target, prop: string | symbol) => {
        const snapshot = buildProviders() as unknown as Record<string | symbol, unknown>;
        const value = snapshot[prop];
        return typeof value === "function" ? (value as () => unknown).bind(snapshot) : value;
    },
    set: () => {
        console.warn("[providers] PROVIDERS is read-only; use registerProvider() to extend the catalog.");
        return true;
    },
});

export const PROVIDER_MAP: Record<Provider, ProviderMeta> = new Proxy(
    {} as Record<Provider, ProviderMeta>,
    {
        get: (_target, prop: string) => buildProviders().find((p) => p.id === prop),
        has: (_target, prop: string) => buildProviders().some((p) => p.id === prop),
        ownKeys: () => buildProviders().map((p) => p.id),
        getOwnPropertyDescriptor: (_target, prop: string) => {
            const found = buildProviders().find((p) => p.id === prop);
            if (!found) return undefined;
            return { enumerable: true, configurable: true, value: found };
        },
    }
);

/** Look up metadata for a stored provider id (unknown ids → undefined). */
export function getProviderMeta(id: string): ProviderMeta | undefined {
    return buildProviders().find((p) => p.id === id);
}

/** List all registered provider ids (drives UI dropdowns dynamically). */
export function listProviders(): ProviderMeta[] {
    return buildProviders();
}
