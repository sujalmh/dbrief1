/**
 * Final-answer style + chart guidance (shared)
 * ============================================
 *
 * Both final-answer writers — the standard responder prompt
 * (`app/api/chat/route.ts`) and the deep-research synthesizer
 * (`lib/research/agents/synthesizer.ts`) — share these blocks so the
 * prose matches the inline charts and follows house style:
 *
 *   - No emojis, ever.
 *   - No em dashes; use a plain hyphen (-) or restructure the sentence.
 *   - Charts render automatically below the answer: point at them by
 *     title, lead with the headline finding, and do NOT re-dump every
 *     data row the chart already shows.
 */

import type { ChartSpec } from "@/lib/research/types";

// =============================================================================
// Prompt blocks
// =============================================================================

/** Hard style rules appended to both synthesis prompts. */
export const ANSWER_STYLE_PROMPT = `## Style (strict)
- NEVER use emojis anywhere in the answer (no check marks, stars, flags, or symbols).
- NEVER use em dashes. Use a plain hyphen (-) or a colon instead. "Q3 - 1:19.000" is correct; "Q3 — 1:19.000" is not.
- Keep headings short. Prefer plain sentences over decorative formatting.`;

/**
 * Chart guidance for the standard responder. It cannot know exact chart
 * titles (specs are synthesized client-side after the answer streams),
 * so it points at "the chart below" and leads with the finding.
 */
export const CHART_GUIDANCE_STANDARD_PROMPT = `## Charts (rendered automatically below your answer)
- Visualize whenever possible: when the data holds chartable series (telemetry traces, lap times, standings, grid/finish positions, tyre stints, round-by-round positions), charts render automatically underneath your answer. You do not need to ask for them and you cannot see them - but the reader can.
- Always point the reader at the relevant chart ("see the pace chart below", "the standings chart below shows..."). Every chart must earn its place: state the one takeaway it exists to show.
- The reader sees each chart, so never announce a chart, describe where it is, or restate what it plainly shows. Add only what the chart doesn't say.
- Lead with the headline finding the chart makes visible (who is fastest, who gained, where the race was won or lost), then support it with 2-4 key numbers from the data.
- Do NOT paste the full data table when a chart shows the same rows. A short table (at most 5 rows) is fine when it adds a comparison the chart does not show.
- Keep every number consistent with the data context - each chart is drawn from the same data in team and driver colors, so any mismatch reads as an error.`;

/**
 * Chart guidance for the deep-research synthesizer, which knows the exact
 * planned specs (injected as the chart list below this block).
 */
export const CHART_GUIDANCE_DEEP_PROMPT = `## Charts (rendered automatically below your answer)
- The "Available Charts" list below is EXACT: reference charts only as "Chart N: <exact title>" (e.g., "See Chart 1: Pace Distribution - Suzuka 2024"). Do NOT reference charts that are not in the list. If the list says no charts are available, do not mention charts at all.
- Reference every chart that answers part of the objective. Each reference must earn its place: mirror the chart's headline finding in your prose and state the one takeaway a reader should draw from it.
- The reader sees each chart, so never announce a chart, describe where it is, or restate what it plainly shows. Add only what the chart doesn't say.
- Do NOT paste the full data table behind a chart. A short table (at most 5 rows) is fine when it adds a comparison the chart does not show.
- Keep every number consistent with the evidence - each chart is drawn from the same evidence in team and driver colors, so any mismatch reads as an error.`;

/** Render the injected "Available Charts" list for the deep synthesizer. */
export function describeChartsForPrompt(chartSpecs: ChartSpec[]): string {
    if (chartSpecs.length === 0) return "No charts available for this response.";
    return chartSpecs
        .map((c, i) => `Chart ${i + 1}: "${c.title}" (type: ${c.type}, evidence: ${c.dataSource})`)
        .join("\n");
}

// =============================================================================
// Sanitizer (deterministic enforcement)
// =============================================================================

// Em dash (U+2014) and horizontal bar (U+2015). En dashes (U+2013, used in
// ranges like "2023-2024") are left alone.
const EM_DASH_RE = /[—―]/g;

// Pictographs, dingbats, misc symbols, variation selectors, ZWJ and the
// keycap combiner. BMP-safe single pass - applied to complete buffered
// text only, never to streaming chunks (a split surrogate pair mid-stream
// would corrupt output).
const EMOJI_RE = /[🀀-🫿☀-➿⬀-⭿️‍⃣]/gu;

/**
 * Deterministically enforce house style on a COMPLETE buffered answer.
 * Replaces em dashes with hyphens and strips emojis/symbols. Citations
 * ([E1]), lap times (1:23.456), markdown, and numbers are untouched.
 */
export function sanitizeAnswerText(text: string): string {
    if (!text) return text;
    return text.replace(EM_DASH_RE, "-").replace(EMOJI_RE, "");
}
