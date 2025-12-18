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
                    reasoning: settings.reasoningEnabled,
                    web_search: settings.webSearchEnabled
                })
            })

            if (!response.ok) {
                const errorData = await response.json()
                throw new Error(errorData.error || "Failed to send message")
            }

            if (!response.body) throw new Error("No response body")

            // 4. Handle Streaming Response
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let assistantContent = ""
            let currentSteps: NonNullable<import("@/lib/store").Message['steps']> = []

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                const chunk = decoder.decode(value)
                const lines = chunk.split("\n\n")

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const dataStr = line.replace("data: ", "").trim()
                        if (dataStr === "[DONE]") break

                        try {
                            const parsed = JSON.parse(dataStr)
                            // New format: { event: string, data: any }
                            if (parsed.event) {
                                const { event, data } = parsed

                                switch (event) {
                                    case "plan":
                                        // Initialize steps
                                        currentSteps = data.steps.map((s: any, i: number) => ({
                                            id: i + 1,
                                            tool: s.tool,
                                            args: s.args,
                                            status: 'pending'
                                        }))
                                        useChatStore.getState().updateMessageSteps(assistantMsgId, currentSteps)
                                        break

                                    case "step_update":
                                        // Update specific step status
                                        const { step, status, additional } = data
                                        currentSteps = currentSteps.map(s =>
                                            s.id === step ? { ...s, status, error: additional } : s
                                        )
                                        useChatStore.getState().updateMessageSteps(assistantMsgId, currentSteps)
                                        break

                                    case "token":
                                        // Append content
                                        assistantContent += data.content
                                        useChatStore.getState().updateMessage(assistantMsgId, assistantContent)
                                        break

                                    case "visualization":
                                        // Send data to visualization panel
                                        useChatStore.getState().setVisualizationData(data.data)
                                        break

                                    case "error":
                                        throw new Error(data.message)
                                }
                            }
                            // Fallback for old/other formats if any
                            else if (parsed.content) {
                                assistantContent += parsed.content
                                useChatStore.getState().updateMessage(assistantMsgId, assistantContent)
                            }
                        } catch (e) {
                            console.error("Error parsing stream chunk", e)
                        }
                    }
                }
            }

        } catch (error) {
            console.error(error)
            useChatStore.getState().updateMessage(assistantMsgId, "Error: " + (error as Error).message, true)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="relative rounded-3xl border border-[var(--f1-red)]/20 bg-muted/20 shadow-2xl backdrop-blur-md transition-all focus-within:ring-1 focus-within:ring-[var(--f1-red)]/50 focus-within:bg-muted/30 hover:bg-muted/30 hover:shadow-[0_0_40px_-10px_rgba(225,6,0,0.15)]">

            {/* Top Section: Input Area */}
            <div className="flex gap-2 p-3 pb-0">
                <Button
                    variant="ghost"
                    size="icon"
                    className="mt-1 h-8 w-8 shrink-0 text-muted-foreground hover:text-[var(--f1-red)] rounded-full"
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
                    className="min-h-[50px] w-full resize-none border-none bg-transparent p-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-base custom-scrollbar max-h-[200px] placeholder:text-muted-foreground/50 font-medium"
                    rows={1}
                />

                <Button
                    onClick={handleSend}
                    disabled={!input.trim() || isLoading}
                    size="icon"
                    className={cn(
                        "h-8 w-8 shrink-0 rounded-full transition-all mt-1",
                        input.trim()
                            ? "bg-[var(--f1-red)] text-white hover:bg-[var(--f1-red)]/90 shadow-lg shadow-[var(--f1-red)]/20"
                            : "bg-muted text-muted-foreground hover:bg-muted/80"
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
