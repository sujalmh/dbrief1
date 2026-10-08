"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useChatStore, type Message, type ResearchIteration } from "@/lib/store"
import { useSession } from "@/lib/cf/session-context"
import { createSession, saveMessage, patchSessionMeta } from "@/lib/cf/client"
import { sanitizeCitations } from "@/lib/utils"

/** Minimal shape of SSE payload steps/tasks — fields are unknown until validated. */
interface SsePlanStep {
    description?: unknown;
    tool?: unknown;
    args?: unknown;
}
interface SseTask {
    id: string;
    description: string;
    tool: string;
    args?: unknown;
}

// Module-scoped so generation survives SPA remounts (e.g. `/` → `/c/<id>`
// on the first message unmounts ChatInput mid-stream) and so the Stop
// button in the newly mounted tree can still cancel the old stream.
let activeAbortController: AbortController | null = null

export function useChatHandler() {
    // Subscribe ONLY to isLoading — a full-store subscription here would
    // re-render every consumer (chat input, every message bubble) on each
    // streamed token. Everything else goes through getState().
    const isLoading = useChatStore((s) => s.isLoading)
    const { user } = useSession()
    const router = useRouter()

    // Abort on real page leave only (reload/tab close). SPA navigation
    // (e.g. `/` → `/c/<id>` on the first message) remounts this hook —
    // aborting there kills the in-flight generation, which is exactly
    // the "stops right after submit" bug. The stream itself survives
    // remounts: it only touches the global store + the shared controller.
    React.useEffect(() => {
        const onHide = () => {
            if (activeAbortController) {
                activeAbortController.abort()
                activeAbortController = null
            }
        }
        window.addEventListener("pagehide", onHide)
        return () => window.removeEventListener("pagehide", onHide)
    }, [])
    const cancelGeneration = React.useCallback(() => {
        if (activeAbortController) {
            activeAbortController.abort()
            activeAbortController = null
            useChatStore.getState().setLoading(false)
        }
    }, [])

    const handleSend = React.useCallback(async (overrideInput?: string) => {
        const state = useChatStore.getState()
        const messageText = (overrideInput ?? state.input).trim()
        if (!messageText || state.isLoading) return

        // Clear input immediately so the composer feels instant.
        if (!overrideInput) {
            state.setInput("")
        }

        // Optimistic UI: paint the user bubble + loading state BEFORE any
        // network work. Session creation (D1) can take hundreds of ms —
        // awaiting it first made the query appear to "lag" after submit.
        // Use the monotonic message counter so IDs are stable even if the
        // system clock jumps backwards during a long session.
        const userMsgId = state.nextMessageId()
        state.setLoading(true)
        state.setError(null)

        if (!overrideInput) {
            state.addMessage({
                id: userMsgId,
                role: "user",
                content: messageText,
                timestamp: Date.now()
            })
        }

        // Placeholder assistant message up-front so the "thinking"
        // indicator renders in the same frame as the user bubble.
        const assistantMsgId = state.nextMessageId()
        // Hoist updateFrameId so the catch (abort) block can cancel any
        // pending animation frame. Without this, the variable would be
        // block-scoped to the try and the catch reference would not compile.
        let updateFrameId: number | null = null
        // Wall-clock start for the response-time footer. Hoisted for the
        // same reason — set just before fetch, read on completion and
        // in the finally safety net below.
        let requestStartedAt = 0
        // Accumulated streamed text. Hoisted so the catch block can
        // persist failed generations (error events, exceptions) instead
        // of leaving the user message with no assistant row.
        let assistantContent = ""

        // Save the FULL assistant message (steps + args, visualizationData,
        // evidence/iterations/reflections/confidence/chartSpecs, usage,
        // degraded warnings, reasoning) so reopening the session resumes
        // exactly where the user left off. Defined at function scope so
        // error paths can persist failed generations too. Large payloads
        // are offloaded to Storage by session-io; reload hydrates them.
        const saveAssistantMessage = () => {
            // Wall-clock response time — recorded for every completed
            // turn in both modes, ahead of the cloud save so the
            // persisted message carries it for reopened sessions.
            if (requestStartedAt > 0) {
                useChatStore.getState().setMessageDurationMs(assistantMsgId, Date.now() - requestStartedAt);
            }
            if (effectiveSessionId && !effectiveSessionId.startsWith("local_") && assistantContent) {
                const storeMsg = useChatStore.getState().messages.find((m) => m.id === assistantMsgId);
                const fullMsg: Message = {
                    id: assistantMsgId,
                    role: "assistant",
                    content: assistantContent,
                    timestamp: storeMsg?.timestamp ?? Date.now(),
                    ...(storeMsg?.durationMs != null ? { durationMs: storeMsg.durationMs } : {}),
                    ...(storeMsg?.reasoning ? { reasoning: storeMsg.reasoning } : {}),
                    ...(storeMsg?.isError !== undefined ? { isError: storeMsg.isError } : {}),
                    ...(storeMsg?.steps ? { steps: storeMsg.steps } : {}),
                    ...(storeMsg?.citations ? { citations: storeMsg.citations } : {}),
                    ...(storeMsg?.visualizationData !== undefined && storeMsg.visualizationData !== null
                        ? { visualizationData: storeMsg.visualizationData }
                        : {}),
                    ...(storeMsg?.degradedWarnings ? { degradedWarnings: storeMsg.degradedWarnings } : {}),
                    ...(storeMsg?.usage ? { usage: storeMsg.usage } : {}),
                    ...(storeMsg?.researchType ? { researchType: storeMsg.researchType } : {}),
                    ...(storeMsg?.iterations ? { iterations: storeMsg.iterations } : {}),
                    ...(storeMsg?.evidence ? { evidence: storeMsg.evidence } : {}),
                    ...(storeMsg?.confidence ? { confidence: storeMsg.confidence } : {}),
                    ...(storeMsg?.reflections ? { reflections: storeMsg.reflections } : {}),
                    ...(storeMsg?.chartSpecs ? { chartSpecs: storeMsg.chartSpecs } : {}),
                    ...(storeMsg?.planTrace ? { planTrace: storeMsg.planTrace } : {}),
                    ...(storeMsg?.refusal ? { refusal: storeMsg.refusal } : {}),
                    ...(storeMsg?.feedback ? { feedback: storeMsg.feedback } : {}),
                };
                const sid = effectiveSessionId;
                saveMessage(sid, fullMsg);
            }
        };
        state.addMessage({
            id: assistantMsgId,
            role: "assistant",
            content: "",
            timestamp: Date.now()
        })

        let effectiveSessionId = useChatStore.getState().currentSessionId

        // Create session if it doesn't exist (Cloudflare D1; falls
        // back to a local-only session when cloud sync is unavailable).
        // The messages above are already painted — this await only gates
        // the fetch, not the first paint.
        if (!effectiveSessionId) {
            const title = messageText.slice(0, 30) + "...";
            try {
                effectiveSessionId = await createSession(title)
                state.setCurrentSessionId(effectiveSessionId)
                // Add to sessions list
                state.setSessions([{
                    id: effectiveSessionId,
                    userId: user?.uid,
                    title,
                    createdAt: Date.now(),
                    lastMessageAt: Date.now(),
                }, ...state.sessions])
            } catch (err) {
                console.error("Failed to create session:", err)
                effectiveSessionId = `local_${Date.now()}`;
                state.setCurrentSessionId(effectiveSessionId)
                state.setSessions([{
                    id: effectiveSessionId,
                    userId: user?.uid,
                    title,
                    createdAt: Date.now(),
                    lastMessageAt: Date.now(),
                }, ...state.sessions])
            }
        }

        if (!overrideInput) {
            // Persist User Message to Cloudflare (D1 + R2 overflow).
            // Local-only sessions (local_*) skip cloud saves quietly.
            // Fire-and-forget to keep the fetch path snappy.
            if (effectiveSessionId && !effectiveSessionId.startsWith("local_")) {
                // Don't await this to keep UI snappy
                const userMsg: Message = {
                    id: userMsgId,
                    role: "user",
                    content: messageText,
                    timestamp: Date.now(),
                };
                const sid = effectiveSessionId;
                saveMessage(sid, userMsg);
            }
        }

        // Reflect the session in the URL (ChatGPT-style `/c/<id>`).
        // Client-side replace only — the page never reloads, and the
        // route shell skips reloading when the session is already live.
        if (
            effectiveSessionId &&
            !effectiveSessionId.startsWith("local_") &&
            typeof window !== "undefined" &&
            window.location.pathname !== `/c/${effectiveSessionId}`
        ) {
            router.replace(`/c/${effectiveSessionId}`);
        }

        try {
            // Check if this is the first message in the session (it was just added, so length is 1)
            const isFirstMessage = useChatStore.getState().messages.filter(m => m.role === "user").length === 1;

            const aborter = new AbortController()
            activeAbortController = aborter

            // Conversation history for follow-up resolution (server-side
            // planner + intent analyzer). Last 10 non-empty turns, content
            // capped so the body stays small (schema allows 50 x 8000).
            // The just-added current user message is excluded — `message`
            // already carries it.
            const history = useChatStore.getState().messages
                .filter((m) => m.id !== userMsgId && m.content && m.content.trim())
                .slice(-10)
                .map((m) => ({
                    role: m.role as "user" | "assistant",
                    content: m.content.slice(0, 2000),
                }));

            requestStartedAt = Date.now()
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: messageText,
                    // Two modes only: "managed" (server env) or "byok".
                    // The BYOK API key lives in an httpOnly cookie and is
                    // never sent from JS — the server reads the cookie.
                    aiMode: state.settings.aiMode,
                    byokBaseUrl: state.settings.byokBaseUrl || undefined,
                    byokModel: state.settings.byokModelId || undefined,
                    byokModelName: state.settings.byokModelName || undefined,
                    deepResearchMode: state.settings.deepResearchMode,
                    web_search: state.settings.webSearchEnabled,
                    sessionId: effectiveSessionId,
                    isFirstMessage,
                    history
                }),
                signal: aborter.signal
            })

            if (!response.ok) {
                let errorMessage
                let errorCode: string | undefined
                try {
                    const errorData = await response.json()
                    errorMessage = errorData.error || errorData.message || "Failed to send message"
                    errorCode = typeof errorData.code === "string" ? errorData.code : undefined
                } catch {
                    errorMessage = `Server Error: ${response.status} ${response.statusText}`
                }
                // Signed-out (or unlinked) session: re-bootstrap so the
                // page gate routes to sign up/in instead of showing a
                // dead chat that can never send.
                if (response.status === 401 || errorCode === "auth_required") {
                    if (typeof window !== "undefined") window.location.reload()
                    throw new Error("Sign in with Google to use the chat.")
                }
                throw new Error(errorMessage)
            }

            if (!response.body) throw new Error("No response body")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            assistantContent = ""
            let currentSteps: NonNullable<Message['steps']> = []
            let buffer = ""
            let done = false

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
                                            status: "pending" as const,
                                            ...(s.args && typeof s.args === "object" && s.args !== null
                                                ? { args: s.args as Record<string, unknown> }
                                                : {}),
                                        }))
                                        useChatStore.getState().updateMessageSteps(assistantMsgId, currentSteps)
                                        // Plan-decision trace: persisted with the
                                        // message so every turn (including
                                        // no-tool direct replies) records WHY
                                        // the backend chose its path.
                                        useChatStore.getState().setMessagePlanTrace(assistantMsgId, {
                                            needsPlan: data.needsPlan !== false,
                                            ...(typeof data.reasoning === "string" && data.reasoning
                                                ? { reasoning: data.reasoning.slice(0, 2000) }
                                                : {}),
                                            ...(typeof data.replyPreview === "string" && data.replyPreview
                                                ? { replyPreview: data.replyPreview.slice(0, 500) }
                                                : {}),
                                            ...(typeof data.plannerError === "string" && data.plannerError
                                                ? { plannerError: data.plannerError.slice(0, 500) }
                                                : {}),
                                            ...(data.deepDowngraded === true
                                                ? { deepDowngraded: true as const }
                                                : {}),
                                        })
                                        break
                                    case "refusal":
                                        // Backend refused (no tool data) — persist
                                        // the reason + failed steps with the
                                        // message so the trace shows WHY.
                                        useChatStore.getState().setMessageRefusal(assistantMsgId, {
                                            reason: typeof data.reason === "string" ? data.reason : "unknown",
                                            ...(Array.isArray(data.failedSteps)
                                                ? {
                                                    failedSteps: data.failedSteps.slice(0, 25).map((s: {
                                                        step?: unknown; tool?: unknown; error?: unknown
                                                    }) => ({
                                                        step: typeof s.step === "number" ? s.step : 0,
                                                        tool: typeof s.tool === "string" ? s.tool : "",
                                                        ...(typeof s.error === "string" && s.error
                                                            ? { error: s.error.slice(0, 2000) }
                                                            : {}),
                                                    })),
                                                }
                                                : {}),
                                        })
                                        break
                                    case "step_update":
                                        const stepIndex = (typeof data.step === 'number' ? data.step : parseInt(data.step)) - 1
                                        if (stepIndex >= 0 && stepIndex < currentSteps.length) {
                                            const updatedStep = {
                                                ...currentSteps[stepIndex],
                                                status: data.status,
                                                result: data.additional,
                                                ...(data.status === "failed" && typeof data.additional === "string" && data.additional
                                                    ? { error: data.additional.slice(0, 2000) }
                                                    : {}),
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
                                        // Per-message payload only — charts render
                                        // inline in this bubble, always (no
                                        // toggle, no side panel).
                                        useChatStore.getState().updateMessageVisualization(assistantMsgId, data.data)
                                        // Learn driver→team→color mappings from the live
                                        // payload (results rows carry TeamName/TeamColor
                                        // from FastF1) so highlights and charts stay
                                        // correct across seasons without code changes.
                                        try {
                                            const { learnColorsFromPayload } = await import("@/lib/f1-colors");
                                            learnColorsFromPayload(data.data);
                                        } catch {
                                            // Best-effort: colors fall back to the static grid.
                                        }
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

                                            // Persist metadata to Cloudflare D1 (skipped for local-only sessions).
                                            if (!effectiveSessionId.startsWith("local_")) {
                                                patchSessionMeta(effectiveSessionId!, data.title, data.type);
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
                                        // breakdown. Nothing to do UI-side today — the
                                        // planner resolves follow-ups from the history
                                        // it now receives server-side. Kept for parity
                                        // with deep mode in case future UI surfaces it.
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
                                                ...(t.args && typeof t.args === "object" && t.args !== null
                                                    ? { args: t.args as Record<string, unknown> }
                                                    : {}),
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
                                        {
                                            const errorText = data.message || "An error occurred while generating a response."
                                            useChatStore.getState().updateMessage(assistantMsgId, errorText, true)
                                            // Persist the failure like any completed turn —
                                            // otherwise the user message is saved with no
                                            // assistant row and the failure is invisible
                                            // (and undebuggable) on reload.
                                            if (!assistantContent) assistantContent = errorText
                                            saveAssistantMessage()
                                        }
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
                    "Please try again, or check Settings (Managed / BYOK)."
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
            useChatStore.getState().updateMessage(assistantMsgId, message, true)
            if (!assistantContent) assistantContent = message
            saveAssistantMessage()
        } finally {
            // Safety net: stamp the response time on every exit path
            // (server-error events, aborts, exceptions) so the footer
            // still shows how long the attempt took. No-op when the
            // completion path above already recorded it.
            if (requestStartedAt > 0) {
                useChatStore.getState().setMessageDurationMs(assistantMsgId, Date.now() - requestStartedAt)
            }
            useChatStore.getState().setLoading(false)
        }
    }, [user, router])

    return { handleSend, cancelGeneration, isLoading }
}
