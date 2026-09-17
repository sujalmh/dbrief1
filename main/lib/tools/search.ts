/**
 * Web Search Tool (TinyFish)
 * ==========================
 * Real web search for F1 news, recent events, and anything outside
 * historical data. Requires TINYFISH_API_KEY on the server; without it
 * the tool reports itself unconfigured (callers treat that as
 * "no web results" rather than an error).
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";

// =============================================================================
// Configuration (env-overridable, sane defaults)
// =============================================================================

function searchApiKey(): string | undefined {
    return process.env.TINYFISH_API_KEY || undefined;
}

function searchBaseUrl(): string {
    // Canonical endpoint per current TinyFish docs
    // (https://docs.tinyfish.ai/search-api). Override with
    // TINYFISH_BASE_URL without a deploy if it ever moves again.
    return (process.env.TINYFISH_BASE_URL || "https://api.search.tinyfish.ai").replace(/\/+$/, "");
}

function searchTimeoutMs(): number {
    const n = Number(process.env.TINYFISH_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 60_000) : 15_000;
}

function searchResultsLimit(): number {
    const n = Number(process.env.TINYFISH_RESULTS_LIMIT);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : 5;
}

// =============================================================================
// Search Tool
// =============================================================================

export const webSearchTool = tool(
    async ({ query }) => {
        try {
            const apiKey = searchApiKey();
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
            const response = await fetch(`${searchBaseUrl()}?${params.toString()}`, {
                headers: { "X-API-Key": apiKey },
                signal: AbortSignal.timeout(searchTimeoutMs()),
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
                .slice(0, searchResultsLimit());

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
