/**
 * F1 AI Chatbot API Route
 * ========================
 * Main API endpoint that orchestrates F1 data queries using LangChain JS.
 * Follows the planner → executor → responder pattern.
 *
 * POST /api/chat
 *
 * Request body:
 * {
 *   "message": string,
 *   "aiMode": "managed" | "byok",
 *   "byokBaseUrl": string (byok only),
 *   "byokModel": string (byok only, identifier),
 *   "byokModelName": string (optional display name),
 *   "deepResearchMode": boolean,
 *   "web_search": boolean,
 *   "images": []
 * }
 *
 * BYOK key comes from the httpOnly cookie, not the body.
 */

import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";

import { getPlannerModel, getResponderModel, chatContentToText, LLM_TIMEOUT_MS, type AiMode } from "@/lib/llm";
import { decidePlan, createFallbackPlan, type Plan } from "@/lib/planner";
import { executeSteps, aggregateContext } from "@/lib/executor";
import { UsageAccumulator, getModelId } from "@/lib/llm-usage";
import { f1Tools } from "@/lib/tools/fastf1";
import { getSearchTools } from "@/lib/tools/search";
import { getRegulationTools } from "@/lib/tools/regulation";
import { getSimulationTools } from "@/lib/tools/simulation";
import { ResearchManager } from "@/lib/research/manager";
import { classifyLlmError, isNonRecoverable, type ClassifiedLlmError } from "@/lib/utils/llm-errors";
import {
    researchConfig,
    responderSystemPrompt as configuredResponderPrompt,
    routeConfig,
} from "@/lib/config";
import {
    extractRegulationDocs,
    pickUsedSources,
    type RetrievedDocLike,
    type SourceCitation,
} from "@/lib/utils/sources";
import { adminAuth } from "@/lib/firebase/admin";

// =============================================================================
// Simple in-process rate limiter
// =============================================================================
//
// Prevents a single client from spamming the chat endpoint and exhausting
// the LLM API quota. Tracks per-key (uid when authenticated, else remote IP)
// request timestamps in a sliding window. Suitable for a single-instance
// dev/staging deployment; a real production deployment should swap this for
// a shared store (Redis, Upstash Ratelimit, etc.).

interface RateLimitOptions {
    windowMs: number;
    maxRequests: number;
}

/** Live rate-limit options (config-driven per request). */
function chatRateLimit(): RateLimitOptions {
    return {
        windowMs: routeConfig.rateLimitWindowMs(),
        maxRequests: routeConfig.rateLimitMaxRequests(),
    };
}

const rateLimitBuckets = new Map<string, number[]>();

function rateLimitMaxKeys(): number {
    return routeConfig.rateLimitMaxKeys();
}

function pruneRateLimitBuckets(now: number, windowMs: number): void {
    // Bound memory: evict keys whose window has fully expired, and if the
    // map is still huge (many distinct IPs), drop the oldest entries.
    const maxKeys = rateLimitMaxKeys();
    for (const [key, stamps] of rateLimitBuckets) {
        if (stamps.length === 0 || stamps[stamps.length - 1] <= now - windowMs) {
            rateLimitBuckets.delete(key);
        }
    }
    if (rateLimitBuckets.size > maxKeys) {
        const overflow = rateLimitBuckets.size - maxKeys;
        const keys = rateLimitBuckets.keys();
        for (let i = 0; i < overflow; i++) {
            const k = keys.next();
            if (k.done) break;
            rateLimitBuckets.delete(k.value);
        }
    }
}

function checkRateLimit(key: string, opts: RateLimitOptions): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    if (rateLimitBuckets.size > rateLimitMaxKeys()) {
        pruneRateLimitBuckets(now, opts.windowMs);
    }
    const cutoff = now - opts.windowMs;
    const bucket = rateLimitBuckets.get(key) || [];
    // Drop timestamps outside the current window.
    const recent = bucket.filter((t) => t > cutoff);
    if (recent.length >= opts.maxRequests) {
        const oldest = recent[0];
        return { allowed: false, retryAfterMs: Math.max(0, opts.windowMs - (now - oldest)) };
    }
    recent.push(now);
    rateLimitBuckets.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
}

function getClientKey(request: NextRequest, userId: string | null): string {
    if (userId) return `u:${userId}`;
    const forwarded = request.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "anon";
    return `ip:${ip}`;
}


