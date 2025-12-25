"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { BrainCircuit, AlertTriangle, Copy, Check, RotateCcw, Trash2, FileText } from "lucide-react"
import { Message, useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { PlanningGrid } from "@/components/chat/planning-grid"
import { RadioWave } from "@/components/chat/radio-wave"
import { useEffect, useRef, useMemo, memo, useCallback, useState } from "react"
import { useChatHandler } from "@/lib/hooks/use-chat-handler"
import { getDriverColor, DRIVER_REGEX } from "@/lib/f1-colors"
import type { Components } from "react-markdown"

interface MessageBubbleProps {
    message: Message
}

// --- HELPER: Highlights driver names in text ---
const highlightDrivers = (text: string) => {
    if (!text) return text;

    const parts = text.split(DRIVER_REGEX);

    return parts.map((part, index) => {
        const color = getDriverColor(part);

        if (color !== "#FFFFFF") {
            return (
                <span
                    key={index}
                    style={{ color: color }}
                    className="font-bold brightness-110 drop-shadow-sm"
                >
                    {part}
                </span>
            );
        }
        return part;
    });
};

// Reusable component for Markdown elements - memoized
const HighlightedText = memo(function HighlightedText({ children }: { children: React.ReactNode }) {
    if (typeof children === 'string') {
        return <>{highlightDrivers(children)}</>;
    }

    if (Array.isArray(children)) {
        return (
            <>
                {children.map((child, i) => {
                    if (typeof child === 'string') return <span key={i}>{highlightDrivers(child)}</span>;
                    return <span key={i}>{child}</span>;
                })}
            </>
        );
    }

    return <>{children}</>;
});

// Memoized markdown components - defined outside component to avoid recreation
const createMarkdownComponents = (): Components => ({
    table: ({ ...props }) => <div className="my-4 w-full overflow-x-auto"><table className="w-full text-sm border-collapse" {...props} /></div>,
    thead: ({ ...props }) => <thead className="bg-muted/50 text-left font-medium" {...props} />,
    th: ({ ...props }) => <th className="px-4 py-3 font-bold border-b border-border/70 text-left" {...props} />,
    hr: ({ ...props }) => <hr className="my-8 border-muted" {...props} />,
    h1: ({ ...props }) => <h1 className="mt-6 mb-4 text-2xl font-black uppercase italic tracking-widest text-foreground border-b border-[var(--f1-red)] pb-2" {...props} />,
    h2: ({ ...props }) => <h2 className="mt-5 mb-3 text-lg font-bold uppercase italic tracking-wider text-foreground" {...props} />,
    h3: ({ ...props }) => <h3 className="mt-4 mb-2 text-base font-bold uppercase italic tracking-wide text-muted-foreground" {...props} />,
    p: ({ children }) => <p className="mb-4 last:mb-0"><HighlightedText>{children}</HighlightedText></p>,
    li: ({ children, ...props }) => <li {...props}><HighlightedText>{children}</HighlightedText></li>,
    td: ({ children, ...props }) => <td className="px-4 py-3 border-b border-border/70" {...props}><HighlightedText>{children}</HighlightedText></td>,
    strong: ({ children, ...props }) => <strong {...props}><HighlightedText>{children}</HighlightedText></strong>
});

// Cache the markdown components
const markdownComponents = createMarkdownComponents();

// Memoized remark plugins array
const remarkPlugins = [remarkGfm];

// Inner component for the message content - heavily memoized
const MessageContent = memo(function MessageContent({
    content,
    isUser,
    isError
}: {
    content: string;
    isUser: boolean;
    isError?: boolean;
}) {
    if (content) {
        return (
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                components={markdownComponents}
            >
                {content}
            </ReactMarkdown>
        );
    }

    if (!isUser && !isError) {
        return (
            <div className="flex items-center gap-3 py-2">
                <span className="text-xs font-mono text-muted-foreground animate-pulse">AWAITING DATA...</span>
                <RadioWave />
            </div>
        );
    }

    return null;
});

// Main component wrapped in React.memo for performance
function MessageBubbleComponent({ message }: MessageBubbleProps) {
    const isUser = message.role === "user"
    const isError = message.isError
    const containerRef = useRef<HTMLDivElement>(null)
    const [isCopied, setIsCopied] = useState(false)

    const { messages, deleteMessage } = useChatStore()
    const { handleSend, isLoading } = useChatHandler()

    // Determine if this is the last assistant message
    const isLastAssistant = useMemo(() => {
        if (isUser) return false
        const assistantMessages = messages.filter(m => m.role === 'assistant')
        return assistantMessages[assistantMessages.length - 1]?.id === message.id
    }, [messages, message.id, isUser])

    // Use stable selector to avoid re-renders from unrelated store changes
    const setActiveMessageId = useChatStore(
        useCallback((state) => state.setActiveMessageId, [])
    )

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(message.content)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
    }, [message.content])

    const handleRetry = useCallback(async () => {
        // Find the user message immediately preceding this assistant message
        const msgIndex = messages.findIndex(m => m.id === message.id)
        if (msgIndex <= 0) return

        const prevUserMsg = messages.slice(0, msgIndex).reverse().find(m => m.role === 'user')
        if (!prevUserMsg) return

        // Delete the current message (the one we want to replace)
        deleteMessage(message.id)

        // Regenerate
        await handleSend(prevUserMsg.content)
    }, [message.id, messages, deleteMessage, handleSend])

    // Memoize the intersection observer callback
    const handleIntersection = useCallback((entries: IntersectionObserverEntry[]) => {
        if (entries[0]?.isIntersecting) {
            setActiveMessageId(message.id)
        }
    }, [message.id, setActiveMessageId])

    useEffect(() => {
        if (isUser) return;

        const observer = new IntersectionObserver(handleIntersection, {
            rootMargin: '-40% 0px -40% 0px',
            threshold: 0
        })

        if (containerRef.current) {
            observer.observe(containerRef.current)
        }

        return () => observer.disconnect()
    }, [isUser, handleIntersection])

    // Memoize the visualization button click handler
    const handleShowChart = useCallback(() => {
        useChatStore.getState().setVisualizationData(message.visualizationData)
    }, [message.visualizationData])

    return (
        <div ref={containerRef} className={cn("flex w-full gap-3 p-4", isUser ? "flex-row-reverse" : "flex-row")}>
            <Avatar className={cn("h-8 w-8 border", isUser ? "bg-muted/50 border-[var(--f1-red)]" : "bg-background")}>
                <AvatarFallback className={cn("text-xs font-bold", isUser ? "text-[var(--f1-red)] bg-transparent" : "bg-background text-foreground")}>
                    {isUser ? "DRV" : "PIT"}
                </AvatarFallback>
                {!isUser && <AvatarImage src="/f1-logo-small.png" alt="AI" />}
            </Avatar>

            <div className={cn(
                "relative flex flex-col gap-2 rounded-xl text-sm shadow-sm",
                isUser
                    ? "max-w-[85%] md:max-w-[75%] px-4 py-3 border border-[var(--f1-red)] bg-[var(--f1-red)]/5 text-foreground"
                    : "w-full max-w-none px-0 py-2 bg-transparent shadow-none"
            )}>
                {!isUser && (
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1">
                        Race Engineer
                    </span>
                )}

                {message.steps && message.steps.length > 0 && <PlanningGrid steps={message.steps} reasoning={message.reasoning} />}

                <div className={cn("prose prose-sm break-words dark:prose-invert max-w-none leading-relaxed", isUser ? "text-foreground" : "text-foreground")}>
                    <MessageContent
                        content={message.content}
                        isUser={isUser}
                        isError={isError}
                    />
                </div>

                {isError && (
                    <div className="mt-2 flex items-center gap-2 text-xs font-bold uppercase">
                        <AlertTriangle className="h-3 w-3" />
                        <span>Transmission Error</span>
                    </div>
                )}

                {message.visualizationData && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                        <button
                            onClick={handleShowChart}
                            className="flex items-center gap-2 text-xs font-medium text-[var(--f1-red)] hover:text-[var(--f1-red)]/80 transition-colors"
                        >
                            <BrainCircuit className="h-3.5 w-3.5" />
                            Show Chart
                        </button>
                    </div>
                )}

                {/* Citations Section */}
                {message.citations && message.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sources</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {message.citations.map((citation, i) => (
                                <div
                                    key={i}
                                    className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border border-border/50 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    <FileText className="h-3 w-3" />
                                    <span className="truncate max-w-[200px]">{citation.source}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Message Actions Toolbar */}
                <div className={cn(
                    "flex items-center gap-1 mt-2",
                    isUser ? "justify-end" : "justify-start"
                )}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="minimal"
                                size="icon"
                                className="h-7 w-7 rounded-sm hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                                onClick={handleCopy}
                            >
                                {isCopied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                                <span className="sr-only">Copy</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[10px] px-2 py-1">
                            <p>{isCopied ? "Copied!" : "Copy Message"}</p>
                        </TooltipContent>
                    </Tooltip>

                    {!isUser && isLastAssistant && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="minimal"
                                    size="icon"
                                    className="h-7 w-7 rounded-sm hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={handleRetry}
                                    disabled={isLoading}
                                >
                                    <RotateCcw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
                                    <span className="sr-only">Retry</span>
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px] px-2 py-1">
                                <p>Regenerate Response</p>
                            </TooltipContent>
                        </Tooltip>
                    )}

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-sm hover:bg-muted/50 text-muted-foreground hover:text-red-500 transition-colors"
                                onClick={() => deleteMessage(message.id)}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span className="sr-only">Delete</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[10px] px-2 py-1">
                            <p>Delete Message</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </div>
    )
}

// Export memoized component with custom comparison
export const MessageBubble = memo(MessageBubbleComponent, (prevProps, nextProps) => {
    // Only re-render if the message actually changed
    const prev = prevProps.message;
    const next = nextProps.message;

    return (
        prev.id === next.id &&
        prev.content === next.content &&
        prev.role === next.role &&
        prev.isError === next.isError &&
        prev.reasoning === next.reasoning &&
        prev.visualizationData === next.visualizationData &&
        JSON.stringify(prev.steps) === JSON.stringify(next.steps)
    );
});