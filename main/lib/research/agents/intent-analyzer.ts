/**
 * Intent Analyzer Agent
 * =====================
 *
 * Runs BEFORE planning to produce a structured breakdown of the user's
 * question: entities (drivers, teams, GPs, years, sessions), data needs,
 * ambiguities, suggested tools, and conversation context resolution.
 *
 * This replaces the old Reasoner.classify step (which only produced a
 * researchType + one-line strategy) with a much richer analysis that gives
 * the Planner structured guidance instead of a raw string to guess from.
 *
 * The IntentAnalyzer NEVER calls tools, NEVER plans tasks, and NEVER
 * answers the question. It only analyzes the question.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import {
    IntentAnalysisSchema,
    IntentAnalysis,
    RESEARCH_TYPES,
    deriveStrategy,
} from "../types";
import { classifyLlmError, isNonRecoverable } from "@/lib/utils/llm-errors";
import { LLM_TIMEOUT_MS } from "@/lib/llm";
import { envJson, telemetryStartYear } from "@/lib/config";
import {
    getDriverCodes,
    getDriverNameToCode,
    getGpNames,
    getSessionCodes,
    getSessionMap,
    getTeams,
} from "@/lib/reference-data";

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when the IntentAnalyzer cannot run at all because the underlying
 * LLM is unavailable (rate limit, auth failure, network error, etc.).
 *
 * Distinct from "the LLM returned bad output we couldn't parse" — that
 * case is handled by the deterministic heuristic fallback and does NOT
 * throw.
 *
 * Callers should surface this to the user rather than silently continuing
 * with a degraded path, because:
 *   - The Planner / Executor / Responder will all hit the same failure.
 *   - The user is left staring at a spinner for minutes.
 */
export class IntentAnalyzerUnavailableError extends Error {
    readonly userMessage: string;
    readonly kind: string;
    readonly cause: unknown;

    constructor(opts: { userMessage: string; kind: string; cause: unknown }) {
        super(opts.userMessage);
        this.name = "IntentAnalyzerUnavailableError";
        this.userMessage = opts.userMessage;
        this.kind = opts.kind;
        this.cause = opts.cause;
    }
}

// =============================================================================
// Types
// =============================================================================

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
}

// =============================================================================
// Reference data (live — see lib/reference-data.ts + lib/config.ts)
// =============================================================================
//
// Driver codes, name aliases, GP names, session maps, and team lists are
// resolved dynamically at call time so the analyzer tracks the live season
// and any configured overrides (F1_DRIVERS_JSON, F1_GP_NAMES_JSON, ...).
// The constants below are kept as deprecated aliases so existing imports
// keep working; new code must use the get*() accessors.

const KNOWN_DRIVER_CODES: string[] = new Proxy([] as unknown as string[], {
    get: (_target, prop: string | symbol) => {
        const snapshot = getDriverCodes() as unknown as Record<string | symbol, unknown>;
        const value = snapshot[prop];
        return typeof value === "function" ? (value as () => unknown).bind(snapshot) : value;
    },
});

const DRIVER_NAME_TO_CODE: Record<string, string> = new Proxy({} as Record<string, string>, {
    get: (_target, prop: string) => getDriverNameToCode()[prop],
    ownKeys: () => Reflect.ownKeys(getDriverNameToCode()),
    getOwnPropertyDescriptor: (_target, prop: string) => {
        const map = getDriverNameToCode();
        if (!(prop in map)) return undefined;
        return { enumerable: true, configurable: true, value: map[prop] };
    },
});

const KNOWN_GP_NAMES: string[] = new Proxy([] as unknown as string[], {
    get: (_target, prop: string | symbol) => {
        const snapshot = getGpNames() as unknown as Record<string | symbol, unknown>;
        const value = snapshot[prop];
        return typeof value === "function" ? (value as () => unknown).bind(snapshot) : value;
    },
});

// =============================================================================
// Intent Analyzer
// =============================================================================

export class IntentAnalyzer {
    constructor(private model: BaseChatModel) { }

