/**
 * Research Agent Type Definitions
 * ===============================
 * Core types for the four-agent iterative research architecture:
 *   ResearchManager → Reasoner → Planner → Executor → Synthesizer
 *
 * These types are framework-agnostic and carry no LLM or tool implementation
 * details. They describe the shape of tasks, evidence, memory, confidence,
 * reflections, chart specs, and the overall research state.
 */

import { z } from "zod";

// =============================================================================
// Research Type Taxonomy (17 types)
// =============================================================================

export const RESEARCH_TYPES = [
    "factual",
    "comparative",
    "causal",
    "predictive",
    "trend",
    "historical",
    "statistical",
    "strategy",
    "performance",
    "reliability",
    "technical",
    "driver_development",
    "constructor_development",
    "race_analysis",
    "season_review",
    "track_analysis",
    "regulation_impact",
] as const;

export type ResearchType = (typeof RESEARCH_TYPES)[number];

// =============================================================================
// Evidence Types (what kind of data a tool produces)
// =============================================================================

export const EVIDENCE_TYPES = [
    "seasons",
    "events",
    "sessions",
    "results",
    "qualifying",
    "race",
    "laps",
    "fastest_lap",
    "telemetry",
    "telemetry_summary",
    "weather",
    "race_control",
    "tyres",
    "standings",
    "regulation",
    "web_search",
    "web_fetch",
    "simulation",
    "visualization",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

// =============================================================================
// Tool Metadata (self-describing tools)
// =============================================================================

export interface ToolMetadata {
    /** Tool name as registered in the LangChain tool registry */
    name: string;
    /** Human-readable description of what the tool does */
    description: string;
    /** Category for grouping: "data", "regulation", "search", "simulation", "visualization" */
    category: "data" | "regulation" | "search" | "simulation" | "visualization";
    /** The evidence type this tool produces */
    outputType: EvidenceType;
    /**
     * Human-readable description of the output shape, e.g.
     * "Array of events with fields: round_number, country, event_name, event_date"
     * Used by the Planner to generate correct {{task_id.field}} references.
     */
    outputShape: string;
    /**
     * Evidence types this tool requires as prior input (for dependency-aware
     * scheduling). Empty if the tool needs no prior evidence.
     */
    requires: EvidenceType[];
    /** Evidence types this tool provides (usually [outputType]) */
    provides: EvidenceType[];
    /** Whether this tool is only available in deep research mode */
    deepResearchOnly?: boolean;
}

// =============================================================================
// Task
// =============================================================================

export const TaskStatus = {
    PENDING: "pending",
    RUNNING: "running",
    SUCCESS: "success",
    FAILED: "failed",
    SKIPPED: "skipped",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskSchema = z.object({
    id: z.string(),
    description: z.string(),
    tool: z.string(),
    args: z.record(z.string(), z.unknown()),
    dependsOn: z.array(z.string()).optional().default([]),
    status: z.enum(["pending", "running", "success", "failed", "skipped"]).default("pending"),
    result: z.unknown().optional(),
    error: z.string().optional(),
    iteration: z.number().int().min(1),
    rationale: z.string().optional(),
    evidenceId: z.string().optional(),
});

export type Task = z.infer<typeof TaskSchema>;

// =============================================================================
// Evidence
// =============================================================================

export interface EvidenceSource {
    tool: string;
    taskId: string;
    args: Record<string, unknown>;
}

export const EvidenceSchema = z.object({
    id: z.string(),
    type: z.enum(EVIDENCE_TYPES),
    source: z.object({
        tool: z.string(),
        taskId: z.string(),
        args: z.record(z.string(), z.unknown()),
    }),
    race: z.string().optional(),
    season: z.number().optional(),
    driver: z.string().optional(),
    data: z.unknown(),
    summary: z.string(),
    confidence: z.number().min(0).max(1),
    timestamp: z.number(),
    tags: z.array(z.string()).default([]),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

// =============================================================================
// Research Memory
// =============================================================================

export interface Discovery {
    claim: string;
    evidenceId: string;
    timestamp: number;
}

export interface ToolCallRecord {
    tool: string;
    argsHash: string;
    resultHash: string;
    evidenceId: string;
    timestamp: number;
}

// =============================================================================
// Reflection (Reasoner's post-execution judgment)
// =============================================================================

export const ReflectionSchema = z.object({
    useful: z.boolean(),
    answeredPart: z.string().describe("What part of the objective is now answered"),
    stillMissing: z.array(z.string()).describe("What information is still missing"),
    nextAction: z.enum(["call_tool", "stop"]),
    nextStrategy: z.string().optional().describe("Strategy for the next batch of tasks, if continuing"),
    reasoning: z.string(),
});

export type Reflection = z.infer<typeof ReflectionSchema>;

// =============================================================================
// Confidence Score
// =============================================================================

export interface ConfidenceFactors {
    sourceCount: number;
    completeness: number; // 0-1
    conflicts: number;
    missingData: string[];
    dataQuality: number; // 0-1
}

export interface ConfidenceScore {
    overall: number; // 0-1
    factors: ConfidenceFactors;
}

// =============================================================================
// Chart Spec (deterministic visualization planning)
// =============================================================================
//
// A ChartSpec is the contract between the planner (LLM or heuristic) and
// the frontend renderer. The schema supports both freeform chart types
// (heatmap, line, etc.) and the new intelligent types
// (horizontal_bar, area, dumbbell, box_plot, stacked_bar, telemetry_multi).
//
// `config` is an open bag that the renderer reads to:
//   - access pre-aggregated rows (`config.data`)
//   - get axis labels (`config.xAxisLabel`, `config.yAxisLabel`)
//   - annotate the chart (`config.insight`, `config.highlight`)
//   - format ticks (`config.unit`)

export const ChartType = {
    LINE: "line",
    BAR: "bar",
    SCATTER: "scatter",
    HEATMAP: "heatmap",
    HISTOGRAM: "histogram",
    HORIZONTAL_BAR: "horizontal_bar",
    AREA: "area",
    STACKED_BAR: "stacked_bar",
    DUMBBELL: "dumbbell",
    BOX_PLOT: "box_plot",
    TELEMETRY_MULTI: "telemetry_multi",
    KPI: "kpi",
    SWARM: "swarm",
    BUMP: "bump",
} as const;

export type ChartType = (typeof ChartType)[keyof typeof ChartType];

export const ChartSpecSchema = z.object({
    id: z.string(),
    type: z.enum([
        "line",
        "bar",
        "scatter",
        "heatmap",
        "histogram",
        "horizontal_bar",
        "area",
        "stacked_bar",
        "dumbbell",
        "box_plot",
        "telemetry_multi",
        "kpi",
        "swarm",
        "bump",
    ]),
    title: z.string(),
    subtitle: z.string().optional().describe("Secondary line that adds context (e.g. drivers, season)"),
    dataSource: z.string().describe("Evidence ID this chart is built from"),
    xField: z.string(),
    yField: z.string(),
    groupField: z.string().optional(),
    purpose: z.string().optional().describe("One-line summary of what the chart is for"),
    question: z.string().optional().describe("The user-facing question this chart answers"),
    insight: z.string().optional().describe("Headline finding shown to the user"),
    config: z.record(z.string(), z.unknown()).default({}),
});

export type ChartSpec = z.infer<typeof ChartSpecSchema>;

// =============================================================================
// Research State & Result
// =============================================================================

export interface ResearchBudget {
    maxTasks: number;
    maxIterations: number;
    tasksExecuted: number;
    iterationsCompleted: number;
}

export interface ResearchOptions {
    deepResearch: boolean;
    webSearch: boolean;
    maxTasks?: number;
    maxIterations?: number;
}

// =============================================================================
// Research Events (emitted by ResearchManager for SSE streaming)
// =============================================================================

export type ResearchEvent =
    | { type: "research_start"; researchType: ResearchType; objective: string; strategy: string }
    | { type: "intent_analysis"; intentAnalysis: IntentAnalysis }
    | { type: "plan_iteration"; iteration: number; tasks: Task[]; reasoning: string }
    | { type: "task_update"; taskId: string; status: TaskStatus; data?: unknown; evidenceId?: string }
    | { type: "evidence"; evidence: Evidence }
    | { type: "citations"; citations: import("@/lib/utils/sources").SourceCitation[] }
    | { type: "reflection"; reflection: Reflection; iteration: number }
    | { type: "confidence"; confidence: ConfidenceScore }
    | { type: "chart_specs"; specs: ChartSpec[] }
    | { type: "visualization"; data: Array<{ tool: string; args: Record<string, unknown>; success: boolean; data: unknown }> }
    | { type: "verification"; result: CriticResult }
    | { type: "token"; content: string }
    | { type: "degraded"; stage: string; kind: string; message: string }
    | { type: "done"; result: ResearchResultSummary }
    | { type: "error"; message: string };

export interface ResearchResultSummary {
    researchType: ResearchType;
    iterations: number;
    tasksExecuted: number;
    evidenceCount: number;
    confidence: number;
}

// =============================================================================
// Critic Result (post-synthesis verification)
// =============================================================================

export const CriticResultSchema = z.object({
    grounded: z.boolean().describe("Whether all factual claims in the answer trace to evidence"),
    issues: z.array(z.string()).describe("List of specific issues found (empty if grounded)"),
    severity: z.enum(["ok", "minor", "major"]).describe("Overall severity: ok = no issues, minor = minor issues, major = significant ungrounded claims"),
});
export type CriticResult = z.infer<typeof CriticResultSchema>;

// =============================================================================
// Research Type → Expected Evidence Types (for confidence completeness)
// =============================================================================

export const RESEARCH_TYPE_EXPECTATIONS: Partial<Record<ResearchType, EvidenceType[]>> = {
    race_analysis: ["qualifying", "race", "laps", "weather"],
    season_review: ["standings", "race", "qualifying"],
    reliability: ["race", "race_control", "results"],
    performance: ["qualifying", "laps", "telemetry_summary"],
    strategy: ["tyres", "laps", "race_control"],
    comparative: ["standings", "qualifying", "race"],
    causal: ["race", "qualifying", "weather", "race_control"],
    trend: ["standings", "race"],
    track_analysis: ["telemetry_summary", "laps", "weather"],
    regulation_impact: ["regulation", "results", "standings"],
    driver_development: ["standings", "race", "qualifying"],
    constructor_development: ["standings", "race", "tyres"],
    technical: ["telemetry_summary", "tyres", "laps"],
    statistical: ["standings", "results", "laps"],
    historical: ["standings", "race"],
    predictive: ["standings", "simulation"],
    factual: ["results"],
};

// =============================================================================
// Intent Analysis (pre-planning structured breakdown)
// =============================================================================

/**
 * Structured entity extraction from the user's question.
 * These are the concrete F1 entities the user mentioned (or that were
 * resolved from conversation history). The planner uses these to avoid
 * guessing driver codes, GP names, years, etc.
 */
export const IntentEntitiesSchema = z.object({
    drivers: z.array(z.string()).describe("3-letter driver codes if known (VER, HAM, LEC, NOR, SAI, PER, ALO, RUS, PIA, GAS, OCO, STR, ALB, HUL, MAG, BOT, ZHO, TSU, etc.). Full names if the code is unknown."),
    teams: z.array(z.string()).describe("Team names (e.g., 'Red Bull', 'Mercedes', 'Ferrari')"),
    grandPrix: z.array(z.string()).describe("Canonical GP names (e.g., 'Monaco', 'British', 'Abu Dhabi'). Do NOT include the year."),
    years: z.array(z.number()).describe("Years mentioned or resolved (e.g., [2024])"),
    sessions: z.array(z.string()).describe("Session codes (FP1, FP2, FP3, Q, SQ, SS, S, R)"),
    other: z.array(z.string()).describe("Other concepts mentioned (e.g., 'fastest lap', 'podium', 'tyre strategy', 'safety car')"),
});
export type IntentEntities = z.infer<typeof IntentEntitiesSchema>;

/**
 * Structured intent analysis produced BEFORE planning.
 *
 * This replaces the old Reasoner.classify output (researchType + strategy
 * string) with a much richer breakdown: entities, data needs, ambiguities,
 * suggested tools, and conversation context resolution.
 *
 * The IntentAnalyzer agent produces this; the Planner consumes it to
 * generate better-targeted tasks on the first try.
 */
export const IntentAnalysisSchema = z.object({
    primaryIntent: z.string().describe("One-sentence restatement of what the user is actually asking for"),
    intentType: z.enum(RESEARCH_TYPES as unknown as [string, ...string[]]).describe("Classification of the question type"),
    entities: IntentEntitiesSchema,
    temporalContext: z.string().describe("Time range the user is asking about (e.g., '2024 season', 'last 5 races', 'career-wide')"),
    comparisonAxis: z.string().nullable().describe("If this is a comparison, what metric is being compared (e.g., 'lap time', 'points', 'position'). Null if not a comparison."),
    dataNeeds: z.array(z.string()).describe("Specific F1 data needed to answer (e.g., 'race results for Monaco 2024', 'telemetry summary for VER fastest lap')"),
    ambiguities: z.array(z.string()).describe("Anything unclear: unknown driver codes, ambiguous GP names, missing year, vague time references"),
    suggestedTools: z.array(z.string()).describe("Tool names from the registry that should be called (e.g., ['get_race', 'get_qualifying', 'get_telemetry_summary'])"),
    requiresSimulation: z.boolean().describe("Whether this is a what-if/predictive query requiring run_simulation"),
    requiresWebSearch: z.boolean().describe("Whether this query needs web_search for current/news information"),
    conversationContext: z.string().describe("Resolved context from conversation history if this is a follow-up (e.g., 'User previously asked about LEC at Monza 2023; this question refers to the same race')"),
});
export type IntentAnalysis = z.infer<typeof IntentAnalysisSchema>;

/**
 * Derive a research strategy string from an IntentAnalysis.
 * This replaces the old Reasoner.classify strategy output so the Planner's
 * existing `strategy` parameter still works.
 */
export function deriveStrategy(intent: IntentAnalysis): string {
    const parts: string[] = [
        intent.primaryIntent,
    ];
    if (intent.dataNeeds.length > 0) {
        parts.push(`Data needs: ${intent.dataNeeds.join("; ")}`);
    }
    if (intent.suggestedTools.length > 0) {
        parts.push(`Suggested tools: ${intent.suggestedTools.join(", ")}`);
    }
    if (intent.ambiguities.length > 0) {
        parts.push(`Ambiguities: ${intent.ambiguities.join("; ")}`);
    }
    if (intent.requiresSimulation) {
        parts.push("Requires simulation grounded in real data.");
    }
    return parts.join(" | ");
}
