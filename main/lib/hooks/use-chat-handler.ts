"use client"

import { useChatStore } from "@/lib/store"

export function useChatHandler() {
    const { input, setInput, isLoading, setLoading, addMessage, updateMessage, updateMessageSteps, updateMessageVisualization, updateMessageReasoning, setError, settings } = useChatStore()

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
        if (!overrideInput) {
            addMessage({
                id: userMsgId,
                role: "user",
                content: messageText,
                timestamp: Date.now()
            })
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
                    web_search: settings.webSearchEnabled
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

            const scheduleUpdate = () => {
                if (updateFrameId) return
                updateFrameId = requestAnimationFrame(() => {
                    updateMessage(assistantMsgId, assistantContent)
                    updateFrameId = null
                })
            }

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value, { stream: true })
                buffer += chunk

                const lines = buffer.split("\n\n")
                buffer = lines.pop() || ""

                for (const line of lines) {
                    const trimmedLine = line.trim()
                    if (!trimmedLine) continue

                    if (trimmedLine.startsWith("data: ")) {
                        const content = trimmedLine.slice(6)
                        if (content === "[DONE]") break

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
