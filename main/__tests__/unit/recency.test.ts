import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "@/lib/executor";
import {
    eventYear,
    extractScheduleEvents,
    hasRaceResultForEvent,
    hasUsableWebEvidence,
} from "@/lib/recency";

function result(overrides: Partial<ExecutionResult>): ExecutionResult {
    return {
        step: 1,
        tool: "get_events",
        args: {},
        success: true,
        durationMs: 1,
        ...overrides,
    };
}

const schedule = {
    year: 2026,
    events: [
        { round_number: 0, event_name: "Pre-Season Testing", event_date: "2026-02-20", event_format: "testing" },
        { round_number: 18, event_name: "United States Grand Prix", event_date: "2026-10-25", event_format: "conventional" },
    ],
};

describe("recency tool-result helpers", () => {
    it("extracts and normalizes a schedule from a JSON string", () => {
        const events = extractScheduleEvents([
            result({ tool: "get_events", data: JSON.stringify(schedule), args: { year: 2026 } }),
        ]);
        expect(events).toHaveLength(2);
        expect(events[1].event_name).toBe("United States Grand Prix");
        expect(events[1].round_number).toBe(18);
    });

    it("extracts canonical names from get_gp_names", () => {
        const events = extractScheduleEvents([
            result({
                tool: "get_gp_names",
                data: { year: 2026, grand_prix: [{ round: 18, event_name: "United States Grand Prix" }] },
            }),
        ]);
        expect(events[0].event_name).toBe("United States Grand Prix");
        expect(events[0].round_number).toBe(18);
    });

    it("matches a race result by event name or short GP alias", () => {
        const event = { event_name: "United States Grand Prix", event_date: "2026-10-25" };
        expect(
            hasRaceResultForEvent(
                [result({ tool: "get_race", args: { year: 2026, gp: "United States" } })],
                event
            )
        ).toBe(true);
        expect(
            hasRaceResultForEvent(
                [result({ tool: "get_results", args: { year: 2026, gp: "United States Grand Prix", session: "R" } })],
                event
            )
        ).toBe(true);
        expect(
            hasRaceResultForEvent(
                [result({ tool: "get_results", args: { year: 2026, gp: "United States Grand Prix", session: "Q" } })],
                event
            )
        ).toBe(false);
    });

    it("requires actual web rows, not merely a successful call", () => {
        expect(
            hasUsableWebEvidence([
                result({ tool: "web_search", data: { results: [{ title: "Antonelli wins" }] } }),
            ])
        ).toBe(true);
        expect(
            hasUsableWebEvidence([result({ tool: "web_search", data: { note: "No relevant web results found" } })])
        ).toBe(false);
        expect(
            hasUsableWebEvidence([result({ tool: "fetch_web_pages", data: { pages: [{ url: "https://example.com" }] } })])
        ).toBe(true);
    });

    it("derives the season from the event date", () => {
        expect(eventYear({ event_name: "United States Grand Prix", event_date: "2026-10-25" })).toBe(2026);
        expect(eventYear({ event_name: "No date" })).toBeNull();
    });
});
