"use client"

import { useEffect, useRef } from "react"
import { useChatStore } from "@/lib/store"
import { MessageBubble } from "@/components/chat/message-bubble"

/**
 * Render the chat message list and ensure the view scrolls to the newest message.
 *
 * When there are no messages, renders a centered placeholder prompting to connect telemetry.
 * When messages exist, renders each message as a MessageBubble and keeps a bottom spacer that is scrolled into view whenever messages or loading state change.
 *
 * @returns The rendered message list element
 */
export function MessageList() {
    // Slice subscriptions: typing in the input (or settings/session
    // changes) must not re-render the whole message list.
    const messages = useChatStore((s) => s.messages)
    const isLoading = useChatStore((s) => s.isLoading)
    const bottomRef = useRef<HTMLDivElement>(null)

    // Auto-scroll to bottom on new message
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [messages, isLoading])

    if (messages.length === 0) {
        return (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground opacity-50">
                <div className="mb-4 rounded-full bg-muted p-4">
                    {/* Simple F1 Car or Checkered Flag SVG placeholder */}
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-flag"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></svg>
                </div>
                <h3 className="text-lg font-semibold">Ready to Race</h3>
                <p className="text-sm">Connect to telemetry to start analysis.</p>
            </div>
        )
    }

    // Compute the ID of the last assistant message
    const lastAssistantMessageId = messages
        .filter(m => m.role === 'assistant')
        .pop()?.id;

    return (
        <div className="h-full w-full min-w-0 max-w-full p-3 sm:p-4">
            <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 pb-32">
                {messages.map((msg) => (
                    <MessageBubble 
                        key={msg.id} 
                        message={msg} 
                        isLastAssistant={msg.role === 'assistant' && msg.id === lastAssistantMessageId}
                    />
                ))}
                {/* Loading indicator removed in favor of MessageBubble internal state */}
                <div ref={bottomRef} />
            </div>
        </div>
    )
}