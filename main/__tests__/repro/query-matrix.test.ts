import { describe, it, expect } from "vitest";
import { decidePlan, createFallbackPlan, isRecencyQuery } from "@/lib/planner";
import { findPlaceholderArg } from "@/lib/args-guard";
import { aggregateContext, type ExecutionContext } from "@/lib/executor";
import { createTestPlannerModel } from "../utils/llm-client";

interface MatrixCase {
  id: string;
  prompt: string;
  history?: { role: "user" | "assistant"; content: string }[];
  expectPlan?: boolean;
  expectTools?: string[];
  expectToolsAny?: string[];
  forbidTools?: string[];
  expectArgs?: Record<string, unknown>;
}

const CASES: MatrixCase[] = [
  { id: "race-named", prompt: "Who won the 2023 Monaco Grand Prix?", expectPlan: true, expectTools: ["get_race"], expectArgs: { year: 2023 } },
  { id: "race-quali", prompt: "Get qualifying results for Silverstone 2024", expectPlan: true, expectTools: ["get_qualifying"], expectArgs: { year: 2024 } },
  { id: "standings-current", prompt: "Who won the 2024 drivers' championship and by how many points?", expectPlan: true, expectTools: ["get_driver_standings"], expectArgs: { year: 2024 } },
  { id: "standings-hist", prompt: "Who won the 1994 championship?", expectPlan: true, expectTools: ["get_driver_standings"], expectArgs: { year: 1994 }, forbidTools: ["get_telemetry", "get_laps"] },
  { id: "standings-1950", prompt: "Race results from Silverstone 1950", expectPlan: true, expectToolsAny: ["get_race", "get_driver_standings"], expectArgs: { year: 1950 }, forbidTools: ["get_telemetry", "get_laps"] },
  { id: "laps", prompt: "Show Verstappen's lap times in the 2023 Monaco GP race", expectPlan: true, expectTools: ["get_laps"], expectArgs: { year: 2023, driver: "VER" } },
  { id: "fastest-lap", prompt: "What was the fastest lap in the 2023 Monaco GP race?", expectPlan: true, expectToolsAny: ["get_fastest_lap", "get_laps"], expectArgs: { year: 2023 } },
  { id: "telemetry", prompt: "Show telemetry for Leclerc fastest lap in Bahrain 2023 qualifying", expectPlan: true, expectToolsAny: ["get_telemetry", "get_telemetry_summary"], expectArgs: { year: 2023, driver: "LEC" } },
  { id: "telemetry-summary", prompt: "Give me a statistical summary of Verstappen telemetry in Abu Dhabi 2023 race", expectPlan: true, expectToolsAny: ["get_telemetry_summary", "get_telemetry"], expectArgs: { year: 2023 } },
  { id: "weather", prompt: "What was the weather during the 2023 Monaco GP race?", expectPlan: true, expectTools: ["get_weather"], expectArgs: { year: 2023 } },
  { id: "race-control", prompt: "Were there any safety cars in the 2021 Abu Dhabi GP?", expectPlan: true, expectTools: ["get_race_control"], expectArgs: { year: 2021 } },
  { id: "tyres", prompt: "What tyre strategy did the winner use at Silverstone 2023?", expectPlan: true, expectToolsAny: ["get_tyres", "get_race"], expectArgs: { year: 2023 } },
  { id: "events", prompt: "Show the 2024 F1 calendar", expectPlan: true, expectToolsAny: ["get_events", "get_gp_names"], expectArgs: { year: 2024 } },
  { id: "sessions", prompt: "What sessions ran at Monaco 2023?", expectPlan: true, expectToolsAny: ["get_sessions", "get_events"], expectArgs: { year: 2023 } },
  { id: "recency-last", prompt: "who won the last race", expectPlan: true, expectTools: ["get_events", "web_search"] },
  { id: "recency-most-recent", prompt: "Who won the most recent race?", expectPlan: true, expectTools: ["get_events", "web_search"] },
  { id: "recency-next", prompt: "what's the next race", expectPlan: true, expectToolsAny: ["get_events"] },
  { id: "recency-upcoming", prompt: "when is the next Grand Prix", expectPlan: true, expectToolsAny: ["get_events"] },
  { id: "recency-news", prompt: "latest F1 news", expectPlan: true, expectToolsAny: ["web_search"] },
  { id: "recency-current-standings", prompt: "current driver standings", expectPlan: true, expectToolsAny: ["web_search", "get_driver_standings"] },
  { id: "followup-telemetry", prompt: "show telemetry for the winner's fastest lap in that race", history: [{ role: "user", content: "who won the 2023 Monaco Grand Prix?" }, { role: "assistant", content: "Verstappen won the 2023 Monaco Grand Prix for Red Bull." }], expectPlan: true, expectToolsAny: ["get_telemetry", "get_fastest_lap", "get_laps"] },
  { id: "followup-compare", prompt: "how did his teammate do in comparison?", history: [{ role: "user", content: "Show Verstappen's lap times in the 2023 Monaco GP race" }, { role: "assistant", content: "Verstappen's laps ..." }], expectPlan: true, expectToolsAny: ["get_laps", "get_telemetry", "get_race"] },
  { id: "regs-drs", prompt: "What are the current DRS rules?", expectPlan: true, expectTools: ["retrieve_regulations"] },
  { id: "regs-cost-cap", prompt: "What are the 2025 cost cap regulations?", expectPlan: true, expectTools: ["retrieve_regulations"] },
  { id: "penalty-named", prompt: "Who got a penalty in the 2024 Austrian GP?", expectPlan: true, expectTools: ["retrieve_regulations"] },
  { id: "penalty-first", prompt: "Who got the first penalty in 2024?", expectPlan: true, expectTools: ["retrieve_regulations"] },
  { id: "sim-counterfactual", prompt: "What if Abu Dhabi 2021 didn't end under safety car?", expectPlan: true, expectToolsAny: ["run_simulation"] },
  { id: "sim-season", prompt: "Simulate Verstappen vs Hamilton over a full season with equal cars", expectPlan: true, expectToolsAny: ["run_simulation"] },
  { id: "sim-pit", prompt: "What if a pit stop took 5 extra seconds in Monaco 2024 race?", expectPlan: true, expectToolsAny: ["run_simulation"] },
  { id: "conversational-hello", prompt: "Hey!", expectPlan: false },
  { id: "conversational-help", prompt: "How can you help with F1?", expectPlan: false },
  { id: "ambiguous-noleclerc", prompt: "Show Leclerc pace", forbidTools: ["get_telemetry", "get_laps", "get_race", "get_qualifying", "get_weather", "get_tyres"] },
  { id: "ambiguous-quickest", prompt: "Who was quickest?", forbidTools: ["get_telemetry", "get_laps", "get_race", "get_qualifying", "get_weather", "get_tyres"] },
  { id: "invalid-future", prompt: "Get telemetry for the 2030 Monaco GP", forbidTools: ["get_telemetry", "get_laps"] },
  { id: "invalid-pre2018-tel", prompt: "Show me telemetry for Senna in the 1994 Monaco Grand Prix", forbidTools: ["get_telemetry", "get_telemetry_summary", "get_laps", "get_weather"] },
  { id: "multi-two", prompt: "Compare Verstappen and Norris pace in Abu Dhabi 2023", expectPlan: true, expectToolsAny: ["get_laps", "get_telemetry"] },
  { id: "multi-three", prompt: "Get lap times for VER, HAM, and LEC in Monaco 2023", expectPlan: true, expectToolsAny: ["get_laps", "get_fastest_lap"] },
  { id: "multi-team", prompt: "Compare Ferrari vs Red Bull race pace at Monza 2021", expectPlan: true, expectToolsAny: ["get_laps", "get_telemetry"] },
  { id: "cross-domain", prompt: "Did the 2023 Monaco GP have any race control flags? What do the regulations say about safety car procedures?", expectPlan: true, expectToolsAny: ["get_race_control", "retrieve_regulations"] },
  { id: "season-review", prompt: "Tell me about the 2023 F1 season", expectPlan: true, expectToolsAny: ["get_events", "get_driver_standings"] },
  { id: "champ-likelihood", prompt: "who is more likely to win the championship", expectPlan: true, expectToolsAny: ["get_driver_standings", "run_simulation"] },
];

