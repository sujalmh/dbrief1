import { getChatModel, Provider } from "@/lib/llm";

export interface SessionMetadata {
    title: string;
    type: "telemetry" | "comparison" | "strategy" | "insights";
}

export async function generateSessionMetadata(
    userQuery: string,
    provider: Provider = "gemini",
    model: string = "gemini-2.0-flash",
    apiKey?: string,
    sessionId?: string
): Promise<SessionMetadata> {
    const llm = await getChatModel({
        provider,
        model,
        temperature: 0.3,
        maxTokens: 512,
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
        const content = response.content.toString();

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

        // Truncate title if needed
        if (metadata.title.length > 40) {
            metadata.title = metadata.title.substring(0, 37) + "...";
        }

        return metadata;
    } catch (error) {
        console.error("Error generating session metadata:", error);
        // Fallback to default values
        return {
            title: userQuery.substring(0, 37) + (userQuery.length > 37 ? "..." : ""),
            type: "insights"
        };
    }
}
