import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearchTool, fetchWebPagesTool } from "@/lib/tools/search";

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TINYFISH_API_KEY;
    delete process.env.TINYFISH_FETCH_MAX_CHARS;
});

describe("webSearchTool", () => {
    it("reports unconfigured search when no API key is set", async () => {
        const raw = await webSearchTool.invoke({ query: "2026 Baku winner" });
        const data = JSON.parse(raw as string);
        expect(data.error).toBe(true);
        expect(data.message).toMatch(/TINYFISH_API_KEY/);
    });

    it("queries TinyFish and maps results", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                query: "2026 Baku winner",
                results: [
                    { title: "Baku results", url: "https://example.com/baku", snippet: "x".repeat(600), site_name: "example" },
                    { title: "", url: "" },
                ],
                total_results: 2,
                page: 0,
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await webSearchTool.invoke({ query: "2026 Baku winner" });
        const data = JSON.parse(raw as string);
        expect(data.results).toHaveLength(1);
        expect(data.results[0].title).toBe("Baku results");
        expect(data.results[0].snippet).toHaveLength(500);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url).startsWith("https://api.search.tinyfish.ai?")).toBe(true);
        expect(String(url)).toContain("query=2026+Baku+winner");
        expect(init.headers).toMatchObject({ "X-API-Key": "test-key" });
    });

    it("returns an error payload on HTTP failure", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));

        const raw = await webSearchTool.invoke({ query: "x" });
        const data = JSON.parse(raw as string);
        expect(data.error).toBe(true);
        expect(data.message).toMatch(/403/);
    });

    it("fails fast on non-retryable HTTP errors (single call)", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await webSearchTool.invoke({ query: "x", domain_type: "news" });
        const data = JSON.parse(raw as string);
        expect(data.error).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("retries an empty result set and returns the later hits", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ query: "q", results: [], total_results: 0 }) })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    query: "q",
                    results: [{ title: "Winner", url: "https://example.com/w", snippet: "won" }],
                }),
            });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await webSearchTool.invoke({ query: "q", domain_type: "news" });
        const data = JSON.parse(raw as string);
        expect(data.results).toHaveLength(1);
        expect(data.note).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("relaxes filters after repeated empties and notes it", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const empty = { ok: true, json: async () => ({ query: "q", results: [], total_results: 0 }) };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(empty)
            .mockResolvedValueOnce(empty)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    query: "q",
                    results: [{ title: "Winner", url: "https://example.com/w", snippet: "won" }],
                }),
            });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await webSearchTool.invoke({ query: "q", domain_type: "news", recency_minutes: 10080 });
        const data = JSON.parse(raw as string);
        expect(data.results).toHaveLength(1);
        expect(data.note).toMatch(/without date\/domain filters/);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        const relaxedUrl = String(fetchMock.mock.calls[2][0]);
        expect(relaxedUrl).not.toContain("domain_type");
        expect(relaxedUrl).not.toContain("recency_minutes");
    });

    it("retries once after a 429 then succeeds", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => null } })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    query: "q",
                    results: [{ title: "Winner", url: "https://example.com/w", snippet: "won" }],
                }),
            });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await webSearchTool.invoke({ query: "q" });
        const data = JSON.parse(raw as string);
        expect(data.results).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("gives up with a note when an unfiltered query stays empty", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true, json: async () => ({ query: "q", results: [], total_results: 0 }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await webSearchTool.invoke({ query: "q" });
        const data = JSON.parse(raw as string);
        expect(data.results).toBeUndefined();
        expect(data.note).toMatch(/No relevant web results/);
        // Unfiltered: exact retry only (attempts 1-2), no relaxed 3rd.
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("passes domain_type + recency params and maps date/publisher", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                query: "last F1 race winner",
                results: [
                    { title: "Winner", url: "https://example.com/w", snippet: "won", date: "2026-09-13", publisher: "F1" },
                ],
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await webSearchTool.invoke({
            query: "last F1 race winner",
            domain_type: "news",
            recency_minutes: 10080,
        });
        const data = JSON.parse(raw as string);
        expect(data.results[0].date).toBe("2026-09-13");
        expect(data.results[0].publisher).toBe("F1");

        const [url] = fetchMock.mock.calls[0];
        const qs = String(url);
        expect(qs).toContain("domain_type=news");
        expect(qs).toContain("recency_minutes=10080");
    });
});

