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
});