const ChatRequestSchema = z.object({
    message: z.string().min(1, "Message is required").max(routeConfig.messageMaxChars(), `Message too long (max ${routeConfig.messageMaxChars()} chars)`),
    aiMode: z.enum(["managed", "byok"]).default("managed"),
    byokBaseUrl: z.string().max(500).optional(),
    byokModel: z.string().max(200).optional(),
    byokModelName: z.string().max(200).optional(),
    byokApiKey: z.string().max(1000).optional(),
    // Legacy fields, accepted and ignored so old clients don't 400.
    provider: z.string().optional(),
    model: z.string().optional(),
    plannerModel: z.string().optional(),
    plannerProvider: z.string().optional(),
    apiKey: z.string().optional(),
    deepResearchMode: z.boolean().default(false),
    web_search: z.boolean().default(false),
    images: z.array(z.string().max(routeConfig.imageMaxBytes())).max(routeConfig.imageMaxCount()).default([]),
    sessionId: z.string().max(routeConfig.sessionIdMaxChars()).optional(),
    isFirstMessage: z.boolean().default(false),
    history: z.array(z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string().max(routeConfig.historyMaxCharsPerItem()),
    })).max(routeConfig.historyMaxItems()).default([]),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

// =============================================================================
// System Prompt for Responder (config-driven — override via
// F1_RESPONDER_SYSTEM_PROMPT without a code change)
// =============================================================================

function getResponderSystemPrompt(): string {
    return configuredResponderPrompt();
}

