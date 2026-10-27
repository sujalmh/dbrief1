import { describe, expect, it } from "vitest";
import {
    buildTemporalAnchor,
    classifyRecencyIntent,
    extractExplicitYear,
    isRaceEvent,
    pickLatestCompletedEvent,
    pickNextEvent,
    renderTemporalAnchor,
    type ScheduleEvent,
} from "@/lib/temporal";

const NOW = new Date("2026-10-26T12:00:00Z");

function events(): ScheduleEvent[] {
    return [
        { round_number: 0, event_name: "Pre-Season Testing", event_date: "2026-02-20", event_format: "testing" },
        { round_number: 1, event_name: "Australian Grand Prix", event_date: "2026-03-08", event_format: "conventional" },
        { round_number: 17, event_name: "Singapore Grand Prix", event_date: "2026-10-11", event_format: "sprint_qualifying" },
        { round_number: 18, event_name: "United States Grand Prix", event_date: "2026-10-25", event_format: "conventional" },
        { round_number: 19, event_name: "Mexico City Grand Prix", event_date: "2026-11-01", event_format: "conventional" },
        { round_number: 23, event_name: "Abu Dhabi Grand Prix", event_date: "2026-12-06", event_format: "conventional" },
    ];
}

describe("temporal anchoring", () => {
    it("never treats pre-season testing as a race", () => {
        expect(isRaceEvent(events()[0])).toBe(false);
        expect(isRaceEvent(events()[1])).toBe(true);
    });

    it("picks the latest completed race strictly before today", () => {
        const latest = pickLatestCompletedEvent(events(), 2026, NOW);
        expect(latest?.event_name).toBe("United States Grand Prix");
    });

    it("does not treat a race happening today as completed", () => {
        const todayRace = [
            ...events(),
            { round_number: 20, event_name: "Today Grand Prix", event_date: "2026-10-26" },
        ];
        const latest = pickLatestCompletedEvent(todayRace, 2026, NOW);
        expect(latest?.event_name).toBe("United States Grand Prix");
    });

    it("picks the next race on or after today", () => {
        const next = pickNextEvent(events(), 2026, NOW);
        expect(next?.event_name).toBe("Mexico City Grand Prix");
    });

    it("anchors an explicit past season to its finale", () => {
        const historical = [
            { round_number: 1, event_name: "Bahrain Grand Prix", event_date: "2024-03-02" },
            { round_number: 24, event_name: "Abu Dhabi Grand Prix", event_date: "2024-12-08" },
        ];
        const latest = pickLatestCompletedEvent(historical, 2024, NOW);
        expect(latest?.event_name).toBe("Abu Dhabi Grand Prix");
    });

    it("extracts explicit years", () => {
        expect(extractExplicitYear("Who won the last race of 2024?")).toBe(2024);
        expect(extractExplicitYear("Who won the last race?")).toBeNull();
    });

    it("classifies recency intents without misreading historical years", () => {
        expect(classifyRecencyIntent("Who won the last race?")).toBe("last_race");
        expect(classifyRecencyIntent("Who won?")).toBe("last_race");
        expect(classifyRecencyIntent("Who won the race?")).toBe("last_race");
        expect(classifyRecencyIntent("Who won the 2024 British Grand Prix?")).toBeNull();
        expect(classifyRecencyIntent("Who won the last race of 2024?")).toBe("last_race");
        expect(classifyRecencyIntent("Who finished second and third at the last F1 race?")).toBe("last_race");
        expect(classifyRecencyIntent("Who finished second at the last Formula 1 race?")).toBe("last_race");
        expect(classifyRecencyIntent("When is the next race?")).toBe("next_race");
        expect(classifyRecencyIntent("What are the current driver standings?")).toBe("standings");
        expect(classifyRecencyIntent("Latest F1 news")).toBe("news");
    });

    it("renders an authoritative timeline", () => {
        const anchor = buildTemporalAnchor(events(), "Who won the last race?", NOW);
        const rendered = renderTemporalAnchor(anchor);
        expect(rendered).toContain("Today: 2026-10-26");
        expect(rendered).toContain("Latest completed event: United States Grand Prix, Round 18, 2026-10-25");
        expect(rendered).toContain("Next scheduled event: Mexico City Grand Prix, Round 19, 2026-11-01");
    });
});
