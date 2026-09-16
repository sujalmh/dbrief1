/**
 * RAG Retrieval End-to-End Integration Test
 * ==========================================
 * Tests the complete flow from query to retrieved documents
 * with real API calls to OpenAI and Supabase
 */

import { describe, it, expect, beforeAll } from "vitest";
import { ragRetrieve } from "@/lib/agents/regulationRetriever";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { getPlannerModel } from "@/lib/llm";

describe("RAG Retrieval - End-to-End Test", () => {
    let plannerModel: BaseChatModel | undefined;

    beforeAll(async () => {
        // Use the planner model for sub-query generation
        try {
            plannerModel = await getPlannerModel("go");
        } catch (error) {
            console.warn("⚠️ Skipping E2E test - LLM not available:", error);
        }
    });

    it("should complete full RAG flow: query → sub-queries → retrieval → results", async () => {
        if (!plannerModel) {
            console.log("⚠️ Skipping - planner model not available");
            return;
        }

        // Real regulation query
        const query = "If a race is stopped after 2 laps behind the Safety Car, are points awarded?";
        const season = 2025;
        const section = "Sporting";

        console.log("\n========================================");
        console.log("🔍 RAG RETRIEVAL END-TO-END TEST");
        console.log("========================================\n");
        console.log("📝 Original Query:", query);
        console.log("📅 Season:", season);
        console.log("📋 Section:", section);
        console.log("\n");

        // Execute RAG retrieval with model for sub-query generation
        const result = await ragRetrieve(
            { query, season, section },
            plannerModel
        );

        // Log sub-queries
        console.log("🔄 Generated Sub-Queries:");
        result.used_subqueries.forEach((sq, i) => {
            console.log(`   ${i + 1}. "${sq}"`);
        });
        console.log("\n");

        // Log retrieved documents
        console.log(`📚 Retrieved ${result.retrieved_documents.length} Documents:\n`);
        result.retrieved_documents.forEach((doc, i) => {
            console.log(`   Document ${i + 1}:`);
            console.log(`   └─ Source: ${doc.source}`);
            console.log(`   └─ Type: ${doc.doc_type} / ${doc.section || "n/a"}`);
            console.log(`   └─ Published: ${doc.published_on || "N/A"}`);
            console.log(`   └─ Content: ${doc.content.substring(0, 150)}...`);
            console.log("\n");
        });

        console.log("========================================\n");

        // Assertions
        expect(result.used_subqueries.length).toBeGreaterThanOrEqual(1);
        expect(result.used_subqueries.length).toBeLessThanOrEqual(5);
        expect(result.retrieved_documents.length).toBeGreaterThan(0);
        // TOP_N_RESULTS (5) after dedup, minus any hits below the rerank floor
        expect(result.retrieved_documents.length).toBeLessThanOrEqual(5);

        // Verify document structure
        result.retrieved_documents.forEach((doc) => {
            expect(doc).toHaveProperty("source");
            expect(doc).toHaveProperty("doc_type");
            expect(doc).toHaveProperty("content");
            expect(doc.content.length).toBeGreaterThan(0);
        });
    }, 120000); // 2 minute timeout for real API calls

    it("should work without LLM (fallback to original query)", async () => {
        const query = "minimum race distance for points";
        const season = 2025;
        const section = "Sporting";

        console.log("\n========================================");
        console.log("🔍 RAG RETRIEVAL (No Sub-Query Generation)");
        console.log("========================================\n");
        console.log("📝 Query:", query);
        console.log("\n");

        // Execute without providing a model (will use only the original query)
        const result = await ragRetrieve({ query, season, section });

        console.log(`📚 Retrieved ${result.retrieved_documents.length} Documents\n`);
        console.log("========================================\n");

        expect(result.used_subqueries).toEqual([query]);
        expect(result.retrieved_documents.length).toBeGreaterThan(0);
    }, 60000);
});