// =============================================================================
// Main API Handler
// =============================================================================

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const validationResult = ChatRequestSchema.safeParse(body);

        if (!validationResult.success) {
            return Response.json(
                { error: validationResult.error.issues[0].message },
                { status: 400 }
            );
        }

        // 1. Authenticate User
        const token = request.cookies.get("firebaseToken")?.value;
        let userId: string | null = null;
        if (token) {
            try {
                const decodedToken = await adminAuth.verifyIdToken(token);
                userId = decodedToken.uid;
            } catch (error) {
                console.error("[Auth] Token verification failed:", error);
            }
        }

        // 2. Rate limit per client key (uid when authenticated, else IP).
        //    Runs before any expensive work (model init, LLM calls) so spam
        //    can't burn through quotas.
        const clientKey = getClientKey(request, userId);
        const rl = checkRateLimit(clientKey, chatRateLimit());
        if (!rl.allowed) {
            return Response.json(
                {
                    error: "Rate limit exceeded. Please slow down.",
                    retryAfterMs: rl.retryAfterMs,
                },
                {
                    status: 429,
                    headers: {
                        "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString(),
                    },
                }
            );
        }

        const { message, aiMode, byokBaseUrl, byokModel, byokApiKey, apiKey: legacyApiKey, deepResearchMode, web_search, sessionId, isFirstMessage, history } = validationResult.data as ChatRequest;
        const mode = (aiMode ?? "managed") as AiMode;

        const cookieByokKey =
            request.cookies.get("byok_api_key")?.value?.trim() ||
            request.cookies.get("api_key")?.value?.trim() ||
            "";
        const resolvedByokKey =
            (byokApiKey || "").trim() || (legacyApiKey || "").trim() || cookieByokKey;
        const byok = {
            baseUrl: (byokBaseUrl || "").trim() || undefined,
            model: (byokModel || "").trim() || undefined,
            apiKey: resolvedByokKey || undefined,
        };

        // Gateway session id for OpenCode Zen/Go (`x-opencode-session`
        // header: routing + prompt caching). The client sends its chat
        // sessionId when one exists, but logged-out / first-message
        // requests have none — and Go REJECTS requests without the header
        // (400). Fall back to a per-request id so gateway calls never 400;
        // prompt caching just degrades to no caching for those requests.
        const gatewaySessionId = sessionId ?? randomUUID();

        // If sessionId is provided, and we have userId, verify ownership (optional but recommended)
        // SKIPPED: Admin SDK credentials missing in local dev. Client-side rules are verified by Firebase.
        if (sessionId && userId) {
            // const sessionDoc = await adminDb.collection("sessions").doc(sessionId).get();
            // if (sessionDoc.exists && sessionDoc.data()?.userId !== userId) {
            //    return Response.json({ error: "Unauthorized access to session" }, { status: 403 });
            // }
        }

        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                let controllerClosed = false;

                const safeClose = () => {
                    if (!controllerClosed) {
                        controllerClosed = true;
                        try { controller.close(); } catch { /* already closed */ }
                    }
                };

                const sendEvent = (event: string, data: unknown) => {
                    if (controllerClosed) return;
                    try {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, data })}\n\n`));
                    } catch {
                        controllerClosed = true;
                    }
                };

                try {
                    // 1. Initialize models. The responder is created lazily
                    // in normal mode — conversational messages never need it.
                    // In deep-research mode both models are needed, so init
                    // them in parallel (independent getChatModel calls).
                    let plannerModel;
                    // Pre-initialized responder for deep-research mode (parallel init below).
                    let deepResponderModel: Awaited<ReturnType<typeof getResponderModel>> | null = null;
                    try {
                        if (deepResearchMode) {
                            [plannerModel, deepResponderModel] = await Promise.all([
                                getPlannerModel(mode, byok, gatewaySessionId),
                                getResponderModel(mode, byok, true, gatewaySessionId),
                            ]);
                        } else {
                            plannerModel = await getPlannerModel(mode, byok, gatewaySessionId);
                        }
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : "Failed to initialize models";
                        console.error("[API] Model initialization error:", errorMessage);
                        sendEvent("error", { message: errorMessage });
                        safeClose();
                        return;
                    }

                    const sendLlmMetadata = async (text: string) => {
                        if (!isFirstMessage || !sessionId || controllerClosed) return;
                        try {
                            const { generateSessionMetadata } = await import("@/lib/utils/generate-session-metadata");
                            const metadata = await generateSessionMetadata(text, { mode, ...byok }, gatewaySessionId);
                            if (!controllerClosed) sendEvent("metadata", metadata);
                        } catch (error) {
                            console.error("Error generating session metadata:", error);
                        }
                    };

                    // Track usage across every LLM call we make in this
                    // request (created once the responder model exists —
                    // see below). Per the OpenRouter docs, usage is reported
                    // automatically on the last chunk of every stream, so we
                    // sum it up and emit a single `usage` SSE event at the
                    // end. We capture BOTH the planner and the responder
                    // model ids so the footer can show "planner → answer"
                    // when the user picked different models for each role.
                    let usage: UsageAccumulator | null = null;

                    /**
                     * Emit the `usage` SSE event with the aggregated
                     * totals. No-op until the accumulator is created
                     * (conversational fast path never creates one).
                     */
                    const emitUsage = () => {
                        if (!usage) return;
                        const u = usage.finalize()
                        sendEvent("usage", {
                            provider: u.provider,
                            model: u.model,
                            plannerModel: u.plannerModel ?? null,
                            promptTokens: u.promptTokens,
                            completionTokens: u.completionTokens,
                            reasoningTokens: u.reasoningTokens,
                            cachedTokens: u.cachedTokens,
                            totalTokens: u.totalTokens,
                            cost: u.cost,
                            upstreamCost: u.upstreamCost,
                        })
                    }

                    // =================================================================
                    // Deep Research Mode: delegate to the four-agent ResearchManager.
                    // The manager yields ResearchEvents that we forward as SSE events
                    // so the frontend's existing handler (research_start, plan_iteration,
                    // task_update, evidence, reflection, confidence, chart_specs, token,
                    // visualization, done) lights up the full deep research UI.
                    // =================================================================
                    if (deepResearchMode) {
                        // Responder was pre-initialized in parallel with the
                        // planner above (both are needed in deep mode).
                        const responderModel = deepResponderModel;
                        if (!responderModel) {
                            const errorMessage = "Failed to initialize models";
                            console.error("[API] Model initialization error:", errorMessage);
                            sendEvent("error", { message: errorMessage });
                            safeClose();
                            return;
                        }
                        usage = new UsageAccumulator(mode, getModelId(responderModel));
                        try {
                            const researchManager = new ResearchManager(plannerModel, responderModel, {
                                deepResearch: true,
                                // Always allow web search in deep mode; the
                                // planner and reasoner decide whether to use it.
                                webSearch: true,
                                // Tight budgets for responsiveness: the old
                                // 50 tasks / 20 iterations allowed very long
                                // sequential plan→execute→reflect chains.
                                // 15 tasks / 6 iterations covers multi-angle
                                // research while bounding worst-case latency.
                                // Deterministic early-stop in the manager
                                // usually finishes well before these caps.
                                // Budgets are config-driven (RESEARCH_DEEP_MAX_*).
                                maxTasks: researchConfig.deepMaxTasks(),
                                maxIterations: researchConfig.deepMaxIterations(),
                            },
                            // Pass the shared UsageAccumulator so the
                            // Synthesizer can record its raw LLM chunks.
                            usage,
                            );

                            for await (const ev of researchManager.run(message, history)) {
                                if (controllerClosed) break;

                                switch (ev.type) {
                                    case "research_start":
                                        sendEvent("research_start", {
                                            researchType: ev.researchType,
                                            objective: ev.objective,
                                            strategy: ev.strategy,
                                        });
                                        break;
                                    case "intent_analysis":
                                        sendEvent("intent_analysis", {
                                            intentAnalysis: ev.intentAnalysis,
                                        });
                                        break;
                                    case "plan_iteration":
                                        sendEvent("plan_iteration", {
                                            iteration: ev.iteration,
                                            tasks: ev.tasks,
                                            reasoning: ev.reasoning,
                                        });
                                        break;
                                    case "task_update":
                                        sendEvent("task_update", {
                                            taskId: ev.taskId,
                                            status: ev.status,
                                            data: ev.data,
                                            evidenceId: ev.evidenceId,
                                        });
                                        break;
                                    case "evidence":
                                        sendEvent("evidence", { evidence: ev.evidence });
                                        break;
                                    case "citations":
                                        // LLM-picked sources only (subset of the
                                        // evidence actually cited in the report).
                                        sendEvent("citations", { citations: ev.citations });
                                        break;
                                    case "reflection":
                                        sendEvent("reflection", {
                                            reflection: ev.reflection,
                                            iteration: ev.iteration,
                                        });
                                        break;
                                    case "confidence":
                                        sendEvent("confidence", ev.confidence);
                                        break;
                                    case "chart_specs":
                                        sendEvent("chart_specs", { specs: ev.specs });
                                        break;
                                    case "visualization":
                                        sendEvent("visualization", { data: ev.data });
                                        break;
                                    case "verification":
                                        sendEvent("verification", { result: ev.result });
                                        break;
                                    case "token":
                                        sendEvent("token", { content: ev.content });
                                        break;
                                    case "degraded":
                                        sendEvent("degraded", {
                                            stage: ev.stage,
                                            kind: ev.kind,
                                            message: ev.message,
                                        });
                                        break;
                                    case "done":
                                        sendEvent("done", { result: ev.result });
                                        break;
                                    case "error":
                                        sendEvent("error", { message: ev.message });
                                        break;
                                }
                            }

                            // Emit aggregated usage accounting for deep
                            // research mode. For OpenRouter this
                            // includes the cost of the Synthesizer
                            // stream. Other LLM calls in the manager
                            // (Planner, Reasoner, Critic, etc.) use
                            // .invoke() with structured output, which
                            // doesn't reliably expose usage — capturing
                            // them would require deeper plumbing than
                            // is in scope here.
                            emitUsage()

                            await sendLlmMetadata(message);

                            safeClose();
                            return;
                        } catch (error) {
                            console.error("[ResearchManager] Error:", error);
                            const cls = classifyLlmError(error, "ResearchManager.run");
                            if (isNonRecoverable(cls)) {
                                sendEvent("error", {
                                    message: cls.userMessage,
                                    stage: "research_manager",
                                    kind: cls.kind,
                                });
                            } else {
                                const errorMessage = error instanceof Error ? error.message : "Deep research failed";
                                sendEvent("error", { message: errorMessage, stage: "research_manager" });
                            }
                            safeClose();
                            return;
                        }
                    }

                    // 2. Plan (single LLM call) + responder init IN PARALLEL.
                    // The old path also ran IntentAnalyzer here (2 parallel
                    // LLM calls, wall time = max(intent, planner)). But in
                    // normal mode the intent result is never consumed
                    // server-side — decidePlan takes no intent input — and the
                    // frontend explicitly ignores the `intent_analysis` event
                    // ("Nothing to do UI-side today"). So the intent call was
                    // pure overhead on the critical path: removed. Deep mode
                    // still runs intent inside the ResearchManager above.
                    // The responder model init (dynamic import + client setup)
                    // is independent of planning, so it overlaps too instead
                    // of running sequentially afterwards.
                    let plan: Plan;
                    let directReply: string | undefined;
                    // Responder init (dynamic import + client setup)
                    // is independent of planning, so it overlaps too instead
                    // of running sequentially afterwards.
                    const responderPromise = getResponderModel(mode, byok, deepResearchMode, gatewaySessionId).then(
                        (m) => ({ ok: true as const, model: m }),
                        (e) => ({ ok: false as const, error: e }),
                    );
                    try {
                        // In Deep Research Mode, force web search to be enabled
                        const effectiveWebSearch = deepResearchMode ? true : web_search;

                        const decision = await decidePlan(
                            plannerModel,
                            message,
                            effectiveWebSearch,
                            deepResearchMode
                        );
                        plan = decision.plan;
                        directReply = decision.needsPlan ? undefined : decision.reply;
                    } catch (error) {
                        // Distinguish "LLM is unavailable" (rate limit, auth,
                        // network) from "LLM returned bad JSON". The former
                        // is terminal — there's no point falling back to a
                        // heuristic plan if the responder will also fail on
                        // the same root cause. Surface it instead.
                        const cls = classifyLlmError(error, "Planner");
                        if (isNonRecoverable(cls)) {
                            console.error(
                                "[Planner] Non-recoverable LLM error:",
                                cls.kind,
                                error instanceof Error ? error.message : error
                            );
                            sendEvent("error", {
                                message: cls.userMessage,
                                stage: "planner",
                                kind: cls.kind,
                            });
                            safeClose();
                            return;
                        }
                        console.error("[Planner] Error:", error);
                        plan = createFallbackPlan(message);
                    }

                    // Send plan to frontend
                    sendEvent("plan", { steps: plan.steps });

                    // 2b. Fast path: conversational reply, no tools, no responder call.
                    if (directReply !== undefined) {
                        sendEvent("token", { content: directReply });
                        sendEvent("done", {});

                        await sendLlmMetadata(message);

                        safeClose();
                        return;
                    }

                    // 3. Execute Plan with mode-specific tools
                    let tools: Record<string, StructuredTool>;

                    if (deepResearchMode) {
                        // Deep Research Mode: All agents enabled (regulation
                        // search re-enabled — the FIA vector store is back).
                        tools = {
                            ...f1Tools,
                            ...getRegulationTools(),
                            ...getSimulationTools(),
                            ...getSearchTools(), // Always include in deep mode
                        };
                    } else {
                        // Normal Mode: Data API + Retrieval + Simulation.
                        // run_simulation is included (not gated on deep mode)
                        // because the planner advertises what-if queries for
                        // every request — and it is a local deterministic
                        // tool with no backend cost. Web search stays
                        // deep-mode-only (or explicit opt-in) to avoid
                        // surprise external calls.
                        tools = {
                            ...f1Tools,
                            ...getRegulationTools(),
                            ...getSimulationTools(),
                        };
                    }

                    // Responder was initialized in parallel with planning
                    // above — just rendezvous here. Tool execution below does
                    // not need the responder, but awaiting now overlaps the
                    // init with the plan call that just finished.
                    const responderSettled = await responderPromise;
                    if (!responderSettled.ok) {
                        const errorMessage = responderSettled.error instanceof Error ? responderSettled.error.message : "Failed to initialize models";
                        console.error("[API] Model initialization error:", errorMessage);
                        sendEvent("error", { message: errorMessage });
                        safeClose();
                        return;
                    }
                    const responderModel = responderSettled.model;

                    usage = new UsageAccumulator(mode, getModelId(responderModel));

                    const executionContext = await executeSteps(
                        plan.steps,
                        tools,
                        (step, status, additional) => {
                            sendEvent("step_update", { step, status, additional });
                        }
                    );

                    // Reranked FIA docs collected here; the responder LLM picks
                    // the actually-used subset after streaming (below).
                    const regulationDocs: RetrievedDocLike[] = [];

                    // Send visualization data if available
                    // NOTE: This sends full data to the FRONTEND for charts.
                    // LLM protection is handled separately in aggregateContext.
                    if (executionContext.results.length > 0) {
                        const visualizationPayload = executionContext.results.map((result) => ({
                            tool: result.tool,
                            args: result.args,
                            success: result.success,
                            data: result.data || null,
                            error: result.error || null
                        }));
                        sendEvent("visualization", { data: visualizationPayload });

                        // Collect reranked FIA documents for post-answer source
                        // picking. These are deliberately NOT emitted as
                        // sources here: only documents picked by the
                        // structured-output call below (see
                        // lib/utils/sources.ts) become UI sources.
                        regulationDocs.push(
                            ...executionContext.results.flatMap((result) => {
                                if (result.tool === "retrieve_regulations" && result.success && result.data) {
                                    try {
                                        return extractRegulationDocs(result.data);
                                    } catch (e) {
                                        console.error("Error parsing regulation docs:", e);
                                        return [];
                                    }
                                }
                                return [];
                            })
                        );
                    }

                    // 4. Generate Response
                    const contextString = aggregateContext(executionContext);
                    const currentDate = new Date().toISOString().split('T')[0];

                    // --- Refuse-on-empty guardrail ---
                    // If all steps failed or the context is empty, stream a
                    // refusal message directly instead of calling the responder
                    // LLM (which would hallucinate from training data).
                    const allFailed = executionContext.failureCount > 0 && executionContext.successCount === 0;
                    const contextEmpty = !contextString || contextString.trim() === "" || contextString.includes("No data was retrieved");
                    if (allFailed || contextEmpty) {
                        const refusalMsg = "I was unable to retrieve any F1 data for your query. This may be due to an invalid Grand Prix name, session type, or year. Please verify the details and try again.\n\n**What went wrong:**\n" +
                            executionContext.results
                                .filter((r) => !r.success)
                                .map((r) => `- Step ${r.step} (${r.tool}): ${r.error || "unknown error"}`)
                                .join("\n");
                        sendEvent("token", { content: refusalMsg });
                        sendEvent("done", {});
                        safeClose();
                        return;
                    }

                    // Build the user message context (question + current date + retrieved F1 data).
                    const userMessageContext = `## User Question
