import { describe, it, expect, vi, afterEach } from "vitest";
import { webSearchTool } from "@/lib/tools/search";

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TINYFISH_API_KEY;
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
});
