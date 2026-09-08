/**
 * Simple RAG Retrieval Demo Script
 * ==================================
 * Demonstrates the full RAG flow without test framework complexity
 * Run with: npx tsx scripts/test-rag.ts
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables from .env.local
config({ path: resolve(__dirname, "../.env.local") });

import { ragRetrieve } from "../lib/agents/regulationRetriever";

async function main() {
    console.log("\n========================================");
    console.log("🏎️  RAG RETRIEVAL DEMO");
    console.log("========================================\n");

    // Check environment
    console.log("🔧 Environment Check:");
    console.log("   ✓ EMBEDDINGS_API_KEY:", process.env.EMBEDDINGS_API_KEY ? "✅ Set" : "❌ Missing");
    console.log("   ✓ QDRANT_URL:", process.env.QDRANT_URL ? "✅ Set" : "❌ Missing");
    console.log("   ✓ QDRANT_API_KEY:", process.env.QDRANT_API_KEY ? "✅ Set" : "❌ Missing");
    console.log("\n");

    if (!process.env.EMBEDDINGS_API_KEY || !process.env.QDRANT_URL || !process.env.QDRANT_API_KEY) {
        console.error("❌ Missing required environment variables. Check .env.local");
        process.exit(1);
    }

    // Test query
    const query = "If a race is stopped after 2 laps behind the Safety Car, are points awarded?";
    const season = 2025;
    const section = "Sporting";

    console.log("📝 Query:", query);
    console.log("📅 Season:", season);
    console.log("📋 Section:", section);
    console.log("\n⏳ Processing...\n");

    try {
        // Execute RAG retrieval (without model, will use only original query)
        const result = await ragRetrieve({ query, season, section });

        // Display results
        console.log("✅ RAG Retrieval Complete!\n");
        console.log("========================================");
        console.log("📊 RESULTS");
        console.log("========================================\n");

        console.log(`🔍 Sub-queries used (${result.used_subqueries.length}):`);
        result.used_subqueries.forEach((sq, i) => {
            console.log(`   ${i + 1}. "${sq}"`);
        });
        console.log("\n");

        console.log(`📚 Retrieved Documents (${result.retrieved_documents.length}):\n`);

        if (result.retrieved_documents.length === 0) {
            console.log("   ⚠️  No documents found. This might mean:");
            console.log("      - The Qdrant collection is empty");
            console.log("      - The ingestion script hasn't run yet");
            console.log("      - The query doesn't match any regulations");
        } else {
            result.retrieved_documents.forEach((doc, i) => {
                console.log(`   📄 Document ${i + 1}:`);
                console.log(`      Source: ${doc.source}`);
                console.log(`      Type: ${doc.doc_type} / ${doc.section || "n/a"}`);
                console.log(`      Published: ${doc.published_on || "N/A"}`);
                console.log(`      Content Preview: ${doc.content.substring(0, 200)}...`);
                console.log("\n");
            });
        }

        console.log("========================================");
        console.log("✅ Demo Complete!");
        console.log("========================================\n");

        // Return structured output
        return {
            success: true,
            subQueries: result.used_subqueries,
            documentCount: result.retrieved_documents.length,
            documents: result.retrieved_documents,
        };
    } catch (error) {
        console.error("\n❌ Error during RAG retrieval:");
        console.error(error);
        console.log("\n");
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// Run if called directly
if (require.main === module) {
    main()
        .then((result) => {
            if (result.success) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        })
        .catch((error) => {
            console.error("Fatal error:", error);
            process.exit(1);
        });
}

export { main };
