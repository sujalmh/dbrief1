/**
 * RAG Agent End-to-End Test Script
 * =================================
 * Tests the complete flow: User Query → Planner → RAG Retrieval → Response
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load environment variables
config({ path: resolve(__dirname, "../.env.local") });

import { ragRetrieve } from "../lib/agents/regulationRetriever";
import { getPlannerModel } from "../lib/llm";
import { planQuery } from "../lib/planner";

// Test cases for comprehensive validation
const TEST_CASES = [
    {
        name: "Race Stoppage Points Query",
        query: "If a race is stopped after 2 laps behind the Safety Car, are full points awarded?",
        season: 2025,
        section: "Sporting" as const,
        expectedKeywords: ["points", "safety car", "race", "stopped", "75%"],
    },
    {
        name: "DRS Activation Rules",
        query: "When can DRS be activated in a race and what are the restrictions?",
        season: 2025,
        section: "Sporting" as const,
        expectedKeywords: ["DRS", "lap", "activation", "zone"],
    },
    {
        name: "Power Unit Technical Specs",
        query: "What are the technical specifications for the 2026 F1 power unit?",
        season: 2026,
        section: "Technical" as const,
        expectedKeywords: ["power unit", "MGU", "electric", "battery"],
    },
    {
        name: "Pit Stop Regulations",
        query: "What are the safety regulations for pit stops during the race?",
        season: 2025,
        section: "Sporting" as const,
        expectedKeywords: ["pit", "stop", "safety", "crew"],
    },
];

async function testRAGDirect() {
    console.log("\n========================================");
    console.log("🧪 TEST 1: Direct RAG Retrieval");
    console.log("========================================\n");

    for (const testCase of TEST_CASES) {
        console.log(`\n📝 Test Case: ${testCase.name}`);
        console.log(`   Query: "${testCase.query}"`);
        console.log(`   Season: ${testCase.season}, Section: ${testCase.section}\n`);

        try {
            // Test with sub-query generation
            const plannerModel = await getPlannerModel("managed");
            const result = await ragRetrieve(
                {
                    query: testCase.query,
                    season: testCase.season,
                    section: testCase.section,
                },
                plannerModel
            );

            // Verification
            console.log(`✅ Retrieved: ${result.retrieved_documents.length} documents`);
            console.log(`✅ Sub-queries: ${result.used_subqueries.length}`);

            console.log("\n   📊 Sub-queries:");
            result.used_subqueries.forEach((sq, i) => {
                console.log(`      ${i + 1}. "${sq}"`);
            });

            console.log("\n   📚 Documents:");
            result.retrieved_documents.slice(0, 3).forEach((doc, i) => {
                console.log(`      ${i + 1}. Source: ${doc.source}`);
                console.log(`         Preview: ${doc.content.substring(0, 100)}...`);
                console.log(`         Type: ${doc.doc_type} / ${doc.section || "n/a"}, Published: ${doc.published_on || "N/A"}\n`);
            });

            // Validate keywords
            const allContent = result.retrieved_documents
                .map((d) => d.content.toLowerCase())
                .join(" ");

            const foundKeywords = testCase.expectedKeywords.filter((kw) =>
                allContent.includes(kw.toLowerCase())
            );

            if (foundKeywords.length > 0) {
                console.log(`   ✅ Found expected keywords: ${foundKeywords.join(", ")}`);
            } else {
                console.log(`   ⚠️  Expected keywords not found: ${testCase.expectedKeywords.join(", ")}`);
            }

        } catch (error) {
            console.error(`   ❌ Error:`, error);
        }

        console.log("\n" + "-".repeat(60));
    }
}

async function testPlannerIntegration() {
    console.log("\n========================================");
    console.log("🧪 TEST 2: Planner Integration");
    console.log("========================================\n");

    const regulationQuery = "What are the rules for race restarts after a red flag in F1?";

    console.log(`📝 User Query: "${regulationQuery}"\n`);

    try {
        const plannerModel = await getPlannerModel("managed");
        const plan = await planQuery(plannerModel, regulationQuery, false);

        console.log("✅ Plan Generated:");
        console.log(`   Steps: ${plan.steps.length}`);
        console.log(`   Reasoning: ${plan.reasoning}\n`);

        plan.steps.forEach((step, i) => {
            console.log(`   Step ${i + 1}:`);
            console.log(`      Tool: ${step.tool}`);
            console.log(`      Description: ${step.description}`);
            console.log(`      Args: ${JSON.stringify(step.args, null, 2)}`);
            console.log("");
        });

        // Check if retrieve_regulations was used
        const hasRegulationTool = plan.steps.some(
            (step) => step.tool === "retrieve_regulations"
        );

        if (hasRegulationTool) {
            console.log("   ✅ Planner correctly identified need for regulation retrieval");
        } else {
            console.log("   ⚠️  Planner did not use retrieve_regulations tool");
            console.log("   Tools used:", plan.steps.map((s) => s.tool).join(", "));
        }
    } catch (error) {
        console.error("   ❌ Error:", error);
    }
}

async function main() {
    console.log("\n========================================");
    console.log("🏎️  RAG AGENT COMPREHENSIVE TEST");
    console.log("========================================");

    // Check environment
    const requiredEnvVars = [
        "EMBEDDINGS_API_KEY",
        "QDRANT_URL",
        "QDRANT_API_KEY",
        "OPENCODE_GO_API_KEY",
    ];

    console.log("\n🔧 Environment Check:");
    const missing = requiredEnvVars.filter((v) => !process.env[v]);
    if (missing.length > 0) {
        console.error(`❌ Missing environment variables: ${missing.join(", ")}`);
        process.exit(1);
    }
    requiredEnvVars.forEach((v) => {
        console.log(`   ✓ ${v}: ✅`);
    });

    // Run tests
    await testRAGDirect();
    await testPlannerIntegration();

    console.log("\n========================================");
    console.log("✅ ALL TESTS COMPLETE");
    console.log("========================================\n");
}

if (require.main === module) {
    main().catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
}

export { main };
