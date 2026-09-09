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
    const { input, setInput } = useChatStore()
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

    const onSend = async () => {
        await handleSend()
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (!isLoading) {
                onSend()
            }
        }
    }


    return (
        <div className="relative rounded-[2rem] border transition-all duration-300 backdrop-blur-xl 
            bg-white/80 border-black/5 shadow-[0_8px_32px_rgba(0,0,0,0.1)] hover:bg-white/90 
            dark:bg-black/40 dark:border-white/10 dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] dark:hover:bg-black/50 
            focus-within:ring-1 focus-within:ring-black/5 dark:focus-within:ring-white/10">

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

            {/* Bottom Section: Integrated Control Panel */}
            <div className="px-3 pb-2">
                <ControlPanel />
            </div>
        </div>
    )
}
