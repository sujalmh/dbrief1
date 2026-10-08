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

function fetchMinChars(): number {
    // Floor for usable extraction. Per TinyFish, 10%+ of "successful"
    // fetches come back nearly empty — enough to pass, not enough to
    // reason on. Below this, the page goes to errors[] instead of
    // pages[] so callers treat it as missing, not evidence.
    const n = Number(process.env.TINYFISH_FETCH_MIN_CHARS);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 5000) : 200;
}

/** Max fetch attempts: one retry for transient failures (mirrors search). */
const MAX_FETCH_ATTEMPTS = 2;

/**
 * Map HTTP statuses to actionable messages (per TinyFish error codes).
 * Callers surface message verbatim, so "failed: 402" alone would baffle.
 */
function httpErrorMessage(service: "Search" | "Fetch", status: number): string {
    switch (status) {
        case 401:
            return `${service} failed: invalid API key (401). Check TINYFISH_API_KEY.`;
        case 402:
            return `${service} quota exhausted (402 INSUFFICIENT_CREDITS) — daily free allowance used.`;
        case 403:
            return `${service} forbidden (403) by the upstream service.`;
        case 404:
            return `${service} API unavailable (404).`;
        default:
            return `${service} failed: ${status}`;
    }
}

// =============================================================================
// Search Tool
// =============================================================================

const DomainTypeSchema = z.enum(["web", "news"]).describe(
    "Result category: 'news' for latest/recent/current-events queries (returns publisher + date), 'web' for everything else."
);

interface SearchParams {
    query: string;
    domain_type?: string;
    recency_minutes?: number;
    after_date?: string;
    before_date?: string;
}

interface SearchHit {
    title: string;
    url: string;
    snippet: string;
    date?: string;
    publisher?: string;
}

/**
 * Retry policy for TinyFish Search (per https://docs.tinyfish.ai/error-codes):
 *
 * Empty 200-responses are a known transient failure mode of the upstream
 * provider (identical queries flip between N results and zero), so an
 * empty result set is retried — not accepted — up to MAX_SEARCH_ATTEMPTS:
 *   1. exact params as requested,
 *   2. exact params again after a short delay (transient blip),
 *   3. relaxed params (freshness/domain filters stripped) when the
 *      request carried any — tight windows (e.g. 7 days for a race
 *      11 days ago) legitimately match nothing.
 *
 * HTTP-level transients follow the docs: honor Retry-After on 429
 * (capped), brief backoff on 500/503. Anything else throws immediately.
 */
const MAX_SEARCH_ATTEMPTS = 3;
const RETRY_AFTER_CAP_MS = 8000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterMs(response: Response): number | null {
    const raw = response.headers?.get?.("retry-after");
    if (!raw) return null;
    const secs = Number(raw);
    if (!Number.isFinite(secs) || secs < 0) return null;
    return Math.min(secs * 1000, RETRY_AFTER_CAP_MS);
}

function buildSearchUrl(params: SearchParams): string {
    const qs = new URLSearchParams({
        query: params.query,
        purpose: "Answering a Formula 1 question; recent results and news matter most.",
    });
    if (params.domain_type) qs.set("domain_type", params.domain_type);
    // TinyFish forbids combining recency_minutes with after/before_date.
    if (typeof params.recency_minutes === "number") {
        qs.set("recency_minutes", String(params.recency_minutes));
    } else {
        if (params.after_date) qs.set("after_date", params.after_date);
        if (params.before_date) qs.set("before_date", params.before_date);
    }
    return `${searchBaseUrl()}?${qs.toString()}`;
}

function mapSearchHits(data: {
    results?: {
        title?: string;
        url?: string;
        snippet?: string;
        site_name?: string;
        date?: string;
        publisher?: string;
    }[];
}): SearchHit[] {
    return (data.results || [])
        .map((r) => ({
            title: r.title || r.site_name || r.url || "",
            url: r.url || "",
            snippet: (r.snippet || "").slice(0, 500),
            ...(r.date ? { date: r.date } : {}),
            ...(r.publisher ? { publisher: r.publisher } : {}),
        }))
        .filter((r) => r.title)
        .slice(0, searchResultsLimit());
}

