/**
 * Deterministic temporal anchoring for F1 schedules
 * =================================================
 *
 * The responder is asked to answer "last race" / "next race" questions from
 * tool data, but asking an LLM to compare every `event_date` against today is
 * exactly the kind of arithmetic it gets wrong. This module computes the
 * anchors in code from the `get_events` payload so the answer prompt can be
 * given a single, authoritative timeline.
 *
 * Rules that matter for correctness:
 * - Pre-season testing rows (RoundNumber 0 / EventFormat "testing") are not
 *   races and must never become "the last race".
 * - A race happening today is not treated as completed until the next
 *   calendar day. The F1 API also blocks in-flight sessions, so this keeps
 *   the anchor and the data availability gates aligned.
 * - An explicit year ("last race of 2024") anchors to that season's finale,
 *   not to the latest race in the current season.
 */

export interface ScheduleEvent {
    round_number?: number | string | null;
    event_name?: string | null;
    event_date?: string | null;
    event_format?: string | null;
    sessions?: unknown;
    [key: string]: unknown;
}

export type RecencyIntent = "last_race" | "next_race" | "news" | "standings";

export interface TemporalAnchor {
    today: string;
    targetYear: number | null;
    latestCompleted: ScheduleEvent | null;
    nextEvent: ScheduleEvent | null;
}

const DAY_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;

/** UTC calendar day (YYYY-MM-DD), matching the date format in prompts. */
export function todayIsoDate(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
}

/** Extract a sortable YYYY-MM-DD day from an event_date value. */
export function eventDay(event: ScheduleEvent): string | null {
    const match = String(event.event_date ?? "").match(DAY_PREFIX_RE);
    return match ? match[1] : null;
}

/** A real championship round, never pre-season testing. */
export function isRaceEvent(event: ScheduleEvent): boolean {
    const round = Number(event.round_number);
    if (!Number.isFinite(round) || round <= 0) return false;
    if (String(event.event_format ?? "").toLowerCase() === "testing") return false;
    return true;
}

/** Explicit 4-digit year in the question, if any. */
export function extractExplicitYear(message: string): number | null {
    const match = message.match(/\b((?:19|20)\d{2})\b/);
    if (!match) return null;
    const year = Number(match[1]);
    return Number.isFinite(year) ? year : null;
}

/**
 * True for questions that ask about the latest completed race. Historical
 * "last race of 2024" still counts; the explicit year narrows the target.
 */
export function isLastRaceQuery(message: string): boolean {
    // A bare winner question ("Who won?", "Who won the race?") has no event
    // entity, so the only deterministic reading is the most recent race.
    // Keep this narrow: a year or named Grand Prix still goes through the
    // normal planner instead of being forced onto the last race.
    const bareWinner =
        /^(?:so\s+)?who\s+(?:won|wins|took\s+the\s+win)(?:\s+(?:the\s+)?(?:race|grand\s*prix|gp))?\s*[?.!]*$/i;
    if (bareWinner.test(message.trim())) return true;

    return /\b(last|latest|most\s+recent|previous)\s+(?:(?:f1|formula\s*(?:1|one))\s+)?(race|grand\s*prix|gp|round|event)\b|\bwho\s+won\s+(the\s+)?(last|latest)\b|\bjust\s+(finished|ended|happened)\b/i.test(
        message
    );
}

/** True for questions about the next/upcoming race. */
export function isNextRaceQuery(message: string): boolean {
    return /\bnext\s+(race|grand\s*prix|gp|round|event)\b|\bwhen\s+is\s+the\s+next\b|\bupcoming\s+(race|grand\s*prix|gp|round|event)\b/i.test(
        message
    );
}

/**
 * Classify recency questions that have a deterministic schedule answer.
 * Returns null for live news, which needs web search and cannot be derived
 * from the calendar.
 */
export function classifyRecencyIntent(message: string): RecencyIntent | null {
    if (isNextRaceQuery(message)) return "next_race";
    if (isLastRaceQuery(message)) return "last_race";
    if (
        /\b(current|latest|updated)\s+(driver|constructor|standings|championship)\b|\bstandings\s+(now|today)\b|\bcurrent\s+season\b/i.test(
            message
        )
    ) {
        return "standings";
    }
    if (/\b(news|breaking|headlines?)\b/i.test(message)) return "news";
    return null;
}

