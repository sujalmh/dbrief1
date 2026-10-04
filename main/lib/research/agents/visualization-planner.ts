/**
 * Visualization Planner
 * ======================
 *
 * The "data analyst" agent. It walks the evidence store, asks
 * "what question is the user actually trying to answer?", and emits
 * one or more `ChartSpec`s that:
 *
 *   1. Aggregate raw data (average, median, top-N) so the chart isn't
 *      just a dump of 200 rows.
 *   2. Pick the chart family that best answers the question.
 *   3. Carry axis labels, units, and a headline insight so the renderer
 *      never has to invent them.
 *
 * The LLM is used to suggest chart *intents* and *titles*; the actual
 * spec, aggregation, and chart type are produced deterministically by
 * `visualization-intelligence.ts`. This keeps the renderer dumb and
 * prevents the LLM from inventing fake x/y fields.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { LLM_TIMEOUT_MS } from "@/lib/llm";
import { z } from "zod";
import { type ChartSpec, type Evidence, type ResearchType } from "../types";
import type { EvidenceStore } from "../evidence-store";
import {
    detectIntents,
    buildChartSpec,
    validateChartSpec,
    type VisualizationIntent,
    type AggregatedRow,
} from "./visualization-intelligence";

// =============================================================================
// LLM-side intent + title proposal
// =============================================================================
//
// The LLM is intentionally scoped: it picks which intents to render and
// writes a focused question/purpose. It does NOT pick chart type, fields,
// or aggregation. Those come from the deterministic pipeline.

const IntentProposalSchema = z.object({
    charts: z
        .array(
            z.object({
                intent: z.string().describe("One of: compare_drivers, compare_teams, rank_metric, championship_progression, lap_progression, tyre_degradation, strategy_breakdown, pit_stop_distribution, lap_time_distribution, qualifying_pace, qualifying_vs_result, telemetry_compare, telemetry_single, telemetry_correlation, standings_breakdown, race_control_timeline, weather_conditions, correlation, summary_kpi, show"),
                purpose: z.string().describe("One-line summary of the chart's purpose"),
                question: z.string().describe("The user-facing question this chart answers"),
                evidenceIds: z.array(z.string()).describe("IDs of evidence to use (E1, E2, ...)"),
                focus: z.array(z.string()).nullable().describe("Driver/team/compound codes to highlight, or null"),
            })
        )
        .describe("List of meaningful chart intents. Return an empty array if no charts are needed."),
});

const VIZ_PROMPT = `You are an expert F1 Data Analyst.

Your job is to choose which CHARTS (not which datasets) communicate the user's
research objective. You do NOT pick chart types, fields, or aggregations —
those are decided downstream by a deterministic pipeline. You only choose
*which insights to communicate* and write a purpose + question for each.

Rules:
- Do NOT emit a chart unless it answers a real, specific question.
- Do NOT emit a chart that just mirrors a table.
- Prefer 1-4 focused charts over 10 generic ones.
- If the user asked about specific drivers/teams, list them in 'focus'.
- If the question is purely informational ("what year did X happen?"), return [].
- If the evidence store has no relevant data, return [].

Intents you can pick from:
- compare_drivers           → "Who was faster / better?"
- compare_teams             → Team vs team
- rank_metric               → "Most wins, top 5 drivers"
- championship_progression  → WDC/WCC points over a season
- lap_progression           → Pace across a stint
- tyre_degradation          → Pace vs tyre age
- strategy_breakdown        → Compound usage
- pit_stop_distribution     → Pit time spread
- lap_time_distribution     → Pace consistency
- qualifying_pace           → Qualifying comparison
- qualifying_vs_result      → Grid vs finish
- telemetry_compare         → Speed traces of multiple drivers
- telemetry_single          → Single-driver telemetry
- telemetry_correlation     → Telemetry-derived correlation
- standings_breakdown       → Final WDC/WCC breakdown
- race_control_timeline     → Flags/SC timeline
- weather_conditions        → Air/track temp
- correlation               → Generic scatter
- summary_kpi               → Headline number only
- show                      → Generic fallback

Research Objective: {objective}
Research Type: {researchType}

Available Evidence:
{evidenceContext}

Output JSON matching the schema. The pipeline will fill in chart type, fields,
and aggregation. Focus on intent + question.`;

// =============================================================================
// Visualization Planner
// =============================================================================

const DEFAULT_INTENTS_BY_RESEARCH: Partial<Record<ResearchType, VisualizationIntent[]>> = {
    race_analysis: ["compare_drivers", "qualifying_vs_result", "lap_progression", "tyre_degradation"],
    season_review: ["championship_progression", "standings_breakdown", "rank_metric"],
    reliability: ["race_control_timeline"],
    performance: ["qualifying_pace", "compare_drivers", "lap_time_distribution"],
    strategy: ["strategy_breakdown", "tyre_degradation", "pit_stop_distribution"],
    comparative: ["compare_drivers", "compare_teams", "qualifying_pace"],
    causal: ["qualifying_vs_result", "weather_conditions", "race_control_timeline"],
    trend: ["championship_progression"],
    track_analysis: ["telemetry_compare", "telemetry_single", "lap_progression"],
    regulation_impact: ["standings_breakdown", "championship_progression"],
    driver_development: ["compare_drivers", "lap_progression", "rank_metric"],
    constructor_development: ["compare_teams", "rank_metric"],
    technical: ["telemetry_single", "telemetry_compare", "tyre_degradation"],
    statistical: ["rank_metric", "lap_time_distribution", "standings_breakdown"],
    historical: ["rank_metric", "championship_progression"],
    predictive: ["championship_progression", "rank_metric"],
    factual: [],
};

export class VisualizationPlanner {
    constructor(private model: BaseChatModel) {}

    /**
     * Plan charts intelligently using an LLM based on objective and evidence.
     * The LLM proposes intents; we deterministically build the specs.
     */
    async plan(
        evidenceStore: EvidenceStore,
        researchType: ResearchType,
        objective: string
    ): Promise<ChartSpec[]> {
        if (evidenceStore.size() === 0) {
            return [];
        }

        const evidenceContext = evidenceStore.toReasonerContextString();

        let intents: IntentProposal[];

        try {
            const modelWithStructure = this.model.withStructuredOutput(IntentProposalSchema, {
                name: "plan_visualizations",
            });
            const prompt = ChatPromptTemplate.fromTemplate(VIZ_PROMPT);
            const chain = prompt.pipe(modelWithStructure);
            const result = await chain.invoke(
                { objective, researchType, evidenceContext },
                { signal: AbortSignal.timeout(LLM_TIMEOUT_MS.planner) }
            );
            intents = result.charts
                .map((c): IntentProposal | null => {
                    const intent = sanitizeIntent(c.intent);
                    if (!intent) return null;
                    return {
                        intent,
                        purpose: c.purpose,
                        question: c.question,
                        evidenceIds: c.evidenceIds,
                        focus: c.focus ?? undefined,
                    };
                })
                .filter((c): c is IntentProposal => c !== null);
        } catch (error) {
            console.error("VisualizationPlanner: LLM intent proposal failed, falling back to heuristics:", error);
            intents = fallbackIntents(objective, researchType, evidenceStore);
        }

        // Build deterministic specs for each intent.
        const specs: ChartSpec[] = [];
        const seenEvidenceIds = new Set<string>();
        for (const intent of intents) {
            const evidence = pickEvidenceForIntent(intent.intent, evidenceStore, intent.evidenceIds, seenEvidenceIds);
            if (!evidence) continue;
            seenEvidenceIds.add(evidence.id);

            const spec = buildSpecForEvidence(intent.intent, intent.purpose, intent.question, evidence, intent.focus);
            if (!spec) continue;

            const { ok, reasons } = validateChartSpec(spec);
            if (!ok) {
                console.warn(`[VisualizationPlanner] Rejecting chart ${spec.id}: ${reasons.join(", ")}`);
                continue;
            }
            specs.push(spec);
        }

        return specs;
    }
}

