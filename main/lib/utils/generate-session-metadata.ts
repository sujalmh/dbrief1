import { getChatModel, chatContentToText, Provider } from "@/lib/llm";
import { llmSampling, sessionMetadataConfig } from "@/lib/config";

export interface SessionMetadata {
    title: string;
    type: "telemetry" | "comparison" | "strategy" | "insights";
}

/**
 * Deterministic heuristic session metadata — zero LLM calls.
 * Title: first ~40 chars of the query, cut at a word boundary.
 * Type: keyword rules mirroring the old LLM prompt (telemetry >
 * comparison > strategy > insights). Used by the chat route so the
 * `metadata` event emits synchronously instead of after an LLM round-trip.
 * Keyword sets and lengths are config-driven (SESSION_* env vars).
 */
export function heuristicSessionMetadata(userQuery: string): SessionMetadata {
    const text = userQuery.trim().replace(/\s+/g, " ");
    const lower = text.toLowerCase();
    const cfg = sessionMetadataConfig;

    const matchesAny = (keywords: string[]) =>
        keywords.some((k) => {
            try {
                return new RegExp(`\\b(${k})\\b`, "i").test(lower);
            } catch {
                return lower.includes(k.toLowerCase());
            }
        });

    let type: SessionMetadata["type"] = "insights";
    if (matchesAny(cfg.telemetryKeywords())) {
        type = "telemetry";
    } else if (matchesAny(cfg.comparisonKeywords())) {
        type = "comparison";
    } else if (matchesAny(cfg.strategyKeywords())) {
        type = "strategy";
    }

    const maxChars = cfg.titleMaxChars();
    const cutThreshold = cfg.wordCutThreshold();
    let title = text.slice(0, maxChars);
    if (text.length > maxChars) {
        const cut = title.lastIndexOf(" ");
        title = (cut > cutThreshold ? title.slice(0, cut) : title).trimEnd() + "...";
    }
    if (!title) title = cfg.fallbackTitle();

    return { title, type };
}

export async function generateSessionMetadata(
    userQuery: string,
    provider: Provider = "gemini",
    model?: string,
    apiKey?: string,
    sessionId?: string
): Promise<SessionMetadata> {
    const { getProviderMeta } = await import("@/lib/providers");
    const resolvedModel = model || getProviderMeta(provider)?.defaultModel || "gemini-2.0-flash";
    const llm = await getChatModel({
        provider,
        model: resolvedModel,
        temperature: llmSampling.sessionMetadataTemperature(),
        maxTokens: llmSampling.sessionMetadataMaxTokens(),
        sessionId,
    }, apiKey);

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

    try {
        const response = await llm.invoke(prompt);
        const content = chatContentToText(response.content);

        // Extract JSON from the response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("Failed to extract JSON from LLM response");
        }

        const metadata = JSON.parse(jsonMatch[0]) as SessionMetadata;

        // Validate the type
        const validTypes = ["telemetry", "comparison", "strategy", "insights"];
        if (!validTypes.includes(metadata.type)) {
            metadata.type = "insights"; // Default fallback
        }

        // Truncate title if needed (length is config-driven)
        const titleCap = sessionMetadataConfig.titleMaxChars();
        const truncateAt = sessionMetadataConfig.titleTruncateAt();
        if (metadata.title.length > titleCap) {
            metadata.title = metadata.title.substring(0, truncateAt) + "...";
        }

        return metadata;
    } catch (error) {
        console.error("Error generating session metadata:", error);
        // Fallback to default values (length is config-driven)
        const truncateAt = sessionMetadataConfig.titleTruncateAt();
        return {
            title: userQuery.substring(0, truncateAt) + (userQuery.length > truncateAt ? "..." : ""),
            type: "insights"
        };
    }
}
