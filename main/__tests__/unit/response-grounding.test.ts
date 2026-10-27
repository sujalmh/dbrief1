/**
 * Responder grounding and disclosure rules
 * ========================================
 * Prompt rules are production behavior in this pipeline, so they are tested
 * directly. Simulation tests use the real tool output shape to confirm the
 * grounding label and statistics the prompt asks the model to quote.
 */

import { describe, it, expect } from "vitest";
import { aggregateContext, type ExecutionContext } from "@/lib/executor";
import { runSimulationTool } from "@/lib/tools/simulation";
import { RESPONDER_SYSTEM_PROMPT } from "@/lib/synthesis/responder-prompt";

function simulationGroundingRules(): string {
    const start = RESPONDER_SYSTEM_PROMPT.indexOf("## Simulation Grounding");
    const end = RESPONDER_SYSTEM_PROMPT.indexOf("## Standings Grounding", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return RESPONDER_SYSTEM_PROMPT.slice(start, end);
}

type SimulationToolInput = {
    scenario_id: string;
    horizon: "lap" | "race" | "season" | "custom";
    metric: "time" | "points" | "score" | "position" | "gap";
    iterations?: number;
    base_value?: number;
    variance?: number;
    seed?: number;
    reference_data?: number[] | Record<string, unknown> | string;
    reference_field?: string;
};

async function runSimulation(args: SimulationToolInput): Promise<Record<string, unknown>> {
    const raw = await runSimulationTool.invoke(args);
    expect(typeof raw).toBe("string");
    return JSON.parse(raw as string) as Record<string, unknown>;
}

describe("lap sampling disclosure", () => {
    it("requires the answer to disclose laps_omitted sampling", () => {
        expect(RESPONDER_SYSTEM_PROMPT).toContain("laps_omitted");
        expect(RESPONDER_SYSTEM_PROMPT).toMatch(/multi-driver payloads are sampled at 220 rows/i);
        expect(RESPONDER_SYSTEM_PROMPT).toMatch(/state the omitted count/i);
        expect(RESPONDER_SYSTEM_PROMPT).toMatch(/never claim the table shows every lap/i);
    });
});

describe("simulation grounding", () => {
    it("labels defaults-grounded simulations illustrative and blocks precise percentiles", () => {
        const rules = simulationGroundingRules();
        expect(rules).toContain('"defaults"');
        expect(rules).toContain('"defaults-despite-reference"');
        expect(rules).toMatch(/ILLUSTRATIVE estimate only/i);
        expect(rules).toMatch(/never precise percentiles/i);
        expect(rules).toMatch(/no real session data grounded the run/i);
    });

    it("allows derived-grounded simulations to quote percentiles", () => {
        const rules = simulationGroundingRules();
        expect(rules).toContain('"derived"');
        expect(rules).toContain('"explicit"');
        expect(rules).toMatch(/may quote the .*percentiles/i);
        expect(rules).toMatch(/simulation output rather than measured race data/i);
    });

    it("returns parameters_used.grounding=defaults with percentile statistics", async () => {
        const output = await runSimulation({
            scenario_id: "defaults-race-pace",
            horizon: "lap",
            metric: "gap",
            iterations: 200,
            seed: 42,
        });

        const parameters = output.parameters_used as Record<string, unknown>;
        expect(parameters.grounding).toBe("defaults");
        expect(parameters.derived_from_reference_data).toBe(false);
        expect(parameters.warning).toBeUndefined();

        const statistics = output.statistics as { percentiles: Record<string, number> };
        expect(typeof statistics.percentiles.p50).toBe("number");
        expect(typeof statistics.percentiles.p95).toBe("number");
    });

    it("returns parameters_used.grounding=derived when reference laps ground the run", async () => {
        const output = await runSimulation({
            scenario_id: "derived-race-pace",
            horizon: "lap",
            metric: "time",
            iterations: 200,
            seed: 42,
            reference_data: {
                laps: [
                    { LapTime: "1:36.100" },
                    { LapTime: "1:36.450" },
                    { LapTime: "1:35.900" },
                    { LapTime: "1:36.300" },
                ],
            },
            reference_field: "LapTime",
        });

        const parameters = output.parameters_used as Record<string, unknown>;
        expect(parameters.grounding).toBe("derived");
        expect(parameters.derived_from_reference_data).toBe(true);
        expect(parameters.reference_field).toBe("LapTime");
        expect(typeof parameters.base_value).toBe("number");

        const statistics = output.statistics as { percentiles: Record<string, number> };
        expect(typeof statistics.percentiles.p50).toBe("number");
    });

    it("flags defaults-despite-reference when reference data has no usable numbers", async () => {
        const output = await runSimulation({
            scenario_id: "unusable-reference",
            horizon: "race",
            metric: "gap",
            iterations: 100,
            seed: 7,
            reference_data: { notes: "no numeric channel here" },
        });

        const parameters = output.parameters_used as Record<string, unknown>;
        expect(parameters.grounding).toBe("defaults-despite-reference");
        expect(parameters.derived_from_reference_data).toBe(false);
        expect(String(parameters.warning)).toMatch(/generic defaults were used/i);
    });

    it("keeps the grounding label in LLM context while stripping raw simulation arrays", async () => {
        const output = await runSimulation({
            scenario_id: "context-grounding",
            horizon: "lap",
            metric: "gap",
            iterations: 100,
            seed: 11,
        });
        const context: ExecutionContext = {
            results: [{
                step: 1,
                tool: "run_simulation",
                args: { scenario_id: "context-grounding", horizon: "lap", metric: "gap" },
                success: true,
                data: output,
                durationMs: 12,
            }],
            successCount: 1,
            failureCount: 0,
            totalDurationMs: 12,
        };

        const aggregated = aggregateContext(context);

        expect(aggregated).toContain('"parameters_used"');
        expect(aggregated).toContain('"grounding": "defaults"');
        expect(aggregated).toContain('"percentiles"');
        expect(aggregated).not.toContain('"raw_values"');
        expect(aggregated).not.toContain('"visualization"');
    });
});
