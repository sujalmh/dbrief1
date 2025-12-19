"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { BrainCircuit, AlertTriangle } from "lucide-react"
import { Message, useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { PlanningGrid } from "@/components/chat/planning-grid"
import { RadioWave } from "@/components/chat/radio-wave"
import { useEffect, useRef, useMemo, memo, useCallback } from "react"
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
    table: ({ ...props }) => <div className="my-4 w-full overflow-y-auto rounded-lg border"><table className="w-full text-sm" {...props} /></div>,
    thead: ({ ...props }) => <thead className="bg-muted/50 text-left font-medium" {...props} />,
    th: ({ ...props }) => <th className="px-4 py-3 font-medium border-b" {...props} />,
    hr: ({ ...props }) => <hr className="my-8 border-muted" {...props} />,
    h1: ({ ...props }) => <h1 className="mt-6 mb-4 text-2xl font-black uppercase italic tracking-widest text-foreground border-b border-[var(--f1-red)] pb-2" {...props} />,
    h2: ({ ...props }) => <h2 className="mt-5 mb-3 text-lg font-bold uppercase italic tracking-wider text-foreground" {...props} />,
    h3: ({ ...props }) => <h3 className="mt-4 mb-2 text-base font-bold uppercase italic tracking-wide text-muted-foreground" {...props} />,
    p: ({ children }) => <p className="mb-4 last:mb-0"><HighlightedText>{children}</HighlightedText></p>,
    li: ({ children, ...props }) => <li {...props}><HighlightedText>{children}</HighlightedText></li>,
    td: ({ children, ...props }) => <td className="px-4 py-3 border-b last:border-0" {...props}><HighlightedText>{children}</HighlightedText></td>,
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

    // Use stable selector to avoid re-renders from unrelated store changes
    const setActiveMessageId = useChatStore(
        useCallback((state) => state.setActiveMessageId, [])
    )

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

                {message.reasoning && (
                    <div className="mb-2 rounded-lg border border-[var(--f1-purple)]/30 bg-[var(--f1-purple)]/5 p-3 text-xs">
                        <div className="flex items-center gap-2 mb-1 font-semibold text-[var(--f1-purple)]">
                            <BrainCircuit className="h-3 w-3" />
                            <span>Telemetry Analysis</span>
                        </div>
                        <div className="text-muted-foreground font-mono leading-relaxed">
                            {message.reasoning}
                        </div>
                    </div>
                )}

                {message.steps && message.steps.length > 0 && <PlanningGrid steps={message.steps} />}

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