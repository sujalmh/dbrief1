import { describe, it, expect } from "vitest";
import { Planner } from "@/lib/research/agents/planner";
import { createToolRegistry } from "@/lib/research/tool-registry";
import { EvidenceStore } from "@/lib/research/evidence-store";
import { ResearchMemory } from "@/lib/research/memory";
import { createTestPlannerModel } from "../utils/llm-client";

describe("deep planner date anchor", () => {
  it("anchors 'recent race' to the current year, not training-cutoff 2025", async () => {
    const planner = new Planner(createTestPlannerModel(), createToolRegistry(true));
    const { tasks } = await planner.createTasks(
      "Determine the most recently completed Formula 1 Grand Prix and look up its winner.",
      {
        objective: "who won the recent race",
        researchType: "factual",
        evidenceStore: new EvidenceStore(),
        memory: new ResearchMemory(),
        budget: { maxTasks: 12, maxIterations: 3, tasksExecuted: 0, iterationsCompleted: 0 },
        iteration: 1,
        deepResearch: true,
        intentAnalysis: null,
      }
    );
    const dump = tasks.map((t) => `${t.tool} ${JSON.stringify(t.args)}`).join(" | ");
    console.log("TASKS:", dump);
    expect(tasks.length).toBeGreaterThan(0);
    // No training-cutoff year anywhere in args or queries
    expect(dump).not.toContain("2025");
    // Current year must appear (date-anchored query or explicit year arg)
    expect(dump).toContain(String(new Date().getFullYear()));
    // Exact schema arg names only — no invented recency_days/count/recency
    const webArgs = tasks.filter((t) => t.tool === "web_search").flatMap((t) => Object.keys(t.args));
    expect(webArgs).toContain("recency_minutes");
    expect(webArgs).not.toContain("recency_days");
    const flatYears = tasks.flatMap((t) =>
      Object.entries(t.args)
        .filter(([k]) => k === "year" || k === "season")
        .map(([, v]) => Number(v))
    );
    for (const y of flatYears) expect(y).toBe(new Date().getFullYear());
  }, 600000);
});