// =============================================================================
// Helpers (must be declared before the class that uses them)
// =============================================================================

interface IntentProposal {
    intent: VisualizationIntent;
    purpose: string;
    question: string;
    evidenceIds: string[];
    focus?: string[];
}

const VALID_INTENTS: Set<string> = new Set([
    "compare_drivers", "compare_teams", "rank_metric", "championship_progression",
    "lap_progression", "tyre_degradation", "strategy_breakdown", "pit_stop_distribution",
    "lap_time_distribution", "qualifying_pace", "qualifying_vs_result",
    "telemetry_compare", "telemetry_single", "telemetry_correlation",
    "standings_breakdown", "race_control_timeline", "weather_conditions",
    "correlation", "summary_kpi", "show",
]);

function sanitizeIntent(raw: string): VisualizationIntent | null {
    const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (VALID_INTENTS.has(normalized)) return normalized as VisualizationIntent;
    return null;
}

function fallbackIntents(
    objective: string,
    researchType: ResearchType,
    evidenceStore: EvidenceStore
): IntentProposal[] {
    const heuristic = detectIntents(objective);
    const fallbackByType = DEFAULT_INTENTS_BY_RESEARCH[researchType] ?? [];
    const intents: VisualizationIntent[] = heuristic.length > 0 && !heuristic.includes("show")
        ? heuristic
        : fallbackByType.length > 0
            ? fallbackByType
            : ["show"];

    return intents.map((intent) => ({
        intent,
        purpose: `Visualize ${intent.replace(/_/g, " ")}`,
        question: `What does the data show for ${intent.replace(/_/g, " ")}?`,
        evidenceIds: evidenceStore.getAll().slice(0, 2).map((e) => e.id),
    }));
}