describe("query matrix", () => {
  it("logs planner decision per case", async () => {
    const model = createTestPlannerModel();
    const rows: string[] = [];
    for (const c of CASES) {
      let line: string;
      try {
        const d = await decidePlan(model, c.prompt, false, false, c.history ?? []);
        const tools = d.plan.steps.map((s) => s.tool);
        const checks: string[] = [];
        if (c.expectPlan !== undefined && d.needsPlan !== c.expectPlan) checks.push(`needsPlan=${d.needsPlan} want=${c.expectPlan}`);
        for (const t of c.expectTools ?? []) if (!tools.includes(t)) checks.push(`missing:${t}`);
        if (c.expectToolsAny && !c.expectToolsAny.some((t) => tools.includes(t))) checks.push(`missing-any:${c.expectToolsAny.join("|")}`);
        for (const t of c.forbidTools ?? []) if (tools.includes(t)) checks.push(`forbidden:${t} used`);
        if (c.expectArgs) {
          const flat = d.plan.steps.flatMap((s) => Object.entries(s.args));
          for (const [k, v] of Object.entries(c.expectArgs)) {
            if (!flat.some(([ak, av]) => ak === k && String(av).toUpperCase() === String(v).toUpperCase())) checks.push(`arg ${k}=${v} missing`);
          }
        }
        for (const s of d.plan.steps) {
          const hit = findPlaceholderArg(s.args);
          if (hit) checks.push(`placeholder ${s.tool}.${hit.path}=${hit.value}`);
        }
        line = `${checks.length === 0 ? "PASS" : "FAIL"} ${c.id} tools=[${tools.join(",")}] ${checks.join("; ")}`;
      } catch (e) {
        line = `ERROR ${c.id} ${e instanceof Error ? e.message.slice(0, 120) : e}`;
      }
      rows.push(line);
      console.log(line);
    }
    const fails = rows.filter((r) => !r.startsWith("PASS"));
    console.log(`\nTOTAL ${CASES.length} PASS ${rows.length - fails.length} FAIL ${fails.length}`);
    expect(fails, fails.join("\n")).toHaveLength(0);
  }, 600000);

  it("recency regex covers last/next/current/news", () => {
    for (const q of ["who won the last race", "who won the most recent race", "what's the next race", "when is the next Grand Prix", "latest F1 news", "current driver standings", "what happened this week in F1"]) expect(isRecencyQuery(q)).toBe(true);
    for (const q of ["Show Verstappen's lap times in the 2023 Monaco GP", "when did Hamilton last win a race", "Who won the championship in 2010?"]) expect(isRecencyQuery(q)).toBe(false);
  });

  it("fallback routes recency/simulation/penalty without LLM", () => {
    expect(createFallbackPlan("who won the last race").steps.map((s) => s.tool).includes("web_search")).toBe(true);
    expect(createFallbackPlan("what's the next race").steps.map((s) => s.tool).includes("web_search")).toBe(true);
    expect(createFallbackPlan("What if Abu Dhabi 2021 didn't end under safety car?").steps.map((s) => s.tool).includes("run_simulation")).toBe(true);
    expect(createFallbackPlan("Who got the first penalty in 2024?").steps.map((s) => s.tool).includes("retrieve_regulations")).toBe(true);
  });

  it("schedule and standings survive context budgeting whole", () => {
    const events = Array.from({ length: 25 }, (_, i) => ({ round_number: i + 1, event_name: `GP${i + 1}`, event_date: `2026-01-01T00:00:00` }));
    const ctx: ExecutionContext = { results: [{ step: 1, tool: "get_events", args: { year: 2026 }, success: true, data: { year: 2026, events }, durationMs: 1 }], successCount: 1, failureCount: 0, totalDurationMs: 1 };
    const agg = aggregateContext(ctx);
    expect(agg).toContain("GP25");
    expect(agg).not.toContain("truncated_from");
  });
});
