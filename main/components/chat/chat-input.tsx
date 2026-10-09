"use client"

import * as React from "react"
import { Send, Square } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { useChatHandler } from "@/lib/hooks/use-chat-handler"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ControlPanel } from "@/components/chat/control-panel"
import { cn } from "@/lib/utils"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"

export function ChatInput() {
    // Select slices so streamed tokens (messages updates) and unrelated
    // store changes don't re-render the input on every frame.
    const input = useChatStore((s) => s.input)
    const setInput = useChatStore((s) => s.setInput)
    const { handleSend, cancelGeneration, isLoading } = useChatHandler()
    const textareaRef = React.useRef<HTMLTextAreaElement>(null)

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value)
        // Auto-resize
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`
        }
    }

    const onSend = () => {
        // Collapse the composer immediately — don't wait for the async
        // send (session creation + first fetch) or the box stays tall
        // while the optimistic bubble is already in the list.
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
        }
        void handleSend()
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (!isLoading) {
                onSend()
            }
        }
    }


    // Flat liquid glass: single surface, no gradient ring. The blur
    // reacts to the background; the border stays light and shifts
    // with the theme (same `.modal-glass` as the modals).
    return (
        <div className="modal-glass relative rounded-[2rem] transition-all duration-300">

            {/* Top Section: Input Area */}
            <div className="flex gap-2 p-3 pb-0">
                {/* Parked: image upload button (feature not required for now).
                    Restore the upload Button + handler here when needed. */}

                <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    placeholder="Ask about race strategy..."
                    className="min-h-[50px] w-full resize-none border-none bg-transparent p-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-base custom-scrollbar max-h-[200px] placeholder:text-muted-foreground font-medium disabled:opacity-50"
                    rows={1}
                />

                <Tooltip>
                    <TooltipTrigger asChild>
                        {isLoading ? (
                            <Button
                                onClick={cancelGeneration}
                                size="icon"
                                className="btn-wheel btn-wheel-red mt-1 h-8 w-8 shrink-0 rounded-full transition-all"
                                title="Stop generation"
                            >
                                <Square className="h-4 w-4" />
                                <span className="sr-only">Stop generation</span>
                            </Button>
                        ) : (
                            <Button
                                onClick={onSend}
                                disabled={!input.trim()}
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
                        )}
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        <p>{isLoading ? "Stop generation" : "Send Message"}</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            {/* Bottom Section: single control row. Usage sits inline left of
                the Managed/BYOK pill (inside ControlPanel) with details on
                hover — nothing expands below. */}
            <div className="px-3 pb-2">
                <ControlPanel />
            </div>
        </div>
    )
}
