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
 *   "provider": "gemini" | "openrouter" | "huggingface",
 *   "model": string,
 *   "reasoning": boolean,
 *   "web_search": boolean,
 *   "images": []
 * }
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { getPlannerModel, getResponderModel, Provider } from "@/lib/llm";
import { planQuery, streamPlanQuery, createFallbackPlan, Plan } from "@/lib/planner";
import { executeSteps, aggregateContext, simplifyContext } from "@/lib/executor";
import { f1Tools } from "@/lib/tools/fastf1";
import { getSearchTools } from "@/lib/tools/search";
import { getVisualizationTools } from "@/lib/tools/visualization";

// =============================================================================
// Request Validation
// =============================================================================

const ChatRequestSchema = z.object({
    message: z.string().min(1, "Message is required"),
    provider: z.enum(["gemini", "openrouter", "huggingface"]).default("gemini"),
    model: z.string().default("gemini-2.0-flash"),
    apiKey: z.string().optional(),
    reasoning: z.boolean().default(false),
    web_search: z.boolean().default(false),
    images: z.array(z.string()).default([]),
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
// Streaming Helpers
// =============================================================================

/**
 * Create a streaming response from LLM output
 */
async function createStreamingResponse(
    model: ReturnType<typeof getResponderModel> extends Promise<infer T> ? T : never,
    messages: (SystemMessage | HumanMessage)[]
): Promise<Response> {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            try {
                // Use streaming if available
                const response = await model.stream(messages);

                for await (const chunk of response) {
                    const content =
                        typeof chunk.content === "string"
                            ? chunk.content
                            : JSON.stringify(chunk.content);

                    if (content) {
                        // Send as SSE data
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
                    }
                }

                // Send done signal
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : "Streaming failed";
                controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
                );
                controller.close();
            }
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
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

        const { message, provider, model, apiKey, reasoning, web_search } = validationResult.data as ChatRequest;
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
            async start(controller) {
                const sendEvent = (event: string, data: any) => {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event, data })}\n\n`));
                };

                try {
                    // 1. Initialize Models
                    let plannerModel, responderModel;
                    try {
                        plannerModel = await getPlannerModel(provider as Provider, apiKey);
                        responderModel = await getResponderModel(provider as Provider, model, reasoning, apiKey);
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : "Failed to initialize models";
                        console.error("[API] Model initialization error:", errorMessage);
                        sendEvent("error", { message: errorMessage });
                        controller.close();
                        return;
                    }

                    // 2. Plan Query with Streaming Reasoning
                    let plan: Plan;
                    try {
                        plan = await streamPlanQuery(
                            plannerModel,
                            message,
                            web_search,
                            reasoning,
                            (token) => {
                                // Stream reasoning tokens to frontend
                                sendEvent("reasoning", { token });
                            }
                        );
                    } catch (error) {
                        console.error("[Planner] Error:", error);
                        plan = createFallbackPlan(message);
                    }

                    // Send plan to frontend
                    sendEvent("plan", { steps: plan.steps });

                    // 3. Execute Plan
                    const tools = {
                        ...f1Tools,
                        ...(web_search ? getSearchTools() : {}),
                    };

                    const executionContext = await executeSteps(
                        plan.steps,
                        tools,
                        (step, status, additional) => {
                            sendEvent("step_update", { step, status, additional });
                        }
                    );

                    // Send visualization data if available
                    if (executionContext.results.length > 0) {
                        const visualizationPayload = executionContext.results.map((result) => ({
                            tool: result.tool,
                            args: result.args,
                            success: result.success,
                            data: result.data || null,
                            error: result.error || null
                        }));
                        sendEvent("visualization", { data: visualizationPayload });
                    }

                    // 4. Generate Response
                    const contextString = aggregateContext(executionContext);
                    const simplifiedData = simplifyContext(executionContext);
                    const currentDate = new Date().toISOString().split('T')[0];

                    const userMessage = `## User Question
${message}

## User Context
Current Date: ${currentDate}

## F1 Data Context
${contextString}

## Simplified Data
\`\`\`json
${JSON.stringify(simplifiedData, null, 2)}
\`\`\`

Please answer the user's question based on the F1 data provided above.`;

                    const messages = [
                        new SystemMessage(RESPONDER_SYSTEM_PROMPT),
                        new HumanMessage(userMessage),
                    ];

                    // Stream Response
                    const response = await responderModel.stream(messages);

                    for await (const chunk of response) {
                        const content = typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
                        if (content) {
                            sendEvent("token", { content });
                        }
                    }

                    sendEvent("done", {});
                    controller.close();

                } catch (error) {
                    console.error("[Stream Error]", error);
                    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
                    sendEvent("error", { message: errorMessage });
                    controller.close();
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
                    provider: "gemini | openrouter | huggingface (default: gemini)",
                    model: "string (default: gemini-2.0-flash)",
                    reasoning: "boolean (default: false)",
                    web_search: "boolean (default: false)",
                    images: "string[] (default: [])",
                },
            },
        },
    });
}
