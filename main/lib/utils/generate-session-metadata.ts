import { getChatModel, chatContentToText, type AiMode } from "@/lib/llm";
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

    // The upstream model occasionally returns prose with no JSON at all
    // (observed in prod) — retry once before falling back to the raw
    // query as the title. extractJson handles fences, markers, balanced
    // braces, and common malformations (trailing commas, quotes).
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await llm.invoke(prompt);
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
    console.error("Error generating session metadata:", lastError);
    // Fallback to default values
    return {
        title: userQuery.substring(0, 37) + (userQuery.length > 37 ? "..." : ""),
        type: "insights"
    };
}
