/**
 * Web Search Tool
 * ===============
 * Optional web search functionality using DuckDuckGo.
 * Used to supplement F1 data with current news and context.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";

// =============================================================================
// Configuration
// =============================================================================

const SEARCH_TIMEOUT_MS = 15000;

// =============================================================================
// Search Tool
// =============================================================================

/**
 * Web search tool using DuckDuckGo Instant Answers
 * Note: This uses the free, no-API-key DuckDuckGo endpoint
 */
export const webSearchTool = tool(
    async ({ query }) => {
        try {
            // DuckDuckGo Instant Answers API
            const response = await fetch(
                `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
                {
                    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
                }
            );

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json();

            // Extract relevant information
            const result = {
                abstract: data.Abstract || null,
                abstract_source: data.AbstractSource || null,
                abstract_url: data.AbstractURL || null,
                heading: data.Heading || null,
                answer: data.Answer || null,
                related_topics: (data.RelatedTopics || [])
                    .slice(0, 5)
                    .filter((topic: { Text?: string }) => topic.Text)
                    .map((topic: { Text: string; FirstURL?: string }) => ({
                        text: topic.Text,
                        url: topic.FirstURL,
                    })),
                results: (data.Results || [])
                    .slice(0, 5)
                    .map((result: { Text: string; FirstURL?: string }) => ({
                        text: result.Text,
                        url: result.FirstURL,
                    })),
            };

            // If no useful results, return a note
            if (!result.abstract && !result.answer && result.related_topics.length === 0) {
                return {
                    note: "No relevant web results found for this query",
                    query,
                };
            }

            return result;
        } catch (error) {
            // Return error info instead of throwing
            return {
                error: true,
                message: error instanceof Error ? error.message : "Search failed",
                query,
            };
        }
    },
    {
        name: "web_search",
        description:
            "Search the web for F1-related news, recent events, or information not available in historical data",
        schema: z.object({
            query: z
                .string()
                .describe(
                    "Search query - be specific and include relevant F1 terms"
                ),
        }),
    }
);

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Get the web search tool
 */
export function getSearchTools(): Record<string, StructuredTool> {
    return {
        web_search: webSearchTool,
    };
}