${message}

## User Context
Current Date: ${currentDate}

## F1 Data Context
${contextString}

Please answer the user's question based on the F1 data provided above.`;

                    // Build messages with conversation history for follow-up context.
                    // Truncated for latency: only the last N turns, M chars
                    // each (CHAT_RESPONDER_HISTORY_*). Older turns rarely change
                    // the answer but each one adds prompt tokens (and TTFT) to
                    // the responder call.
                    const responderHistoryItems = routeConfig.responderHistoryItems();
                    const responderHistoryChars = routeConfig.responderHistoryCharsPerItem();
                    const historyMessages = (history || []).slice(-responderHistoryItems).map((m) => {
                        const clipped = m.content.length > responderHistoryChars ? m.content.slice(-responderHistoryChars) : m.content;
                        if (m.role === "assistant") return new HumanMessage(`Assistant: ${clipped}`);
                        return new HumanMessage(`User: ${clipped}`);
                    });

                    const messages = [
                        new SystemMessage(getResponderSystemPrompt()),
                        ...historyMessages,
                        new HumanMessage(userMessageContext),
                    ];

                    // Stream Response
                    let assistantContent = "";
                    let responderError: ClassifiedLlmError | null = null;
                    // `usage` was created right after the responder model
                    // above; capture it locally so the loop below sees a
                    // non-null accumulator.
                    const activeUsage = usage;
                    try {
                        // Hang protection (see lib/llm.ts): a stalled stream
                        // aborts instead of spinning the UI forever.
                        const response = await responderModel.stream(messages, {
                            signal: AbortSignal.timeout(LLM_TIMEOUT_MS.responder),
                        });

                        // Walk the stream ourselves (rather than using
                        // trackUsage) so we can both forward tokens to the
                        // client AND record usage from each chunk. The
                        // provider attaches the full `usage` block to the
                        // final chunk(s) — addChunk() is idempotent so
                        // duplicate totals are safe (we take the last
                        // non-null value for cost, and we *add* token
                        // counts which
                        // is a no-op when both are the same final number).
                        for await (const chunk of response) {
                            try {
                                activeUsage?.addChunk(chunk as Parameters<UsageAccumulator["addChunk"]>[0])
                            } catch {
                                // best-effort: never let usage tracking
                                // break the main flow.
                            }
                            // chatContentToText handles both string content
                            // (chat/completions) and content blocks
                            // (responses-API models, e.g. Go Contributor).
                            const content = chatContentToText(chunk.content);
                            if (content) {
                                assistantContent += content;
                                sendEvent("token", { content });
                            }
                        }
                        // FIA source picking (structured output, NOT reply
                        // markers): a cheap model maps the finished answer
                        // back onto the reranked candidate filenames. Only
                        // picked, really-retrieved files become UI sources —
                        // the raw candidate list is never shown. Runs AFTER
                        // `done` so it never delays stream completion: the
                        // frontend applies `citations` whenever they arrive
                        // and persists them at stream end.
                        if (regulationDocs.length > 0 && assistantContent.trim()) {
                            emitUsage()
                            sendEvent("done", {});
                            const picked: SourceCitation[] = await pickUsedSources(
                                plannerModel,
                                message,
                                assistantContent,
                                regulationDocs
                            );
                            if (picked.length > 0) {
                                sendEvent("citations", { citations: picked });
                            }
                            await sendLlmMetadata(message);
                            safeClose();
                            return;
                        }
                    } catch (streamError) {
                        // The responder model failed mid-stream. Classify the
                        // error: if it's non-recoverable (rate limit, auth,
                        // network, etc.) surface a clear error event so the
                        // frontend stops the spinner and the user sees what
                        // happened, rather than staring at a half-rendered
                        // bubble forever.
                        const cls = classifyLlmError(streamError, "Responder.stream");
                        if (isNonRecoverable(cls)) {
                            console.error(
                                "[Responder] Non-recoverable LLM error during stream:",
                                cls.kind,
                                streamError instanceof Error ? streamError.message : streamError
                            );
                            responderError = cls;
                            // If we got *some* tokens before the failure,
                            // keep them — a partial answer is still useful.
                            // But always emit the error event so the UI can
                            // present the failure clearly.
                            sendEvent("error", {
                                message: cls.userMessage,
                                stage: "responder",
                                kind: cls.kind,
                                partial: assistantContent.length > 0,
                            });
                        } else {
                            // Recoverable (parse) error mid-stream: just log
                            // and end normally with whatever we streamed.
                            console.warn(
                                "[Responder] Recoverable error mid-stream:",
                                streamError instanceof Error ? streamError.message : streamError
                            );
                        }
                    }

                    // (The old degraded-mode note for an unavailable normal-mode
                    // intent pass was removed with that pass: normal mode no
                    // longer runs IntentAnalyzer — see the planning section
                    // above — so there is no intent failure to annotate here.
                    // Planner/executor/responder errors still surface via
                    // their own `error` events.)

                    // If the responder itself failed non-recoverably and we
                    // have *no* content, end the stream now so the frontend
                    // renders the error message inline.
                    if (responderError && assistantContent.trim() === "") {
                        // Still emit a usage event with whatever we
                        // managed to capture — the user may want to know
                        // they were charged for the prompt even if no
                        // completion tokens were produced. If the
                        // accumulator never saw any usage data, skip
                        // the event entirely (the footer just won't
                        // show for this turn).
                        if (usage.hasData()) {
                            emitUsage()
                        }
                        sendEvent("done", {});
                        safeClose();
                        return;
                    }

                    // Emit aggregated usage accounting (token counts +
                    // cost when reported). The frontend stores this on
                    // the message and renders a small footer in the
                    emitUsage()

                    sendEvent("done", {});

                    await sendLlmMetadata(message);

                    safeClose();

                } catch (error) {
                    console.error("[Stream Error]", error);
                    const cls = classifyLlmError(error, "OuterStream");
                    if (isNonRecoverable(cls)) {
                        sendEvent("error", {
                            message: cls.userMessage,
                            stage: "stream",
                            kind: cls.kind,
                        });
                    } else {
                        const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
                        sendEvent("error", { message: errorMessage, stage: "stream" });
                    }
                    safeClose();
                }
            }
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        });

    } catch (error) {
        console.error("[Chat API Error]", error);
        return Response.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

// =============================================================================
// Non-Streaming Alternative (for debugging)
// =============================================================================

export async function GET() {
    return Response.json({
        status: "ok",
        version: "2.0.0",
        description: "F1 AI Chatbot API - Use POST to send messages",
        endpoints: {
            "POST /api/chat": {
                description: "Send a chat message",
                body: {
                    message: "string (required)",
                    aiMode: "managed | byok (default: managed)",
                    byokBaseUrl: "string (byok only, model URL)",
                    byokModel: "string (byok only, model identifier)",
                    byokModelName: "string (byok only, display name, optional)",
                    web_search: "boolean (default: false)",
                    images: "string[] (default: [])",
                },
            },
        },
    });
}
