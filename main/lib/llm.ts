/**
 * LLM Model Selection and Initialization
 * =======================================
 * Provides model selection logic for the F1 AI Chatbot orchestrator.
 * Supports multiple providers: Gemini, OpenRouter, and Hugging Face.
 */

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

// =============================================================================
// Types
// =============================================================================

export type Provider = "gemini" | "openrouter" | "huggingface";

export interface ModelConfig {
    provider: Provider;
    model: string;
    reasoning?: boolean;
    temperature?: number;
    maxTokens?: number;
}

// =============================================================================
// Model Mappings
// =============================================================================

/**
 * Default cheap models for the planner (fast, low-cost)
 */
const PLANNER_MODELS: Record<Provider, string> = {
    gemini: "gemini-2.0-flash",
    openrouter: "z-ai/glm-4.5-air:free",
    huggingface: "mistralai/Mistral-7B-Instruct-v0.3",
};

/**
 * Reasoning-capable models for complex analysis
 */
const REASONING_MODELS: Record<Provider, string> = {
    gemini: "gemini-2.0-flash-thinking-exp",
    openrouter: "z-ai/glm-4.5-air:free",
    huggingface: "mistralai/Mixtral-8x7B-Instruct-v0.1",
};

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
    const apiKey = userApiKey || process.env.GOOGLE_AI_API_KEY;
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
    const apiKey = userApiKey || process.env.OPENROUTER_API_KEY;
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
 * Create a Hugging Face chat model
 */
async function createHuggingFaceModel(
    model: string,
    temperature: number = 0.7,
    maxTokens: number = 4096,
    userApiKey?: string
): Promise<BaseChatModel> {
    const apiKey = userApiKey || process.env.HUGGINGFACE_API_KEY;
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
    const { provider, model, temperature = 0.7, maxTokens = 4096 } = config;

    switch (provider) {
        case "gemini":
            return createGeminiModel(model, temperature, maxTokens, apiKey);

        case "openrouter":
            return await createOpenRouterModel(model, temperature, maxTokens, apiKey);

        case "huggingface":
            return await createHuggingFaceModel(model, temperature, maxTokens, apiKey);

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
 * @returns LangChain chat model for planning
 */
export async function getPlannerModel(provider: Provider, apiKey?: string): Promise<BaseChatModel> {
    const model = PLANNER_MODELS[provider];

    return getChatModel({
        provider,
        model,
        temperature: 0, // Deterministic for planning
        maxTokens: 2048,
    }, apiKey);
}

/**
 * Get the responder model based on reasoning flag
 *
 * @param provider - The user's selected provider
 * @param model - The user's selected model (used if not reasoning)
 * @param reasoning - Whether to use a reasoning-capable model
 * @param apiKey - Optional API key from user settings
 * @returns LangChain chat model for response generation
 */
export async function getResponderModel(
    provider: Provider,
    model: string,
    reasoning: boolean,
    apiKey?: string
): Promise<BaseChatModel> {
    // If reasoning is enabled, use the reasoning model for this provider
    const selectedModel = reasoning ? REASONING_MODELS[provider] : model;

    return getChatModel({
        provider,
        model: selectedModel,
        reasoning,
        temperature: reasoning ? 0.3 : 0.7, // Lower temp for reasoning
        maxTokens: 8192, // Higher limit for detailed responses
    }, apiKey);
}

/**
 * Check if API key is configured for a provider
 */
export function isProviderConfigured(provider: Provider): boolean {
    switch (provider) {
        case "gemini":
            return !!process.env.GOOGLE_AI_API_KEY;
        case "openrouter":
            return !!process.env.OPENROUTER_API_KEY;
        case "huggingface":
            return !!process.env.HUGGINGFACE_API_KEY;
        default:
            return false;
    }
}