export const webSearchTool = tool(
    async ({ query, domain_type, recency_minutes, after_date, before_date }) => {
        const apiKey = searchApiKey();
        if (!apiKey) {
            return JSON.stringify({
                error: true,
                message: "Web search is not configured on the server (missing TINYFISH_API_KEY).",
                query,
            });
        }

        const requested: SearchParams = { query };
        if (domain_type) requested.domain_type = domain_type;
        if (typeof recency_minutes === "number") {
            requested.recency_minutes = recency_minutes;
        } else {
            if (after_date) requested.after_date = after_date;
            if (before_date) requested.before_date = before_date;
        }
        const hasFilters =
            !!requested.domain_type ||
            typeof requested.recency_minutes === "number" ||
            !!requested.after_date ||
            !!requested.before_date;
        // Relaxed fallback: bare query (docs' default web behavior, which
        // proved far more reliable than news+recency in production).
        const relaxed: SearchParams = { query };

        let lastError: unknown = null;
        for (let attempt = 1; attempt <= MAX_SEARCH_ATTEMPTS; attempt++) {
            // Attempts 1-2 use exact params; attempt 3 drops the filters,
            // but only when there were filters to drop (otherwise it would
            // just repeat attempt 2).
            const useRelaxed = attempt === MAX_SEARCH_ATTEMPTS && hasFilters;
            if (attempt === MAX_SEARCH_ATTEMPTS && !hasFilters) break;
            const params = useRelaxed ? relaxed : requested;

            try {
                const response = await fetch(buildSearchUrl(params), {
                    headers: { "X-API-Key": apiKey },
                    signal: AbortSignal.timeout(searchTimeoutMs()),
                });

                if (response.status === 429) {
                    const wait = retryAfterMs(response) ?? 2000;
                    lastError = new Error(`Search rate-limited (429)`);
                    await sleep(wait);
                    continue;
                }
                if (response.status === 500 || response.status === 503) {
                    lastError = new Error(`Search unavailable: ${response.status}`);
                    await sleep(2000);
                    continue;
                }
                if (!response.ok) {
                    // Non-retryable HTTP error (auth, validation, quota,
                    // etc. — 429/500/503 are handled above). Fail fast instead
                    // of burning the remaining attempts on a certain repeat.
                    return JSON.stringify({
                        error: true,
                        message: httpErrorMessage("Search", response.status),
                        query,
                    });
                }

                const data = await response.json() as {
                    results?: Parameters<typeof mapSearchHits>[0]["results"];
                    parameter_warnings?: unknown;
                };
                if (data.parameter_warnings) {
                    console.warn("[web_search] parameter_warnings:", JSON.stringify(data.parameter_warnings).slice(0, 500));
                }
                const results = mapSearchHits(data);
                if (results.length > 0) {
                    return JSON.stringify({
                        results,
                        query,
                        ...(useRelaxed
                            ? { note: "Initial filtered search returned no results; retried without date/domain filters." }
                            : {}),
                    });
                }
                // Empty 200: transient upstream blip — space out requests
                // per docs (1-2s) and retry.
                lastError = new Error("Empty result set");
                await sleep(1500);
            } catch (error) {
                // Abort/timeout/network: one of the transient class — retry
                // within budget; anything else (programmer error) escapes
                // via lastError below after attempts run out.
                lastError = error;
                await sleep(1500);
            }
        }

        // All attempts exhausted (or unfiltered query kept coming back empty).
        if (lastError instanceof Error && !/Empty result set/.test(lastError.message)) {
            return JSON.stringify({
                error: true,
                message: lastError.message,
                query,
            });
        }
        return JSON.stringify({
            note: "No relevant web results found for this query",
            query,
        });
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
    async ({ urls, question, ttl }) => {
        const sliced = (urls || []).slice(0, fetchMaxUrls());
        const apiKey = searchApiKey();
        if (!apiKey) {
            return JSON.stringify({
                error: true,
                message: "Web fetch is not configured on the server (missing TINYFISH_API_KEY).",
                urls: sliced,
            });
        }
        if (sliced.length === 0) {
            // Clean skip (not an error): the planner sometimes plans
            // fetch alongside search before URLs are known. Succeeding
            // keeps the step out of the failure count.
            return JSON.stringify({ note: "No URLs to fetch — skipping", pages: [], errors: [] });
        }

        let lastError: unknown = null;
        for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(fetchBaseUrl(), {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
                    body: JSON.stringify({
                        urls: sliced,
                        format: "markdown",
                        ...(typeof ttl === "number" ? { ttl } : {}),
                        purpose: question
                            ? `Answering an F1 question: ${question.slice(0, 500)}`
                            : "Extracting page content to answer a Formula 1 question.",
                    }),
                    signal: AbortSignal.timeout(fetchTimeoutMs()),
                });

                if (response.status === 429) {
                    const wait = retryAfterMs(response) ?? 2000;
                    lastError = new Error(`Fetch rate-limited (429)`);
                    if (attempt < MAX_FETCH_ATTEMPTS) {
                        await sleep(wait);
                        continue;
                    }
                    break;
                }
                if (response.status === 500 || response.status === 503) {
                    lastError = new Error(`Fetch unavailable: ${response.status}`);
                    if (attempt < MAX_FETCH_ATTEMPTS) {
                        await sleep(2000);
                        continue;
                    }
                    break;
                }
                if (!response.ok) {
                    return JSON.stringify({
                        error: true,
                        message: httpErrorMessage("Fetch", response.status),
                        urls: sliced,
                    });
                }

                const maxChars = fetchMaxChars();
                const minChars = fetchMinChars();
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
                const pages: Record<string, unknown>[] = [];
                const thin: { url: string; error: string }[] = [];
                for (const r of data.results || []) {
                    const text = typeof r.text === "string" ? r.text : "";
                    if (text.length < minChars) {
                        thin.push({
                            url: r.url || "",
                            error: `extracted text too thin (${text.length} chars, minimum ${minChars})`,
                        });
                        continue;
                    }
                    pages.push({
                        url: r.url || "",
                        final_url: r.final_url || r.url || "",
                        title: r.title || "",
                        ...(r.published_date ? { published_date: r.published_date } : {}),
                        text: text.length > maxChars ? text.slice(0, maxChars) + "\n\n[truncated]" : text,
                    });
                }
                const errors = [
                    ...thin,
                    ...(data.errors || []).map((e) => ({
                        url: e.url || "",
                        error: e.error || "fetch failed",
                        ...(typeof e.status === "number" ? { status: e.status } : {}),
                    })),
                ];

                return JSON.stringify({ pages, errors, question: question || undefined });
            } catch (error) {
                // Abort/timeout/network (or malformed body): transient
                // class — one retry, then report.
                lastError = error;
                if (attempt < MAX_FETCH_ATTEMPTS) {
                    await sleep(1500);
                }
            }
        }

        return JSON.stringify({
            error: true,
            message: lastError instanceof Error ? lastError.message : "Fetch failed",
            urls: sliced,
        });
    },
    {
        name: "fetch_web_pages",
        description:
            "Fetch and extract clean markdown from web pages (concrete URLs from web_search results, the user message, or conversation history) to verify facts for latest/news/recency answers. NEVER invent URLs — leave urls empty when none are known (succeeds as a skip).",
        schema: z.object({
            urls: z
                .array(z.string().url())
                .max(10)
                .describe("Page URLs to fetch (from web_search results, max ~3 recommended). May be empty (then the step succeeds as a no-op skip)."),
            question: z
                .string()
                .max(500)
                .optional()
                .describe("The factual question the pages should answer (guides extraction)."),
            ttl: z
                .number()
                .int()
                .min(0)
                .optional()
                .describe("Cache freshness in seconds; 0 forces a live fetch (use when verifying breaking news). Omit to accept cached entries."),
        }),
    }
);

export function getSearchTools(): Record<string, StructuredTool> {
    return {
        web_search: webSearchTool,
        fetch_web_pages: fetchWebPagesTool,
    };
}

/**
 * Collect distinct http(s) URLs from web_search result payloads.
 * Used by the recency auto-verify fetch: only concrete URLs the search
 * actually returned are ever fetched, never invented ones.
 */
export function extractResultUrls(data: unknown): string[] {
    try {
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        const hits = (parsed as { results?: { url?: unknown }[] } | null)?.results ?? [];
        const urls = hits
            .map((h) => h.url)
            .filter((u): u is string => typeof u === "string" && u.startsWith("http"));
        return [...new Set(urls)];
    } catch {
        return [];
    }
}
