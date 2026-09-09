/**
 * Cross-Model E2E — SMOKE RUN
 * ===========================
 * Tiny version of the full E2E: just 1 model, 3 prompts across the 4
 * categories. Used to validate the harness end-to-end before running
 * the 4×20 version. Replaced by cross-model-e2e.test.ts in CI.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
config({ path: ".env.local" });

import { createModel, invokeWithLog, ModelCallLog, ProjectModel } from "../utils/multi-model-client";
import { ALL_E2E_PROMPTS, E2EPrompt } from "../fixtures/e2e-prompts";
import { grade, GraderResult } from "../utils/e2e-grader";
import { Plan, planQuery } from "@/lib/planner";
import { executeSteps, ExecutionResult, aggregateContext } from "@/lib/executor";
import { f1Tools } from "@/lib/tools/fastf1";
import { getSearchTools } from "@/lib/tools/search";
import { getVisualizationTools } from "@/lib/tools/visualization";
import { getSimulationTools } from "@/lib/tools/simulation";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const LOG_DIR = join(process.cwd(), ".e2e-logs");
mkdirSync(LOG_DIR, { recursive: true });
const allResults: GraderResult[] = [];
const callLogs: ModelCallLog[] = [];

const F1_API = process.env.F1_API_URL || "http://localhost:8000";

const SMOKE_MODEL: ProjectModel = "nvidia/nemotron-3-super-120b-a12b:free";
const SMOKE_PROMPTS = [
    ALL_E2E_PROMPTS.find((p) => p.id === "recent-ver-monaco-2024")!,
    ALL_E2E_PROMPTS.find((p) => p.id === "past-2017-standings")!,
    ALL_E2E_PROMPTS.find((p) => p.id === "cmp-ver-vs-nor-monaco-2024")!,
    ALL_E2E_PROMPTS.find((p) => p.id === "inf-abu-dhabi-2021-no-sc")!,
];

beforeAll(async () => {
    const r = await fetch(`${F1_API}/health`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`F1 backend not healthy at ${F1_API}`);
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
}, 30_000);

afterAll(() => {
    writeFileSync(join(LOG_DIR, "smoke-results.json"), JSON.stringify(allResults, null, 2));
    writeFileSync(join(LOG_DIR, "smoke-calls.json"), JSON.stringify(callLogs, null, 2));
    console.log("\nSMOKE RUN RESULTS:");
    for (const r of allResults) {
        const icon = r.passed ? "PASS" : "FAIL";
        console.log(`  [${icon}] ${r.model} / ${r.promptId} overall=${(r.overall * 100).toFixed(0)}%`);
        if (r.findings.length > 0) {
            for (const f of r.findings.slice(0, 5)) console.log(`         - ${f}`);
        }
    }
});

describe("Cross-Model E2E (smoke)", () => {
    it("runs one model against 4 category prompts", async () => {
        const planner = createModel(SMOKE_MODEL, { temperature: 0, maxTokens: 4096, timeout: 60_000 });
        const responder = createModel(SMOKE_MODEL, { temperature: 0.3, maxTokens: 4096, timeout: 60_000 });
        for (const prompt of SMOKE_PROMPTS) {
            const r = await runOne(planner, responder, SMOKE_MODEL, prompt);
            allResults.push(r);
        }
        // Smoke assertion: at least one run should be attempted.
        expect(allResults.length).toBeGreaterThan(0);
    }, 8 * 60 * 1000);
});

async function runOne(
    plannerModel: BaseChatModel,
    responderModel: BaseChatModel,
    modelName: ProjectModel,
    prompt: E2EPrompt
): Promise<GraderResult> {
    const t0 = Date.now();
    const pLog: ModelCallLog = { model: modelName, role: "planner", latencyMs: 0, rawContent: "", contentPreview: "" };
    const rLog: ModelCallLog = { model: modelName, role: "responder", latencyMs: 0, rawContent: "", contentPreview: "" };
    callLogs.push(pLog, rLog);

    let plan: Plan | null = null;
    let planError: string | null = null;
    try {
        plan = await planQuery(plannerModel, prompt.prompt, false, false);
        pLog.rawContent = JSON.stringify(plan);
        pLog.contentPreview = pLog.rawContent.slice(0, 800);
    } catch (e: any) {
        planError = e?.message ?? String(e);
        pLog.error = planError ?? undefined;
    }
    pLog.latencyMs = Date.now() - t0;

    const toolResults: Record<number, { success: boolean; data: unknown; error?: string }> = {};
    let ctx: any = null;
    if (plan) {
        const tools: Record<string, any> = {
            ...(f1Tools as Record<string, any>),
            ...(getSearchTools() as Record<string, any>),
            ...(getVisualizationTools() as any),
            ...(getSimulationTools() as Record<string, any>),
        };
        ctx = await executeSteps(plan.steps, tools);
        for (const r of ctx.results as ExecutionResult[]) {
            toolResults[r.step - 1] = { success: r.success, data: r.data, error: r.error };
        }
    }

    let finalResponse = "";
    let responseError: string | null = null;
    try {
        const data = ctx ? aggregateContext(ctx) : "(empty plan)";
        const sys = new SystemMessage("You are an F1 expert. Use the F1 data below to answer. Be concise, factual, and never invent drivers, years, or events that aren't in the data.");
        const user = new HumanMessage(`Question: ${prompt.prompt}\n\nF1 data:\n${data.slice(0, 6000)}`);
        finalResponse = await invokeWithLog(responderModel, rLog, [
            { role: "system", content: String(sys.content ?? "") },
            { role: "user", content: String(user.content ?? "") },
        ]);
    } catch (e: any) {
        responseError = e?.message ?? String(e);
        rLog.error = responseError ?? undefined;
    }

    return grade({
        prompt, plan, planError, toolResults, finalResponse, responseError,
        rawResponse: rLog.rawContent, model: modelName, latencyMs: Date.now() - t0,
    });
}