    /**
     * Analyze the user's question and produce a structured intent breakdown.
     *
     * @param objective - The user's raw question
     * @param history - Optional conversation history for follow-up resolution
     * @returns Structured IntentAnalysis
     * @throws {IntentAnalyzerUnavailableError} when the underlying LLM is
     *   unavailable (rate limit, auth, network). Recoverable parse failures
     *   (LLM responded but with bad output) still fall back to the
     *   heuristic path silently.
     */
    async analyze(
        objective: string,
        history?: ChatMessage[]
    ): Promise<IntentAnalysis> {
        const systemPrompt = this.buildSystemPrompt(history);
        const humanPrompt = `User question: ${objective}`;

        // Try structured output first (guarantees schema-valid JSON)
        try {
            const structuredModel = this.model.withStructuredOutput(
                IntentAnalysisSchema,
                { name: "intent_analysis", strict: true }
            );
            const result = await structuredModel.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(humanPrompt),
            ], { signal: AbortSignal.timeout(LLM_TIMEOUT_MS.intent) });
            return this.postProcess(result as IntentAnalysis, objective, history);
        } catch (structuredError) {
            const cls = classifyLlmError(structuredError, "IntentAnalyzer.structured");
            if (isNonRecoverable(cls)) {
                console.error(
                    "[IntentAnalyzer] Structured output failed (non-recoverable):",
                    cls.kind,
                    cls.cause instanceof Error ? cls.cause.message : cls.cause
                );
                throw new IntentAnalyzerUnavailableError({
                    userMessage: cls.userMessage,
                    kind: cls.kind,
                    cause: cls.cause,
                });
            }
            console.log(
                "[IntentAnalyzer] Structured output failed (recoverable), falling back to manual parsing:",
                structuredError instanceof Error ? structuredError.message : structuredError
            );
        }

        // Recoverable failure: skip the old second LLM call (manual
        // invoke + JSON extraction) and go straight to the deterministic
        // heuristic. The second call doubled intent latency in exactly the
        // failure cases that are already slow, and the regex heuristic
        // extracts years/drivers/GPs/sessions well enough for planning —
        // the Planner re-validates everything anyway.
        return this.heuristicFallback(objective, history);
    }

    /**
     * Build the system prompt for the IntentAnalyzer.
     * Entity examples and session codes are generated from the live
     * reference data so the prompt never pins a stale grid.
     */
    private buildSystemPrompt(history?: ChatMessage[]): string {
        const historySection = history && history.length > 0
            ? `\n## Conversation History (use this to resolve follow-up references)\n${history
                .map((m) => `${m.role}: ${m.content}`)
                .join("\n")}`
            : "\n## Conversation History\n(none — this is a new question)";
        const driverCodes = getDriverCodes().join(", ");
        const teams = getTeams().join(", ");
        const sessions = getSessionCodes().join(", ");
        const gpExamples = getGpNames().slice(0, 7).join(", ");

        return `You are the Intent Analyzer in an F1 research agent. Your job is to break down the user's question into a structured analysis BEFORE any planning happens.

Extract:
1. **primaryIntent** — restate what the user is actually asking for in one sentence.
2. **intentType** — classify from: ${RESEARCH_TYPES.join(", ")}.
3. **entities** — extract all:
    - drivers: 3-letter codes if known (${driverCodes}). Use full names if the code is unknown.
    - teams: team names (${teams})
    - grandPrix: canonical GP names (${gpExamples}, etc.). Do NOT include the year.
    - years: years mentioned or resolved from context
    - sessions: session codes (${sessions})
    - other: other concepts (fastest lap, podium, tyre strategy, safety car, DRS, etc.)
4. **temporalContext** — what time range is the user asking about? (e.g., "2024 season", "last 5 races", "career-wide")
5. **comparisonAxis** — if this is a comparison, what metric is being compared? (lap time, points, position, telemetry). Null if not a comparison.
6. **dataNeeds** — what specific F1 data would be needed to answer? Be specific (e.g., "race results for Monaco 2024", "telemetry summary for VER fastest lap").
7. **ambiguities** — flag anything unclear: unknown driver codes, ambiguous GP names, missing year, vague time references.
8. **suggestedTools** — which F1 data tools should be called? Use exact tool names: get_seasons, get_events, get_sessions, get_results, get_qualifying, get_race, get_laps, get_fastest_lap, get_telemetry, get_telemetry_summary, get_weather, get_race_control, get_tyres, get_driver_standings, run_simulation, web_search.
9. **requiresSimulation** — true if this is a what-if/predictive/counterfactual query.
10. **requiresWebSearch** — true if this needs current news or information not in historical data.
11. **conversationContext** — if this is a follow-up question, resolve references from the conversation history (e.g., "what about Monaco?" → identify which year/driver from prior turns).

## CRITICAL RULES
- Do NOT answer the question. Do NOT generate F1 facts. You are ONLY analyzing the question.
- If a driver name is ambiguous (e.g., "Carlos"), flag it in ambiguities and suggest the likely code (SAI for Carlos Sainz).
- If a GP name is ambiguous, flag it and suggest the canonical form.
- If no year is specified, flag it as an ambiguity and suggest the most likely year (current season or most recent completed).
- For follow-up questions, use the conversation history to resolve pronouns and references.
- For "what if" / "simulate" / "predict" / "counterfactual" queries, set requiresSimulation=true and include run_simulation in suggestedTools.
- For current-season news or events not yet in historical data, set requiresWebSearch=true.
${historySection}`;
    }

    /**
     * Post-process the LLM output: resolve missing years, validate driver codes,
     * and fill in conversation context if the LLM didn't.
     */
    private postProcess(
        analysis: IntentAnalysis,
        objective: string,
        history?: ChatMessage[]
    ): IntentAnalysis {
        // Resolve missing year → default to most recent completed season
        if (analysis.entities.years.length === 0) {
            const currentYear = new Date().getFullYear();
            // Default to current year (or last year if before March)
            const month = new Date().getMonth();
            const defaultYear = month < 2 ? currentYear - 1 : currentYear;
            analysis.entities.years = [defaultYear];
            if (!analysis.ambiguities.some((a) => a.toLowerCase().includes("year"))) {
                analysis.ambiguities.push(
                    `No year specified — defaulting to ${defaultYear}.`
                );
            }
        }

        // Normalize driver codes to uppercase
        analysis.entities.drivers = analysis.entities.drivers.map((d) =>
            d.length === 3 ? d.toUpperCase() : d
        );

        // Validate driver codes against known list — flag unknown ones
        for (const driver of analysis.entities.drivers) {
            if (
                driver.length === 3 &&
                !KNOWN_DRIVER_CODES.includes(driver) &&
                !analysis.ambiguities.some((a) =>
                    a.toLowerCase().includes(driver.toLowerCase())
                )
            ) {
                analysis.ambiguities.push(
                    `Driver code "${driver}" is not in the known driver list — may be a rookie or hallucinated.`
                );
            }
        }

        // If conversation context is empty but we have history, note it
        if (
            (!analysis.conversationContext || analysis.conversationContext.trim() === "") &&
            history &&
            history.length > 0
        ) {
            analysis.conversationContext =
                "Follow-up question with conversation history available.";
        }

        return analysis;
    }

    /**
     * Heuristic fallback when the LLM fails entirely.
     * Uses regex to extract years, driver codes, GP names, and session codes.
     */
    private heuristicFallback(
        objective: string,
        history?: ChatMessage[]
    ): IntentAnalysis {
        const text = objective.toLowerCase();
        const ambiguities: string[] = ["LLM intent analysis failed — using heuristic extraction."];

        // Extract years
        const yearMatches = objective.match(/(?:19|20)\d{2}/g) || [];
        const years = [...new Set(yearMatches.map((y) => parseInt(y)))];
        if (years.length === 0) {
            const currentYear = new Date().getFullYear();
            const month = new Date().getMonth();
            const defaultYear = month < 2 ? currentYear - 1 : currentYear;
            years.push(defaultYear);
            ambiguities.push(`No year specified — defaulting to ${defaultYear}.`);
        }

        // Extract driver codes (3-letter uppercase tokens)
        const driverMatches = objective.match(/\b[A-Z]{3}\b/g) || [];
        const drivers = [...new Set(
            driverMatches.filter((d) => KNOWN_DRIVER_CODES.includes(d))
        )];

        // Also check for full driver names
        for (const [name, code] of Object.entries(DRIVER_NAME_TO_CODE)) {
            if (text.includes(name) && !drivers.includes(code)) {
                drivers.push(code);
            }
        }

        // Extract GP names
        const grandPrix: string[] = [];
        for (const gp of KNOWN_GP_NAMES) {
            if (text.includes(gp.toLowerCase())) {
                grandPrix.push(gp);
            }
        }

        // Extract session codes (mapping is config-driven reference data)
        const sessionMap = getSessionMap();
        const sessions: string[] = [];
        for (const [keyword, code] of Object.entries(sessionMap)) {
            if (text.includes(keyword) && !sessions.includes(code)) {
                sessions.push(code);
            }
        }

        // Detect simulation (keyword list is config-overridable)
        const simKeywords = envJson<string[]>("F1_INTENT_SIM_KEYWORDS_JSON", ["what if", "simulate", "predict", "project", "counterfactual", "hypothetical", "how would", "what would happen"]);
        const requiresSimulation = simKeywords.some((k) => text.includes(k));

        // Detect comparison (keyword list is config-overridable)
        const comparisonKeywords = envJson<string[]>("F1_INTENT_COMPARISON_KEYWORDS_JSON", ["compare", "vs", "versus", "better", "faster", "slower", "difference between"]);
        const isComparison = comparisonKeywords.some((k) => text.includes(k));
        let comparisonAxis: string | null = null;
        if (isComparison) {
            if (text.includes("lap time") || text.includes("fastest lap")) comparisonAxis = "lap time";
            else if (text.includes("points") || text.includes("championship")) comparisonAxis = "points";
            else if (text.includes("position") || text.includes("finish")) comparisonAxis = "position";
            else if (text.includes("telemetry") || text.includes("speed")) comparisonAxis = "telemetry";
            else comparisonAxis = "performance";
        }

        // Determine intent type (pre-telemetry cutoff is config-driven)
        let intentType: IntentAnalysis["intentType"] = "factual";
        if (requiresSimulation) intentType = "predictive";
        else if (isComparison) intentType = "comparative";
        else if (text.includes("history") || text.includes("career") || years[0] < telemetryStartYear()) intentType = "historical";
        else if (text.includes("season") || text.includes("championship")) intentType = "season_review";
        else if (text.includes("race") && grandPrix.length > 0) intentType = "race_analysis";
        else if (text.includes("trend") || text.includes("over time") || text.includes("progress")) intentType = "trend";
        else if (text.includes("strategy") || text.includes("tyre") || text.includes("pit")) intentType = "strategy";
        else if (text.includes("telemetry") || text.includes("technical")) intentType = "technical";
        else if (text.includes("reliab") || text.includes("dNF") || text.includes("failure")) intentType = "reliability";

        // Suggested tools
        const suggestedTools: string[] = [];
        if (grandPrix.length > 0 && years.length > 0) {
            if (sessions.includes("R") || text.includes("race")) suggestedTools.push("get_race");
            if (sessions.includes("Q") || text.includes("qualifying")) suggestedTools.push("get_qualifying");
            if (drivers.length > 0 && (text.includes("lap") || text.includes("telemetry"))) {
                suggestedTools.push("get_telemetry_summary");
            }
            if (text.includes("weather")) suggestedTools.push("get_weather");
            if (text.includes("tyre") || text.includes("strategy")) suggestedTools.push("get_tyres");
        }
        if (text.includes("standings") || text.includes("championship") || text.includes("points")) {
            suggestedTools.push("get_driver_standings");
        }
        if (text.includes("events") || text.includes("calendar") || text.includes("season")) {
            suggestedTools.push("get_events");
        }
        if (requiresSimulation) {
            suggestedTools.push("run_simulation");
        }
        // Always include get_events if GP is mentioned but we're not sure of the exact name
        if (grandPrix.length > 0 && !suggestedTools.includes("get_events")) {
            suggestedTools.unshift("get_events");
        }
        // Dedup
        const uniqueTools = [...new Set(suggestedTools)];

        // Data needs
        const dataNeeds: string[] = [];
        for (const year of years) {
            if (grandPrix.length > 0) {
                for (const gp of grandPrix) {
                    dataNeeds.push(`race results for ${gp} ${year}`);
                    if (text.includes("qualifying")) dataNeeds.push(`qualifying results for ${gp} ${year}`);
                }
            }
            if (drivers.length > 0) {
                for (const driver of drivers) {
                    if (text.includes("telemetry") || text.includes("speed")) {
                        dataNeeds.push(`telemetry summary for ${driver} at ${grandPrix[0] || "the race"} ${year}`);
                    }
                }
            }
            if (text.includes("standings") || text.includes("championship")) {
                dataNeeds.push(`driver standings for ${year}`);
            }
        }
        if (dataNeeds.length === 0) {
            dataNeeds.push(`F1 data for ${years[0] || "the current season"}`);
        }

        return {
            primaryIntent: objective.slice(0, 200),
            intentType,
            entities: {
                drivers,
                teams: [],
                grandPrix,
                years,
                sessions,
                other: [],
            },
            temporalContext: years.length > 0 ? `${years.join(", ")} season` : "current season",
            comparisonAxis,
            dataNeeds,
            ambiguities,
            suggestedTools: uniqueTools,
            requiresSimulation,
            requiresWebSearch: text.includes("news") || text.includes("latest") || text.includes("current"),
            conversationContext:
                history && history.length > 0
                    ? "Follow-up question with conversation history available."
                    : "New question, no prior context.",
        };
    }
}

/**
 * Convenience function: analyze intent and derive a strategy string.
 * This is used by the ResearchManager to replace the old Reasoner.classify
 * output while keeping the Planner's `strategy` parameter compatible.
 */
export async function analyzeIntent(
    model: BaseChatModel,
    objective: string,
    history?: ChatMessage[]
): Promise<{ intentAnalysis: IntentAnalysis; strategy: string }> {
    const analyzer = new IntentAnalyzer(model);
    const intentAnalysis = await analyzer.analyze(objective, history);
    const strategy = deriveStrategy(intentAnalysis);
    return { intentAnalysis, strategy };
}
