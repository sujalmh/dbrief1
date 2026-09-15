import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";
import { searchConfig } from "@/lib/config";

export const webSearchTool = tool(
    async ({ query }) => {
        try {
            const apiKey = searchConfig.apiKey();
            if (!apiKey) {
                return JSON.stringify({
                    error: true,
                    message: "Web search is not configured on the server (missing TINYFISH_API_KEY).",
                    query,
                });
            }

            const params = new URLSearchParams({
                query,
                purpose: "Answering a Formula 1 question; recent results and news matter most.",
            });
            const response = await fetch(`${searchConfig.baseUrl()}?${params.toString()}`, {
                headers: { "X-API-Key": apiKey },
                signal: AbortSignal.timeout(searchConfig.timeoutMs()),
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json() as {
                results?: { title?: string; url?: string; snippet?: string; site_name?: string }[];
            };
            const results = (data.results || [])
                .map((r) => ({
                    title: r.title || r.site_name || r.url || "",
                    url: r.url || "",
                    snippet: (r.snippet || "").slice(0, 500),
                }))
                .filter((r) => r.title)
                .slice(0, searchConfig.resultsLimit());

            if (results.length === 0) {
                return JSON.stringify({
                    note: "No relevant web results found for this query",
                    query,
                });
            }

            return JSON.stringify({ results, query });
        } catch (error) {
            return JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : "Search failed",
                query,
            });
        }
    },
    {
        name: "web_search",
        description:
            "Search the web for F1 news, recent events, or information not available in historical data. Returns sources with snippets.",
        schema: z.object({
            query: z
                .string()
                .describe(
                    "Search query - use concrete names and dates (e.g. '2026 Azerbaijan Grand Prix winner')"
                ),
        }),
    }
);

export function getSearchTools(): Record<string, StructuredTool> {
    return {
        web_search: webSearchTool,
    };
}