/**
 * Pick the best evidence for an intent. We prefer evidence the LLM named,
 * but if it's missing or the wrong type we fall back to the highest-quality
 * evidence whose type matches the intent.
 */
function pickEvidenceForIntent(
    intent: VisualizationIntent,
    store: EvidenceStore,
    preferredIds: string[],
    alreadyUsed: Set<string>
): Evidence | undefined {
    for (const id of preferredIds) {
        const ev = store.getById(id);
        if (ev && !alreadyUsed.has(id)) return ev;
    }

    const typePreference = intentToEvidenceTypes(intent);
    for (const ev of store.getAll()) {
        if (alreadyUsed.has(ev.id)) continue;
        if (typePreference.includes(ev.type)) return ev;
    }

    const unused = store.getAll().filter((e) => !alreadyUsed.has(e.id));
    unused.sort((a, b) => b.confidence - a.confidence);
    return unused[0];
}

function intentToEvidenceTypes(intent: VisualizationIntent): string[] {
    const map: Record<VisualizationIntent, string[]> = {
        compare_drivers: ["qualifying", "race", "laps", "telemetry_summary", "standings"],
        compare_teams: ["qualifying", "race", "standings"],
        rank_metric: ["standings", "race", "qualifying"],
        championship_progression: ["standings", "race"],
        lap_progression: ["laps"],
        tyre_degradation: ["tyres", "laps"],
        strategy_breakdown: ["tyres"],
        pit_stop_distribution: ["laps", "race"],
        lap_time_distribution: ["laps", "telemetry_summary"],
        qualifying_pace: ["qualifying", "laps"],
        qualifying_vs_result: ["qualifying", "race"],
        telemetry_compare: ["telemetry", "telemetry_summary"],
        telemetry_single: ["telemetry", "telemetry_summary"],
        telemetry_correlation: ["laps", "tyres"],
        standings_breakdown: ["standings"],
        race_control_timeline: ["race_control"],
        weather_conditions: ["weather"],
        correlation: ["laps", "telemetry_summary", "qualifying", "race"],
        summary_kpi: ["standings", "race", "qualifying", "laps", "tyres"],
        show: ["laps", "telemetry", "telemetry_summary", "race", "qualifying", "standings", "tyres"],
    };
    return map[intent] ?? [];
}

/**
 * Build a deterministic ChartSpec for a single intent + evidence pair.
 * This is the heart of the redesign: every spec carries pre-aggregated
 * data, smart labels, and a headline insight.
 */
