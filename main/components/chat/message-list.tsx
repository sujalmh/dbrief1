"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { MessageBubble } from "@/components/chat/message-bubble"
import { computeIsAtEnd, shouldAutoFollow, resolveJumpBehavior } from "@/lib/chat/scroll-follow"

/**
 * Render the chat message list with live-edge follow.
 * ====================================================
 * Follows the live edge only while the reader is already at the bottom
 * (40px band): streaming tokens never yank a reader who scrolled up.
 * A pill button appears off-bottom to jump back with smooth motion.
 *
 * When there are no messages, renders a centered placeholder prompting to connect telemetry.
 * When messages exist, renders each message as a MessageBubble.
 *
 * In-chat charts (t3code-style): each assistant bubble owns its charts.
 * The list derives the preceding user query per assistant message so
 * `InlineCharts` can focus smart-aggregator titles/highlights without
 * any global `activeMessageId` panel state.
 *
 * @returns The rendered message list element
 */
export function MessageList() {
    // Slice subscriptions: typing in the input (or settings/session
    // changes) must not re-render the whole message list.
    const messages = useChatStore((s) => s.messages)
    const isLoading = useChatStore((s) => s.isLoading)
    const bottomRef = useRef<HTMLDivElement>(null)
    const scrollerRef = useRef<HTMLElement | null>(null)
    const isAtEndRef = useRef(true)
    const [showPill, setShowPill] = useState(false)

    function readScroller(): HTMLElement | null {
        if (scrollerRef.current) return scrollerRef.current;
        const el = bottomRef.current?.closest("[data-chat-scroll]") as HTMLElement | null;
        scrollerRef.current = el;
        return el;
    }

    function measureAtEnd(): boolean {
        const el = readScroller();
        if (!el) return true;
        return computeIsAtEnd({
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
        });
    }

    function scrollToBottom(behavior: ScrollBehavior) {
        const el = readScroller();
        if (el) {
            el.scrollTo({ top: el.scrollHeight, behavior });
        } else {
            bottomRef.current?.scrollIntoView({ behavior, block: "end" });
        }
        isAtEndRef.current = true;
    }

    // Track the reader's position (rAF-throttled, passive). Scrolling up
    // breaks follow implicitly — the stream below never forces it back.
    // All pill writes happen in the async update, never synchronously in
    // the effect body.
    useEffect(() => {
        const el = readScroller();
        if (!el) return;
        let frame = 0;
        const update = () => {
            frame = 0;
            const atEnd = measureAtEnd();
            isAtEndRef.current = atEnd;
            setShowPill((prev) => {
                const next = !atEnd && messages.length > 0;
                return prev === next ? prev : next;
            });
        };
        const onScroll = () => {
            if (frame) return;
            frame = requestAnimationFrame(update);
        };
        // Sync once after mount / session switch via rAF (measure only,
        // never jump — restored sessions open where they are).
        frame = requestAnimationFrame(update);
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            el.removeEventListener("scroll", onScroll);
            if (frame) cancelAnimationFrame(frame);
        };
        // messages.length in deps re-syncs the pill after session loads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length])

    // Follow the live edge while streaming (instant, so tokens track
    // tightly) and settle to the bottom when a turn completes — but only
    // when the reader is already at the end. Session loads never jump:
    // they replace the list while isLoading is false and the reader is
    // wherever the last measure says. No state writes here by design.
    useEffect(() => {
        if (shouldAutoFollow(isLoading, isAtEndRef.current)) {
            scrollToBottom("auto");
        } else if (!isLoading && isAtEndRef.current && messages.length > 0) {
            scrollToBottom("auto");
        }
        // Intentionally token-driven: every streamed update re-checks.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages, isLoading])

    function jumpToEnd() {
        const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        setShowPill(false);
        scrollToBottom(resolveJumpBehavior(isLoading, reduced));
    }

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

    // Preceding user query per message (for inline chart focus). Walk once:
    // every assistant message inherits the latest user content before it.
    let lastUserQuery = ""
    const userQueryById = new Map<string, string>()
    for (const msg of messages) {
        if (msg.role === "user") {
            lastUserQuery = msg.content
        } else {
            userQueryById.set(msg.id, lastUserQuery)
        }
    }

    return (
        <div className="h-full w-full min-w-0 max-w-full p-3 sm:p-4">
            <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 pb-32">
                {messages.map((msg) => {
                    const isLastAssistant = msg.role === 'assistant' && msg.id === lastAssistantMessageId
                    return (
                        <MessageBubble
                            key={msg.id}
                            message={msg}
                            isLastAssistant={isLastAssistant}
                            userQuery={userQueryById.get(msg.id) ?? ""}
                            isStreaming={isLoading && isLastAssistant}
                        />
                    )
                })}
                <div ref={bottomRef} />
            </div>
            {/* Live-edge pill — sticky within the scroll container so it
                floats above the newest message without extra layout. */}
            {showPill && (
                <div className="sticky bottom-24 z-10 -mt-10 flex justify-center pb-2 pointer-events-none">
                    <button
                        type="button"
                        onClick={jumpToEnd}
                        aria-label="Jump to latest message"
                        className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-background/90 shadow-lg backdrop-blur transition-colors hover:text-foreground text-muted-foreground"
                    >
                        <ArrowDown className="h-4 w-4" />
                    </button>
                </div>
            )}
        </div>
    )
}
