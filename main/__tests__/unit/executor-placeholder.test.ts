/**
 * Executor Placeholder Rejection Tests
 * ====================================
 * Steps carrying placeholder args must fail closed (no tool invocation)
 * so wrong-race data can never reach the responder.
 */

import { describe, it, expect, vi } from "vitest";
import { executeSteps } from "@/lib/executor";
import type { Step } from "@/lib/planner";
import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

function createMockTool(name: string): StructuredTool & { spy: ReturnType<typeof vi.fn> } {
    const spy = vi.fn(async () => JSON.stringify({ ok: true }));
    const t = tool(spy, { name, description: `Mock ${name}`, schema: z.object({}) });
    return Object.assign(t, { spy });
}

describe("Executor placeholder guard", () => {
    it("fails the step without invoking the tool", async () => {
        const mock = createMockTool("get_race");
        const steps: Step[] = [
            { description: "Get last race", tool: "get_race", args: { year: 2026, gp: "LAST_COMPLETED_GP", session: "R" } },
        ];

        const ctx = await executeSteps(steps, { get_race: mock });

        expect(ctx.successCount).toBe(0);
        expect(ctx.failureCount).toBe(1);
        expect(ctx.results[0].error).toMatch(/Placeholder argument rejected/);
        expect(ctx.results[0].error).toContain("LAST_COMPLETED_GP");
        expect(mock.spy).not.toHaveBeenCalled();
    });

    it("lets concrete args through", async () => {
        const mock = createMockTool("get_race");
        const steps: Step[] = [
            { description: "Get race", tool: "get_race", args: { year: 2026, gp: "Spain", session: "R" } },
        ];

        const ctx = await executeSteps(steps, { get_race: mock });

        expect(ctx.successCount).toBe(1);
        expect(mock.spy).toHaveBeenCalledOnce();
    });
});
