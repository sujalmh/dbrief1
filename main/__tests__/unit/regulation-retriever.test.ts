/**
 * Regulation Retriever Unit Tests
 * ================================
 * Tests for the RAG retrieval module
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    generateSubQueries,
    embedQuery,
    rerankDocuments,
    deduplicateAndRank,
    ragRetrieve,
    RagInputSchema,
    RagOutputSchema,
} from "@/lib/agents/regulationRetriever";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

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

// Sample documents for testing (mirrors Qdrant fia_documents payload)
const createMockDocument = (id: number, content: string, source: string = "test.pdf") => ({
    id,
    season: 2025,
    doc_type: "regulation",
    section: "Sporting",
    event: null,
    source,
    title: "Test Document",
    url: "https://www.fia.com/test.pdf",
    published_on: "2024-10-17",
    chunk_index: id,
    content,
    similarity: 0.9 - id * 0.1,
});

const toQdrantPoint = (doc: ReturnType<typeof createMockDocument>) => ({
    id: doc.id,
    score: doc.similarity || 0.9,
    payload: {
        season: doc.season,
        doc_type: doc.doc_type,
        section: doc.section,
        event: doc.event,
        filename: doc.source,
        short_title: doc.title,
        source_url: doc.url,
        published_on: doc.published_on,
        chunk_index: doc.chunk_index,
        text: doc.content,
    },
});

// =============================================================================
// Schema Validation Tests
// =============================================================================

describe("Schema Validation", () => {
    describe("RagInputSchema", () => {
        it("should accept valid input", () => {
            const input = {
                query: "race stopped safety car points",
                season: 2025,
                section: "Sporting",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(true);
        });

        it("should default doc_type to regulation", () => {
            const input = {
                query: "race stopped safety car points",
                season: 2025,
                section: "Sporting",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.doc_type).toBe("regulation");
            }
        });

        it("should accept decision queries with an event", () => {
            const input = {
                query: "deleted lap times",
                season: 2023,
                section: "Sporting",
                doc_type: "decision",
                event: "Austrian Grand Prix",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(true);
        });

        it("should reject empty query", () => {
            const input = {
                query: "",
                season: 2025,
                section: "Sporting",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject invalid season", () => {
            const input = {
                query: "test query",
                season: 1800, // Too old
                section: "Sporting",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should reject invalid section", () => {
            const input = {
                query: "test query",
                season: 2025,
                section: "invalid",
            };

            const result = RagInputSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("should accept all valid sections", () => {
            const sections = ["Sporting", "Technical", "Financial"];

            sections.forEach((section) => {
                const input = { query: "test", season: 2025, section };
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
                        title: "Sporting Regulations",
                        url: "https://www.fia.com/fia_2025_sporting.pdf",
                        doc_type: "regulation",
                        section: "Sporting",
                        event: null,
                        season: 2025,
                        published_on: "2024-10-17",
                        content: "Race stopped content...",
                    },
                ],
                used_subqueries: ["race stopped points", "safety car points"],
            };

            const result = RagOutputSchema.safeParse(output);
            expect(result.success).toBe(true);
        });

        it("should accept null optionals", () => {
            const output = {
                retrieved_documents: [
                    {
                        source: "test.pdf",
                        title: "Test",
                        url: null,
                        doc_type: "decision",
                        section: null,
                        event: "Austrian Grand Prix",
                        season: 2023,
                        published_on: null,
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
        const result = await generateSubQueries("Test query", mockLLM as unknown as BaseChatModel);

        expect(result).toEqual(expectedQueries);
        expect(mockLLM.invoke).toHaveBeenCalledOnce();
    });

    it("should limit sub-queries to maximum of 5", async () => {
        const manyQueries = Array(10)
            .fill(null)
            .map((_, i) => `query ${i}`);

        const mockLLM = createMockLLM(manyQueries);
        const result = await generateSubQueries("Test query", mockLLM as unknown as BaseChatModel);

        expect(result.length).toBeLessThanOrEqual(5);
    });

    it("should fallback to original query on LLM error", async () => {
        const mockLLM = {
            invoke: vi.fn().mockRejectedValue(new Error("LLM failed")),
        };

        const result = await generateSubQueries("Original query", mockLLM as unknown as BaseChatModel);

        expect(result).toEqual(["Original query"]);
    });

    it("should fallback when response is not an array", async () => {
        const mockLLM = {
            invoke: vi.fn().mockResolvedValue({
                content: '"not an array"',
            }),
        };

        const result = await generateSubQueries("Original query", mockLLM as unknown as BaseChatModel);

        expect(result).toEqual(["Original query"]);
    });

    it("should include original query if too few sub-queries generated", async () => {
        const mockLLM = createMockLLM(["single query"]);
        const result = await generateSubQueries("Original query", mockLLM as unknown as BaseChatModel);

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
        const doc1Dup = { ...createMockDocument(3, "Content A"), chunk_index: 1 }; // Same chunk as doc1

        const results = [[doc1, doc2], [doc1Dup]];
        const ranked = deduplicateAndRank(results);

        expect(ranked.length).toBe(2);
        expect(ranked.map((d) => d.content)).toContain("Content A");
        expect(ranked.map((d) => d.content)).toContain("Content B");
    });

    it("should rank by frequency (higher frequency first)", () => {
        const doc1 = createMockDocument(1, "Frequent content");
        const doc2 = createMockDocument(2, "Rare content");
        const doc1Dup1 = { ...createMockDocument(3, "Frequent content"), chunk_index: 1 };
        const doc1Dup2 = { ...createMockDocument(4, "Frequent content"), chunk_index: 1 };

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

    it("should limit results to top 5 (TOP_N_RESULTS)", () => {
        const manyDocs = Array(15)
            .fill(null)
            .map((_, i) => createMockDocument(i, `Content ${i}`));

        const results = [manyDocs];
        const ranked = deduplicateAndRank(results);

        expect(ranked.length).toBeLessThanOrEqual(5);
    });

    it("should handle empty input", () => {
        const ranked = deduplicateAndRank([[], []]);

        expect(ranked).toEqual([]);
    });

    it("should deduplicate same chunk across sub-queries", () => {
        const doc1 = createMockDocument(1, "Same content", "source1.pdf");
        const doc2 = { ...createMockDocument(2, "Same content", "source1.pdf"), chunk_index: 1 }; // Same chunk
        const doc3 = createMockDocument(3, "Same content", "source2.pdf"); // Different source

        const results = [[doc1, doc2], [doc3]];
        const ranked = deduplicateAndRank(results);

        // Should have 2 documents (one chunk from source1.pdf, one from source2.pdf)
        expect(ranked.length).toBe(2);
    });

    it("should keep different chunks as separate documents", () => {
        const doc1 = createMockDocument(1, "Same content", "source1.pdf");
        const doc2 = createMockDocument(2, "Same content", "source1.pdf"); // Different chunk_index

        const results = [[doc1, doc2]];
        const ranked = deduplicateAndRank(results);

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
        expect(ranked[0]).toHaveProperty("doc_type");
        expect(ranked[0]).toHaveProperty("season");
    });
});

// =============================================================================
// Embedding Tests (with mocked fetch)
// =============================================================================

describe("embedQuery", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.EMBEDDINGS_API_KEY = "test-key";
        process.env.QDRANT_URL = "https://test.qdrant.io";
        process.env.QDRANT_API_KEY = "test-qdrant-key";
    });

    it("should return embedding from Voyage API", async () => {
        const mockEmbedding = Array(1024).fill(0.1);

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    data: [{ embedding: mockEmbedding }],
                }),
        });

        const result = await embedQuery("test text");

        expect(result).toEqual(mockEmbedding);
        expect(result.length).toBe(1024);

        // Should call Voyage embeddings endpoint with query input type
        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe("https://ai.mongodb.com/v1/embeddings");
        const body = JSON.parse(options.body);
        expect(body.model).toBe("voyage-4");
        expect(body.input_type).toBe("query");
    });

    it("should throw if EMBEDDINGS_API_KEY is not set", async () => {
        delete process.env.EMBEDDINGS_API_KEY;

        await expect(embedQuery("test")).rejects.toThrow("EMBEDDINGS_API_KEY");
    });

    it("should throw on API error", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve("Unauthorized"),
        });

        await expect(embedQuery("test")).rejects.toThrow("Voyage API error");
    });
});

// =============================================================================
// Rerank Tests (with mocked fetch)
// =============================================================================

describe("rerankDocuments", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.EMBEDDINGS_API_KEY = "test-key";
    });

    const createDoc = (content: string, source = "test.pdf") => ({
        source,
        title: "Test Document",
        url: "https://www.fia.com/test.pdf",
        doc_type: "regulation",
        section: "Sporting",
        event: null,
        season: 2025,
        published_on: "2024-10-17",
        content,
    });

    it("should return documents ordered by rerank relevance", async () => {
        const docs = [createDoc("Content A"), createDoc("Content B"), createDoc("Content C")];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    object: "list",
                    data: [
                        { index: 2, relevance_score: 0.9 },
                        { index: 0, relevance_score: 0.5 },
                        { index: 1, relevance_score: 0.3 },
                    ],
                    model: "rerank-3",
                }),
        });

        const result = await rerankDocuments("test query", docs, 3);

        expect(result.map((d) => d.content)).toEqual(["Content C", "Content A", "Content B"]);
        // Rerank scores are carried on the documents for downstream source picks.
        expect(result.map((d) => d.relevance_score)).toEqual([0.9, 0.5, 0.3]);

        const [url, options] = mockFetch.mock.calls[0];
        expect(url).toBe("https://ai.mongodb.com/v1/rerank");
        const body = JSON.parse(options.body);
        expect(body.model).toBe("rerank-3");
        expect(body.query).toBe("test query");
        expect(body.documents).toEqual(["Content A", "Content B", "Content C"]);
    });

    it("should respect topK", async () => {
        const docs = [createDoc("Content A"), createDoc("Content B")];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    object: "list",
                    data: [
                        { index: 1, relevance_score: 0.9 },
                        { index: 0, relevance_score: 0.5 },
                    ],
                    model: "rerank-3",
                }),
        });

        const result = await rerankDocuments("test query", docs, 1);

        expect(result.length).toBe(1);
        expect(result[0].content).toBe("Content B");
    });

    it("should drop hits below the relevance floor", async () => {
        const docs = [createDoc("Content A"), createDoc("Content B"), createDoc("Content C")];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    object: "list",
                    data: [
                        { index: 0, relevance_score: 0.85 },
                        { index: 1, relevance_score: 0.05 },
                        { index: 2, relevance_score: 0.01 },
                    ],
                    model: "rerank-3",
                }),
        });

        const result = await rerankDocuments("test query", docs, 3);

        expect(result.map((d) => d.content)).toEqual(["Content A"]);
        expect(result[0].relevance_score).toBe(0.85);
    });

    it("should keep the best hit when all scores fall below the floor", async () => {
        const docs = [createDoc("Content A"), createDoc("Content B")];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    object: "list",
                    data: [
                        { index: 1, relevance_score: 0.15 },
                        { index: 0, relevance_score: 0.05 },
                    ],
                    model: "rerank-3",
                }),
        });

        const result = await rerankDocuments("test query", docs, 2);

        expect(result.length).toBe(1);
        expect(result[0].content).toBe("Content B");
    });

    it("should carry source_url from the collection payload", async () => {
        const docs = [createDoc("Content A")];

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () =>
                Promise.resolve({
                    object: "list",
                    data: [{ index: 0, relevance_score: 0.9 }],
                    model: "rerank-3",
                }),
        });

        const result = await rerankDocuments("test query", docs, 1);

        // createDoc-based unit docs carry url; source_url may be absent here
        // (populated from the live Qdrant payload in retrieveFromQdrant).
        expect(result[0].url).toBe("https://www.fia.com/test.pdf");
    });

    it("should return empty array for empty input without calling API", async () => {
        const result = await rerankDocuments("test query", [], 5);

        expect(result).toEqual([]);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should throw if EMBEDDINGS_API_KEY is not set", async () => {
        delete process.env.EMBEDDINGS_API_KEY;

        await expect(rerankDocuments("q", [createDoc("Content A")])).rejects.toThrow(
            "EMBEDDINGS_API_KEY"
        );
    });

    it("should throw on API error", async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: () => Promise.resolve("Unauthorized"),
        });

        await expect(rerankDocuments("q", [createDoc("Content A")])).rejects.toThrow(
            "Voyage rerank error"
        );
    });
});

// =============================================================================
// Integration-Style Tests (with all mocks)
// =============================================================================

describe("ragRetrieve (integration)", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        process.env.EMBEDDINGS_API_KEY = "test-key";
        process.env.QDRANT_URL = "https://test.qdrant.io";
        process.env.QDRANT_API_KEY = "test-qdrant-key";
    });

    it("should return structured output for valid input", async () => {
        const mockEmbedding = Array(1024).fill(0.1);
        const mockDocuments = [createMockDocument(1, "Regulation content")];

        // Mock Voyage embedding
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
                result: mockDocuments.map(toQdrantPoint)
            }),
        });

        // Mock Voyage rerank-3
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                object: "list",
                data: [{ index: 0, relevance_score: 0.95 }],
                model: "rerank-3",
            }),
        });

        const result = await ragRetrieve({
            query: "race stopped points",
            season: 2025,
            section: "Sporting",
        });

        expect(result).toHaveProperty("retrieved_documents");
        expect(result).toHaveProperty("used_subqueries");
        expect(result.retrieved_documents.length).toBeGreaterThan(0);
    });

    it("should validate output matches schema", async () => {
        const mockEmbedding = Array(1024).fill(0.1);
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
                result: mockDocuments.map(toQdrantPoint)
            }),
        });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                object: "list",
                data: [
                    { index: 0, relevance_score: 0.9 },
                    { index: 1, relevance_score: 0.8 },
                ],
                model: "rerank-3",
            }),
        });

        const result = await ragRetrieve({
            query: "test query",
            season: 2025,
            section: "Sporting",
        });

        const validation = RagOutputSchema.safeParse(result);
        expect(validation.success).toBe(true);
    });

    it("should fallback to vector order when rerank fails", async () => {
        const mockEmbedding = Array(1024).fill(0.1);
        const mockDocuments = [createMockDocument(1, "Regulation content")];

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
                result: mockDocuments.map(toQdrantPoint)
            }),
        });

        // Rerank fails
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: () => Promise.resolve("Server error"),
        });

        const result = await ragRetrieve({
            query: "race stopped points",
            season: 2025,
            section: "Sporting",
        });

        expect(result.retrieved_documents.length).toBeGreaterThan(0);
        expect(result.retrieved_documents[0].content).toBe("Regulation content");
    });

    it("should throw for invalid input", async () => {
        await expect(
            ragRetrieve({
                query: "",
                season: 2025,
                section: "Sporting",
            })
        ).rejects.toThrow();
    });

    it("should carry source_url and relevance_score from Qdrant through rerank", async () => {
        const mockEmbedding = Array(1024).fill(0.1);

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
                result: [
                    {
                        id: 1,
                        score: 0.9,
                        payload: {
                            season: "2025",
                            doc_type: "regulation",
                            section: "Sporting",
                            filename: "2025_sporting_regs.pdf",
                            short_title: "Sporting Regulations",
                            source_url: "https://www.fia.com/2025_sporting_regs.pdf",
                            published_on: "2024-10-17",
                            chunk_index: 0,
                            text: "Regulation content",
                        },
                    },
                ],
            }),
        });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                object: "list",
                data: [{ index: 0, relevance_score: 0.95 }],
                model: "rerank-3",
            }),
        });

        const result = await ragRetrieve({
            query: "race stopped points",
            season: 2025,
            section: "Sporting",
        });

        expect(result.retrieved_documents.length).toBe(1);
        const doc = result.retrieved_documents[0];
        expect(doc.source_url).toBe("https://www.fia.com/2025_sporting_regs.pdf");
        expect(doc.url).toBe("https://www.fia.com/2025_sporting_regs.pdf");
        expect(doc.relevance_score).toBe(0.95);
    });

    it("should send season/doc_type/section filters to Qdrant", async () => {
        const mockEmbedding = Array(1024).fill(0.1);

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ data: [{ embedding: mockEmbedding }] }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ result: [] }),
        });
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({ object: "list", data: [], model: "rerank-3" }),
        });

        await ragRetrieve({
            query: "deleted lap times",
            season: 2023,
            section: "Sporting",
            doc_type: "decision",
            event: "Austrian Grand Prix",
        });

        const qdrantCall = mockFetch.mock.calls.find(([url]) =>
            String(url).includes("/collections/fia_documents/points/search")
        );
        expect(qdrantCall).toBeDefined();
        const body = JSON.parse(qdrantCall![1].body);
        const must = body.filter.must;
        // Season is a KEYWORD (string) payload in the live collection.
        expect(must).toContainEqual({ key: "season", match: { value: "2023" } });
        expect(must).toContainEqual({ key: "doc_type", match: { value: "decision" } });
        expect(must).toContainEqual({ key: "event", match: { value: "Austrian Grand Prix" } });
        // Decisions carry no section payload — no section filter expected
        expect(must.some((c: unknown) => (c as { key: string }).key === "section")).toBe(false);
    });
});
