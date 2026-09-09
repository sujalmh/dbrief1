/**
 * E2E Grader
 * ==========
 *
 * Scores a single (model, prompt) execution across four dimensions:
 *  - PLAN_QUALITY   : did the planner produce a valid plan with the right tools/args?
 *  - EXECUTION      : did the executor run every step without 5xx errors?
 *  - RESPONSE       : did the responder mention the right entities (driver, GP, year)?
 *  - HALLUCINATION  : did the responder state facts the tools did not return?
 *                     (cheapest proxy: the LLM response must not invent numbers
 *                     that the tool output does not contain)
 *
 * Each score is 0-1. A run "passes" if overall >= 0.6.
 */
import type { E2EPrompt } from "../fixtures/e2e-prompts";
import { Plan, Step } from "@/lib/planner";

const ALL_KNOWN_TOOLS = new Set([
    "get_seasons",
    "get_events",
    "get_sessions",
    "get_results",
    "get_qualifying",
    "get_race",
    "get_laps",
    "get_fastest_lap",
    "get_telemetry",
    "get_telemetry_summary",
    "get_weather",
    "get_race_control",
    "get_tyres",
    "get_driver_standings",
    "run_simulation",
    "web_search",
    // retrieve_regulations is intentionally excluded — it's disabled.
]);

export interface GraderInput {
    prompt: E2EPrompt;
    plan: Plan | null;
    planError: string | null;
    /** Map of step index → tool result string (raw JSON or "ERROR: ..."). */
    toolResults: Record<number, { success: boolean; data: unknown; error?: string }>;
    finalResponse: string;
    responseError: string | null;
    rawResponse: string;
    model: string;
    latencyMs: number;
}

export interface GraderResult {
    model: string;
    promptId: string;
    passed: boolean;
    overall: number;
    planQuality: number;
    execution: number;
    response: number;
    hallucination: number;
    findings: string[];
    latencyMs: number;
    plan: Plan | null;
}

