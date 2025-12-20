"use client"

import * as React from "react"
import { Send, Image as ImageIcon } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ControlPanel } from "@/components/chat/control-panel"
import { cn } from "@/lib/utils"

export function ChatInput() {
    const { input, setInput, isLoading } = useChatStore()
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value)
        // Auto-resize
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const handleSend = async () => {
        if (!input.trim() || isLoading) return

        const userMessage = input.trim()
        const { addMessage, setLoading, settings, updateSettings } = useChatStore.getState()

        // 1. Add User Message immediately
        const userMsgId = Date.now().toString()
        addMessage({
            id: userMsgId,
            role: "user",
            content: userMessage,
            timestamp: Date.now()
        })

        // Clear input and reset height
        setInput("")
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
        }

        // 2. Set Loading
        setLoading(true)

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
                    message: userMessage,
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

            // 4. Handle Streaming Response
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let assistantContent = ""
            let currentSteps: NonNullable<import("@/lib/store").Message['steps']> = []
            let updateFrameId: number | null = null
            let buffer = "" // Buffer for split chunks

            // Throttle UI updates using requestAnimationFrame
            const scheduleUpdate = () => {
                if (updateFrameId) return
                updateFrameId = requestAnimationFrame(() => {
                    useChatStore.getState().updateMessage(assistantMsgId, assistantContent)
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

                            // New SSE format with event types
                            if (parsed.event && parsed.data) {
                                const { event, data } = parsed

                                switch (event) {
                                    case "plan":
                                        currentSteps = data.steps.map((s: any) => ({
                                            description: s.description || `Execute ${s.tool || "tool"}`,
                                            tool: s.tool || "",
                                            status: "pending" as const
                                        }))
                                        useChatStore.getState().updateMessageSteps(assistantMsgId, currentSteps)
                                        break

                                    case "step_update":
                                        const stepIndex = (typeof data.step === 'number' ? data.step : parseInt(data.step)) - 1
                                        if (stepIndex >= 0 && stepIndex < currentSteps.length) {
                                            currentSteps[stepIndex] = {
                                                ...currentSteps[stepIndex],
                                                status: data.status,
                                                result: data.additional
                                            }
                                            useChatStore.getState().updateMessageSteps(assistantMsgId, [...currentSteps])
                                        }
                                        break

                                    case "token":
                                        assistantContent += data.content
                                        scheduleUpdate()
                                        break

                                    case "visualization":
                                        useChatStore.getState().setVisualizationData(data.data)
                                        useChatStore.getState().updateMessageVisualization(assistantMsgId, data.data)
                                        break

                                    case "error":
                                        console.error("Stream reported error:", data.message)
                                        useChatStore.getState().setError(data.message)
                                        useChatStore.getState().updateMessage(assistantMsgId, "", true)
                                        return // Stop processing immediately on error
                                }
                            }
                            // Fallback for old/other formats if any
                            else if (parsed.content) {
                                assistantContent += parsed.content
                                scheduleUpdate()
                            }
                        } catch (e) {
                            console.warn("Skipping malformed JSON chunk:", content.slice(0, 50) + "...")
                        }
                    }
                }
            }

            // Final update to ensure all content is displayed
            if (updateFrameId) cancelAnimationFrame(updateFrameId)
            useChatStore.getState().updateMessage(assistantMsgId, assistantContent)

        } catch (error) {
            console.error(error)
            // 1. Show Global Error Modal
            const message = error instanceof Error ? error.message : "An unexpected error occurred"
            useChatStore.getState().setError(message)
            
            // 2. Update message to remove "AWAITING DATA" state
            useChatStore.getState().updateMessage(assistantMsgId, "", true)
            
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="relative rounded-[2rem] border transition-all duration-300 backdrop-blur-xl 
            bg-white/80 border-black/5 shadow-[0_8px_32px_rgba(0,0,0,0.1)] hover:bg-white/90 
            dark:bg-black/40 dark:border-white/10 dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] dark:hover:bg-black/50 
            focus-within:ring-1 focus-within:ring-black/5 dark:focus-within:ring-white/10">

            {/* Top Section: Input Area */}
            <div className="flex gap-2 p-3 pb-0">
                <Button
                    variant="ghost"
                    size="icon"
                    className="btn-wheel btn-wheel-cyan mt-1 h-8 w-8 shrink-0 rounded-full"
                >
                    <ImageIcon className="h-5 w-5" />
                    <span className="sr-only">Upload Image</span>
                </Button>

                <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about race strategy..."
                    className="min-h-[50px] w-full resize-none border-none bg-transparent p-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-base custom-scrollbar max-h-[200px] placeholder:text-muted-foreground font-medium"
                    rows={1}
                />

                <Button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    size="icon"
                    className={cn(
                        "mt-1 h-8 w-8 shrink-0 rounded-full transition-all",
                        input.trim()
                            ? "btn-wheel btn-wheel-red"
                            : "btn-wheel cursor-not-allowed opacity-50"
                    )}
                >
                    <Send className="h-4 w-4" />
                    <span className="sr-only">Send Message</span>
                </Button>
            </div>

            {/* Bottom Section: Integrated Control Panel */}
            <div className="px-3 pb-2">
                <ControlPanel />
            </div>
        </div>
    )
}
