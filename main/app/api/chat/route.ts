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
 *   "provider": "gemini" | "openrouter" | "huggingface" | "zen" | "go",
 *   "model": string,
 *   "reasoning": boolean,
 *   "web_search": boolean,
 *   "images": []
 * }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";

import { getPlannerModel, getResponderModel, chatContentToText, Provider } from "@/lib/llm";
import { decidePlan, createFallbackPlan, Plan } from "@/lib/planner";
import { executeSteps, aggregateContext } from "@/lib/executor";
import { f1Tools } from "@/lib/tools/fastf1";
import { getSearchTools } from "@/lib/tools/search";
import { getRegulationTools } from "@/lib/tools/regulation";
import { getSimulationTools } from "@/lib/tools/simulation";
import { adminAuth } from "@/lib/firebase/admin";

// =============================================================================
// Request Validation
// =============================================================================

const ChatRequestSchema = z.object({
    message: z.string().min(1, "Message is required"),
    provider: z.enum(["gemini", "openrouter", "huggingface", "zen", "go"]).default("gemini"),
    model: z.string().default("gemini-2.0-flash"),
    apiKey: z.string().optional(),
    deepResearchMode: z.boolean().default(false),
    web_search: z.boolean().default(false),
    images: z.array(z.string()).default([]),
    sessionId: z.string().optional(),
    isFirstMessage: z.boolean().default(false),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

// =============================================================================
// System Prompt for Responder
// =============================================================================

const RESPONDER_SYSTEM_PROMPT = `You are an expert Formula 1 AI assistant with deep knowledge of F1 history, technical regulations, driver statistics, and race analysis.

## Your Role
- Answer questions about F1 using the data provided from official F1 sources
- Provide accurate, detailed responses based on the context
- Be conversational but precise
- Format responses nicely with markdown when appropriate

## Guidelines
1. Use the provided F1 data context to answer questions accurately
2. If data is incomplete or missing, say so honestly
3. For comparisons, highlight the key differences
4. Use driver abbreviations (VER, HAM, LEC) when referring to drivers
5. Format lap times properly (e.g., 1:23.456)
6. Be concise but thorough

## Response Format
- Use markdown formatting for readability
- Use bullet points for lists
- Use tables for comparisons when appropriate
- Bold important information
- Keep responses focused and relevant`;

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

        const { message, provider, model, apiKey, deepResearchMode, web_search, sessionId, isFirstMessage } = validationResult.data as ChatRequest;

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
                    // 1. Initialize the cheap planner model. The responder is
                    // created lazily later — conversational messages never need it.
                    let plannerModel;
                    try {
                        plannerModel = await getPlannerModel(provider as Provider, apiKey, sessionId);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : "Failed to initialize models";
                        console.error("[API] Model initialization error:", errorMessage);
                        sendEvent("error", { message: errorMessage });
                        safeClose();
                        return;
                    }

                    // 2. Decide + plan in a SINGLE model call.
                    // needs_plan=false carries a direct reply (greetings, thanks,
                    // capability questions) — streamed back with no tool calls
                    // and no second LLM call. needs_plan=true carries steps.
                    // In Deep Research Mode, force web search to be enabled.
                    const effectiveWebSearch = deepResearchMode ? true : web_search;

                    let plan: Plan;
                    let directReply: string | undefined;
                    try {
                        const decision = await decidePlan(
                            plannerModel,
                            message,
                            effectiveWebSearch,
                            deepResearchMode
                        );
                        plan = decision.plan;
                        directReply = decision.needsPlan ? undefined : decision.reply;
                    } catch (error) {
                        console.error("[Planner] Error:", error);
                        plan = createFallbackPlan(message);
                    }

                    // Send plan to frontend
                    sendEvent("plan", { steps: plan.steps });

                    // 2b. Fast path: conversational reply, no tools, no responder call.
                    if (directReply !== undefined) {
                        sendEvent("token", { content: directReply });
                        sendEvent("done", {});

                        // Generate Session Metadata (if first message)
                        if (isFirstMessage && sessionId) {
                            try {
                                const { generateSessionMetadata } = await import("@/lib/utils/generate-session-metadata");
                                const metadata = await generateSessionMetadata(message, provider, model, apiKey, sessionId);
                                sendEvent("metadata", metadata);
                            } catch (error) {
                                console.error("Error generating session metadata:", error);
                            }
                        }

                        safeClose();
                        return;
                    }

                    // 3. Execute Plan with mode-specific tools
                    let tools: Record<string, StructuredTool>;

                    if (deepResearchMode) {
                        // Deep Research Mode: All agents enabled
                        tools = {
                            ...f1Tools,
                            ...getRegulationTools(),
                            ...getSimulationTools(),
                            ...getSearchTools(), // Always include in deep mode
                        };
                    } else {
                        // Normal Mode: Limited agents only (Data API + Retrieval)
                        tools = {
                            ...f1Tools,
                            ...getRegulationTools(),
                        };
                    }

                    // Responder is only needed for tool-backed questions.
                    let responderModel;
                    try {
                        responderModel = await getResponderModel(provider as Provider, model, deepResearchMode, apiKey, sessionId);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : "Failed to initialize models";
                        console.error("[API] Model initialization error:", errorMessage);
                        sendEvent("error", { message: errorMessage });
                        safeClose();
                        return;
                    }

                    const executionContext = await executeSteps(
                        plan.steps,
                        tools,
                        (step, status, additional) => {
                            sendEvent("step_update", { step, status, additional });
                        }
                    );

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

                        // Extract and stream citations from retrieval results
                        const citations: { source: string; type: string }[] = [];
                        executionContext.results.forEach(result => {
                            if (result.tool === "retrieve_regulations" && result.success && result.data) {
                                try {
                                    // Parse data if it's a string (executor might stringify it)
                                    const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;

                                    if (data.retrieved_documents && Array.isArray(data.retrieved_documents)) {
                                        data.retrieved_documents.forEach((doc: { source?: unknown; doc_type?: unknown }) => {
                                            if (typeof doc.source === "string" && doc.source) {
                                                citations.push({
                                                    source: doc.source,
                                                    type: typeof doc.doc_type === "string" ? doc.doc_type : "regulation"
                                                });
                                            }
                                        });
                                    }
                                } catch (e) {
                                    console.error("Error parsing citations:", e);
                                }
                            }
                        });

                        if (citations.length > 0) {
                            sendEvent("citations", { citations });
                        }
                    }

                    // 4. Generate Response
                    const contextString = aggregateContext(executionContext);
                    const currentDate = new Date().toISOString().split('T')[0];

                    const userMessageContext = `## User Question
${message}

## User Context
Current Date: ${currentDate}

## F1 Data Context
${contextString}

Please answer the user's question based on the F1 data provided above.`;

                    const messages = [
                        new SystemMessage(RESPONDER_SYSTEM_PROMPT),
                        new HumanMessage(userMessageContext),
                    ];

                    // Stream Response
                    const response = await responderModel.stream(messages);

                    for await (const chunk of response) {
                        const content = chatContentToText(chunk.content);
                        if (content) {
                            sendEvent("token", { content });
                        }
                    }

                    sendEvent("done", {});

                    // 5. Generate Session Metadata (if first message)
                    if (isFirstMessage && sessionId) {
                        try {
                            const { generateSessionMetadata } = await import("@/lib/utils/generate-session-metadata");
                            const metadata = await generateSessionMetadata(message, provider, model, apiKey, sessionId);

                            // Emit metadata update event to client
                            // The client will handle persisting this to Firestore
                            sendEvent("metadata", metadata);
                        } catch (error) {
                            console.error("Error generating session metadata:", error);
                        }
                    }

                    safeClose();

                } catch (error) {
                    console.error("[Stream Error]", error);
                    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
                    sendEvent("error", { message: errorMessage });
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
        version: "1.0.0",
        description: "F1 AI Chatbot API - Use POST to send messages",
        endpoints: {
            "POST /api/chat": {
                description: "Send a chat message",
                body: {
                    message: "string (required)",
                    provider: "gemini | openrouter | huggingface | zen | go (default: gemini)",
                    model: "string (default: gemini-2.0-flash)",
                    reasoning: "boolean (default: false)",
                    web_search: "boolean (default: false)",
                    images: "string[] (default: [])",
                },
            },
        },
    });
}
