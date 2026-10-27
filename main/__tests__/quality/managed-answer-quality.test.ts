/**
 * P0 managed answer-quality regression suite.
 *
 * This runs the real quick pipeline (planner -> executor -> responder) against
 * the local FastAPI service with the managed flash model. It does not use Next
 * dev, the authenticated /api/chat route, or any runtime verification layer.
 *
 * Skips with a clear message when OPENCODE_GO_API_KEY is absent or the local
 * FastAPI service is not reachable. Fails when the configured managed model is
 * outside the allowed flash-only set.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QUALITY_CASES } from "./cases";
import {
    createPipeline,
    fetchRecencySnapshot,
    F1_API_BASE,
    formatFailure,
    printQualitySummary,
    probeFastApi,
    QUALITY_SESSION_ID,
    writeQualityReport,
    type CaseContext,
    type CaseResult,
    type PipelineHandle,
    type QualityCase,
    type RecencySnapshot,
} from "./harness";

const hasManagedKey = Boolean(process.env.OPENCODE_GO_API_KEY);
const service = await probeFastApi();
const shouldSkip = !hasManagedKey || !service.ok;

if (!hasManagedKey) {
    console.warn(
        "[quality] SKIP: OPENCODE_GO_API_KEY is not set. " +
        "Add it to main/.env.local to run the managed answer-quality suite."
    );
}
if (!service.ok) {
    console.warn(
        `[quality] SKIP: local FastAPI at ${F1_API_BASE} is not reachable (${service.error ?? "unknown error"}). ` +
        "Start it with: cd api; venv\\Scripts\\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
    );
}

describe.skipIf(shouldSkip)("Managed answer quality (P0)", () => {
    let pipeline: PipelineHandle | null = null;
    let recency: RecencySnapshot | null = null;
    let recencyError: string | null = null;
    const results: CaseResult[] = [];
    const startedAt = new Date().toISOString();

    beforeAll(async () => {
        pipeline = await createPipeline();
        try {
            recency = await fetchRecencySnapshot();
        } catch (error) {
            recencyError = error instanceof Error ? error.message : String(error);
            console.error(`[quality] Recency snapshot failed: ${recencyError}`);
        }
        console.log(
            `[quality] model=${pipeline.modelId} session=${QUALITY_SESSION_ID} api=${F1_API_BASE}`
        );
        if (recency) {
            console.log(
                `[quality] latest=${recency.latestEvent} (${recency.latestEventDate}) ` +
                `next=${recency.nextEvent} (${recency.nextEventDate})`
            );
        }
    }, 120_000);

    afterAll(() => {
        const report = {
            startedAt,
            finishedAt: new Date().toISOString(),
            model: pipeline?.modelId ?? "unknown",
            sessionId: QUALITY_SESSION_ID,
            apiBase: F1_API_BASE,
            results,
        };
        const path = writeQualityReport(report);
        printQualitySummary(report);
        console.log(`[quality] report: ${path}`);
    });

    it.each(QUALITY_CASES)("$id", async (testCase: QualityCase) => {
        if (!pipeline) throw new Error("Pipeline was not initialized");
        const context: CaseContext = { recency, recencyError };
        const result = await pipeline.run(testCase.prompt);
        const failures = testCase.check(result, context);
        const passed = failures.length === 0;

        results.push({
            ...result,
            id: testCase.id,
            category: testCase.category,
            expected: testCase.expected,
            passed,
            failures,
            model: pipeline.modelId,
            sessionId: QUALITY_SESSION_ID,
        });

        expect(failures, formatFailure(testCase, result, failures)).toEqual([]);
        expect(result.answer.trim().length).toBeGreaterThan(0);
    }, 360_000);
});
