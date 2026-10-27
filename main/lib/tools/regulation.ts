/**
 * Regulation Retrieval Tool
 * =========================
 * LangChain tool wrapper for the regulation retriever agent.
 * Exposes RAG retrieval over FIA regulations + decisions as a structured
 * tool for the planner.
 */

import { z } from "zod";
import { tool, StructuredTool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ragRetrieve } from "@/lib/agents/regulationRetriever";

// =============================================================================
// Tool Definition
// =============================================================================

const REGULATION_TOOL_DESCRIPTION = `Retrieve FIA Formula 1 documents (regulations and stewards' decisions) from the vector store.
Use this tool when the user asks about F1 rules, regulations, or official FIA documents/decisions.
This tool performs semantic search to find relevant document chunks.

Season and section must be provided by the planner - do NOT infer them.
Use doc_type "decision" with an event name for race-specific stewards' documents.

Returns reranked document chunks with source, title, url, source_url, relevance_score, doc_type, section, event, and content.`;

const REGULATION_TOOL_SCHEMA = z.object({
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
});

/**
 * Build a regulation/decision retrieval tool.
 *
 * When `model` is provided, `ragRetrieve` uses it to expand the planner's
 * query into 2-5 focused sub-queries before embedding and search. Without a
 * model, retrieval falls back to the original query (the historical
 * behaviour, kept for callers that do not have an LLM handle).
 */
export function createRegulationRetrieveTool(model?: BaseChatModel): StructuredTool {
    return tool(
        async ({ query, season, section, doc_type, event }) => {
            try {
                const result = await ragRetrieve(
                    { query, season, section, doc_type, event },
                    model
                );
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
            description: REGULATION_TOOL_DESCRIPTION,
            schema: REGULATION_TOOL_SCHEMA,
        }
    );
}

/**
 * Unbound regulation retrieval tool (original-query search only).
 * Retained for callers such as the deep-research tool registry that do not
 * pass an LLM handle.
 */
export const regulationRetrieveTool = createRegulationRetrieveTool();

// =============================================================================
// Tool Registry
// =============================================================================

/**
 * Get all regulation-related tools.
 *
 * @param model - Optional planner/chat model used for sub-query expansion.
 *   When omitted, the shared unbound tool is returned so existing callers
 *   keep their current behaviour.
 */
export function getRegulationTools(model?: BaseChatModel): Record<string, StructuredTool> {
    return {
        retrieve_regulations: model
            ? createRegulationRetrieveTool(model)
            : regulationRetrieveTool,
    };
}
