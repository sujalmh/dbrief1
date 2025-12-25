/**
 * Regulation Retrieval Tool
 * =========================
 * LangChain tool wrapper for the regulation retriever agent.
 * Exposes RAG retrieval as a structured tool for the planner.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";
import { ragRetrieve, RagInputSchema } from "@/lib/agents/regulationRetriever";

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * Regulation retrieval tool for FIA documents
 * Retrieves relevant regulation chunks from Supabase vector store
 */
export const regulationRetrieveTool = tool(
    async ({ query, year, type }) => {
        try {
            const result = await ragRetrieve({ query, year, type });
            return JSON.stringify(result);
        } catch (error) {
            return JSON.stringify({
                error: true,
                message: error instanceof Error ? error.message : "Retrieval failed",
                query,
                year,
                type,
            });
        }
    },
    {
        name: "retrieve_regulations",
        description: `Retrieve FIA Formula 1 regulation documents from the vector store.
Use this tool when the user asks about F1 rules, regulations, or official FIA documents.
This tool performs semantic search to find relevant regulation chunks.

The query should describe what regulation information is needed.
Year and type must be provided by the planner - do NOT infer them.

Returns an array of relevant document chunks with source, date, type, and content.`,
        schema: z.object({
            query: z
                .string()
                .describe("The regulation question or topic to search for"),
            year: z
                .number()
                .int()
                .min(1950)
                .max(2100)
                .describe("The regulation year (e.g., 2025)"),
            type: z
                .enum(["sporting", "technical", "financial", "other"])
                .describe("The regulation type: sporting, technical, financial, or other"),
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
