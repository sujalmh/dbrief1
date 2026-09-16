"use client"

import * as React from "react"
import { useChatStore, type Message, type ResearchIteration } from "@/lib/store"
import { useAuth } from "@/lib/firebase/auth-context"
import { createSession } from "@/lib/firebase/firestore"
import { sanitizeCitations } from "@/lib/utils"

/** Minimal shape of SSE payload steps/tasks — fields are unknown until validated. */
interface SsePlanStep {
    description?: unknown;
    tool?: unknown;
}
interface SseTask {
    id: string;
    description: string;
    tool: string;
}

export function useChatHandler() {
    const store = useChatStore()
    const { user } = useAuth()
    const abortControllerRef = React.useRef<AbortController | null>(null)

    React.useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
            }
        }
    }, [])
    const cancelGeneration = React.useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
            store.setLoading(false)
        }
    }, [store])

    const handleSend = React.useCallback(async (overrideInput?: string) => {
        const state = useChatStore.getState()
        const messageText = (overrideInput ?? state.input).trim()
        if (!messageText || state.isLoading) return

        // Clear input and reset height (if it's from the input field)
        if (!overrideInput) {
            state.setInput("")
        }

        // 1. Add User Message immediately (skip if retrying and we just want to replace assistant response)
        // For a true "Retry", usually we delete the last assistant message and reuse the last user message.
        // My implementation plan said: "regenerate the last assistant response by using the previous user message".

        // Use the monotonic message counter so IDs are stable even if the
        // system clock jumps backwards during a long session.
        const userMsgId = state.nextMessageId()
        let effectiveSessionId = useChatStore.getState().currentSessionId

        // 1. Create session if it doesn't exist and user is logged in
        if (!effectiveSessionId && user) {
            try {
                effectiveSessionId = await createSession(user.uid, messageText.slice(0, 30) + "...")
                state.setCurrentSessionId(effectiveSessionId)
                // Add to sessions list
                state.setSessions([{
                    id: effectiveSessionId,
                    userId: user.uid,
                    title: messageText.slice(0, 30) + "...",
                    createdAt: new Date(),
                    lastMessageAt: new Date(),
                    context: {}
                }, ...state.sessions])
            } catch (err) {
                console.error("Failed to create session:", err)
            }
        }

        if (!overrideInput) {
            state.addMessage({
                id: userMsgId,
                role: "user",
                content: messageText,
                timestamp: Date.now()
            })

            // Persist User Message to Firestore
            // (messages are scoped to the session subcollection, which
            // carries the userId — no per-message userId needed).
            if (effectiveSessionId && user) {
                // Don't await this to keep UI snappy
                import("@/lib/firebase/firestore").then(({ addMessageToSession }) => {
                    addMessageToSession(effectiveSessionId!, {
                        role: "user",
                        content: messageText,
                    }).catch(err => console.error("Error saving user message:", err));
                });
            }
        }

        // 2. Set Loading
        state.setLoading(true)
        state.setError(null)

        // 3. Create Placeholder Assistant Message
        const assistantMsgId = state.nextMessageId()
        // Hoist updateFrameId so the catch (abort) block can cancel any
        // pending animation frame. Without this, the variable would be
        // block-scoped to the try and the catch reference would not compile.
        let updateFrameId: number | null = null
        state.addMessage({
            id: assistantMsgId,
            role: "assistant",
            content: "",
            timestamp: Date.now()
        })

        try {
            // Check if this is the first message in the session (it was just added, so length is 1)
            const isFirstMessage = useChatStore.getState().messages.filter(m => m.role === "user").length === 1;

            abortControllerRef.current = new AbortController()

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: messageText,
                    provider: state.settings.provider,
                    model: state.settings.model,
                    // Dedicated planner model. Empty string tells
                    // the server to use its built-in cheap
                    // planner model. The frontend decides whether
                    // to surface this field in the UI.
                    plannerModel: state.settings.plannerModel || undefined,
                    // For now we keep the planner on the same
                    // provider as the responder. A future UI
                    // control can split these by setting
                    // `state.settings.plannerProvider` on the
                    // store — the route already accepts the field.
                    plannerProvider: undefined,
                    apiKey: state.settings.apiKey,
                    deepResearchMode: state.settings.deepResearchMode,
                    web_search: state.settings.webSearchEnabled,
                    sessionId: effectiveSessionId,
                    isFirstMessage
                }),
                signal: abortControllerRef.current.signal
            })

            if (!response.ok) {
                let errorMessage
                try {
                    const errorData = await response.json()
                    errorMessage = errorData.error || errorData.message || "Failed to send message"
                } catch {
                    errorMessage = `Server Error: ${response.status} ${response.statusText}`
                }
                throw new Error(errorMessage)
            }

            if (!response.body) throw new Error("No response body")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let assistantContent = ""
            let currentSteps: NonNullable<Message['steps']> = []
            let buffer = ""
            let done = false

            // Function to save assistant message on completion.
            // Citations ride along (sanitized) so Sources survive reloads —
            // the `citations` SSE event always precedes stream end, so the
            // store already holds them here.
            const saveAssistantMessage = () => {
                if (effectiveSessionId && user && assistantContent) {
                    const citations = sanitizeCitations(
                        useChatStore.getState().messages.find((m) => m.id === assistantMsgId)?.citations
                    );
                    import("@/lib/firebase/firestore").then(({ addMessageToSession }) => {
                        addMessageToSession(effectiveSessionId!, {
                            role: "assistant",
                            content: assistantContent,
                            ...(citations.length > 0 ? { citations } : {}),
                        }).catch(err => console.error("Error saving assistant message:", err));
                    });
                }
            };

            const scheduleUpdate = () => {
                if (updateFrameId) return
                updateFrameId = requestAnimationFrame(() => {
                    useChatStore.getState().updateMessage(assistantMsgId, assistantContent)
                    updateFrameId = null
                })
            }

            while (true) {
                const { done: streamDone, value } = await reader.read()
                if (streamDone) {
                    done = true
                    saveAssistantMessage()
                    break
                }

                const chunk = decoder.decode(value, { stream: true })
                buffer += chunk

                const lines = buffer.split("\n\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    const trimmedLine = line.trim()
                    if (!trimmedLine) continue

                    if (trimmedLine.startsWith("data: ")) {
                        const content = trimmedLine.slice(6)
                        if (content === "[DONE]") {
                            if (!done) {
                                done = true
                                saveAssistantMessage()
                            }
                            break
                        }

                        try {
                            const parsed = JSON.parse(content)

                            if (parsed.event && parsed.data) {
                                const { event, data } = parsed
                                switch (event) {
                                    case "reasoning":
                                        const currentMsg = useChatStore.getState().messages.find(m => m.id === assistantMsgId)
                                        const currentReasoning = currentMsg?.reasoning || ""
                                        useChatStore.getState().updateMessageReasoning(assistantMsgId, currentReasoning + data.token)
                                        break
                                    case "plan":
                                        currentSteps = data.steps.map((s: SsePlanStep) => ({
                                            description: typeof s.description === "string" && s.description ? s.description : `Execute ${typeof s.tool === "string" ? s.tool : "tool"}`,
                                            tool: typeof s.tool === "string" ? s.tool : "",
                                            status: "pending" as const
                                        }))
                                        useChatStore.getState().updateMessageSteps(assistantMsgId, currentSteps)
                                        break
                                    case "step_update":
                                        const stepIndex = (typeof data.step === 'number' ? data.step : parseInt(data.step)) - 1
                                        if (stepIndex >= 0 && stepIndex < currentSteps.length) {
                                            const updatedStep = {
                                                ...currentSteps[stepIndex],
                                                status: data.status,
                                                result: data.additional
                                            }
                                            currentSteps[stepIndex] = updatedStep

                                            // Sub-query expansion logic for retrieval tool
                                            if (updatedStep.tool === "retrieve_regulations" && data.additional) {
                                                try {
                                                    const result = JSON.parse(data.additional)
                                                    if (result.used_subqueries && Array.isArray(result.used_subqueries)) {
                                                        // Insert sub-queries as completed steps immediately after the main retrieval step
                                                        const subSteps = result.used_subqueries.map((sq: string) => ({
                                                            description: `Sub-query: "${sq}"`,
                                                            tool: "rag_subquery",
                                                            status: "success" as const,
                                                            result: "Completed"
                                                        }))

                                                        // Insert after current index
                                                        currentSteps.splice(stepIndex + 1, 0, ...subSteps)
                                                    }
                                                } catch {
                                                    // Ignore parsing errors
                                                }
                                            }

                                            useChatStore.getState().updateMessageSteps(assistantMsgId, [...currentSteps])
                                        }
                                        break
                                    case "citations":
                                        useChatStore.getState().updateMessageCitations(assistantMsgId, sanitizeCitations(data.citations))
                                        break
                                    case "token":
                                        assistantContent += data.content
                                        scheduleUpdate()
                                        break
                                    case "visualization":
                                        useChatStore.getState().setVisualizationData(data.data)
                                        useChatStore.getState().updateMessageVisualization(assistantMsgId, data.data)
                                        // Make the new message the active one so the
                                        // visualization panel reflects the latest reply.
                                        useChatStore.getState().setActiveMessageId(assistantMsgId)
                                        break
                                    case "metadata":
                                        // Update session title and type in the store
                                        if (effectiveSessionId) {
                                            const currentSessions = useChatStore.getState().sessions;
                                            const updatedSessions = currentSessions.map(s =>
                                                s.id === effectiveSessionId
                                                    ? { ...s, title: data.title, type: data.type }
                                                    : s
                                            )
                                            useChatStore.getState().setSessions(updatedSessions)

                                            // Persist metadata to Firestore (Client SDK)
                                            if (user) {
                                                import("@/lib/firebase/firestore").then(({ updateSessionMetadata }) => {
                                                    updateSessionMetadata(effectiveSessionId!, data.title, data.type)
                                                        .catch(err => console.error("Error updating session metadata:", err));
                                                });
                                            }
                                        }
                                        break
                                    case "usage":
                                        // Per-message usage accounting (OpenRouter
                                        // Usage Accounting docs). Attach to the
                                        // assistant message so the bubble can
                                        // render a small footer with model name,
                                        // token counts, and cost. Shape mirrors
                                        // Message.usage in the store.
                                        //
                                        // `plannerModel` is only present when the
                                        // user picked a different model for the
                                        // planner; the server omits it when both
                                        // roles use the same model so the footer
                                        // can collapse the two rows.
                                        useChatStore.getState().setMessageUsage(assistantMsgId, {
                                            provider: data.provider,
                                            model: data.model,
                                            plannerModel: data.plannerModel ?? undefined,
                                            promptTokens: data.promptTokens ?? 0,
                                            completionTokens: data.completionTokens ?? 0,
                                            reasoningTokens: data.reasoningTokens ?? 0,
                                            cachedTokens: data.cachedTokens ?? 0,
                                            totalTokens: data.totalTokens ?? 0,
                                            cost: data.cost ?? null,
                                            upstreamCost: data.upstreamCost ?? null,
                                        })
                                        break
                                    case "intent_analysis":
                                        // (Normal mode) Backend has the structured intent
                                        // breakdown. Nothing to do UI-side today — the planner
                                        // already consumed it server-side. Kept for parity with
                                        // deep mode in case future UI surfaces it.
                                        break
                                    case "intent_analysis_unavailable":
                                        // The backend's IntentAnalyzer couldn't reach the
                                        // LLM (rate limit, auth, network). The planner still
                                        // ran (with reduced accuracy). Surface a non-fatal
                                        // warning badge on the assistant message.
                                        useChatStore.getState().addMessageDegradedWarning(assistantMsgId, {
                                            stage: "intent_analysis",
                                            kind: data.kind,
                                            message: data.message,
                                        })
                                        break
                                    case "degraded":
                                        // Generic degraded-mode event from the backend.
                                        // Append to the message's warning list — the
                                        // MessageBubble renders these as a small badge.
                                        useChatStore.getState().addMessageDegradedWarning(assistantMsgId, {
                                            stage: data.stage,
                                            kind: data.kind,
                                            message: data.message,
                                        })
                                        break
                                    // ===== Deep Research Mode Events =====
                                    case "research_start":
                                        useChatStore.getState().updateMessageResearchType(assistantMsgId, data.researchType)
                                        break
                                    case "plan_iteration":
                                        useChatStore.getState().addResearchIteration(assistantMsgId, {
                                            iteration: data.iteration,
                                            tasks: (data.tasks || []).map((t: SseTask) => ({
                                                id: t.id,
                                                description: t.description,
                                                tool: t.tool,
                                                status: "pending" as const,
                                            })),
                                            reasoning: data.reasoning,
                                        })
                                        break
                                    case "task_update":
                                        // Find which iteration this task belongs to
                                        {
                                            const currentMsg = useChatStore.getState().messages.find(m => m.id === assistantMsgId)
                                            const iterations = currentMsg?.iterations || []
                                            // Find the iteration containing this task
                                            const iter = iterations.find((it: ResearchIteration) =>
                                                it.tasks.some((t: ResearchIteration['tasks'][number]) => t.id === data.taskId)
                                            )
                                            if (iter) {
                                                useChatStore.getState().updateResearchTaskStatus(
                                                    assistantMsgId,
                                                    iter.iteration,
                                                    data.taskId,
                                                    data.status,
                                                    data.evidenceId
                                                )
                                            }
                                        }
                                        break
                                    case "evidence":
                                        useChatStore.getState().addResearchEvidence(assistantMsgId, data.evidence)
                                        break
                                    case "reflection":
                                        useChatStore.getState().addResearchReflection(assistantMsgId, {
                                            ...data.reflection,
                                            iteration: data.iteration,
                                        })
                                        break
                                    case "confidence":
                                        useChatStore.getState().setResearchConfidence(assistantMsgId, data)
                                        break
                                    case "chart_specs":
                                        useChatStore.getState().setResearchChartSpecs(assistantMsgId, data.specs || [])
                                        // Also set visualization data for the panel
                                        if (data.specs && data.specs.length > 0) {
                                            useChatStore.getState().setVisualizationData(data.specs)
                                        }
                                        // Make the new message the active one so the
                                        // visualization panel renders the new specs.
                                        useChatStore.getState().setActiveMessageId(assistantMsgId)
                                        break
                                    case "done":
                                        // In deep research mode, done carries result summary
                                        break
                                    case "error":
                                        // Surface the error inline in the
                                        // assistant bubble AND as a global
                                        // error modal. The bubble shows the
                                        // friendly message in context; the
                                        // modal catches the user's attention
                                        // and lets them acknowledge it.
                                        useChatStore.getState().setError(data.message)
                                        useChatStore.getState().updateMessage(
                                            assistantMsgId,
                                            data.message || "An error occurred while generating a response.",
                                            true
                                        )
                                        return
                                }
                            } else if (parsed.content) {
                                assistantContent += parsed.content
                                scheduleUpdate()
                            }
                        } catch {
                            // skip malformed
                        }
                    }
                }
            }

            if (updateFrameId) cancelAnimationFrame(updateFrameId)
            useChatStore.getState().updateMessage(assistantMsgId, assistantContent)

            // Safety net: the stream ended cleanly (HTTP 200, EOF) but
            // nothing was ever produced — no `token`, no `error`, no
            // `done`. This is rare but can happen if the connection
            // drops mid-flight, the server crashes silently, or the
            // provider hangs and we never get a payload. Without this
            // the user sees a frozen "AWAITING DATA..." bubble forever.
            // Detect it and surface a clear inline error.
            const finalMsg = useChatStore.getState().messages.find(m => m.id === assistantMsgId)
            const finalContent = finalMsg?.content ?? assistantContent
            if (!finalContent || finalContent.trim() === "") {
                const errorText =
                    "The response stream ended without producing any output. " +
                    "This usually means a network interruption or an upstream LLM timeout. " +
                    "Please try again, or switch providers in Settings."
                useChatStore.getState().setError(errorText)
                useChatStore.getState().updateMessage(assistantMsgId, errorText, true)
            }

        } catch (error) {
            if (error instanceof Error && error.name === "AbortError") {
                console.log("Generation aborted by user");
                // Mark the placeholder assistant message as cancelled so the
                // user sees feedback in the UI instead of an empty bubble.
                // We persist whatever partial content streamed before the
                // abort, prefixed with a clear "stopped" notice.
                if (updateFrameId) cancelAnimationFrame(updateFrameId)
                const partial = useChatStore.getState().messages
                    .find(m => m.id === assistantMsgId)?.content ?? ""
                const cancelledNote = partial
                    ? `${partial}\n\n_⏹ Generation stopped._`
                    : "_⏹ Generation stopped._"
                useChatStore.getState().updateMessage(assistantMsgId, cancelledNote)
                return;
            }
            console.error(error)
            const message = error instanceof Error ? error.message : "An unexpected error occurred"
            useChatStore.getState().setError(message)
            useChatStore.getState().updateMessage(assistantMsgId, "", true)
        } finally {
            useChatStore.getState().setLoading(false)
        }
    }, [user])

    return { handleSend, cancelGeneration, isLoading: store.isLoading }
}
