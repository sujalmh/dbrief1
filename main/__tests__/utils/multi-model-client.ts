/**
 * Multi-Model OpenRouter Test Client
 * ==================================
 *
 * Used by the cross-model E2E test to:
 *  - Construct a LangChain ChatOpenAI for any of the project's OpenRouter models
 *  - Pin the model in the test rather than relying on env vars
 *  - Capture per-call timing, token usage, and raw content for diffing
 */
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * The four OpenRouter models this project ships to end users.
 * Keep this list in sync with `components/chat/control-panel.tsx` and
 * `components/chat/settings-modal.tsx`.
 */
export const PROJECT_OPENROUTER_MODELS = [
    "nvidia/nemotron-3-super-120b-a12b:free", // default planner in lib/llm.ts
    "nvidia/nemotron-3-ultra-550b-a55b:free", // user-selectable in UI + test default
    "poolside/laguna-m.1:free", // user-selectable in UI
    "cohere/north-mini-code:free", // user-selectable in UI
] as const;

export type ProjectModel = (typeof PROJECT_OPENROUTER_MODELS)[number];

export interface ModelCallLog {
    model: ProjectModel;
    role: "planner" | "responder" | "reasoner" | "synthesizer" | "visualization_planner" | "raw";
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    latencyMs: number;
    rawContent: string;
    error?: string;
    /** First 800 chars of the response, useful for diffing in the report. */
    contentPreview: string;
}

export interface ModelFactoryOptions {
    temperature?: number;
    maxTokens?: number;
    timeout?: number;
}

export function createModel(
    model: ProjectModel,
    opts: ModelFactoryOptions = {}
): BaseChatModel {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        throw new Error("OPENROUTER_API_KEY is required in .env.local");
    }
    return new ChatOpenAI({
        model,
        apiKey,
        temperature: opts.temperature ?? 0,
        maxTokens: opts.maxTokens ?? 8192,
        timeout: opts.timeout ?? 90_000,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
        },
    }) as unknown as BaseChatModel;
}

/**
 * Invoke a model and return both the parsed content and a per-call log entry.
 * The log is what the E2E runner diffs across models — if model A returns
 * "Verstappen won 2023" and model B returns "Hamilton won 2023" we want to
 * see both raw strings side-by-side.
 */
export async function invokeWithLog(
    model: BaseChatModel,
    callLog: ModelCallLog,
    messages: { role: "system" | "user"; content: string }[]
): Promise<string> {
    const start = Date.now();
    try {
        const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");
        const lcMessages = messages.map((m) =>
            m.role === "system" ? new SystemMessage(m.content) : new HumanMessage(m.content)
        );
        const resp = await (model as any).invoke(lcMessages);
        const text =
            typeof resp.content === "string" ? resp.content : JSON.stringify(resp.content);
        callLog.latencyMs = Date.now() - start;
        callLog.rawContent = text;
        callLog.contentPreview = text.slice(0, 800);
        // Best-effort token capture
        const usage = (resp as any).response_metadata?.tokenUsage ??
            (resp as any).usage_metadata ??
            (resp as any).response?.usage;
        if (usage) {
            callLog.promptTokens = usage.prompt_tokens ?? usage.input_tokens;
            callLog.completionTokens = usage.completion_tokens ?? usage.output_tokens;
            callLog.totalTokens = usage.total_tokens ??
                (callLog.promptTokens ?? 0) + (callLog.completionTokens ?? 0);
        }
        return text;
    } catch (e: any) {
        callLog.latencyMs = Date.now() - start;
        callLog.error = e?.message ?? String(e);
        callLog.rawContent = `<<ERROR: ${callLog.error}>>`;
        callLog.contentPreview = callLog.rawContent;
        throw e;
    }
}