describe("fetchWebPagesTool", () => {
    it("reports unconfigured fetch when no API key is set", async () => {
        const raw = await fetchWebPagesTool.invoke({ urls: ["https://example.com/a"] });
        const data = JSON.parse(raw as string);
        expect(data.error).toBe(true);
        expect(data.message).toMatch(/TINYFISH_API_KEY/);
    });

    it("POSTs to the fetch endpoint and truncates long pages", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        process.env.TINYFISH_FETCH_MAX_CHARS = "100";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { url: "https://example.com/a", final_url: "https://example.com/a", title: "A", published_date: "2026-09-13", text: "y".repeat(500) },
                ],
                errors: [{ url: "https://example.com/b", error: "timeout" }],
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await fetchWebPagesTool.invoke({
            urls: ["https://example.com/a", "https://example.com/b"],
            question: "Who won?",
        });
        const data = JSON.parse(raw as string);
        expect(data.pages).toHaveLength(1);
        expect(data.pages[0].title).toBe("A");
        expect(data.pages[0].published_date).toBe("2026-09-13");
        expect(data.pages[0].text).toContain("[truncated]");
        expect(data.errors).toHaveLength(1);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("https://api.fetch.tinyfish.ai");
        expect(init.method).toBe("POST");
        expect(init.headers).toMatchObject({ "X-API-Key": "test-key" });
        const body = JSON.parse(init.body as string);
        expect(body.urls).toEqual(["https://example.com/a", "https://example.com/b"]);
        expect(body.format).toBe("markdown");
    });

    it("returns an error payload on HTTP failure", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));

        const raw = await fetchWebPagesTool.invoke({ urls: ["https://example.com/a"] });
        const data = JSON.parse(raw as string);
        expect(data.error).toBe(true);
        expect(data.message).toMatch(/429/);
    });

    it("succeeds as a skip when no urls are provided", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        const raw = await fetchWebPagesTool.invoke({ urls: [] });
        const data = JSON.parse(raw as string);
        expect(data.error).toBeUndefined();
        expect(data.pages).toEqual([]);
        expect(data.note).toMatch(/skipping/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("moves thin extractions to errors instead of pages", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    { url: "https://example.com/thin", title: "Thin", text: "x".repeat(14) },
                    { url: "https://example.com/full", title: "Full", text: "y".repeat(500) },
                ],
                errors: [],
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await fetchWebPagesTool.invoke({ urls: ["https://example.com/thin", "https://example.com/full"] });
        const data = JSON.parse(raw as string);
        expect(data.pages).toHaveLength(1);
        expect(data.pages[0].url).toBe("https://example.com/full");
        expect(data.errors).toHaveLength(1);
        expect(data.errors[0].url).toBe("https://example.com/thin");
        expect(data.errors[0].error).toMatch(/too thin/);
    });

    it("retries once on 500 then succeeds", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: false, status: 500 })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    results: [{ url: "https://example.com/a", title: "A", text: "z".repeat(300) }],
                }),
            });
        vi.stubGlobal("fetch", fetchMock);

        const raw = await fetchWebPagesTool.invoke({ urls: ["https://example.com/a"] });
        const data = JSON.parse(raw as string);
        expect(data.pages).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("maps quota/auth statuses to actionable messages without retrying", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        for (const [status, pattern] of [[402, /quota/i], [401, /API key/i]] as const) {
            const fetchMock = vi.fn().mockResolvedValue({ ok: false, status });
            vi.stubGlobal("fetch", fetchMock);

            const raw = await fetchWebPagesTool.invoke({ urls: ["https://example.com/a"] });
            const data = JSON.parse(raw as string);
            expect(data.error).toBe(true);
            expect(data.message).toMatch(pattern);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it("passes ttl through to the fetch API", async () => {
        process.env.TINYFISH_API_KEY = "test-key";
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [{ url: "https://example.com/a", title: "A", text: "z".repeat(300) }],
            }),
        });
        vi.stubGlobal("fetch", fetchMock);

        await fetchWebPagesTool.invoke({ urls: ["https://example.com/a"], ttl: 0 });
        const [, init] = fetchMock.mock.calls[0];
        expect(JSON.parse(init.body as string).ttl).toBe(0);
    });
});

describe("extractResultUrls", () => {
    it("collects distinct http urls, skipping junk", async () => {
        const { extractResultUrls } = await import("@/lib/tools/search");
        expect(
            extractResultUrls({
                results: [
                    { url: "https://a.com/1" },
                    { url: "https://a.com/1" },
                    { url: "not-a-url" },
                    { url: 42 },
                    {},
                ],
            })
        ).toEqual(["https://a.com/1"]);
    });

    it("accepts JSON strings and tolerates garbage", async () => {
        const { extractResultUrls } = await import("@/lib/tools/search");
        expect(extractResultUrls(JSON.stringify({ results: [{ url: "http://b.com/x" }] }))).toEqual([
            "http://b.com/x",
        ]);
        expect(extractResultUrls("{broken")).toEqual([]);
        expect(extractResultUrls(null)).toEqual([]);
        expect(extractResultUrls({})).toEqual([]);
    });
});
