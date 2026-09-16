/**
 * Regulation Retriever Agent
 * ==========================
 * RAG retrieval module for FIA documents (regulations + decisions).
 * Accepts queries from the planner, generates sub-queries,
 * performs vector search in Qdrant, reranks, and returns structured evidence.
 *
 * Qdrant collection: fia_documents (1024-dim voyage-4 vectors, Cosine)
 * Payload: doc_type (regulation|decision), season, section, event,
 *          title, filename, url, published_on, header, text, chunk_index, ...
 *
 * This module is:
 * - Server-side only
 * - Fully stateless and multi-user safe
 * - Designed as a LangChain planner step
 */

import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatContentToText } from "../llm";

// =============================================================================
// Configuration
// =============================================================================

const VOYAGE_API_URL = "https://ai.mongodb.com/v1/embeddings";
const VOYAGE_RERANK_URL = "https://ai.mongodb.com/v1/rerank";
export const EMBEDDING_MODEL = "voyage-4";
/** voyage-4 default output dimension (must match the Qdrant collection). */
export const EMBEDDING_DIM = 1024;
const RERANK_MODEL = "rerank-3";
const MAX_SUBQUERIES = 5;
const MIN_SUBQUERIES = 2;
const DEFAULT_MATCH_COUNT = 10;
const TOP_N_RESULTS = 5;
/**
 * Minimum Voyage rerank-3 relevance score (0-1) for a document to be kept.
 * Hits below this floor are clearly off-topic vector-search noise and must
 * not become UI sources. If every hit falls below the floor we keep the
 * single best one so the answer path still has context — the downstream
 * LLM source-pick decides whether it is actually cited.
 */
export const MIN_RELEVANCE_SCORE = 0.2;

/**
 * Section filter values map to every known `section` payload variant in
 * Qdrant (e.g. "Section C [Technical]"). Qdrant `match.any` is exact-match,
 * so all variants must be listed.
 */
const SECTION_VARIANTS: Record<string, string[]> = {
    Sporting: ["Sporting", "Section B [Sporting]"],
    Technical: ["Technical", "Section C [Technical]"],
    Financial: [
        "Financial",
        "Section D [Financial - F1 Teams]",
        "Section D [Financial Regulations - F1 Teams]",
        "Section E [Financial – PU Manufacturers]",
        "Section E [Financial Regulations - Power Unit Manufacturers]",
        "Section E [Financial - Power Unit Manufacturers]",
        "Section E [Financial - PU Manufacturers]",
    ],
};

// =============================================================================
// Zod Schemas
// =============================================================================

export const RagInputSchema = z.object({
    query: z.string().min(1, "Query is required"),
    season: z.number().int().min(1950).max(2100),
    section: z.enum(["Sporting", "Technical", "Financial"]),
    doc_type: z.enum(["regulation", "decision"]).default("regulation"),
    event: z.string().min(1).optional().describe("Grand Prix event name, e.g. 'Austrian Grand Prix' (mainly for decisions)"),
});

export type RagInput = z.input<typeof RagInputSchema>;

export const DocumentSchema = z.object({
    source: z.string().describe("Source filename"),
    title: z.string().describe("Document short title"),
    url: z.string().nullable().describe("Source URL"),
    /**
     * Canonical link field of the live `fia_documents` collection payload.
     * Carried explicitly (alongside the legacy `url`) so the exact
     * collection value reaches the UI clickable link without guessing.
     */
    source_url: z.string().nullable().optional().describe("Canonical source URL from the collection payload"),
    doc_type: z.string().describe("regulation or decision"),
    section: z.string().nullable(),
    event: z.string().nullable(),
    season: z.number(),
    published_on: z.string().nullable(),
    content: z.string().describe("Chunk text"),
    /**
     * Voyage rerank-3 relevance score (0-1, higher = more relevant).
     * Present only on documents that went through reranking; null when
     * the reranker was skipped or failed and vector order was used.
     * Downstream consumers use this to surface only genuinely relevant
     * sources instead of the raw top-N candidate list.
     */
    relevance_score: z.number().nullable().optional().describe("Rerank relevance score, null when not reranked"),
});

export type Document = z.infer<typeof DocumentSchema>;

export const RagOutputSchema = z.object({
    retrieved_documents: z.array(DocumentSchema),
    used_subqueries: z.array(z.string()),
});

export type RagOutput = z.infer<typeof RagOutputSchema>;

// Internal type for document representation
interface RetrievedDocument {
    id: number | string;
    season: number;
    doc_type: string;
    section: string | null;
    event: string | null;
    source: string;
    title: string;
    url: string | null;
    source_url?: string | null;
    published_on: string | null;
    chunk_index: number | null;
    content: string;
    similarity?: number;
    relevance_score?: number | null;
}

