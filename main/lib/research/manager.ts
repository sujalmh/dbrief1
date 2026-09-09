/**
 * Research Manager
 * ================
 *
 * Orchestrates the four-agent iterative research loop:
 *
 *   Reasoner.classify → Planner.createTasks → Executor.executeBatch
 *     → EvidenceStore.add + Memory.update → Reasoner.reflect
 *     → (loop if continue) → ConfidenceCalculator → VisualizationPlanner
 *     → Synthesizer.generate
 *
 * The Manager owns the loop, budget tracking, and event emission (for SSE
 * streaming to the frontend). It yields ResearchEvent objects that the API
 * route maps to SSE events.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { AIMessageChunk } from "@langchain/core/messages";
import { getPlannerModel, getResponderModel, type Provider } from "@/lib/llm";
import { ToolRegistry, createToolRegistry } from "./tool-registry";
import { EvidenceStore } from "./evidence-store";
import { ResearchMemory } from "./memory";
import { Reasoner } from "./agents/reasoner";
import { Planner } from "./agents/planner";
import { Executor } from "./agents/executor";
import { Synthesizer } from "./agents/synthesizer";
import { IntentAnalyzer, IntentAnalyzerUnavailableError, type ChatMessage } from "./agents/intent-analyzer";
import { Critic } from "./agents/critic";
import { ConfidenceCalculator } from "./confidence";
import { VisualizationPlanner } from "./agents/visualization-planner";
import { classifyLlmError, isNonRecoverable } from "@/lib/utils/llm-errors";
import type { UsageAccumulator } from "@/lib/llm-usage";
import type {
    ResearchEvent,
    ResearchOptions,
    ResearchType,
    ResearchBudget,
    Task,
    Reflection,
    IntentAnalysis,
} from "./types";
import { RESEARCH_TYPE_EXPECTATIONS } from "./types";
import { researchConfig } from "@/lib/config";

// =============================================================================
// Configuration (live — see lib/config.ts)
// =============================================================================

/**
 * Hard wall-clock cap on the entire research session. Even if the budget
 * would otherwise allow more iterations, we stop once this elapses so a
 * single slow tool/plan/reflect call cannot hang the user forever.
 * Config-driven (RESEARCH_OVERALL_TIMEOUT_MS).
 */
function overallTimeoutMs(): number {
    return researchConfig.overallTimeoutMs();
}

// =============================================================================
// Research Manager
// =============================================================================

export class ResearchManager {
    private registry: ToolRegistry;
    private evidenceStore: EvidenceStore;
    private memory: ResearchMemory;
    private reasoner: Reasoner;
    private planner: Planner;
    private executor: Executor;
    private synthesizer: Synthesizer;
    private intentAnalyzer: IntentAnalyzer;
    private critic: Critic;
    private confidenceCalc: ConfidenceCalculator;
    private vizPlanner: VisualizationPlanner;

    constructor(
        private plannerModel: BaseChatModel,
        private responderModel: BaseChatModel,
        private options: ResearchOptions,
        /**
         * Optional external usage accumulator. When provided, the
         * Synthesizer threads its raw LLM chunks into the accumulator
         * so the API route can emit a single `usage` SSE event with
         * the final aggregated totals (prompt/completion tokens +
         * cost, per the OpenRouter Usage Accounting docs).
         *
         * The manager itself never inspects the accumulator — it
         * merely passes the `onChunk` callback down. This keeps the
         * research flow decoupled from the accounting concern.
         */
        private usage?: UsageAccumulator | null
        /**
         * The synthesizer receives the accumulator as an opaque
         * `onChunk` callback so it doesn't need to know about
         * UsageAccumulator directly. This keeps the research flow
         * decoupled from the accounting concern — the manager never
         * reads the accumulator, only forwards chunks into it.
         */
    ) {
        this.registry = createToolRegistry(options.deepResearch);
        this.evidenceStore = new EvidenceStore();
        this.memory = new ResearchMemory();
        this.reasoner = new Reasoner(plannerModel);
        this.planner = new Planner(plannerModel, this.registry);
        this.executor = new Executor(this.registry, this.evidenceStore, this.memory);
        this.synthesizer = new Synthesizer(responderModel);
        this.intentAnalyzer = new IntentAnalyzer(plannerModel);
        this.critic = new Critic(responderModel);
        this.confidenceCalc = new ConfidenceCalculator();
        this.vizPlanner = new VisualizationPlanner(plannerModel);
    }

