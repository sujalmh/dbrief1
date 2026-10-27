/**
 * Recency tool-result helpers
 * ==========================
 *
 * The chat route supplements the planner with deterministic recency steps.
 * These helpers inspect executed tool results without trusting the model:
 * they find the schedule payload, check whether the anchored race result is
 * present, and check whether web evidence actually returned rows.
 */

import type { ExecutionResult } from "@/lib/executor";
import { describeEvent, eventDay, type ScheduleEvent } from "@/lib/temporal";

/** Parse a tool result that may still be a JSON string. */
export function parseToolData(data: unknown): unknown {
    if (typeof data !== "string") return data;
    try {
        return JSON.parse(data) as unknown;
    } catch {
        return data;
    }
}

/** Pull a schedule out of the most recent get_events / get_gp_names result. */
export function extractScheduleEvents(results: ExecutionResult[]): ScheduleEvent[] {
    for (let i = results.length - 1; i >= 0; i--) {
        const result = results[i];
        if (!result.success) continue;
        if (result.tool !== "get_events" && result.tool !== "get_gp_names") continue;
        const data = parseToolData(result.data);
        if (typeof data !== "object" || data === null) continue;
        const rec = data as Record<string, unknown>;
        const raw = Array.isArray(rec.events)
            ? rec.events
            : Array.isArray(rec.grand_prix)
                ? rec.grand_prix
                : [];
        if (raw.length === 0) continue;
        return raw
            .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
            .map((e) => ({
                ...e,
                round_number: (e.round_number ?? e.round) as number | string | null,
                event_name: (e.event_name ?? e.canonical) as string | null,
                event_date: (e.event_date ?? null) as string | null,
                event_format: (e.event_format ?? null) as string | null,
            }));
    }
    return [];
}

function normalizeEventText(value: string): string {
    return value
        .toLowerCase()
        .replace(/\b(grand prix|gp)\b/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/** True when a successful race result belongs to the anchored event. */
export function hasRaceResultForEvent(
    results: ExecutionResult[],
    event: ScheduleEvent
): boolean {
    const eventName = normalizeEventText(String(event.event_name ?? ""));
    if (!eventName) return false;
    return results.some((result) => {
        if (!result.success) return false;
        if (result.tool !== "get_race" && result.tool !== "get_results") return false;
        const session = String(result.args?.session ?? "R").toUpperCase();
        if (result.tool === "get_results" && session !== "R" && session !== "RACE") return false;
        const gp = normalizeEventText(String(result.args?.gp ?? ""));
        if (!gp) return false;
        return gp === eventName || gp.includes(eventName) || eventName.includes(gp);
    });
}

/** True when web results were actually returned (not just a successful call). */
export function hasUsableWebEvidence(results: ExecutionResult[]): boolean {
    return results.some((result) => {
        if (!result.success) return false;
        const data = parseToolData(result.data);
        if (typeof data !== "object" || data === null) return false;
        if (result.tool === "web_search") {
            const hits = (data as { results?: unknown }).results;
            return Array.isArray(hits) && hits.length > 0;
        }
        if (result.tool === "fetch_web_pages") {
            const pages = (data as { pages?: unknown }).pages;
            return Array.isArray(pages) && pages.length > 0;
        }
        return false;
    });
}

/** Human label for the anchored event (used by the unverified-reply guard). */
export function anchoredEventLabel(event: ScheduleEvent): string {
    return describeEvent(event);
}

/** Year from an event's date, used to call get_race with the right season. */
export function eventYear(event: ScheduleEvent): number | null {
    const day = eventDay(event);
    if (!day) return null;
    const year = Number(day.slice(0, 4));
    return Number.isFinite(year) ? year : null;
}