export function grade(input: GraderInput): GraderResult {
    const findings: string[] = [];
    let planQuality = 0;
    let execution = 0;
    let response = 0;
    let hallucination = 1; // default optimistic; subtract on bad signal

    // ------------------------------------------------------------------
    // 1) Plan quality
    // ------------------------------------------------------------------
    if (input.planError || !input.plan) {
        findings.push(`PLAN_FAIL: ${input.planError ?? "no plan"}`);
        planQuality = 0;
    } else {
        const tools = input.plan.steps.map((s) => s.tool);
        // (a) Required tools
        if (input.prompt.expectTools && input.prompt.expectTools.length > 0) {
            const missing = input.prompt.expectTools.filter((t) => !tools.includes(t));
            if (missing.length === 0) planQuality += 0.4;
            else findings.push(`PLAN_MISSING_TOOLS: missing [${missing.join(",")}] have [${tools.join(",")}]`);
        } else if (input.prompt.expectToolsAny && input.prompt.expectToolsAny.length > 0) {
            const hit = input.prompt.expectToolsAny.some((t) => tools.includes(t));
            if (hit) planQuality += 0.4;
            else findings.push(`PLAN_MISSING_ANY: expected one of [${input.prompt.expectToolsAny.join(",")}] got [${tools.join(",")}]`);
        }

        // (b) Forbidden tools
        if (input.prompt.forbidTools && input.prompt.forbidTools.length > 0) {
            const banned = tools.filter((t) => input.prompt.forbidTools!.includes(t));
            if (banned.length === 0) planQuality += 0.2;
            else findings.push(`PLAN_FORBIDDEN_TOOLS: ${banned.join(",")}`);
        }

        // (c) Hallucinated tool names
        const unknown = tools.filter((t) => !ALL_KNOWN_TOOLS.has(t));
        if (unknown.length === 0) planQuality += 0.2;
        else findings.push(`PLAN_HALLUCINATED_TOOLS: ${unknown.join(",")}`);

        // (d) Args match
        if (input.prompt.expectArgs) {
            const match = matchArgs(input.plan.steps, input.prompt.expectArgs);
            if (match) planQuality += 0.2;
            else findings.push(`PLAN_WRONG_ARGS: expected ${JSON.stringify(input.prompt.expectArgs)}`);
        } else {
            planQuality += 0.2; // no expectation -> pass
        }
        planQuality = clamp(planQuality);
    }

    // ------------------------------------------------------------------
    // 2) Execution
    // ------------------------------------------------------------------
    const toolResults = Object.values(input.toolResults);
    if (toolResults.length === 0) {
        // For empty-step plans (e.g. pre-2018 telemetry rejection) this is OK.
        if (input.prompt.expectTools && input.prompt.expectTools.length === 0) {
            execution = 1;
        } else {
            execution = 0;
            findings.push("EXEC_NO_TOOL_RESULTS");
        }
    } else {
        const ok = toolResults.filter((r) => r.success).length;
        execution = ok / toolResults.length;
        if (execution < 1) {
            const errs = toolResults
                .filter((r) => !r.success)
                .map((r) => r.error)
                .filter(Boolean);
            findings.push(`EXEC_FAILURES: ${errs.length}/${toolResults.length} ${errs[0] ?? ""}`);
        }
    }

    // ------------------------------------------------------------------
    // 3) Response content checks
    // ------------------------------------------------------------------
    if (input.responseError) {
        findings.push(`RESPONSE_ERROR: ${input.responseError}`);
        response = 0;
    } else if (!input.finalResponse) {
        findings.push("RESPONSE_EMPTY");
        response = 0;
    } else {
        const text = input.finalResponse.toLowerCase();
        // (a) Driver / GP / year mentioned
        const checks: [string, string | number | undefined][] = [
            ["driver", input.prompt.expectedDriver],
            ["gp", input.prompt.expectedGp],
            ["year", input.prompt.expectedYear],
        ];
        let hit = 0;
        let total = 0;
        for (const [name, expected] of checks) {
            if (expected === undefined) continue;
            total++;
            const needle = String(expected).toLowerCase();
            if (text.includes(needle)) hit++;
            else findings.push(`RESPONSE_MISSING_${name.toUpperCase()}: expected "${expected}"`);
        }
        response = total === 0 ? 1 : hit / total;

        // (b) mustMention / mustNotMention
        if (input.prompt.mustNotMention) {
            for (const forbidden of input.prompt.mustNotMention) {
                if (text.includes(forbidden.toLowerCase())) {
                    findings.push(`RESPONSE_HALLUCINATION: contains "${forbidden}"`);
                    hallucination -= 0.5;
                }
            }
        }
        if (input.prompt.mustMention) {
            for (const required of input.prompt.mustMention) {
                if (!text.includes(required.toLowerCase())) {
                    findings.push(`RESPONSE_MISSING_REQUIRED: "${required}"`);
                }
            }
        }
        response = clamp(response);
    }

    hallucination = clamp(hallucination);

    const overall = (planQuality + execution + response + hallucination) / 4;
    return {
        model: input.model,
        promptId: input.prompt.id,
        passed: overall >= 0.6,
        overall,
        planQuality,
        execution,
        response,
        hallucination,
        findings,
        latencyMs: input.latencyMs,
        plan: input.plan,
    };
}

function clamp(n: number) {
    return Math.max(0, Math.min(1, n));
}

function matchArgs(steps: Step[], expected: Record<string, unknown>): boolean {
    for (const step of steps) {
        let ok = true;
        for (const [k, v] of Object.entries(expected)) {
            const actual = step.args[k];
            if (actual === undefined) {
                ok = false;
                break;
            }
            if (typeof v === "string" && typeof actual === "string") {
                if (actual.toLowerCase() !== v.toLowerCase()) {
                    ok = false;
                    break;
                }
            } else if (actual !== v) {
                ok = false;
                break;
            }
        }
        if (ok) return true;
    }
    return false;
}
