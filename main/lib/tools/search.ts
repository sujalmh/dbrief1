/**
 * Web Search + Fetch Tools (TinyFish)
 * ===================================
 * Real web search and page extraction for F1 news, recent events, and
 * anything outside historical data. Requires TINYFISH_API_KEY on the
 * server; without it the tools report themselves unconfigured (callers
 * treat that as "no web results" rather than an error).
 *
 * Docs: https://docs.tinyfish.ai
 *   Search: GET https://api.search.tinyfish.ai?query=...&domain_type=news&recency_minutes=...
 *   Fetch:  POST https://api.fetch.tinyfish.ai { urls[], format: "markdown", ... }
 * Both are free at any wallet balance.
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
    // Canonical endpoint per TinyFish docs (https://docs.tinyfish.ai/search-api).
    // Override with TINYFISH_BASE_URL without a deploy if it ever moves again.
    return (process.env.TINYFISH_BASE_URL || "https://api.search.tinyfish.ai").replace(/\/+$/, "");
}

function fetchBaseUrl(): string {
    // Canonical endpoint per TinyFish docs (https://docs.tinyfish.ai/fetch-api).
    return (process.env.TINYFISH_FETCH_BASE_URL || "https://api.fetch.tinyfish.ai").replace(/\/+$/, "");
}

function searchTimeoutMs(): number {
    const n = Number(process.env.TINYFISH_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 60_000) : 15_000;
}

function fetchTimeoutMs(): number {
    // Fetch renders pages server-side (JS-heavy sites can take 10-20s);
    // TinyFish applies a 110s per-URL backend timeout with a 120s CDN
    // ceiling, so default well under that but above render times.
    const n = Number(process.env.TINYFISH_FETCH_TIMEOUT_MS);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 60_000;
}

function searchResultsLimit(): number {
    const n = Number(process.env.TINYFISH_RESULTS_LIMIT);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 20) : 5;
}

function fetchMaxUrls(): number {
    const n = Number(process.env.TINYFISH_FETCH_MAX_URLS);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 10) : 3;
}

function fetchMaxChars(): number {
    // Per-page text cap so fetched pages stay LLM-context-friendly.
    const n = Number(process.env.TINYFISH_FETCH_MAX_CHARS);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50_000) : 6000;
}

// =============================================================================
// Search Tool
// =============================================================================

const DomainTypeSchema = z.enum(["web", "news"]).describe(
    "Result category: 'news' for latest/recent/current-events queries (returns publisher + date), 'web' for everything else."
);

export const webSearchTool = tool(
    async ({ query, domain_type, recency_minutes, after_date, before_date }) => {
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
            if (domain_type) params.set("domain_type", domain_type);
            // TinyFish forbids combining recency_minutes with after/before_date.
            if (typeof recency_minutes === "number") {
                params.set("recency_minutes", String(recency_minutes));
            } else {
                if (after_date) params.set("after_date", after_date);
                if (before_date) params.set("before_date", before_date);
            }
            const response = await fetch(`${searchBaseUrl()}?${params.toString()}`, {
                headers: { "X-API-Key": apiKey },
                signal: AbortSignal.timeout(searchTimeoutMs()),
            });

            if (!response.ok) {
                throw new Error(`Search failed: ${response.status}`);
            }

            const data = await response.json() as {
                results?: {
                    title?: string;
                    url?: string;
                    snippet?: string;
                    site_name?: string;
                    date?: string;
                    publisher?: string;
                }[];
            };
            const results = (data.results || [])
                .map((r) => ({
                    title: r.title || r.site_name || r.url || "",
                    url: r.url || "",
                    snippet: (r.snippet || "").slice(0, 500),
                    ...(r.date ? { date: r.date } : {}),
                    ...(r.publisher ? { publisher: r.publisher } : {}),
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
            "Search the web for F1 news and current events. REQUIRED for latest/most-recent/last-race/current-season recency questions (use domain_type 'news'). Returns sources with snippets, publisher, and date.",
        schema: z.object({
            query: z
                .string()
                .describe(
                    "Search query - use concrete names and dates (e.g. '2026 Spanish Grand Prix winner')"
                ),
            domain_type: DomainTypeSchema.optional(),
            recency_minutes: z
                .number()
                .int()
                .min(1)
                .max(5256000)
                .optional()
                .describe(
                    "Freshness window in minutes (e.g. 10080 for the last 7 days). Cannot be combined with after_date/before_date."
                ),
            after_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional()
                .describe("Lower date bound (YYYY-MM-DD)."),
            before_date: z
                .string()
                .regex(/^\d{4}-\d{2}-\d{2}$/)
                .optional()
                .describe("Upper date bound (YYYY-MM-DD)."),
        }),
    }
);

// =============================================================================
// Fetch Tool (page extraction for URLs found via web_search)
// =============================================================================

export const fetchWebPagesTool = tool(
    async ({ urls, question }) => {
        const sliced = (urls || []).slice(0, fetchMaxUrls());
        try {
            const apiKey = searchApiKey();
            if (!apiKey) {
                return JSON.stringify({
                    error: true,
                    message: "Web fetch is not configured on the server (missing TINYFISH_API_KEY).",
                    urls: sliced,
                });
            }
            if (sliced.length === 0) {
                return JSON.stringify({ error: true, message: "No URLs provided.", urls: [] });
            }

            const response = await fetch(fetchBaseUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
                body: JSON.stringify({
                    urls: sliced,
                    format: "markdown",
                    purpose: question
                        ? `Answering an F1 question: ${question.slice(0, 500)}`
                        : "Extracting page content to answer a Formula 1 question.",
                }),
                signal: AbortSignal.timeout(fetchTimeoutMs()),
            });

            if (!response.ok) {
                throw new Error(`Fetch failed: ${response.status}`);
            }

            const maxChars = fetchMaxChars();
            const data = await response.json() as {
                results?: {
                    url?: string;
                    final_url?: string;
                    title?: string | null;
                    published_date?: string | null;
                    text?: string | null;
                }[];
                errors?: { url?: string; error?: string; status?: number }[];
            };
            const pages = (data.results || []).map((r) => {
                const text = typeof r.text === "string" ? r.text : "";
                return {
                    url: r.url || "",
                    final_url: r.final_url || r.url || "",
                    title: r.title || "",
                    ...(r.published_date ? { published_date: r.published_date } : {}),
                    text: text.length > maxChars ? text.slice(0, maxChars) + "\n\n[truncated]" : text,
                };
            });
            const errors = (data.errors || []).map((e) => ({
                url: e.url || "",
                error: e.error || "fetch failed",
                ...(typeof e.status === "number" ? { status: e.status } : {}),
            }));

            return JSON.stringify({ pages, errors, question: question || undefined });
        } catch (error) {
            return JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : "Fetch failed",
                urls: sliced,
            });
        }
    },
    {
        name: "fetch_web_pages",
        description:
            "Fetch and extract clean markdown from web pages (URLs from web_search results) to verify facts for latest/news/recency answers. Use AFTER web_search, only for the top 1-3 most relevant URLs.",
        schema: z.object({
            urls: z
                .array(z.string().url())
                .min(1)
                .max(10)
                .describe("Page URLs to fetch (from web_search results, max ~3 recommended)."),
            question: z
                .string()
                .max(500)
                .optional()
                .describe("The factual question the pages should answer (guides extraction)."),
        }),
    }
);

export function getSearchTools(): Record<string, StructuredTool> {
    return {
        web_search: webSearchTool,
        fetch_web_pages: fetchWebPagesTool,
    };
}