// =============================================================================
// Sub-Query Generation
// =============================================================================

const SUBQUERY_SYSTEM_PROMPT = `You are a query expansion assistant for FIA Formula 1 regulation retrieval.

Your task is to generate 2-5 focused sub-queries from a user's question to improve vector search recall.

Rules:
1. Generate exactly 2-5 sub-queries
2. Each sub-query should be short (3-7 words) and keyword-focused
3. Cover different aspects/angles of the original question
4. Use regulation-specific terminology when appropriate
5. Be deterministic - same input should produce same output
6. Output ONLY a JSON array of strings, nothing else

Example:
Input: "If a race is stopped after 2 laps behind the Safety Car, are points awarded?"
Output: ["race stopped safety car points", "minimum race distance points awarded", "race suspension points allocation", "safety car laps points eligibility"]`;

/**
 * Generate multiple focused sub-queries from a user query using an LLM
 *
 * @param query - The original user query
 * @param model - The LLM model to use for generation
 * @returns Array of 2-5 sub-queries
 */
export async function generateSubQueries(
    query: string,
    model: BaseChatModel
): Promise<string[]> {
    try {
        const messages = [
            new SystemMessage(SUBQUERY_SYSTEM_PROMPT),
            new HumanMessage(query),
        ];

        const response = await model.invoke(messages);
        const content = chatContentToText(response.content);

        // Parse JSON array from response
        const parsed = JSON.parse(content.trim());

        if (!Array.isArray(parsed)) {
            console.warn("[SubQuery] Response is not an array, using original query");
            return [query];
        }

        // Validate and limit sub-queries
        const subQueries = parsed
            .filter((q): q is string => typeof q === "string" && q.length > 0)
            .slice(0, MAX_SUBQUERIES);

        if (subQueries.length < MIN_SUBQUERIES) {
            // Fallback: include original query if too few sub-queries
            return [query, ...subQueries].slice(0, MAX_SUBQUERIES);
        }

        return subQueries;
    } catch (error) {
        console.error("[SubQuery] Generation failed:", error);
        // Fallback to original query
        return [query];
    }
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generate an embedding for a text using MongoDB Voyage AI (voyage-4)
 *
 * @param text - The text to embed
 * @returns Embedding vector of dimension 1024
 */
export async function embedQuery(text: string): Promise<number[]> {
    const apiKey = process.env.EMBEDDINGS_API_KEY;

    if (!apiKey) {
        throw new Error("EMBEDDINGS_API_KEY environment variable is not set");
    }

    try {
        const response = await fetch(VOYAGE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                input: text,
                model: EMBEDDING_MODEL,
                input_type: "query",
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Voyage API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const embedding = data.data?.[0]?.embedding;

        if (!embedding || !Array.isArray(embedding)) {
            throw new Error("Invalid embedding response from Voyage");
        }

        return embedding;
    } catch (error) {
        console.error("[Embed] Embedding generation failed:", error);
        throw error;
    }
}

// =============================================================================
// Qdrant Retrieval
// =============================================================================

interface QdrantPoint {
    id: number;
    score: number;
    payload: {
        doc_type: string;
        // NOTE: the live collection stores season as a STRING ("2024"),
        // not a number — the filter below stringifies, and the mapping
        // coerces back to number for the typed output contract.
        season: number | string;
        section?: string | null;
        event?: string | null;
        title?: string | null;
        short_title?: string | null;
        filename?: string | null;
        url?: string | null;
        source_url?: string | null;
        published_on?: string | null;
        text?: string | null;
        chunk_index?: number | null;
    };
}

interface QdrantSearchResponse {
    result: QdrantPoint[];
}

export interface RetrievalFilters {
    season: number;
    section: keyof typeof SECTION_VARIANTS;
    doc_type?: string;
    event?: string;
}

/**
 * Retrieve documents from Qdrant using vector similarity search
 *
 * @param embedding - The query embedding vector (voyage-4, 1024-dim)
 * @param filters - Payload filters (season, section, doc_type, event)
 * @param matchCount - Number of results to return per query (default: 10)
 * @returns Array of matching documents
 */
export async function retrieveFromQdrant(
    embedding: number[],
    filters: RetrievalFilters,
    matchCount: number = DEFAULT_MATCH_COUNT
): Promise<RetrievedDocument[]> {
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_API_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
        throw new Error("Missing Qdrant credentials (QDRANT_URL or QDRANT_API_KEY)");
    }

    const { season, section, doc_type = "regulation", event } = filters;

    try {
        // Qdrant search endpoint
        const searchUrl = `${qdrantUrl}/collections/fia_documents/points/search`;

        const must: Record<string, unknown>[] = [
            // Season is a KEYWORD (string) payload in the live collection.
            { key: "season", match: { value: String(season) } },
            { key: "doc_type", match: { value: doc_type } },
        ];

        // Decisions rarely carry a section payload — applying the filter
        // would exclude them, so only filter section for regulations.
        const sectionVariants = SECTION_VARIANTS[section];
        if (doc_type === "regulation" && sectionVariants) {
            must.push({ key: "section", match: { any: sectionVariants } });
        }

        if (event) {
            must.push({ key: "event", match: { value: event } });
        }

        const response = await fetch(searchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-key": qdrantApiKey,
            },
            body: JSON.stringify({
                vector: embedding,
                filter: { must },
                limit: matchCount,
                with_payload: true,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Qdrant search error: ${response.status} - ${errorText}`);
        }

        const data: QdrantSearchResponse = await response.json();

        if (!Array.isArray(data.result)) {
            console.warn("[Retrieve] Qdrant search returned non-array:", data);
            return [];
        }

        // Map Qdrant response to internal document format
        return data.result.map((point) => ({
            id: point.id,
            season: Number(point.payload.season),
            doc_type: point.payload.doc_type,
            section: point.payload.section ?? null,
            event: point.payload.event ?? null,
            source: point.payload.filename ?? "unknown",
            title: point.payload.short_title ?? point.payload.title ?? "untitled",
            // Carry the collection's canonical link field explicitly; `url`
            // stays as the merged fallback for older payloads/tests.
            source_url: point.payload.source_url ?? null,
            url: point.payload.source_url ?? point.payload.url ?? null,
            published_on: point.payload.published_on ?? null,
            chunk_index: point.payload.chunk_index ?? null,
            content: point.payload.text ?? "",
            similarity: point.score,
            relevance_score: null as number | null,
        }));
    } catch (error) {
        console.error("[Retrieve] Qdrant retrieval failed:", error);
        throw error;
    }
}

// =============================================================================
// Voyage Reranking (rerank-3)
// =============================================================================

interface RerankResultItem {
    index: number;
    relevance_score: number;
    document?: string;
}

interface RerankResponse {
    object: string;
    data?: RerankResultItem[];
    results?: RerankResultItem[];
    model: string;
}

/**
 * Rerank candidate documents against the original query using Voyage rerank-3.
 *
 * @param query - The original user query
 * @param documents - Deduplicated candidate documents
 * @param topK - Number of top documents to return (default: TOP_N_RESULTS)
 * @returns Reranked documents, ordered by relevance (descending)
 */
export async function rerankDocuments(
    query: string,
    documents: Document[],
    topK: number = TOP_N_RESULTS
): Promise<Document[]> {
    if (documents.length === 0) {
        return [];
    }

    const apiKey = process.env.EMBEDDINGS_API_KEY;

    if (!apiKey) {
        throw new Error("EMBEDDINGS_API_KEY environment variable is not set");
    }

    try {
        const response = await fetch(VOYAGE_RERANK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                query,
                documents: documents.map((doc) => doc.content),
                model: RERANK_MODEL,
                top_k: Math.min(topK, documents.length),
                return_documents: false,
                truncation: true,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Voyage rerank error: ${response.status} - ${errorText}`);
        }

        const data: RerankResponse = await response.json();
        const results = data.data ?? data.results;

        if (!Array.isArray(results)) {
            throw new Error("Invalid rerank response from Voyage");
        }

        const ranked = results
            .filter(
                (item) =>
                    typeof item.index === "number" &&
                    item.index >= 0 &&
                    item.index < documents.length
            )
            .slice(0, topK);

        // Attach the rerank relevance score to each surviving document so
        // downstream consumers (LLM source-pick, UI) can distinguish
        // genuinely relevant hits from vector-search noise.
        const scored = ranked.map((item) => ({
            ...documents[item.index],
            relevance_score: item.relevance_score,
        }));

        // Drop clearly off-topic hits below the relevance floor. If that
        // would empty the list, keep the single best hit so the answer
        // path still has context to work with.
        const kept = scored.filter(
            (doc) => (doc.relevance_score ?? 0) >= MIN_RELEVANCE_SCORE
        );
        if (kept.length === 0 && scored.length > 0) {
            console.warn(
                `[Rerank] All ${scored.length} hits below relevance floor ${MIN_RELEVANCE_SCORE} — keeping best hit only.`
            );
            return [scored[0]];
        }
        return kept;
    } catch (error) {
        console.error("[Rerank] Reranking failed:", error);
        throw error;
    }
}

// =============================================================================
// Deduplication and Ranking
// =============================================================================

interface RankedDocument extends Document {
    frequency: number;
    originalOrder: number;
}

/**
 * Deduplicate and rank documents from multiple sub-query results
 *
 * @param results - Array of document arrays from each sub-query
 * @returns Deduplicated and ranked array of documents (top N)
 */
export function deduplicateAndRank(results: RetrievedDocument[][]): Document[] {
    // Track document occurrences and their original order
    const documentMap = new Map<string, RankedDocument>();

    results.forEach((docs, subQueryIndex) => {
        docs.forEach((doc, docIndex) => {
            // Unique key from filename + chunk index (falls back to content)
            const key = doc.chunk_index !== null && doc.chunk_index !== undefined
                ? `${doc.source}::${doc.chunk_index}`
                : `${doc.source}::${doc.content}`;

            if (documentMap.has(key)) {
                // Increment frequency for duplicates
                const existing = documentMap.get(key)!;
                existing.frequency += 1;
                // Keep the better (lower) original order
                existing.originalOrder = Math.min(existing.originalOrder, docIndex);
            } else {
                // Add new document
                documentMap.set(key, {
                    source: doc.source,
                    title: doc.title,
                    url: doc.url,
                    source_url: doc.source_url ?? null,
                    doc_type: doc.doc_type,
                    section: doc.section,
                    event: doc.event,
                    season: doc.season,
                    published_on: doc.published_on,
                    content: doc.content,
                    frequency: 1,
                    originalOrder: docIndex + subQueryIndex * 100, // Weight by sub-query order
                });
            }
        });
    });

    // Sort by frequency (descending) then by original order (ascending)
    const ranked = Array.from(documentMap.values()).sort((a, b) => {
        if (b.frequency !== a.frequency) {
            return b.frequency - a.frequency; // Higher frequency first
        }
        return a.originalOrder - b.originalOrder; // Lower order first
    });

    // Return top N results, stripped of ranking metadata.
    // relevance_score stays null here — it is only populated by the
    // reranker in rerankDocuments().
    return ranked.slice(0, TOP_N_RESULTS).map((doc) => ({
        source: doc.source,
        title: doc.title,
        url: doc.url,
        source_url: doc.source_url ?? null,
        doc_type: doc.doc_type,
        section: doc.section,
        event: doc.event,
        season: doc.season,
        published_on: doc.published_on,
        content: doc.content,
        relevance_score: null as number | null,
    }));
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main RAG retrieval function - entry point for the planner
 *
 * Orchestrates:
 * 1. Sub-query generation
 * 2. Embedding generation for each sub-query (Voyage voyage-4)
 * 3. Vector search in Qdrant for each sub-query
 * 4. Deduplication of results
 * 5. Reranking with Voyage rerank-3
 *
 * @param input - The RAG input containing query, season, section, doc_type, event
 * @param model - Optional LLM model for sub-query generation (uses cheap model by default)
 * @returns Structured RAG output with retrieved documents and used sub-queries
 */
export async function ragRetrieve(
    input: RagInput,
    model?: BaseChatModel
): Promise<RagOutput> {
    // Validate input
    const validatedInput = RagInputSchema.parse(input);
    const { query, season, section, doc_type, event } = validatedInput;

    console.log(`[RAG] Starting retrieval for: "${query}" (season: ${season}, section: ${section}, doc_type: ${doc_type}${event ? `, event: ${event}` : ""})`);

    // Step 1: Generate sub-queries
    let subQueries: string[];
    if (model) {
        subQueries = await generateSubQueries(query, model);
    } else {
        // Fallback: use the original query if no model provided
        subQueries = [query];
    }

    console.log(`[RAG] Generated ${subQueries.length} sub-queries:`, subQueries);

    // Step 2 & 3: Embed and retrieve for each sub-query (in parallel)
    const retrievalPromises = subQueries.map(async (subQuery) => {
        try {
            const embedding = await embedQuery(subQuery);
            const documents = await retrieveFromQdrant(embedding, { season, section, doc_type, event });
            return documents;
        } catch (error) {
            console.error(`[RAG] Retrieval failed for sub-query "${subQuery}":`, error);
            return [];
        }
    });

    const allResults = await Promise.all(retrievalPromises);

    // Step 4: Deduplicate
    const rankedDocuments = deduplicateAndRank(allResults);

    // Step 5: Rerank with Voyage rerank-3 (fallback to vector order on failure)
    let finalDocuments = rankedDocuments;
    if (rankedDocuments.length > 0) {
        try {
            finalDocuments = await rerankDocuments(query, rankedDocuments, TOP_N_RESULTS);
        } catch (error) {
            console.error(`[RAG] Reranking failed, using vector order:`, error);
            finalDocuments = rankedDocuments;
        }
    }

    console.log(`[RAG] Retrieved ${finalDocuments.length} unique documents`);

    return {
        retrieved_documents: finalDocuments,
        used_subqueries: subQueries,
    };
}
