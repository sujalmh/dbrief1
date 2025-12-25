/**
 * Regulation Retriever Unit Tests
 * ================================
 * Tests for the RAG retrieval module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    generateSubQueries,
    embedQuery,
    deduplicateAndRank,
    ragRetrieve,
    RagInputSchema,
    RagOutputSchema,
} from "@/lib/agents/regulationRetriever";

// =============================================================================
// Mock Setup
// =============================================================================

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock LLM for sub-query generation
const createMockLLM = (subQueries: string[]) => ({
    invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify(subQueries),
    }),
});

// Sample documents for testing
const createMockDocument = (id: number, content: string, source: string = "test.pdf") => ({
    id,
    year: 2025,
    type: "sporting",
    source,
    date: "2024-10-17",
    content,
    similarity: 0.9 - id * 0.1,
});

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("Schema Validation", () => {
    describe("RagInputSchema", () => {
        it("should accept valid input", () => {
            const input = {
                query: "race stopped safety car points",
                year: 2025,
                type: "sporting",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(true);
        });

        it("should reject empty query", () => {
            const input = {
                query: "",
                year: 2025,
                type: "sporting",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject invalid year", () => {
            const input = {
                query: "test query",
                year: 1800, // Too old
                type: "sporting",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject invalid type", () => {
            const input = {
                query: "test query",
                year: 2025,
                type: "invalid",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should accept all valid types", () => {
            const types = ["sporting", "technical", "financial", "other"];

            types.forEach((type) => {
                const input = { query: "test", year: 2025, type };
                const result = RagInputSchema.safeParse(input);
                expect(result.success).toBe(true);
            });
        });
    });

    describe("RagOutputSchema", () => {
        it("should accept valid output", () => {
            const output = {
                retrieved_documents: [
                    {
                        source: "fia_2025_sporting.pdf",
                        date: "2024-10-17",
                        type: "sporting",
                        content: "Race stopped content...",
                    },
                ],
                used_subqueries: ["race stopped points", "safety car points"],
            };

            const result = RagOutputSchema.safeParse(output);
            expect(result.success).toBe(true);
        });

        it("should accept null date", () => {
            const output = {
                retrieved_documents: [
                    {
                        source: "test.pdf",
                        date: null,
                        type: "sporting",
                        content: "content",
                    },
                ],
                used_subqueries: ["query"],
            };

            const result = RagOutputSchema.safeParse(output);
            expect(result.success).toBe(true);
        });
    });
});

// =============================================================================
// Sub-Query Generation Tests
// =============================================================================

describe("generateSubQueries", () => {
    it("should return sub-queries from LLM", async () => {
        const expectedQueries = [
            "race stopped safety car points",
            "minimum race distance points awarded",
            "race suspension points allocation",
        ];

        const mockLLM = createMockLLM(expectedQueries);
        const result = await generateSubQueries("Test query", mockLLM as any);

        expect(result).toEqual(expectedQueries);
        expect(mockLLM.invoke).toHaveBeenCalledOnce();
    });

    it("should limit sub-queries to maximum of 5", async () => {
        const manyQueries = Array(10)
            .fill(null)
            .map((_, i) => `query ${i}`);

        const mockLLM = createMockLLM(manyQueries);
        const result = await generateSubQueries("Test query", mockLLM as any);

        expect(result.length).toBeLessThanOrEqual(5);
    });

    it("should fallback to original query on LLM error", async () => {
        const mockLLM = {
            invoke: vi.fn().mockRejectedValue(new Error("LLM failed")),
        };

        const result = await generateSubQueries("Original query", mockLLM as any);

        expect(result).toEqual(["Original query"]);
    });

    it("should fallback when response is not an array", async () => {
        const mockLLM = {
            invoke: vi.fn().mockResolvedValue({
                content: '"not an array"',
            }),
        };

        const result = await generateSubQueries("Original query", mockLLM as any);

        expect(result).toEqual(["Original query"]);
    });

    it("should include original query if too few sub-queries generated", async () => {
        const mockLLM = createMockLLM(["single query"]);
        const result = await generateSubQueries("Original query", mockLLM as any);

        expect(result.length).toBeGreaterThanOrEqual(2);
        expect(result).toContain("Original query");
    });
});

// =============================================================================
// Deduplication and Ranking Tests
// =============================================================================

describe("deduplicateAndRank", () => {
    it("should remove duplicate documents", () => {
        const doc1 = createMockDocument(1, "Content A");
        const doc2 = createMockDocument(2, "Content B");
        const doc1Dup = createMockDocument(3, "Content A"); // Same content as doc1

        const results = [[doc1, doc2], [doc1Dup]];
        const ranked = deduplicateAndRank(results);

        expect(ranked.length).toBe(2);
        expect(ranked.map((d) => d.content)).toContain("Content A");
        expect(ranked.map((d) => d.content)).toContain("Content B");
    });

    it("should rank by frequency (higher frequency first)", () => {
        const doc1 = createMockDocument(1, "Frequent content");
        const doc2 = createMockDocument(2, "Rare content");
        const doc1Dup1 = createMockDocument(3, "Frequent content");
        const doc1Dup2 = createMockDocument(4, "Frequent content");

        // doc1 appears 3 times, doc2 appears once
        const results = [[doc1], [doc1Dup1, doc2], [doc1Dup2]];
        const ranked = deduplicateAndRank(results);

        expect(ranked[0].content).toBe("Frequent content");
        expect(ranked[1].content).toBe("Rare content");
    });

    it("should preserve original order for same frequency", () => {
        const doc1 = createMockDocument(1, "First");
        const doc2 = createMockDocument(2, "Second");
        const doc3 = createMockDocument(3, "Third");

        const results = [[doc1, doc2, doc3]];
        const ranked = deduplicateAndRank(results);

        expect(ranked[0].content).toBe("First");
        expect(ranked[1].content).toBe("Second");
        expect(ranked[2].content).toBe("Third");
    });

    it("should limit results to top 8", () => {
        const manyDocs = Array(15)
            .fill(null)
            .map((_, i) => createMockDocument(i, `Content ${i}`));

        const results = [manyDocs];
        const ranked = deduplicateAndRank(results);

        expect(ranked.length).toBeLessThanOrEqual(8);
    });

    it("should handle empty input", () => {
        const results: any[][] = [[], []];
        const ranked = deduplicateAndRank(results);

        expect(ranked).toEqual([]);
    });

    it("should deduplicate across different sources with same content", () => {
        const doc1 = createMockDocument(1, "Same content", "source1.pdf");
        const doc2 = createMockDocument(2, "Same content", "source1.pdf"); // Same source + content
        const doc3 = createMockDocument(3, "Same content", "source2.pdf"); // Different source

        const results = [[doc1, doc2], [doc3]];
        const ranked = deduplicateAndRank(results);

        // Should have 2 documents (one from source1.pdf, one from source2.pdf)
        expect(ranked.length).toBe(2);
    });

    it("should strip ranking metadata from output", () => {
        const doc = createMockDocument(1, "Test");
        const results = [[doc]];
        const ranked = deduplicateAndRank(results);

        expect(ranked[0]).not.toHaveProperty("frequency");
        expect(ranked[0]).not.toHaveProperty("originalOrder");
        expect(ranked[0]).toHaveProperty("source");
        expect(ranked[0]).toHaveProperty("content");
        expect(ranked[0]).toHaveProperty("type");
        expect(ranked[0]).toHaveProperty("date");
    });
});

// =============================================================================
// Embedding Tests (with mocked fetch)
// =============================================================================

describe("embedQuery", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.OPENAI_API_KEY = "test-key";
        process.env.QDRANT_URL = "https://test.qdrant.io";
        process.env.QDRANT_API_KEY = "test-qdrant-key";
    });

    it("should return embedding from OpenAI API", async () => {
        const mockEmbedding = Array(1536).fill(0.1);

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    data: [{ embedding: mockEmbedding }],
                }),
        });

        const result = await embedQuery("test text");

        expect(result).toEqual(mockEmbedding);
        expect(result.length).toBe(1536);
    });

    it("should throw if OPENAI_API_KEY is not set", async () => {
        delete process.env.OPENAI_API_KEY;

        await expect(embedQuery("test")).rejects.toThrow("OPENAI_API_KEY");
    });

    it("should throw on API error", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve("Unauthorized"),
        });

        await expect(embedQuery("test")).rejects.toThrow("OpenAI API error");
    });
});

// =============================================================================
// Integration-Style Tests (with all mocks)
// =============================================================================

describe("ragRetrieve (integration)", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.OPENAI_API_KEY = "test-key";
        process.env.QDRANT_URL = "https://test.qdrant.io";
        process.env.QDRANT_API_KEY = "test-qdrant-key";
    });

    it("should return structured output for valid input", async () => {
        const mockEmbedding = Array(1536).fill(0.1);
        const mockDocuments = [createMockDocument(1, "Regulation content")];

        // Mock OpenAI embedding
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    data: [{ embedding: mockEmbedding }],
                }),
        });

        // Mock Qdrant search
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                result: mockDocuments.map(doc => ({
                    id: doc.id,
                    score: doc.similarity || 0.9,
                    payload: {
                        year: doc.year,
                        type: doc.type,
                        source: doc.source,
                        date: doc.date,
                        content: doc.content
                    }
                }))
            }),
        });

        const result = await ragRetrieve({
            query: "race stopped points",
            year: 2025,
            type: "sporting",
        });

        expect(result).toHaveProperty("retrieved_documents");
        expect(result).toHaveProperty("used_subqueries");
        expect(result.retrieved_documents.length).toBeGreaterThan(0);
    });

    it("should validate output matches schema", async () => {
        const mockEmbedding = Array(1536).fill(0.1);
        const mockDocuments = [
            createMockDocument(1, "Content 1"),
            createMockDocument(2, "Content 2"),
        ];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    data: [{ embedding: mockEmbedding }],
                }),
        });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                result: mockDocuments.map(doc => ({
                    id: doc.id,
                    score: doc.similarity || 0.9,
                    payload: {
                        year: doc.year,
                        type: doc.type,
                        source: doc.source,
                        date: doc.date,
                        content: doc.content
                    }
                }))
            }),
        });

        const result = await ragRetrieve({
            query: "test query",
            year: 2025,
            type: "sporting",
        });

        const validation = RagOutputSchema.safeParse(result);
        expect(validation.success).toBe(true);
    });

    it("should throw for invalid input", async () => {
        await expect(
            ragRetrieve({
                query: "",
                year: 2025,
                type: "sporting",
            })
        ).rejects.toThrow();
    });
});