    /**
     * Run the research loop. Yields ResearchEvent objects for SSE streaming.
     *
     * @param objective - The user's question
     * @param history - Optional conversation history for follow-up resolution
     */
    async *run(objective: string, history?: ChatMessage[]): AsyncGenerator<ResearchEvent> {
        const maxTasks = this.options.maxTasks ?? researchConfig.defaultMaxTasks();
        const maxIterations = this.options.maxIterations ?? researchConfig.defaultMaxIterations();
        const startTime = Date.now();

        const budget: ResearchBudget = {
            maxTasks,
            maxIterations,
            tasksExecuted: 0,
            iterationsCompleted: 0,
        };

        let researchType: ResearchType = "factual";
        let strategy = "";
        let consecutiveStops = 0;
        let timedOut = false;

        try {
            // --- Step 1: Intent analysis only (single LLM call) ---
            // The old path ran Reasoner.classify + IntentAnalyzer IN PARALLEL
            // (2 LLM calls). But IntentAnalysis already carries `intentType`,
            // which IS the researchType — classify was redundant spend on the
            // critical path. Derive researchType + strategy directly from the
            // intent result; fall back to factual/default only if intent is
            // unavailable.
            let intentAnalysis: IntentAnalysis | null = null;
            try {
                intentAnalysis = await this.intentAnalyzer.analyze(objective, history);
            } catch (intentError) {
                if (intentError instanceof IntentAnalyzerUnavailableError) {
                    // The IntentAnalyzer couldn't reach the LLM at all
                    // (rate limit, auth, network). Continue with a default
                    // factual strategy plus a degraded-mode signal so the UI
                    // can warn the user that downstream steps may fail.
                    console.warn(
                        "[ResearchManager] Intent analysis unavailable, continuing with default strategy:",
                        intentError.kind,
                        intentError.cause instanceof Error ? intentError.cause.message : intentError.cause
                    );
                    yield {
                        type: "degraded",
                        stage: "intent_analysis",
                        kind: intentError.kind,
                        message: intentError.userMessage,
                    } as ResearchEvent;
                } else {
                    console.warn(
                        "[ResearchManager] Intent analysis failed (recoverable), proceeding with default strategy:",
                        intentError instanceof Error ? intentError.message : intentError
                    );
                }
            }

            if (intentAnalysis) {
                researchType = intentAnalysis.intentType as ResearchType;
                const { deriveStrategy } = await import("./types");
                strategy = deriveStrategy(intentAnalysis) || `Gather relevant F1 data to answer: ${objective}`;
                yield { type: "intent_analysis", intentAnalysis };
            } else {
                researchType = "factual";
                strategy = `Gather relevant F1 data to answer: ${objective}`;
            }

            yield {
                type: "research_start",
                researchType,
                objective,
                strategy,
            };

            // --- Step 2: Iterative loop ---
            let iteration = 0;
            let shouldContinue = true;

            while (shouldContinue) {
                iteration++;
                budget.iterationsCompleted = iteration;

                // Budget check
                if (iteration > maxIterations) {
                    break;
                }
                if (budget.tasksExecuted >= maxTasks) {
                    break;
                }

                // Wall-clock check — if we've blown past the overall budget,
                // stop iterating and proceed to confidence/synthesis with
                // whatever evidence we have. A single slow LLM call must
                // not hang the user indefinitely.
                const overallBudget = overallTimeoutMs();
                if (Date.now() - startTime > overallBudget) {
                    timedOut = true;
                    console.warn(
                        `[ResearchManager] Overall timeout of ${overallBudget}ms reached after ${iteration} iterations.`
                    );
                    break;
                }

                // --- Plan ---
                let tasks: Task[];
                let reasoning: string;
                try {
                    const planned = await this.planner.createTasks(strategy, {
                        objective,
                        researchType,
                        evidenceStore: this.evidenceStore,
                        memory: this.memory,
                        budget,
                        iteration,
                        deepResearch: this.options.deepResearch,
                        intentAnalysis: iteration === 1 ? intentAnalysis : undefined,
                    });
                    tasks = planned.tasks;
                    reasoning = planned.reasoning;
                } catch (planError) {
                    const cls = classifyLlmError(planError, "ResearchManager.Planner");
                    if (isNonRecoverable(cls)) {
                        console.error(
                            "[ResearchManager] Planner LLM unavailable:",
                            cls.kind,
                            planError instanceof Error ? planError.message : planError
                        );
                        yield {
                            type: "error",
                            message: cls.userMessage,
                        };
                        yield {
                            type: "degraded",
                            stage: "planner",
                            kind: cls.kind,
                            message: cls.userMessage,
                        } as ResearchEvent;
                        // Stop the loop; synthesize with whatever evidence
                        // we already have (possibly none on iteration 1).
                        shouldContinue = false;
                        break;
                    }
                    // Recoverable: rethrow so the outer try/catch logs and
                    // yields a generic error. The deterministic planner
                    // fallback inside the Planner agent will produce *some*
                    // tasks (probably empty for edge cases), so this is
                    // rare.
                    throw planError;
                }

                yield {
                    type: "plan_iteration",
                    iteration,
                    tasks: tasks.map((t) => ({ ...t, result: undefined })),
                    reasoning,
                };

                if (tasks.length === 0) {
                    // No tasks generated — stop
                    consecutiveStops++;
                    if (consecutiveStops >= researchConfig.consecutiveStopsToHalt()) break;
                    continue;
                }

                // --- Execute ---
                const results = await this.executor.executeBatch(tasks, () => {
                    // Emit task updates (handled by caller via the generator)
                    // We collect these synchronously — the caller reads them
                });

                // Emit task updates and evidence.
                // NOTE: evidence ids come from the execution results first —
                // the memory cache is only populated by updateFromResults()
                // BELOW, so reading the cache here would miss every fresh
                // result from this batch (iteration 1 would always look
                // empty). The cache remains as a fallback for results that
                // carry no id (e.g. deduplicated/skipped tasks).
                for (const result of results) {
                    yield {
                        type: "task_update",
                        taskId: result.taskId,
                        status: result.success ? "success" : "failed",
                        data: result.data,
                        evidenceId: result.evidenceId
                            ?? this.evidenceStore.getById(
                                this.memory.getCachedEvidenceId(result.tool, result.args) || ""
                            )?.id,
                    };
                }

                // Emit evidence for new items
                const evidenceMap = new Map<string, string>();
                for (const result of results) {
                    if (!result.success) continue;
                    const evidenceId = result.evidenceId
                        ?? this.memory.getCachedEvidenceId(result.tool, result.args);
                    if (evidenceId) {
                        evidenceMap.set(result.taskId, evidenceId);
                        const evidence = this.evidenceStore.getById(evidenceId);
                        if (evidence) {
                            yield { type: "evidence", evidence };
                        }
                    }
                }

                // Update memory
                this.memory.updateFromResults(results, evidenceMap);

                // Update budget
                budget.tasksExecuted += results.length;

                // --- Reflect (skip LLM when evidence already covers expectations) ---
                // The reflect call is one LLM round-trip PER ITERATION. When
                // the evidence store already contains every expected evidence
                // type for this researchType, another iteration adds nothing —
                // stop deterministically without paying for the LLM judgment.
                let reflection: Reflection;
                const expected = RESEARCH_TYPE_EXPECTATIONS[researchType] || [];
                const present = this.evidenceStore.getEvidenceTypes();
                const allCovered = expected.length > 0 && expected.every((t) => present.has(t));
                // Also stop fast when the batch produced nothing new.
                const gotNewEvidence = evidenceMap.size > 0;
                if (allCovered || !gotNewEvidence) {
                    reflection = {
                        useful: gotNewEvidence,
                        answeredPart: allCovered
                            ? "All expected evidence types collected"
                            : "No new evidence from this batch",
                        stillMissing: [],
                        nextAction: "stop",
                        nextStrategy: undefined,
                        reasoning: allCovered
                            ? "Deterministic early-stop: evidence covers all expected types, skipping reflect LLM."
                            : "Deterministic early-stop: batch yielded no new evidence, skipping reflect LLM.",
                    };
                } else {
                    try {
                        reflection = await this.reasoner.reflect({
                            objective,
                            researchType,
                            evidenceStore: this.evidenceStore,
                            memory: this.memory,
                            budget,
                            iteration,
                        });
                    } catch (reflectError) {
                        const cls = classifyLlmError(reflectError, "ResearchManager.Reasoner");
                        if (isNonRecoverable(cls)) {
                            console.error(
                                "[ResearchManager] Reasoner.reflect LLM unavailable:",
                                cls.kind,
                                reflectError instanceof Error ? reflectError.message : reflectError
                            );
                            yield {
                                type: "error",
                                message: cls.userMessage,
                            };
                            yield {
                                type: "degraded",
                                stage: "reflection",
                                kind: cls.kind,
                                message: cls.userMessage,
                            } as ResearchEvent;
                            shouldContinue = false;
                            break;
                        }
                        throw reflectError;
                    }
                }

                yield { type: "reflection", reflection, iteration };

                if (reflection.nextAction === "stop") {
                    consecutiveStops++;
                    if (consecutiveStops >= researchConfig.consecutiveStopsToHalt()) {
                        shouldContinue = false;
                    } else {
                        // One more chance — but only if we have budget
                        if (budget.tasksExecuted >= maxTasks || iteration >= maxIterations) {
                            shouldContinue = false;
                        }
                    }
                } else {
                    consecutiveStops = 0;
                    strategy = reflection.nextStrategy || strategy;
                }
            }

            // --- Step 3: Compute confidence ---
            const confidence = this.confidenceCalc.compute(
                this.evidenceStore,
                researchType,
                objective
            );
            yield { type: "confidence", confidence };

            // --- Step 4: Plan visualizations ---
            const chartSpecs = await this.vizPlanner.plan(
                this.evidenceStore,
                researchType,
                objective
            );
            yield { type: "chart_specs", specs: chartSpecs };

            // Also emit visualization data in the format the VisualizationPanel expects
            // (array of {tool, args, success, data}) so charts actually render
            const vizData = this.evidenceStore.getAll().map((e) => ({
                tool: e.source.tool,
                args: e.source.args,
                success: true,
                data: e.data,
            }));
            if (vizData.length > 0) {
                yield { type: "visualization", data: vizData };
            }

            // --- Step 5: Synthesize final report ---
            // The synthesizer streams tokens directly (no buffer-then-replay)
            // and validates citations after streaming without re-prompting.
            //
            // If the synthesizer's underlying LLM is unavailable (rate
            // limit, auth, network), we yield a clear error event and stop.
            // We deliberately do NOT silently fall back here — without
            // evidence-backed text, the user would just see a generic
            // answer that wasn't grounded in the data they asked for.
            let reportStream: AsyncGenerator<string> | null = null;
            try {
                reportStream = this.synthesizer.generate({
                    objective,
                    researchType,
                    evidenceStore: this.evidenceStore,
                    memory: this.memory,
                    confidence,
                    chartSpecs,
                    // Forward every raw LLM chunk to the usage
                    // accumulator so the API route can emit a single
                    // `usage` SSE event at the end of the deep
                    // research stream. The callback is a no-op when
                    // no accumulator was provided (e.g. in unit tests).
                    onChunk: (chunk) => {
                        try { this.usage?.addChunk(chunk as AIMessageChunk) } catch { /* best-effort */ }
                    },
                });
            } catch (synthError) {
                const cls = classifyLlmError(synthError, "ResearchManager.Synthesizer.start");
                if (isNonRecoverable(cls)) {
                    console.error(
                        "[ResearchManager] Synthesizer unavailable:",
                        cls.kind,
                        synthError instanceof Error ? synthError.message : synthError
                    );
                    yield {
                        type: "error",
                        message: cls.userMessage,
                    };
                    yield {
                        type: "degraded",
                        stage: "synthesizer",
                        kind: cls.kind,
                        message: cls.userMessage,
                    } as ResearchEvent;
                    // Fall through to emit "done" with the evidence we
                    // have, so the frontend still gets a clean stream
                    // end. The error event above is what the user will
                    // actually see.
                } else {
                    throw synthError;
                }
            }

            if (reportStream) {
                // Buffer the full report so the Critic can verify it
                // before we emit "done". We still stream tokens to the
                // client in real-time for UX, but we keep a copy for
                // post-generation verification.
                let fullReport = "";
                let synthErrored = false;
                try {
                    for await (const token of reportStream) {
                        fullReport += token;
                        yield { type: "token", content: token };
                    }
                } catch (streamErr) {
                    const cls = classifyLlmError(streamErr, "ResearchManager.Synthesizer.stream");
                    if (isNonRecoverable(cls)) {
                        console.error(
                            "[ResearchManager] Synthesizer stream errored:",
                            cls.kind,
                            streamErr instanceof Error ? streamErr.message : streamErr
                        );
                        synthErrored = true;
                        yield {
                            type: "error",
                            message: cls.userMessage,
                        };
                        yield {
                            type: "degraded",
                            stage: "synthesizer",
                            kind: cls.kind,
                            message: cls.userMessage,
                        } as ResearchEvent;
                    } else {
                        throw streamErr;
                    }
                }

                // --- Step 5.5: Critic verification ---
                // Skip verification if the synthesizer errored — there's
                // nothing meaningful to verify.
                if (!synthErrored) {
                    try {
                        const criticResult = await this.critic.review(
                            fullReport,
                            this.evidenceStore,
                            objective
                        );
                        yield { type: "verification", result: criticResult };

                        if (criticResult.severity === "major") {
                            const warning =
                                "\n\n---\n⚠️ **Verification note:** Some claims in this answer could not be fully verified against the retrieved data. Please cross-check with official F1 sources.";
                            yield { type: "token", content: warning };
                        }
                    } catch (criticError) {
                        console.warn(
                            "[ResearchManager] Critic verification failed:",
                            criticError instanceof Error ? criticError.message : criticError
                        );
                    }
                }

                // --- Step 5.6: LLM-picked source citations ---
                // Only evidence the synthesizer actually cited ([E#] refs in
                // the final report) becomes UI sources — the full evidence
                // list stays in the EvidencePanel. Regulation evidence
                // carries document urls so the UI can link to the source.
                if (!synthErrored && fullReport.trim()) {
                    try {
                        const { extractEvidenceIds, extractRegulationDocs, citationsFromDocs } =
                            await import("@/lib/utils/sources");
                        const citedIds = extractEvidenceIds(fullReport);
                        const citedDocs = citedIds.flatMap((id) => {
                            const item = this.evidenceStore.getById(id);
                            if (!item) return [];
                            return extractRegulationDocs(item.data);
                        });
                        const picked = citationsFromDocs(citedDocs);
                        if (picked.length > 0) {
                            yield { type: "citations", citations: picked };
                        }
                    } catch (citationError) {
                        console.warn(
                            "[ResearchManager] Source citation extraction failed:",
                            citationError instanceof Error ? citationError.message : citationError
                        );
                    }
                }
            }

            // --- Done ---
            yield {
                type: "done",
                result: {
                    researchType,
                    iterations: budget.iterationsCompleted,
                    tasksExecuted: budget.tasksExecuted,
                    evidenceCount: this.evidenceStore.size(),
                    confidence: confidence.overall,
                },
            };
            if (timedOut) {
                yield {
                    type: "error",
                    message: `Research reached the overall time limit (${Math.round(overallTimeoutMs() / 1000)}s) — synthesizing with the evidence gathered so far.`,
                };
            }
        } catch (error) {
            yield {
                type: "error",
                message: error instanceof Error ? error.message : "Research failed",
            };
        }
    }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a ResearchManager with models from the given provider.
 *
 * @param provider - LLM provider
 * @param apiKey - API key
 * @param model - User-selected model name
 * @param options - Research options
 * @param reasoning - Whether to use a reasoning-capable model for the responder
 */
export async function createResearchManager(
    provider: Provider,
    apiKey: string | undefined,
    model: string,
    options: ResearchOptions,
    reasoning: boolean = false
): Promise<ResearchManager> {
    // Independent model constructions (dynamic imports + client setup) —
    // run together instead of sequentially.
    const [plannerModel, responderModel] = await Promise.all([
        getPlannerModel(provider, apiKey),
        getResponderModel(provider, model, reasoning, apiKey),
    ]);

    return new ResearchManager(plannerModel, responderModel, options);
}
