import { describe, it, expect } from "vitest";
import { decidePlan } from "@/lib/planner";
import { executeSteps, aggregateContext } from "@/lib/executor";
import { createToolRegistry } from "@/lib/research/tool-registry";
import { createTestPlannerModel, createTestResponderModel } from "../utils/llm-client";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatContentToText } from "@/lib/llm";

describe("e2e recent-race with real backend", () => {
  it("answers who won the recent race from live data", async () => {
    const planner = createTestPlannerModel();
    const d = await decidePlan(planner, "who won the recent race", true, false, []);
    console.log("PLAN:", d.plan.steps.map((s) => `${s.tool} ${JSON.stringify(s.args)}`).join(" | "));
    expect(d.needsPlan).toBe(true);
    const registry = createToolRegistry(true);
    const ctx = await executeSteps(
      d.plan.steps.map((s, i) => ({ ...s, id: `task_1_${i + 1}` })),
      registry.getAllTools()
    );
    for (const r of ctx.results) {
      console.log(`RESULT ${r.tool} success=${r.success} err=${(r.error ?? "").slice(0, 200)}`);
    }
    expect(ctx.successCount).toBeGreaterThan(0);
    const contextString = aggregateContext(ctx);
    expect(contextString).not.toContain("No data was retrieved");

    const responder = createTestResponderModel();
    const stream = await responder.stream([
      new SystemMessage("Answer the F1 question using ONLY the data below. Name the Grand Prix, year, and winner."),
      new HumanMessage(`Question: who won the recent race\n\nData:\n${contextString}`),
    ]);
    let answer = "";
    for await (const chunk of stream) answer += chatContentToText(chunk.content);
    console.log("ANSWER:", answer.slice(0, 800));
    expect(answer).toMatch(/Verstappen/i);
  }, 600000);
});
