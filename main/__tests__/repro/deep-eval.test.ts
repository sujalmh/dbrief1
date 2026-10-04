import { describe, it, expect } from "vitest";
import { writeFileSync } from "fs";
import { ResearchManager } from "@/lib/research/manager";
import type { ResearchEvent, Evidence } from "@/lib/research/types";
import { createTestPlannerModel, createTestResponderModel } from "../utils/llm-client";

const QUERIES = [
  "What is the latest news in Formula 1 this week?",
  "What if the 2021 Abu Dhabi Grand Prix didn't end under safety car?",
  "Who won the most recent Formula 1 race?",
];

function extractRefs(text: string): string[] {
  return text.match(/\[E\d+\]/g) ?? [];
}

function groundingScreen(report: string, evidenceText: string): { kind: string; token: string; grounded: boolean }[] {
  const out: { kind: string; token: string; grounded: boolean }[] = [];
  const seen = new Set<string>();
  const check = (kind: string, re: RegExp) => {
    for (const m of report.matchAll(re)) {
      const t = m[0];
      if (seen.has(kind + t)) continue;
      seen.add(kind + t);
      out.push({ kind, token: t, grounded: evidenceText.includes(t) });
    }
  };
  check("year", /\b(?:19|20)\d{2}\b/g);
  check("laptime", /\b\d+:\d{2}\.\d{3}\b/g);
  check("driver", /\b(?:VER|HAM|LEC|NOR|PIA|RUS|ALO|SAI|PER|GAS|OCO|STR|ALB|HUL|MAG|BOT|ZHO|TSU|RIC|SAR|ANT|BEA|LAW|COL|DOO|BOR)\b/g);
  return out;
}

describe("deep research accuracy", () => {
  it("runs deep queries and grades grounding", async () => {
    const only = process.env.DEEPQ ?? "";
    const qs = only ? QUERIES.filter((q) => q.includes(only)) : QUERIES;
    const plannerModel = createTestPlannerModel();
    const responderModel = createTestResponderModel();
    const summary: Record<string, unknown>[] = [];
    for (const objective of qs) {
      const mgr = new ResearchManager(plannerModel, responderModel, {
        deepResearch: true,
        webSearch: true,
        maxTasks: 12,
        maxIterations: 3,
      });
      const counts: Record<string, number> = {};
      const tasks: { tool: string; status: string }[] = [];
      const evidence: Evidence[] = [];
      let report = "";
      let critic: unknown = null;
      let confidence: unknown = null;
      let specs: { dataSource: string }[] = [];
      let researchType = "";
      const toolByTask: Record<string, string> = {};
      const degraded: string[] = [];
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...a: unknown[]) => {
        warnings.push(a.map(String).join(" ").slice(0, 220));
        origWarn(...(a as []));
      };
      const t0 = Date.now();
      try {
      for await (const ev of mgr.run(objective)) {
        counts[ev.type] = (counts[ev.type] ?? 0) + 1;
        if (ev.type === "research_start") researchType = ev.researchType;
        else if (ev.type === "plan_iteration") for (const t of ev.tasks) toolByTask[t.id] = t.tool;
        else if (ev.type === "task_update") {
          tasks.push({ tool: toolByTask[ev.taskId] ?? "?", status: ev.status });
        } else if (ev.type === "evidence") evidence.push(ev.evidence);
        else if (ev.type === "token") report += ev.content;
        else if (ev.type === "verification") critic = ev.result;
        else if (ev.type === "confidence") confidence = ev.confidence;
        else if (ev.type === "chart_specs") specs = ev.specs;
        else if (ev.type === "degraded" || ev.type === "error") degraded.push(`${ev.type}:${ev.type === "degraded" ? ev.stage : ev.message}`.slice(0, 160));
      }
      } finally {
        console.warn = origWarn;
      }
      const ids = new Set(evidence.map((e) => `[${e.id}]`));
      const refs = extractRefs(report);
      const badRefs = refs.filter((r) => !ids.has(r));
      const evText = evidence.map((e) => JSON.stringify(e.data)).join("\n");
      const screen = groundingScreen(report, evText);
      const misses = screen.filter((s) => !s.grounded);
      const row = {
        objective, researchType,
        ms: Date.now() - t0,
        tasks: tasks.map((t) => `${t.tool}:${t.status}`),
        evidence: evidence.map((e) => `${e.id}:${e.type}:${e.source.tool}`),
        reportChars: report.length, reportHead: report.slice(0, 600), refs: refs.length, badRefs,
        misses: misses.map((m) => `${m.kind}:${m.token}`),
        critic, confidence, chartSources: specs.map((s) => s.dataSource),
        degraded, warnings: warnings.filter((w) => /failed|error|Error|400|429|timeout/i.test(w)).slice(0, 15),
      };
      summary.push(row);
      console.log(JSON.stringify({ ...row, critic, confidence }, null, 1).slice(0, 3000));
    }
    writeFileSync("/tmp/deep-eval-round4.json", JSON.stringify(summary, null, 1));
    expect(summary.length).toBe(QUERIES.length);
  }, 3600000);
});
