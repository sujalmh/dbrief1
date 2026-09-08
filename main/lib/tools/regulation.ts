/**
 * Regulation Retrieval Tool
 * =========================
 * LangChain tool wrapper for the regulation retriever agent.
 * Exposes RAG retrieval over FIA regulations + decisions as a structured
 * tool for the planner.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";
import { ragRetrieve } from "@/lib/agents/regulationRetriever";

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * Regulation/decision retrieval tool for FIA documents
 * Retrieves relevant document chunks from the Qdrant vector store
 */
export const regulationRetrieveTool = tool(
    async ({ query, season, section, doc_type, event }) => {
        try {
            const result = await ragRetrieve({ query, season, section, doc_type, event });
            return JSON.stringify(result);
        } catch (error) {
            return JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : "Retrieval failed",
                query,
                season,
                section,
            });
        }
    },
    {
        name: "retrieve_regulations",
        description: `Retrieve FIA Formula 1 documents (regulations and stewards' decisions) from the vector store.
Use this tool when the user asks about F1 rules, regulations, or official FIA documents/decisions.
This tool performs semantic search to find relevant document chunks.

Season and section must be provided by the planner - do NOT infer them.
Use doc_type "decision" with an event name for race-specific stewards' documents.

Returns an array of relevant document chunks with source, title, url, doc_type, section, event, and content.`,
        schema: z.object({
            query: z
                .string()
                .describe("The regulation question or topic to search for"),
            season: z
                .number()
                .int()
                .min(1950)
                .max(2100)
                .describe("The season year (e.g., 2025)"),
            section: z
                .enum(["Sporting", "Technical", "Financial"])
                .describe("The regulation section: Sporting, Technical, or Financial"),
            doc_type: z
                .enum(["regulation", "decision"])
                .default("regulation")
                .describe("Document type: regulation (rules) or decision (event stewards' documents)"),
            event: z
                .string()
                .optional()
                .describe("Grand Prix event name, e.g. 'Austrian Grand Prix' (mainly for decisions)"),
        }),
    }
);

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Get all regulation-related tools
 */
export function getRegulationTools(): Record<string, StructuredTool> {
    return {
        retrieve_regulations: regulationRetrieveTool,
    };
}

/**
 * Get regulation tools as an array (for LangChain)
 */
export function getRegulationToolsArray(): StructuredTool[] {
    return [regulationRetrieveTool];
}
