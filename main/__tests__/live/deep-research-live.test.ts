/**
 * Live deep-research turn
 * =======================
 * Opt-in only. Requires the local FastAPI service on F1_API_URL and the
 * managed model key. Run with:
 *   RUN_LIVE_DEEP=1 npx vitest run __tests__/live/deep-research-live.test.ts
 *
 * One full ResearchManager turn with the managed DeepSeek model. Asserts
 * evidence was collected, the final report cites it, and no unresolved
 * [E#] references survive.
 */

import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { getPlannerModel, getResponderModel } from "@/lib/llm";
import { ResearchManager } from "@/lib/research/manager";
import type { ResearchEvent } from "@/lib/research/types";

const RUN_LIVE = process.env.RUN_LIVE_DEEP === "1";
if (RUN_LIVE) {
    config({ path: ".env.local", quiet: true });
}
const MANAGED_MODEL = process.env.MANAGED_LLM_MODEL || "deepseek-v4.1-flash";
const ALLOWED_MODEL =
    MANAGED_MODEL === "deepseek-v4.1-flash" || MANAGED_MODEL === "mimo-v2.6-flash";

describe.skipIf(!RUN_LIVE)("live deep-research turn", () => {
    it(
        "collects evidence and streams only valid citations",
        async () => {
            expect(ALLOWED_MODEL).toBe(true);

            const sessionId = `p1-deep-live-${Date.now()}`;
            const [plannerModel, responderModel] = await Promise.all([
                getPlannerModel("managed", undefined, sessionId),
                getResponderModel("managed", undefined, true, sessionId),
            ]);

            const manager = new ResearchManager(
                plannerModel,
                responderModel,
                {
                    deepResearch: true,
                    webSearch: false,
                    maxTasks: 6,
                    maxIterations: 2,
                }
            );

            const events: ResearchEvent[] = [];
            for await (const event of manager.run(
                "Compare the qualifying pace of VER and LEC at the 2024 Austrian Grand Prix."
            )) {
                events.push(event);
            }

            const evidence = events.filter(
                (event): event is Extract<ResearchEvent, { type: "evidence" }> =>
                    event.type === "evidence"
            );
            const text = events
                .filter((event): event is Extract<ResearchEvent, { type: "token" }> =>
                    event.type === "token"
                )
                .map((event) => event.content)
                .join("");

            const refs = text.match(/\[E\d+\]/g) ?? [];
            const evidenceIds = new Set(evidence.map((event) => event.evidence.id));
            const invalidRefs = refs.filter((ref) => !evidenceIds.has(ref.slice(1, -1)));

            const plan = events.find(
                (event): event is Extract<ResearchEvent, { type: "plan_iteration" }> =>
                    event.type === "plan_iteration"
            );
            const done = events.find(
                (event): event is Extract<ResearchEvent, { type: "done" }> => event.type === "done"
            );
            const verification = events.find(
                (event): event is Extract<ResearchEvent, { type: "verification" }> =>
                    event.type === "verification"
            );
            const degraded = events.filter(
                (event): event is Extract<ResearchEvent, { type: "degraded" }> =>
                    event.type === "degraded"
            );

            console.log(
                `[live-deep] model=${MANAGED_MODEL} tasks=${done?.result.tasksExecuted ?? "?"} evidence=${evidence.length} refs=${refs.length} answerChars=${text.length}`
            );
            console.log(
                `[live-deep] plan=${JSON.stringify(plan?.tasks.map((task) => task.tool) ?? [])}`
            );
            console.log(
                `[live-deep] planArgs=${JSON.stringify(
                    plan?.tasks.map((task) => ({
                        tool: task.tool,
                        args: task.args,
                        dependsOn: task.dependsOn,
                    })) ?? []
                )}`
            );
            const taskUpdates = events
                .filter(
                    (event): event is Extract<ResearchEvent, { type: "task_update" }> =>
                        event.type === "task_update"
                )
                .map((event) => ({
                    taskId: event.taskId,
                    status: event.status,
                    evidenceId: event.evidenceId,
                }));
            console.log(`[live-deep] taskUpdates=${JSON.stringify(taskUpdates)}`);
            console.log(
                `[live-deep] evidenceTools=${JSON.stringify(
                    evidence.map((event) => event.evidence.source.tool)
                )}`
            );
            console.log(`[live-deep] refs=${JSON.stringify([...new Set(refs)])}`);
            console.log(
                `[live-deep] verification=${verification?.result.severity ?? "none"} degraded=${JSON.stringify(
                    degraded.map((event) => event.stage)
                )}`
            );
            console.log(`[live-deep] answer=${JSON.stringify(text)}`);

            expect(evidence.length).toBeGreaterThan(0);
            expect(text.trim().length).toBeGreaterThan(0);
            expect(refs.length).toBeGreaterThan(0);
            expect(invalidRefs).toEqual([]);
            expect(done?.result.evidenceCount ?? 0).toBeGreaterThan(0);
        },
        300_000
    );
});
