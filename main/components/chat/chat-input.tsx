"use client"

import * as React from "react"
import { Send, Image as ImageIcon } from "lucide-react"
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
    const { handleSend, isLoading } = useChatHandler()
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


    // Gradient outline: 1px gradient ring wrapping the glass body. The
    // outer div IS the border (padding 1px, gradient bg); the inner div
    // is the frosted glass — a light-catching edge, not a flat border.
    return (
        <div className="rounded-[2rem] bg-gradient-to-br from-white/30 via-white/10 to-white/5 p-px shadow-[0_8px_32px_rgba(0,0,0,0.25)] dark:from-white/20 dark:via-white/10 dark:to-transparent dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
        <div className="relative rounded-[calc(2rem-1px)] transition-all duration-300 backdrop-blur-xl
            bg-white/70 hover:bg-white/80
            dark:bg-black/40 dark:hover:bg-black/50
            focus-within:bg-white/80 dark:focus-within:bg-black/50
            shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">

            {/* Top Section: Input Area */}
            <div className="flex gap-2 p-3 pb-0">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="btn-wheel btn-wheel-cyan mt-1 h-8 w-8 shrink-0 rounded-full"
                        >
                            <ImageIcon className="h-5 w-5" />
                            <span className="sr-only">Upload Image</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        <p>Upload Image</p>
                    </TooltipContent>
                </Tooltip>

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
                        <Button
                            onClick={onSend}
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
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        <p>Send Message</p>
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
        </div>
    )
}
