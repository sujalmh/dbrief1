import { getChatModel, chatContentToText, LLM_TIMEOUT_MS, type AiMode } from "@/lib/llm";
import { extractJson } from "@/lib/research/llm-parse";

export interface SessionMetadata {
    title: string;
    type: "telemetry" | "comparison" | "strategy" | "insights";
}

export async function generateSessionMetadata(
    userQuery: string,
    mode: AiMode = "managed",
    byok?: { baseUrl?: string; model?: string; apiKey?: string },
    sessionId?: string
): Promise<SessionMetadata> {
    const llm = await getChatModel({
        mode,
        byokBaseUrl: byok?.baseUrl,
        byokModel: byok?.model,
        byokApiKey: byok?.apiKey,
        temperature: 0.3,
        maxTokens: 512,
        sessionId,
    });

    const prompt = `You are an AI assistant that categorizes F1 racing queries and generates concise titles.

Given the following user query, you must:
1. Generate a concise, descriptive title (max 40 characters)
2. Categorize the query into ONE of these types:
   - "telemetry": Questions about car data, speed, throttle, brake, telemetry, performance metrics. Use this when "telemetry" is mentioned.
   - "comparison": Questions comparing drivers, teams, race results, or qualifying times (not telemetry comparisons)
   - "strategy": Questions about race strategy, pit stops, tire choices, etc.
   - "insights": General analysis, trends, regulations, or high-level observations

IMPORTANT: If the query mentions "telemetry", classify as "telemetry" even if it's a comparison.

User Query: "${userQuery}"

Respond ONLY with valid JSON in this exact format:
{
  "title": "Your Title Here",
  "type": "telemetry|comparison|strategy|insights"
}`;

    // The upstream model occasionally returns an empty completion or
    // prose with no JSON at all (observed in prod) — retry once before
    // falling back to the raw query as the title. extractJson handles
    // fences, markers, balanced braces, and common malformations
    // (trailing commas, quotes). The retry carries a stricter "JSON
    // only" nudge because an identical retry of an empty response
    // usually fails identically.
    let lastError: unknown = null;
    let lastRawContent: unknown = null;
    let lastHadReasoningContent = false;
    for (let attempt = 0; attempt < 2; attempt++) {
        const attemptPrompt =
            attempt === 0
                ? prompt
                : `${prompt}\n\nREMINDER: Reply with ONLY the JSON object. No prose, no fences.`;
        try {
            // Bounded well under the 10s metadata rendezvous so a
            // hung upstream fails fast into the retry/fallback path
            // instead of burning the whole budget on one attempt.
            const response = await llm.invoke(attemptPrompt, {
                signal: AbortSignal.timeout(LLM_TIMEOUT_MS.metadata),
            });
            lastRawContent = response.content;
            // Reasoning-style endpoints (OpenAI-compatible) park thinking
            // in additional_kwargs.reasoning_content and leave `content`
            // empty — record it so the error log distinguishes that shape
            // from a plain empty completion.
            const extra = (response as unknown as { additional_kwargs?: Record<string, unknown> })
                .additional_kwargs;
            lastHadReasoningContent =
                typeof extra?.reasoning_content === "string" &&
                extra.reasoning_content.length > 0;
            const content = chatContentToText(response.content);
            const metadata = extractJson(content) as unknown as SessionMetadata;

            // Validate the type
            const validTypes = ["telemetry", "comparison", "strategy", "insights"];
            if (!validTypes.includes(metadata.type)) {
                metadata.type = "insights"; // Default fallback
            }

            // Title must be a non-empty string
            if (typeof metadata.title !== "string" || !metadata.title.trim()) {
                throw new Error("Missing title in session metadata");
            }

            // Truncate title if needed
            if (metadata.title.length > 40) {
                metadata.title = metadata.title.substring(0, 37) + "...";
            }

            return metadata;
        } catch (error) {
            lastError = error;
        }
    }
    console.error("Error generating session metadata:", lastError, {
        mode,
        contentPreview: previewLlmContent(lastRawContent),
        hadReasoningContent: lastHadReasoningContent,
    });
    // Fallback to default values
    return {
        title: userQuery.substring(0, 37) + (userQuery.length > 37 ? "..." : ""),
        type: "insights"
    };
}

/**
 * One-line preview of what the model actually returned, for the error
 * log. An "(empty string)" here points at an upstream empty completion;
 * a block-key list (e.g. reasoning-only blocks) points at a
 * content-shape mismatch in chatContentToText.
 */
function previewLlmContent(raw: unknown): string {
    try {
        if (typeof raw === "string") {
            return raw.slice(0, 200) || "(empty string)";
        }
        if (Array.isArray(raw)) {
            if (raw.length === 0) return "(empty content-block array)";
            const keys = raw.map((b) =>
                typeof b === "object" && b !== null ? Object.keys(b) : typeof b
            );
            return `blocks: ${JSON.stringify(keys).slice(0, 200)}`;
        }
        return JSON.stringify(raw)?.slice(0, 200) ?? "(unserializable)";
    } catch {
        return "(unpreviewable)";
    }
}
