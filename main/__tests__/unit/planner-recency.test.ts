/**
 * Recency Query Detection Tests (pure, no LLM)
 * ============================================
 * Recency queries ("who won the last race") auto-allow web tools in the
 * planner even when the user hasn't enabled web search — FastF1 tools
 * must never be used to guess "latest".
 */

import { describe, it, expect } from "vitest";
import { isRecencyQuery } from "@/lib/planner";

describe("isRecencyQuery", () => {
    it.each([
        "who won the last race",
        "Who won the last Grand Prix?",
        "latest F1 news",
        "most recent race results",
        "current standings",
        "current drivers championship",
        "breaking: Verstappen news",
        "what happened this week in F1",
        "who won the latest race",
        "last race winner",
        "just happened in qualifying",
        "what's the next race",
        "when is the next race",
        "what is the upcoming Grand Prix",
        "next race weekend schedule",
    ])("detects recency: %s", (q) => {
        expect(isRecencyQuery(q)).toBe(true);
    });

    it.each([
        "Show Verstappen's lap times in the 2023 Monaco GP",
        "Compare telemetry between NOR and PIA in Abu Dhabi 2023",
        "Who won the championship in 2010?",
        "Hey! How can you help with F1?",
        "What if Abu Dhabi 2021 didn't end under safety car?",
        "Explain the DRS rules",
        "Show telemetry for ANT fastest lap in the 2026 Spanish Grand Prix race",
        "when did Hamilton last win a race",
    ])("does not flag non-recency: %s", (q) => {
        expect(isRecencyQuery(q)).toBe(false);
    });
});
