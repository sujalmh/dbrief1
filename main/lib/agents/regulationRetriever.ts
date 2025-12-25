/**
 * Regulation Retriever Agent
 * ==========================
 * RAG retrieval module for FIA regulation documents.
 * Accepts queries from the planner, generates sub-queries,
 * performs vector search in Supabase, and returns structured evidence.
 *
 * This module is:
 * - Server-side only
 * - Fully stateless and multi-user safe
 * - Designed as a LangChain planner step
 */

import { z } from "zod";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

// =============================================================================
// Configuration
// =============================================================================

const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;
const MAX_SUBQUERIES = 5;
const MIN_SUBQUERIES = 2;
const DEFAULT_MATCH_COUNT = 5;
const TOP_N_RESULTS = 5;

// =============================================================================
// Zod Schemas
// =============================================================================

export const RagInputSchema = z.object({
    query: z.string().min(1, "Query is required"),
    year: z.number().int().min(1950).max(2100),
    type: z.enum(["sporting", "technical", "financial", "other"]),
});

export type RagInput = z.infer<typeof RagInputSchema>;

export const DocumentSchema = z.object({
    source: z.string(),
    date: z.string().nullable(),
    type: z.string(),
    content: z.string(),
});

export type Document = z.infer<typeof DocumentSchema>;

export const RagOutputSchema = z.object({
    retrieved_documents: z.array(DocumentSchema),
    used_subqueries: z.array(z.string()),
});

export type RagOutput = z.infer<typeof RagOutputSchema>;

// Internal type for Supabase RPC response
interface SupabaseDocument {
    id: number;
    year: number;
    type: string;
    source: string;
    date: string | null;
    content: string;
    similarity?: number;
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
        const content = typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

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
 * Generate an embedding for a text using OpenAI's embedding API
 *
 * @param text - The text to embed
 * @returns Embedding vector of dimension 1536
 */
export async function embedQuery(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        throw new Error("OPENAI_API_KEY environment variable is not set");
    }

    try {
        const response = await fetch(OPENAI_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                input: text,
                model: EMBEDDING_MODEL,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const embedding = data.data?.[0]?.embedding;

        if (!embedding || !Array.isArray(embedding)) {
            throw new Error("Invalid embedding response from OpenAI");
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
        year: number;
        type: string;
        source: string;
        date: string | null;
        content: string;
    };
}

interface QdrantSearchResponse {
    result: QdrantPoint[];
}

/**
 * Retrieve documents from Qdrant using vector similarity search
 *
 * @param embedding - The query embedding vector
 * @param year - The regulation year to filter by
 * @param type - The regulation type to filter by
 * @param matchCount - Number of results to return (default: 5)
 * @returns Array of matching documents
 */
export async function retrieveFromQdrant(
    embedding: number[],
    year: number,
    type: string,
    matchCount: number = DEFAULT_MATCH_COUNT
): Promise<SupabaseDocument[]> {
    const qdrantUrl = process.env.QDRANT_URL;
    const qdrantApiKey = process.env.QDRANT_API_KEY;

    if (!qdrantUrl || !qdrantApiKey) {
        throw new Error("Missing Qdrant credentials (QDRANT_URL or QDRANT_API_KEY)");
    }

    try {
        // Qdrant search endpoint
        const searchUrl = `${qdrantUrl}/collections/fia_documents/points/search`;

        const response = await fetch(searchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "api-key": qdrantApiKey,
            },
            body: JSON.stringify({
                vector: embedding,
                filter: {
                    must: [
                        { key: "year", match: { value: year } },
                        { key: "type", match: { value: type } },
                    ],
                },
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
            year: point.payload.year,
            type: point.payload.type,
            source: point.payload.source,
            date: point.payload.date,
            content: point.payload.content,
            similarity: point.score,
        }));
    } catch (error) {
        console.error("[Retrieve] Qdrant retrieval failed:", error);
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
export function deduplicateAndRank(results: SupabaseDocument[][]): Document[] {
    // Track document occurrences and their original order
    const documentMap = new Map<string, RankedDocument>();

    results.forEach((docs, subQueryIndex) => {
        docs.forEach((doc, docIndex) => {
            // Create unique key from source + content
            const key = `${doc.source}::${doc.content}`;

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
                    date: doc.date,
                    type: doc.type,
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

    // Return top N results, stripped of ranking metadata
    return ranked.slice(0, TOP_N_RESULTS).map(({ frequency, originalOrder, ...doc }) => doc);
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main RAG retrieval function - entry point for the planner
 *
 * Orchestrates:
 * 1. Sub-query generation
 * 2. Embedding generation for each sub-query
 * 3. Vector search in Supabase for each sub-query
 * 4. Deduplication and ranking of results
 *
 * @param input - The RAG input containing query, year, and type
 * @param model - Optional LLM model for sub-query generation (uses cheap model by default)
 * @returns Structured RAG output with retrieved documents and used sub-queries
 */
export async function ragRetrieve(
    input: RagInput,
    model?: BaseChatModel
): Promise<RagOutput> {
    // Validate input
    const validatedInput = RagInputSchema.parse(input);
    const { query, year, type } = validatedInput;

    console.log(`[RAG] Starting retrieval for: "${query}" (year: ${year}, type: ${type})`);

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
            const documents = await retrieveFromQdrant(embedding, year, type);
            return documents;
        } catch (error) {
            console.error(`[RAG] Retrieval failed for sub-query "${subQuery}":`, error);
            return [];
        }
    });

    const allResults = await Promise.all(retrievalPromises);

    // Step 4: Deduplicate and rank
    const rankedDocuments = deduplicateAndRank(allResults);

    console.log(`[RAG] Retrieved ${rankedDocuments.length} unique documents`);

    return {
        retrieved_documents: rankedDocuments,
        used_subqueries: subQueries,
    };
}
