/**
 * Test script: Verify research agent JSON parsing with real LLM
 *
 * Tests the Reasoner.classify() and Planner.createTasks() methods
 * using the OpenRouter API key from .env.local to ensure the
 * JSON extraction works with real LLM responses.
 *
 * Run: npx tsx scripts/test-research-parse.ts
 */

import { config } from "dotenv";
import { ChatOpenAI } from "@langchain/openai";
import { Reasoner } from "../lib/research/agents/reasoner";
import { Planner } from "../lib/research/agents/planner";
import { createToolRegistry } from "../lib/research/tool-registry";
import { EvidenceStore } from "../lib/research/evidence-store";
import { ResearchMemory } from "../lib/research/memory";
import { extractContent, extractJson } from "../lib/research/llm-parse";

// Load environment variables
config({ path: ".env.local" });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
    console.error("❌ OPENROUTER_API_KEY not found in .env.local");
    process.exit(1);
}

// =============================================================================
// Create test model (same as test suite uses)
// =============================================================================

function createTestModel(temperature: number = 0): ChatOpenAI {
    return new ChatOpenAI({
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        apiKey: OPENROUTER_API_KEY,
        temperature,
        maxTokens: 16384,
        timeout: 90000,
        configuration: {
            baseURL: "https://openrouter.ai/api/v1",
        },
    });
}

// =============================================================================
// Test runner
// =============================================================================

async function runTests() {
    console.log("=".repeat(70));
    console.log("Research Agent JSON Parsing Test (Real LLM)");
    console.log("=".repeat(70));
    console.log();

    const model = createTestModel(0);

    // --- Test 1: Raw LLM response inspection ---
    console.log("▶ Test 1: Inspect raw LLM response format");
    console.log("-".repeat(50));

    const { SystemMessage, HumanMessage } = await import("@langchain/core/messages");

    try {
        const rawResponse = await model.invoke([
            new SystemMessage("You are a helpful assistant. Respond with ONLY a JSON object, no other text."),
            new HumanMessage('Return this JSON: {"status": "ok", "message": "hello"}'),
        ]);

        const rawContent = extractContent(rawResponse.content);
        console.log("Raw response type:", typeof rawResponse.content);
        console.log("Raw response length:", rawContent.length);
        console.log("Raw response (first 300 chars):", rawContent.slice(0, 300));
        console.log();

        // Try to parse it
        try {
            const parsed = extractJson(rawContent);
            console.log("✅ Parsed successfully:", JSON.stringify(parsed, null, 2));
        } catch (error) {
            console.log("❌ Parse failed:", error instanceof Error ? error.message : error);
        }
    } catch (error) {
        console.log("❌ Model invoke failed:", error instanceof Error ? error.message : error);
        if (error instanceof Error && (error as any).response) {
            console.log("Response data:", JSON.stringify((error as any).response.data || (error as any).response, null, 2));
        }
        // Print full error for debugging
        console.log("Full error:", error);
    }
    console.log();

    // --- Test 2: Reasoner.classify() ---
    console.log("▶ Test 2: Reasoner.classify()");
    console.log("-".repeat(50));

    const reasoner = new Reasoner(model);
    const testObjective = "Why was Verstappen unbeatable in 2023?";

    try {
        const classification = await reasoner.classify(testObjective);
        console.log("✅ Classification succeeded:");
        console.log("  Research type:", classification.researchType);
        console.log("  Strategy:", classification.strategy.slice(0, 200));
        console.log("  Reasoning:", classification.reasoning.slice(0, 200));
    } catch (error) {
        console.log("❌ Classification failed:", error instanceof Error ? error.message : error);
    }
    console.log();

    // --- Test 3: Planner.createTasks() ---
    console.log("▶ Test 3: Planner.createTasks()");
    console.log("-".repeat(50));

    const registry = createToolRegistry(true);
    const planner = new Planner(model, registry);
    const evidenceStore = new EvidenceStore();
    const memory = new ResearchMemory();

    try {
        const { tasks, reasoning } = await planner.createTasks(
            "Investigate Verstappen's 2023 dominance: check standings, qualifying performance, race results, and reliability",
            {
                objective: testObjective,
                researchType: "causal",
                evidenceStore,
                memory,
                budget: { maxTasks: 50, maxIterations: 20, tasksExecuted: 0, iterationsCompleted: 0 },
                iteration: 1,
                deepResearch: true,
            }
        );

        console.log("✅ Planning succeeded:");
        console.log("  Tasks generated:", tasks.length);
        console.log("  Reasoning:", reasoning.slice(0, 200));
        for (const task of tasks) {
            console.log(`  - [${task.id}] ${task.tool}: ${task.description}`);
            console.log(`    args: ${JSON.stringify(task.args)}`);
            if (task.dependsOn && task.dependsOn.length > 0) {
                console.log(`    dependsOn: ${task.dependsOn.join(", ")}`);
            }
        }
    } catch (error) {
        console.log("❌ Planning failed:", error instanceof Error ? error.message : error);
    }
    console.log();

    // --- Test 4: Reasoner.reflect() ---
    console.log("▶ Test 4: Reasoner.reflect()");
    console.log("-".repeat(50));

    // Add some mock evidence to the store for reflection
    try {
        const reflection = await reasoner.reflect({
            objective: testObjective,
            researchType: "causal",
            evidenceStore,
            memory,
            budget: { maxTasks: 50, maxIterations: 20, tasksExecuted: 3, iterationsCompleted: 1 },
            iteration: 1,
        });

        console.log("✅ Reflection succeeded:");
        console.log("  Useful:", reflection.useful);
        console.log("  Answered part:", reflection.answeredPart);
        console.log("  Still missing:", reflection.stillMissing);
        console.log("  Next action:", reflection.nextAction);
        console.log("  Reasoning:", reflection.reasoning.slice(0, 200));
    } catch (error) {
        console.log("❌ Reflection failed:", error instanceof Error ? error.message : error);
    }
    console.log();

    // --- Test 5: Multiple queries to check robustness ---
    console.log("▶ Test 5: Multiple classify() calls for robustness");
    console.log("-".repeat(50));

    const testQueries = [
        "Compare Hamilton vs Verstappen 2023 season",
        "What tyre strategy did Ferrari use at Monaco 2024?",
        "How did the 2021 regulation changes affect car performance?",
        "Show me telemetry for Norris at Silverstone 2024",
    ];

    for (const query of testQueries) {
        try {
            const result = await reasoner.classify(query);
            console.log(`✅ "${query.slice(0, 50)}..." → ${result.researchType}`);
        } catch (error) {
            console.log(`❌ "${query.slice(0, 50)}..." → FAILED: ${error instanceof Error ? error.message : error}`);
        }
    }

    console.log();
    console.log("=".repeat(70));
    console.log("Test complete");
    console.log("=".repeat(70));
}

runTests().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