function buildSpecForEvidence(
    intent: VisualizationIntent,
    purpose: string,
    question: string,
    evidence: Evidence,
    focus?: string[]
): ChartSpec | null {
    const rows = extractRows(evidence);
    if (rows.length === 0) return null;

    const plan = planForIntent(intent, rows);
    if (!plan) return null;

    const spec = buildChartSpec({
        intent,
        objective: question,
        evidence,
        data: rows,
        xKey: plan.xKey,
        yKey: plan.yKey,
        xKeySecondary: plan.xKeySecondary,
        focusKeys: focus,
    });

    return {
        ...spec,
        title: plan.titleOverride ?? spec.title,
        subtitle: plan.subtitle,
        purpose,
        question,
        insight: (spec.config as { insight?: string }).insight,
        config: {
            ...spec.config,
            // Pre-aggregated rows live in `config.data` so the renderer
            // doesn't need to re-aggregate.
            data: (spec.config as { data?: AggregatedRow[] }).data ?? rows,
            // Hint to the renderer how to format ticks.
            unit: (spec.config as { unit?: string }).unit ?? "",
            intent,
        },
    };
}

interface IntentPlan {
    xKey: string;
    yKey: string;
    xKeySecondary?: string;
    titleOverride?: string;
    subtitle?: string;
}

function planForIntent(intent: VisualizationIntent, rows: Array<Record<string, unknown>>): IntentPlan | null {
    const keys = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) keys.add(k);

    const has = (name: string) => keys.has(name);

    switch (intent) {
        case "compare_drivers":
        case "qualifying_pace": {
            const xKey = "driver";
            if (has("q3")) return { xKey, yKey: "q3" };
            if (has("Q3")) return { xKey, yKey: "Q3" };
            if (has("time")) return { xKey, yKey: "time" };
            if (has("Time")) return { xKey, yKey: "Time" };
            if (has("lap_time")) return { xKey, yKey: "lap_time" };
            if (has("position")) return { xKey, yKey: "position" };
            return { xKey, yKey: "position" };
        }
        case "compare_teams":
            return { xKey: "team", yKey: "position" };
        case "rank_metric":
            return { xKey: "driver", yKey: "wins" };
        case "standings_breakdown":
            return { xKey: "driver", yKey: "points" };
        case "championship_progression":
            return { xKey: "round", yKey: "points" };
        case "lap_progression":
            return { xKey: "lap", yKey: "time" };
        case "tyre_degradation":
            return { xKey: "tyre_age", yKey: "lap_time" };
        case "strategy_breakdown":
            return { xKey: "compound", yKey: "laps" };
        case "pit_stop_distribution":
            return { xKey: "driver", yKey: "pit_time" };
        case "lap_time_distribution":
            return { xKey: "driver", yKey: "lap_time" };
        case "qualifying_vs_result":
            return { xKey: "grid", yKey: "finish" };
        case "telemetry_single":
        case "telemetry_compare":
            return { xKey: "distance", yKey: "speed" };
        case "telemetry_correlation":
            return { xKey: "tyre_age", yKey: "lap_time" };
        case "race_control_timeline":
            return { xKey: "lap", yKey: "flag" };
        case "weather_conditions":
            return { xKey: "time", yKey: "air_temp" };
        case "correlation":
            return { xKey: "x", yKey: "y" };
        case "summary_kpi":
            return { xKey: "metric", yKey: "value" };
        case "show":
        default: {
            const numericKeys = pickNumericKeys(rows);
            if (numericKeys.length >= 2) {
                return { xKey: numericKeys[0], yKey: numericKeys[1] };
            }
            return null;
        }
    }
}

function pickNumericKeys(rows: Array<Record<string, unknown>>): string[] {
    if (rows.length === 0) return [];
    const first = rows[0];
    return Object.keys(first).filter((k) => typeof first[k] === "number");
}

function extractRows(evidence: Evidence): Array<Record<string, unknown>> {
    const data = evidence.data;
    if (data == null) return [];
    let parsed: unknown = data;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return [];
        }
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    const obj = parsed as Record<string, unknown>;
    for (const field of ["results", "laps", "tyres", "standings", "data", "retrieved_documents", "seasons", "events", "messages"]) {
        if (Array.isArray(obj[field])) {
            return (obj[field] as Array<Record<string, unknown>>).filter((r) => typeof r === "object" && r !== null);
        }
    }
    return [];
}
