/**
 * Fallback Plan Simulation Detection Tests
 * =========================================
 * Verifies that createFallbackPlan correctly routes what-if / simulation /
 * predictive queries to run_simulation instead of falling through to a
 * generic "get events" plan.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createFallbackPlan } from "@/lib/planner";

const PREV_TINYFISH = process.env.TINYFISH_API_KEY;

beforeEach(() => {
    process.env.TINYFISH_API_KEY = "test-key";
});

afterEach(() => {
    if (PREV_TINYFISH === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = PREV_TINYFISH;
});

describe("createFallbackPlan — simulation detection", () => {
    it("routes a 'what if' query to run_simulation", () => {
        const plan = createFallbackPlan("What if Abu Dhabi 2021 didn't end under safety car?");
        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].tool).toBe("run_simulation");
        expect(plan.steps[0].args.scenario_id).toBeTruthy();
        expect(plan.steps[0].args.iterations).toBe(1000);
    });

    it("routes a 'simulate' query to run_simulation", () => {
        const plan = createFallbackPlan("Simulate Verstappen retiring in 3 races");
        expect(plan.steps[0].tool).toBe("run_simulation");
    });

    it("routes a 'predict' query to run_simulation", () => {
        const plan = createFallbackPlan("Predict the championship outcome if Norris wins the next 2 races");
        expect(plan.steps[0].tool).toBe("run_simulation");
    });

    it("routes a 'how would' query to run_simulation", () => {
        const plan = createFallbackPlan("How would a 10-place grid penalty affect Hamilton's race?");
        expect(plan.steps[0].tool).toBe("run_simulation");
    });

    it("infers 'gap' metric for gap/delta queries", () => {
        const plan = createFallbackPlan("What if the gap between VER and HAM was smaller?");
        expect(plan.steps[0].tool).toBe("run_simulation");
        expect(plan.steps[0].args.metric).toBe("gap");
    });

    it("infers 'points' metric for championship/points queries", () => {
        const plan = createFallbackPlan("What if Verstappen scored more points in the last 3 races?");
        expect(plan.steps[0].tool).toBe("run_simulation");
        expect(plan.steps[0].args.metric).toBe("points");
    });

    it("infers 'time' metric for lap time queries", () => {
        const plan = createFallbackPlan("What if the lap time was 2 seconds faster?");
        expect(plan.steps[0].tool).toBe("run_simulation");
        expect(plan.steps[0].args.metric).toBe("time");
    });

    it("infers 'season' horizon for championship queries", () => {
        const plan = createFallbackPlan("What if the championship ended early this season?");
        expect(plan.steps[0].tool).toBe("run_simulation");
        expect(plan.steps[0].args.horizon).toBe("season");
    });

    it("does NOT route a normal race query to run_simulation", () => {
        const plan = createFallbackPlan("Who won the Monaco 2024 race?");
        expect(plan.steps[0].tool).not.toBe("run_simulation");
    });

    it("does NOT route a qualifying query to run_simulation", () => {
        const plan = createFallbackPlan("Get qualifying results for Silverstone 2024");
        expect(plan.steps[0].tool).not.toBe("run_simulation");
    });
});

describe("createFallbackPlan - recency routing", () => {
    it("anchors 'who won the last race' on get_events and adds news search when configured", () => {
        const plan = createFallbackPlan("who won the last race");
        expect(plan.steps[0].tool).toBe("get_events");
        const web = plan.steps.find((s) => s.tool === "web_search");
        expect(web?.args.domain_type).toBe("news");
    });

    it("anchors latest/current/news queries on get_events", () => {
        for (const q of ["latest F1 news", "current standings", "most recent race results"]) {
            const plan = createFallbackPlan(q);
            expect(plan.steps[0].tool).toBe("get_events");
        }
    });

    it("includes standings for a current-standings fallback", () => {
        const plan = createFallbackPlan("current standings");
        expect(plan.steps.some((s) => s.tool === "get_driver_standings")).toBe(true);
    });

    it("uses the constructor table for constructor-standings fallbacks", () => {
        const plan = createFallbackPlan("current constructor standings");
        expect(plan.steps.some((s) => s.tool === "get_constructor_standings")).toBe(true);
        expect(plan.steps.some((s) => s.tool === "get_driver_standings")).toBe(false);
    });

    it("never plans web tools when TinyFish is not configured", () => {
        delete process.env.TINYFISH_API_KEY;
        const plan = createFallbackPlan("who won the last race");
        expect(plan.steps[0].tool).toBe("get_events");
        expect(plan.steps.some((s) => s.tool === "web_search")).toBe(false);
    });

    it("does NOT route named-GP queries to web_search", () => {
        const plan = createFallbackPlan("Who won the Monaco 2024 race?");
        expect(plan.steps[0].tool).not.toBe("web_search");
    });
});
