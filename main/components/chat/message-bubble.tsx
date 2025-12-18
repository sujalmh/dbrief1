"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { BrainCircuit, AlertTriangle } from "lucide-react"
import { Message, useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { PlanningGrid } from "@/components/chat/planning-grid"
import { RadioWave } from "@/components/chat/radio-wave"

interface MessageBubbleProps {
    message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user"
    const isError = message.isError

    return (
        <div
            className={cn(
                "flex w-full gap-3 p-4",
                isUser ? "flex-row-reverse" : "flex-row"
            )}
        >
            <Avatar className={cn("h-8 w-8 border", isUser ? "bg-muted/50 border-[var(--f1-red)]" : "bg-background")}>
                <AvatarFallback className={cn("text-xs font-bold", isUser ? "text-[var(--f1-red)] bg-transparent" : "bg-background text-foreground")}>
                    {isUser ? "DRV" : "PIT"}
                </AvatarFallback>
                {!isUser && <AvatarImage src="/f1-logo-small.png" alt="AI" />}
            </Avatar>

            <div
                className={cn(
                    "relative flex flex-col gap-2 rounded-xl text-sm shadow-sm",
                    isUser
                        ? "max-w-[85%] md:max-w-[75%] px-4 py-3 border border-[var(--f1-red)] bg-[var(--f1-red)]/5 text-foreground"
                        : "w-full max-w-none px-0 py-2 bg-transparent shadow-none"
                )}
            >
                {/* Header Name (Optional) */}
                {!isUser && (
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1">
                        Race Engineer
                    </span>
                )}

                {/* Reasoning Block */}
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

                {/* Planning Steps */}
                {message.steps && message.steps.length > 0 && (
                    <PlanningGrid steps={message.steps} />
                )}

                {/* Content */}
                <div className={cn(
                    "prose prose-sm break-words dark:prose-invert max-w-none leading-relaxed",
                    isUser ? "text-foreground prose-p:text-foreground prose-headings:text-foreground" : "text-foreground"
                )}>
                    {message.content ? (
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                                table: ({ node, ...props }) => (
                                    <div className="my-4 w-full overflow-y-auto rounded-lg border">
                                        <table className="w-full text-sm" {...props} />
                                    </div>
                                ),
                                thead: ({ node, ...props }) => <thead className="bg-muted/50 text-left font-medium" {...props} />,
                                th: ({ node, ...props }) => <th className="px-4 py-3 font-medium border-b" {...props} />,
                                td: ({ node, ...props }) => <td className="px-4 py-3 border-b last:border-0" {...props} />,
                                hr: ({ node, ...props }) => <hr className="my-8 border-muted" {...props} />
                            }}
                        >
                            {message.content}
                        </ReactMarkdown>
                    ) : !isUser && !isError ? (
                        <div className="flex items-center gap-3 py-2">
                            <span className="text-xs font-mono text-muted-foreground animate-pulse">
                                AWAITING DATA...
                            </span>
                            <RadioWave />
                        </div>
                    ) : null}
                </div>

                {/* Error Indicator */}
                {isError && (
                    <div className="mt-2 flex items-center gap-2 text-xs font-bold uppercase">
                        <AlertTriangle className="h-3 w-3" />
                        <span>Transmission Error</span>
                    </div>
                )}

                {/* Visualization Action */}
                {message.visualizationData && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                        <button
                            onClick={() => useChatStore.getState().setVisualizationData(message.visualizationData)}
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
