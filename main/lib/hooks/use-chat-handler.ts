"use client"

import { useChatStore } from "@/lib/store"
import { useAuth } from "@/lib/firebase/auth-context"
import { createSession } from "@/lib/firebase/firestore"

export function useChatHandler() {
    const {
        input,
        setInput,
        isLoading,
        setLoading,
        addMessage,
        updateMessage,
        updateMessageSteps,
        updateMessageVisualization,
        updateMessageReasoning,
        setError,
        settings,
        currentSessionId,
        setCurrentSessionId,
        sessions,
        setSessions,
        messages
    } = useChatStore()
    const { user } = useAuth()

    const handleSend = async (overrideInput?: string) => {
        const messageText = (overrideInput ?? input).trim()
        if (!messageText || isLoading) return

        // Clear input and reset height (if it's from the input field)
        if (!overrideInput) {
            setInput("")
        }

        // 1. Add User Message immediately (skip if retrying and we just want to replace assistant response)
        // For a true "Retry", usually we delete the last assistant message and reuse the last user message.
        // My implementation plan said: "regenerate the last assistant response by using the previous user message".

        let userMsgId = Date.now().toString()
        let effectiveSessionId = currentSessionId

        // 1. Create session if it doesn't exist and user is logged in
        if (!effectiveSessionId && user) {
            try {
                effectiveSessionId = await createSession(user.uid, messageText.slice(0, 30) + "...")
                setCurrentSessionId(effectiveSessionId)
                // Add to sessions list
                setSessions([{
                    id: effectiveSessionId,
                    userId: user.uid,
                    title: messageText.slice(0, 30) + "...",
                    createdAt: new Date(),
                    lastMessageAt: new Date(),
                    context: {}
                }, ...sessions])
            } catch (err) {
                console.error("Failed to create session:", err)
            }
        }

        if (!overrideInput) {
            addMessage({
                id: userMsgId,
                role: "user",
                content: messageText,
                timestamp: Date.now()
            })

            // Persist User Message to Firestore
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
        setLoading(true)
        setError(null)

        // 3. Create Placeholder Assistant Message
        const assistantMsgId = (Date.now() + 1).toString()
        addMessage({
            id: assistantMsgId,
            role: "assistant",
            content: "",
            timestamp: Date.now()
        })

        try {
            // Check if this is the first message in the session
            const isFirstMessage = messages.filter(m => m.role === "user").length === 0;

            const response = await fetch("/api/chat", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: messageText,
                    provider: settings.provider,
                    model: settings.model,
                    apiKey: settings.apiKey,
                    reasoning: settings.reasoningEnabled,
                    web_search: settings.webSearchEnabled,
                    sessionId: effectiveSessionId,
                    isFirstMessage
                })
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
            let currentSteps: any[] = []
            let updateFrameId: number | null = null
            let buffer = ""
            let done = false

            // Function to save assistant message on completion
            const saveAssistantMessage = () => {
                if (effectiveSessionId && user && assistantContent) {
                    import("@/lib/firebase/firestore").then(({ addMessageToSession }) => {
                        addMessageToSession(effectiveSessionId!, {
                            role: "assistant",
                            content: assistantContent,
                        }).catch(err => console.error("Error saving assistant message:", err));
                    });
                }
            };

            const scheduleUpdate = () => {
                if (updateFrameId) return
                updateFrameId = requestAnimationFrame(() => {
                    updateMessage(assistantMsgId, assistantContent)
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
                                        updateMessageReasoning(assistantMsgId, currentReasoning + data.token)
                                        break
                                    case "plan":
                                        currentSteps = data.steps.map((s: any) => ({
                                            description: s.description || `Execute ${s.tool || "tool"}`,
                                            tool: s.tool || "",
                                            status: "pending" as const
                                        }))
                                        updateMessageSteps(assistantMsgId, currentSteps)
                                        break
                                    case "step_update":
                                        const stepIndex = (typeof data.step === 'number' ? data.step : parseInt(data.step)) - 1
                                        if (stepIndex >= 0 && stepIndex < currentSteps.length) {
                                            currentSteps[stepIndex] = {
                                                ...currentSteps[stepIndex],
                                                status: data.status,
                                                result: data.additional
                                            }
                                            updateMessageSteps(assistantMsgId, [...currentSteps])
                                        }
                                        break
                                    case "token":
                                        assistantContent += data.content
                                        scheduleUpdate()
                                        break
                                    case "visualization":
                                        useChatStore.getState().setVisualizationData(data.data)
                                        updateMessageVisualization(assistantMsgId, data.data)
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
                                            setSessions(updatedSessions)

                                            // Persist metadata to Firestore (Client SDK)
                                            if (user) {
                                                import("@/lib/firebase/firestore").then(({ updateSessionMetadata }) => {
                                                    updateSessionMetadata(effectiveSessionId!, data.title, data.type)
                                                        .catch(err => console.error("Error updating session metadata:", err));
                                                });
                                            }
                                        }
                                        break
                                    case "error":
                                        setError(data.message)
                                        updateMessage(assistantMsgId, "", true)
                                        return
                                }
                            } else if (parsed.content) {
                                assistantContent += parsed.content
                                scheduleUpdate()
                            }
                        } catch (e) {
                            // skip malformed
                        }
                    }
                }
            }

            if (updateFrameId) cancelAnimationFrame(updateFrameId)
            updateMessage(assistantMsgId, assistantContent)

        } catch (error) {
            console.error(error)
            const message = error instanceof Error ? error.message : "An unexpected error occurred"
            setError(message)
            updateMessage(assistantMsgId, "", true)
        } finally {
            setLoading(false)
        }
    }

    return { handleSend, isLoading }
}
