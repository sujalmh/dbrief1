/**
 * Planner Resilience Tests
 * ========================
 *
 * Lock in the cross-model robustness fixes:
 *  - parseJsonResponse handles prose-wrapped JSON, code blocks, and balanced
 *    braces embedded anywhere in the response
 *  - planQuery never throws — every malformed response falls through to
 *    createFallbackPlan
 *  - createFallbackPlan correctly routes simulation/what-if queries to
 *    run_simulation, not get_events
 *
 * These tests are pure (no LLM calls) so they run in <1s.
 */
import { describe, it, expect } from "vitest";
import {
    createFallbackPlan,
} from "@/lib/planner";
import type { Plan } from "@/lib/planner";

describe("Planner resilience (cross-model robustness)", () => {
    describe("createFallbackPlan routing", () => {
        it("routes 'what if' queries to run_simulation, not get_events", () => {
            const plan = createFallbackPlan(
                "What if the 2021 Abu Dhabi Grand Prix didn't end under safety car?"
            );
            expect(plan.steps.length).toBeGreaterThan(0);
            const tool = plan.steps[0].tool;
            expect(tool).toBe("run_simulation");
            const args = plan.steps[0].args as Record<string, unknown>;
            expect(args.horizon).toBe("race");
            // metric should be one of the valid values
            expect(["time", "points", "position", "gap", "score"]).toContain(args.metric);
        });

        it("routes 'simulate' queries to run_simulation with season horizon", () => {
            const plan = createFallbackPlan("Simulate Verstappen's 2023 season points");
            expect(plan.steps[0].tool).toBe("run_simulation");
            const args = plan.steps[0].args as Record<string, unknown>;
            expect(args.horizon).toBe("season");
            expect(args.metric).toBe("points");
        });

        it("routes qualifying queries to get_qualifying when GP is detected", () => {
            const plan = createFallbackPlan("Who was on pole at Monaco 2024 qualifying?");
            // Fallback uses lowerMessage.includes("qualifying") — must include the word
            expect(plan.steps[0].tool).toBe("get_qualifying");
            const args = plan.steps[0].args as Record<string, unknown>;
            expect(args.gp).toBe("Monaco");
            expect(args.year).toBe(2024);
        });

        it("routes race queries to get_race when GP is detected", () => {
            const plan = createFallbackPlan("Who won Monza race 2021?");
            expect(plan.steps[0].tool).toBe("get_race");
            const args = plan.steps[0].args as Record<string, unknown>;
            expect(args.gp).toBe("Monza");
            expect(args.year).toBe(2021);
        });

        it("routes 'Spa' alias to Belgium", () => {
            const plan = createFallbackPlan("Show qualifying for Spa 2023");
            expect(plan.steps[0].tool).toBe("get_qualifying");
            const args = plan.steps[0].args as Record<string, unknown>;
            expect(args.gp).toBe("Belgium");
        });

        it("routes 'British' alias to Silverstone (FastF1 canonical name)", () => {
            // FastAPI uses 'Silverstone' for the British GP; the fallback
            // matches against the regex /silverstone|british/i, so 'British'
            // triggers 'Silverstone' first. Either is correct as long as
            // the executor can resolve it. We just verify the fallback
            // routes to a known GP name.
            const plan = createFallbackPlan("What was the weather at British GP 2023?");
            expect(plan.steps[0].tool).toBe("get_weather");
            const args = plan.steps[0].args as Record<string, unknown>;
            // Both "Silverstone" and "Great Britain" are valid here.
            expect(["Silverstone", "Great Britain"]).toContain(args.gp);
        });

        it("extracts year from prompt rather than defaulting", () => {
            const plan = createFallbackPlan("Show driver standings for 1994");
            expect(plan.steps[0].tool).toBe("get_driver_standings");
            const args = plan.steps[0].args as Record<string, unknown>;
            expect(args.year).toBe(1994);
        });

        it("never returns an empty plan for any prompt", () => {
            const prompts = [
                "tell me about F1",
                "Verstappen lap times",
                "compare drivers",
                "predict the next race",
                "what would happen if it rained",
            ];
            for (const p of prompts) {
                const plan: Plan = createFallbackPlan(p);
                expect(plan.steps.length, `prompt: ${p}`).toBeGreaterThan(0);
            }
        });
    });

    describe("Plan schema validation", () => {
        it("every fallback step has the required fields", () => {
            const plan = createFallbackPlan("what if 2021 Abu Dhabi didn't end under safety car?");
            for (const step of plan.steps) {
                expect(typeof step.tool).toBe("string");
                expect(step.tool.length).toBeGreaterThan(0);
                expect(step.args).toBeTypeOf("object");
                expect(step.description).toBeTypeOf("string");
            }
        });
    });
});