/**
 * Latest completed race for the target season.
 * - Explicit past season: the season finale (max event date).
 * - Current season: the latest event strictly before today.
 * - Future season: none.
 */
export function pickLatestCompletedEvent(
    events: ScheduleEvent[],
    targetYear: number | null,
    now: Date = new Date()
): ScheduleEvent | null {
    const candidates = events.filter(isRaceEvent);
    if (candidates.length === 0) return null;

    const currentYear = Number(todayIsoDate(now).slice(0, 4));
    const year = targetYear ?? currentYear;

    if (year > currentYear) return null;

    // Past season: the finale is the latest scheduled race, independent of
    // today's date.
    if (year < currentYear) {
        return candidates.reduce<ScheduleEvent | null>((best, event) => {
            const day = eventDay(event);
            if (!day || !day.startsWith(`${year}-`)) return best;
            if (!best) return event;
            const bestDay = eventDay(best) ?? "";
            return day > bestDay ? event : best;
        }, null);
    }

    // Current season: only races strictly before today count as completed.
    const today = todayIsoDate(now);
    return candidates.reduce<ScheduleEvent | null>((best, event) => {
        const day = eventDay(event);
        if (!day || day >= today) return best;
        if (!best) return event;
        const bestDay = eventDay(best) ?? "";
        return day > bestDay ? event : best;
    }, null);
}

/**
 * Next scheduled race.
 * - Current season: the earliest event on or after today.
 * - Future season: the first event of that season.
 * - Past season: none.
 */
export function pickNextEvent(
    events: ScheduleEvent[],
    targetYear: number | null,
    now: Date = new Date()
): ScheduleEvent | null {
    const candidates = events.filter(isRaceEvent);
    if (candidates.length === 0) return null;

    const currentYear = Number(todayIsoDate(now).slice(0, 4));
    const year = targetYear ?? currentYear;

    if (year < currentYear) return null;

    const today = todayIsoDate(now);
    return candidates.reduce<ScheduleEvent | null>((best, event) => {
        const day = eventDay(event);
        if (!day || !day.startsWith(`${year}-`)) return best;
        if (year === currentYear && day < today) return best;
        if (!best) return event;
        const bestDay = eventDay(best) ?? "";
        return day < bestDay ? event : best;
    }, null);
}

/** Human label used in prompts and user-facing fallbacks. */
export function describeEvent(event: ScheduleEvent): string {
    const name = String(event.event_name ?? "Unknown Grand Prix").trim();
    const round = Number(event.round_number);
    const day = eventDay(event);
    const bits = [name];
    if (Number.isFinite(round) && round > 0) bits.push(`Round ${round}`);
    if (day) bits.push(day);
    return bits.join(", ");
}

export function buildTemporalAnchor(
    events: ScheduleEvent[],
    message: string,
    now: Date = new Date()
): TemporalAnchor {
    const explicitYear = extractExplicitYear(message);
    const intent = classifyRecencyIntent(message);
    const targetYear =
        explicitYear ??
        (intent === "last_race" || intent === "next_race"
            ? new Date(todayIsoDate(now)).getUTCFullYear()
            : null);

    return {
        today: todayIsoDate(now),
        targetYear,
        latestCompleted: pickLatestCompletedEvent(events, targetYear, now),
        nextEvent: pickNextEvent(events, targetYear, now),
    };
}

/**
 * Render the anchor as trusted, server-computed context. The values are
 * derived from tool data but the date comparison is deterministic, so this
 * block can sit outside `<f1_data>` and be treated as authoritative.
 */
export function renderTemporalAnchor(anchor: TemporalAnchor): string {
    const lines = [`Today: ${anchor.today}`];
    if (anchor.latestCompleted) {
        lines.push(`Latest completed event: ${describeEvent(anchor.latestCompleted)}`);
    }
    if (anchor.nextEvent) {
        lines.push(`Next scheduled event: ${describeEvent(anchor.nextEvent)}`);
    }
    if (lines.length === 1) {
        lines.push("No event dates were available in the retrieved schedule.");
    }
    return lines.join("\n");
}
