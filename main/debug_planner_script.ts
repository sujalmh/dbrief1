
import { planQuery } from '@/lib/planner';
import { createTestPlannerModel } from './__tests__/utils/llm-client';
import { validatePlanSchema } from './__tests__/utils/test-helpers';

async function runDebug() {
    const model = createTestPlannerModel();

    // Updated prompts to match test-prompts.ts changes
    const prompts = [
        "Show Verstappen's lap times in the 2023 Monaco GP",
        "Plot Hamilton's tyre stints in Imola 2024",
        "Compare Ferrari vs Red Bull race pace at Monza 2023"
    ];

    for (const prompt of prompts) {
        console.log(`\n--- Prompt: "${prompt}" ---`);
        try {
            const plan = await planQuery(model, prompt, false);
            console.log("Plan:", JSON.stringify(plan, null, 2));

            const validation = validatePlanSchema(plan);
            console.log("Validation:", validation);
        } catch (error) {
            console.error("Error:", error);
        }
    }
}

runDebug();
