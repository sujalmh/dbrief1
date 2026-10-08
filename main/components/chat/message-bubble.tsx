"use client"

import ReactMarkdown, { type Options as ReactMarkdownOptions } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkBreaks from "remark-breaks"
import dynamic from "next/dynamic"
import { AlertTriangle, Copy, Check, RotateCcw, Trash2, FileText, ShieldCheck, AlertOctagon, ThumbsUp, ThumbsDown } from "lucide-react"
import { Message, useChatStore } from "@/lib/store"
import { cn, citationHref } from "@/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { PlanningGrid } from "@/components/chat/planning-grid"
import { EvidencePanel } from "@/components/chat/evidence-panel"
import { ReflectionTrace } from "@/components/chat/reflection-trace"
import { UsageFooter } from "@/components/chat/usage-footer"
import { useRef, memo, useCallback, useState, useMemo, useEffect } from "react"
import { useChatHandler } from "@/lib/hooks/use-chat-handler"
import { getDriverColor, getDriverPattern, seasonFromPayload } from "@/lib/f1-colors"
import type { Components } from "react-markdown"
import type { PluggableList } from "unified"

import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import { createIncrementalMarkdownPlugin } from "@/lib/markdown/incremental"
import { remarkGithubAlerts, type GithubAlertKind } from "@/lib/markdown/alerts"
import { serializeTableElementToMarkdown, serializeTableElementToCsv } from "@/lib/markdown/tables"

// Recharts (via InlineCharts → ChartDispatcher) is the heaviest dependency
// in the app — load it only when a chart actually needs to render, not with
// the initial chat bundle. t3code-style: charts live inside the message,
// so the split point moves here from the old side panel.
const InlineCharts = dynamic(
    () => import("@/components/visualization/inline-charts").then((m) => m.InlineCharts),
    { ssr: false, loading: () => null }
);

interface MessageBubbleProps {
    message: Message
    isLastAssistant?: boolean
    /** Public shared view: hide action toolbars and skip store writes. */
    readOnly?: boolean
    /** Preceding user query — focuses inline chart titles/highlights. */
    userQuery?: string
    /** True while this assistant message is still streaming. */
    isStreaming?: boolean
}

// --- HELPER: Highlights driver names in text ---
// Pattern is rebuilt per call so drivers learned from live API payloads
// (new codes, mid-season swaps) highlight without a reload. `season`
// prefers that year's learned colors when available.
const highlightDrivers = (text: string, season?: number) => {
    if (!text) return text;

    const parts = text.split(getDriverPattern());

    return parts.map((part, index) => {
        const color = getDriverColor(part, season);

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
const HighlightedText = memo(function HighlightedText({ children, season }: { children: React.ReactNode; season?: number }) {
    if (typeof children === 'string') {
        return <>{highlightDrivers(children, season)}</>;
    }

    if (Array.isArray(children)) {
        return (
            <>
                {children.map((child, i) => {
                    if (typeof child === 'string') return <span key={i}>{highlightDrivers(child, season)}</span>;
                    return <span key={i}>{child}</span>;
                })}
            </>
        );
    }

    return <>{children}</>;
});

// Memoized markdown components - defined outside component to avoid recreation
const createMarkdownComponents = (season?: number): Components => ({
    // Long URLs never push the 360px layout wider — break anywhere.
    // External links get a favicon + open in a new tab.
    a: ({ node: _node, href, children }) => {
        void _node;
        let host: string | null = null;
        if (typeof href === "string" && /^https?:\/\//i.test(href)) {
            try {
                host = new URL(href).hostname;
            } catch {
                host = null;
            }
        }
        return (
            <a
                className="break-all underline underline-offset-2"
                href={href}
                target={host ? "_blank" : undefined}
                rel={host ? "noopener noreferrer" : undefined}
            >
                {host && (
                    <img
                        src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
                        alt=""
                        aria-hidden
                        loading="lazy"
                        // Inline margins: the prose stylesheet gives images
                        // 2em vertical margins (unlayered, beats utilities),
                        // which would push the icon off its line.
                        style={{ marginTop: 0, marginBottom: 0 }}
                        className="mr-1 inline h-3 w-3 rounded-sm align-baseline"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                        }}
                    />
                )}
                {children}
            </a>
        );
    },
    img: ({ node: _node, ...props }) => {
        void _node;
        return <img className="h-auto max-w-full rounded-lg" {...props} />;
    },
    table: ({ node: _node, children }) => {
        void _node;
        return <TableBlock>{children}</TableBlock>;
    },
    thead: ({ node: _node, ...props }) => {
        void _node;
        return <thead className="bg-muted/50 text-left font-medium" {...props} />;
    },
    th: ({ node: _node, ...props }) => {
        void _node;
        return <th className="px-4 py-3 font-bold border-b border-border/70 text-left whitespace-nowrap" {...props} />;
    },
    pre: ({ node: _node, ...props }) => {
        void _node;
        // Long code/JSON dumps scroll internally instead of pushing the
        // bubble (and the whole 390px layout) wider than the viewport.
        return <pre className="max-w-full overflow-x-auto rounded-lg bg-muted/50 p-3 text-xs leading-relaxed" {...props} />;
    },
    hr: ({ node: _node, ...props }) => {
        void _node;
        return <hr className="my-8 border-muted" {...props} />;
    },
    h1: ({ node: _node, ...props }) => {
        void _node;
        return <h1 aria-level={2} className="mt-6 mb-4 text-2xl font-black uppercase italic tracking-widest text-foreground border-b border-[var(--f1-red)] pb-2" {...props} />;
    },
    h2: ({ node: _node, ...props }) => {
        void _node;
        return <h2 aria-level={3} className="mt-5 mb-3 text-lg font-bold uppercase italic tracking-wider text-foreground" {...props} />;
    },
    h3: ({ node: _node, ...props }) => {
        void _node;
        return <h3 aria-level={4} className="mt-4 mb-2 text-base font-bold uppercase italic tracking-wide text-muted-foreground" {...props} />;
    },
    // GitHub alert callouts (`> [!NOTE]` …) render as colored notes.
    blockquote: ({ node, children }) => {
        const alert = (node?.properties as Record<string, unknown> | undefined)?.dataAlert;
        if (typeof alert !== "string" || !(alert in GITHUB_ALERT_STYLES)) {
            return <blockquote>{children}</blockquote>;
        }
        const style = GITHUB_ALERT_STYLES[alert as GithubAlertKind]!;
        return (
            <div role="note" className={`my-3 border-l-2 pl-3 ${style.className}`}>
                <p className={`flex items-center gap-1.5 font-medium ${style.titleClassName}`}>
                    <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
                    {style.label}
                </p>
                {children}
            </div>
        );
    },
    // Native collapsibles, styled. Zero deps.
    details: ({ node: _node, children }) => {
        void _node;
        return (
            <details className="my-2 rounded-lg border border-border/60 px-3 py-2 [&>summary]:cursor-pointer [&>summary]:text-sm [&>summary]:font-medium">
                {children}
            </details>
        );
    },
    summary: ({ node: _node, children }) => {
        void _node;
        return <summary>{children}</summary>;
    },
    p: ({ children }) => <p className="mb-4 last:mb-0"><HighlightedText season={season}>{children}</HighlightedText></p>,
    li: ({ children, ...props }) => <li {...props}><HighlightedText season={season}>{children}</HighlightedText></li>,
    td: ({ children, ...props }) => <td className="px-4 py-3 border-b border-border/70" {...props}><HighlightedText season={season}>{children}</HighlightedText></td>,
    strong: ({ children, ...props }) => <strong {...props}><HighlightedText season={season}>{children}</HighlightedText></strong>
});

/** Rotating pit-wall loading lines while the answer streams in. */
export const LOADING_LINES = [
    "Race engineer is thinking…",
    "Churning through the data…",
    "Reading telemetry traces…",
    "Checking timing screens…",
    "Crunching lap times…",
    "Scanning the field…",
    "Plotting strategy options…",
    "Warming up the pit wall…",
];

/** How long each loading line shows before rotating. */
export const LOADING_LINE_INTERVAL_MS = 2400;

// rehype-sanitize strips unknown hast properties by default, which would
// drop the alert kind (`dataAlert`) our blockquote renderer reads.
const rehypeSanitizeSchema = {
    ...defaultSchema,
    attributes: {
        ...defaultSchema.attributes,
        blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataAlert"],
    },
};
const rehypePlugins = [[rehypeSanitize, rehypeSanitizeSchema]] as ReactMarkdownOptions["rehypePlugins"];

/** GitHub's five alert kinds with the host's urgency colors. */
const GITHUB_ALERT_STYLES: Record<
    GithubAlertKind,
    { label: string; className: string; titleClassName: string }
> = {
    note: {
        label: "Note",
        className: "border-blue-500/70",
        titleClassName: "text-blue-600 dark:text-blue-400",
    },
    tip: {
        label: "Tip",
        className: "border-emerald-500/70",
        titleClassName: "text-emerald-600 dark:text-emerald-400",
    },
    important: {
        label: "Important",
        className: "border-purple-500/70",
        titleClassName: "text-purple-600 dark:text-purple-400",
    },
    warning: {
        label: "Warning",
        className: "border-amber-500/70",
        titleClassName: "text-amber-600 dark:text-amber-500",
    },
    caution: {
        label: "Caution",
        className: "border-red-500/70",
        titleClassName: "text-red-600 dark:text-red-400",
    },
};


/**
 * Table with copy helpers (Markdown + CSV). The table itself keeps the
 * existing scroll-inside wrapper so wide tables never push the layout.
 */
function TableBlock({ children }: { children: React.ReactNode }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleCopy = useCallback((format: "markdown" | "csv") => {
        const table = containerRef.current?.querySelector("table");
        if (!table || typeof navigator === "undefined" || navigator.clipboard == null) return;
        const text =
            format === "markdown"
                ? serializeTableElementToMarkdown(table)
                : serializeTableElementToCsv(table);
        void navigator.clipboard
            .writeText(text)
            .then(() => {
                if (copiedTimerRef.current != null) clearTimeout(copiedTimerRef.current);
                setCopied(true);
                copiedTimerRef.current = setTimeout(() => {
                    setCopied(false);
                    copiedTimerRef.current = null;
                }, 1200);
            })
            .catch(() => {
                // Clipboard unavailable — leave the buttons as-is.
            });
    }, []);

    return (
        <div className="my-4 w-full max-w-full">
            <div ref={containerRef} className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-[420px] sm:min-w-[520px] text-sm border-collapse">
                    {children}
                </table>
            </div>
            <div className="mt-1 flex items-center justify-end gap-1" role="toolbar" aria-label="Table actions">
                {(["markdown", "csv"] as const).map((format) => (
                    <button
                        key={format}
                        type="button"
                        onClick={() => handleCopy(format)}
                        className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                    >
                        {copied ? "Copied" : format === "markdown" ? "Copy MD" : "Copy CSV"}
                    </button>
                ))}
            </div>
        </div>
    );
}

// Inner component for the message content - heavily memoized.
// Exported for reuse by the landing capability carousel so the demo
// answers render with the exact chat typography + driver highlighting.
export const MessageContent = memo(function MessageContent({
    content,
    isUser,
    isError,
    season,
    steps,
    iterations,
    isStreaming,
    lineBreaks,
}: {
    content: string;
    isUser: boolean;
    isError?: boolean;
    season?: number;
    steps?: Message['steps'];
    iterations?: Message['iterations'];
    /** True while this message's tokens are still arriving. */
    isStreaming?: boolean;
    /** Treat single newlines as hard breaks (chat-style user input). */
    lineBreaks?: boolean;
}) {
    // Per-season component set so driver highlights prefer that year's
    // learned colors. Memoized on season + streaming flag (stable across
    // re-renders, so component identity never churns mid-stream).
    const components = useMemo(() => createMarkdownComponents(season), [season]);
    // One incremental-parser instance per renderer (the parse cache lives
    // in its closure). Only engaged while streaming code-heavy text.
    const incrementalPlugin = useMemo(() => createIncrementalMarkdownPlugin(), []);
    const remarkPlugins: PluggableList = useMemo(() => {
        const plugins: PluggableList = lineBreaks
            ? [remarkGfm, remarkBreaks, remarkGithubAlerts]
            : [remarkGfm, remarkGithubAlerts];
        if (isStreaming && content.includes("```")) plugins.push(incrementalPlugin);
        return plugins;
    }, [lineBreaks, isStreaming, content, incrementalPlugin]);
    // Live status line while streaming: show what the pipeline is doing
    // right now (running step/task) instead of a static placeholder.
    const statusLine = useMemo(() => {
        if (steps && steps.length > 0) {
            const running = steps.find((s) => s.status === "running");
            if (running) return running.description;
            if (steps.every((s) => s.status === "pending")) return "Planning…";
            const done = steps.filter((s) => s.status === "success" || s.status === "failed").length;
            return `Step ${Math.min(done + 1, steps.length)} of ${steps.length}…`;
        }
        if (iterations && iterations.length > 0) {
            for (let i = iterations.length - 1; i >= 0; i--) {
                const running = iterations[i].tasks.find((t) => t.status === "running");
                if (running) return running.description;
            }
            return "Researching…";
        }
        return null;
    }, [steps, iterations]);
    // Rotating pit-wall loading lines while no live step status exists.
    // The timer only runs for the empty state below (live pipeline text
    // always wins when present).
    const [flavorIndex, setFlavorIndex] = useState(0);
    useEffect(() => {
        if (content || statusLine) return;
        const id = setInterval(() => {
            setFlavorIndex((i) => (i + 1) % LOADING_LINES.length);
        }, LOADING_LINE_INTERVAL_MS);
        return () => clearInterval(id);
    }, [content, statusLine]);
    const loadingLine = statusLine ?? LOADING_LINES[flavorIndex % LOADING_LINES.length] ?? "Race engineer is thinking…";
    if (content) {
        return (
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={components}
            >
                {content}
            </ReactMarkdown>
        );
    }

    if (!isUser && !isError) {
        return (
            <div className="flex min-w-0 max-w-full items-center gap-3 py-2" aria-live="polite">
                <span className="flex shrink-0 items-center gap-1" aria-hidden>
                    {[0, 1, 2].map((i) => (
                        <span
                            key={i}
                            className="h-1.5 w-1.5 rounded-full bg-[var(--f1-red)] animate-bounce"
                            style={{ animationDelay: `${i * 180}ms` }}
                        />
                    ))}
                </span>
                <span
                    title={statusLine ?? undefined}
                    className="text-xs font-mono text-muted-foreground truncate min-w-0 max-w-[55vw] sm:max-w-[300px]"
                >
                    {loadingLine}
                </span>
            </div>
        );
    }

    return null;
});

/**
 * Render a chat message bubble with avatar, formatted content, and contextual action controls.
 *
 * Displays a user or assistant message with avatar, Markdown-rendered content, optional planning steps,
 * citations, inline charts, and an action toolbar (copy, retry, delete). The retry action regenerates
 * the assistant response using the preceding user message; the copy action places the message content
 * on the clipboard.
 *
 * Charts render inline below the text (t3code-style) via `InlineCharts`,
 * which resolves `message.chartSpecs` (deep research) or synthesizes
 * specs from `message.visualizationData` (standard mode). There is no
 * side panel and no `activeMessageId` — every message owns its charts.
 *
 * @param message - The message to render, including role, content, optional steps, reasoning, citations, visualizationData, chartSpecs, and error flag.
 * @param userQuery - Preceding user query used to focus chart titles/highlights.
 * @param isStreaming - True while this assistant message is still streaming.
 * @returns A JSX element representing the message bubble ready for rendering in the chat UI.
 */
function MessageBubbleComponent({ message, isLastAssistant = false, readOnly = false, userQuery = "", isStreaming = false }: MessageBubbleProps) {
    const isUser = message.role === "user"
    const isError = message.isError
    const containerRef = useRef<HTMLDivElement>(null)
    const [isCopied, setIsCopied] = useState(false)

    const deleteMessage = useChatStore(state => state.deleteMessage)
    const setMessageFeedback = useChatStore(state => state.setMessageFeedback)
    const { handleSend, isLoading } = useChatHandler()

    // Delete locally AND in the cloud store (D1 + R2 blobs) so a
    // reopened session stays in sync. Best-effort: local delete always
    // applies; cloud failures only log.
    const deleteEverywhere = useCallback((id: string) => {
        deleteMessage(id)
        const sessionId = useChatStore.getState().currentSessionId
        if (sessionId && !sessionId.startsWith("local_")) {
            import("@/lib/cf/client").then(({ deleteCloudMessage }) => {
                deleteCloudMessage(sessionId, id)
            })
        }
    }, [deleteMessage])

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(message.content)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
    }, [message.content])

    // Thumbs up/down rating (assistant only, once content exists).
    // Clicking the active thumb clears the rating (toggle). The rating
    // lives on the message so it persists to the cloud store on the next
    // save — re-save immediately so a reload keeps it.
    const handleFeedback = useCallback((value: 'up' | 'down') => {
        const next = message.feedback === value ? null : value
        setMessageFeedback(message.id, next)
        const sessionId = useChatStore.getState().currentSessionId
        if (sessionId && !sessionId.startsWith("local_")) {
            const updated = useChatStore.getState().messages.find((m) => m.id === message.id)
            if (updated) {
                import("@/lib/cf/client").then(({ saveMessage }) => {
                    saveMessage(sessionId, updated)
                })
            }
        }
    }, [message.id, message.feedback, setMessageFeedback])

    const handleRetry = useCallback(async () => {
        // We get the current messages from the store to avoid subscribing to them
        const messages = useChatStore.getState().messages;
        const msgIndex = messages.findIndex(m => m.id === message.id)
        if (msgIndex <= 0) return

        const prevUserMsg = messages.slice(0, msgIndex).reverse().find(m => m.role === 'user')
        if (!prevUserMsg) return

        // Delete the current message (the one we want to replace)
        deleteEverywhere(message.id)

        // Regenerate
        await handleSend(prevUserMsg.content)
    }, [message.id, deleteEverywhere, handleSend])

    const ActionsToolbar = (
        <div className={cn(
            "flex items-center gap-1",
            isUser
                // Hover-reveal on desktop; touch has no hover so the
                // actions stay visible on phones.
                ? "opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity self-center mr-2"
                : "mt-2 justify-start"
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

            {!isUser && message.content && !isError && (
                <>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="minimal"
                                size="icon"
                                className={cn(
                                    "h-7 w-7 rounded-sm hover:bg-muted/50 transition-colors",
                                    message.feedback === 'up'
                                        ? "bg-[var(--f1-red)]/10 text-[var(--f1-red)] hover:text-[var(--f1-red)]"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => handleFeedback('up')}
                            >
                                <ThumbsUp className="h-3.5 w-3.5" fill={message.feedback === 'up' ? "currentColor" : "none"} />
                                <span className="sr-only">Good response</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[10px] px-2 py-1">
                            <p>Good response</p>
                        </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="minimal"
                                size="icon"
                                className={cn(
                                    "h-7 w-7 rounded-sm hover:bg-muted/50 transition-colors",
                                    message.feedback === 'down'
                                        ? "bg-[var(--f1-red)]/10 text-[var(--f1-red)] hover:text-[var(--f1-red)]"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                                onClick={() => handleFeedback('down')}
                            >
                                <ThumbsDown className="h-3.5 w-3.5" fill={message.feedback === 'down' ? "currentColor" : "none"} />
                                <span className="sr-only">Bad response</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-[10px] px-2 py-1">
                            <p>Bad response</p>
                        </TooltipContent>
                    </Tooltip>
                </>
            )}

            <Tooltip>
                <TooltipTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-sm hover:bg-muted/50 text-muted-foreground hover:text-red-500 transition-colors"
                        onClick={() => deleteEverywhere(message.id)}
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
    );

    return (
        <div ref={containerRef} className={cn("group flex w-full min-w-0 max-w-full gap-2 md:gap-3 p-3 md:p-4 overflow-hidden", isUser ? "flex-row-reverse" : "flex-row")}>
            <Avatar className={cn("h-8 w-8 shrink-0 border overflow-hidden", isUser ? "bg-muted/50 border-[var(--f1-red)]" : "bg-white border-white/20")}>
                <AvatarFallback className={cn("text-xs font-bold", isUser ? "text-[var(--f1-red)] bg-transparent" : "bg-white text-foreground")}>
                    {isUser ? "DRV" : "PIT"}
                </AvatarFallback>
                {!isUser && <AvatarImage src="/logo.svg" alt="AI" className="object-contain bg-white p-0.5" />}
            </Avatar>

            <div className={cn(
                "relative flex min-w-0 max-w-full flex-col gap-2 overflow-hidden rounded-xl text-sm shadow-sm",
                isUser
                    ? "max-w-[85%] md:max-w-[75%] px-4 py-3 border border-[var(--f1-red)] bg-[var(--f1-red)]/5 text-foreground"
                    : "min-w-0 flex-1 px-0 py-2 bg-transparent shadow-none"
            )}>
                {!isUser && (
                    <span className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground mb-1">
                        Race Engineer
                    </span>
                )}

                {message.steps && message.steps.length > 0 && <PlanningGrid steps={message.steps} reasoning={message.reasoning} />}

                {/* Deep research mode: iterative planning grid */}
                {message.iterations && message.iterations.length > 0 && (
                    <PlanningGrid
                        iterations={message.iterations}
                        researchType={message.researchType}
                        reasoning={message.reasoning}
                    />
                )}

                {/* Deep research mode: reflection trace */}
                {message.reflections && message.reflections.length > 0 && (
                    <ReflectionTrace reflections={message.reflections} />
                )}

                {/* Degraded-mode warning badge.
                    Renders when the backend reports that one or more LLM
                    steps could not be completed (e.g. intent analysis was
                    skipped because the provider rate-limited us). The
                    answer may be best-effort — the user should know. */}
                {message.degradedWarnings && message.degradedWarnings.length > 0 && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div
                                data-testid="degraded-warning"
                                className="mt-2 flex items-center gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-2 text-xs"
                            >
                                <AlertOctagon className="h-3.5 w-3.5 text-yellow-400 shrink-0" />
                                <span className="font-bold uppercase tracking-wider text-yellow-400">
                                    Degraded Mode
                                </span>
                                <span className="text-muted-foreground">
                                    {message.degradedWarnings.length === 1
                                        ? "Some LLM steps were skipped — the answer may be less precise."
                                        : `${message.degradedWarnings.length} LLM steps were skipped — the answer may be less precise.`}
                                </span>
                            </div>
                        </TooltipTrigger>
                        <TooltipContent
                            side="bottom"
                            className="max-w-xs text-[11px] px-3 py-2 space-y-1"
                        >
                            {message.degradedWarnings.map((w, idx) => (
                                <div key={idx} className="space-y-0.5">
                                    <div className="font-bold uppercase text-yellow-400">
                                        {w.stage} ({w.kind})
                                    </div>
                                    <div className="text-muted-foreground">{w.message}</div>
                                </div>
                            ))}
                        </TooltipContent>
                    </Tooltip>
                )}

                <div data-streaming={isStreaming || undefined} className={cn("prose prose-sm break-words dark:prose-invert min-w-0 max-w-full overflow-hidden leading-relaxed [overflow-wrap:anywhere]", isUser ? "text-foreground" : "text-foreground")}>
                    <MessageContent
                        content={message.content}
                        isUser={isUser}
                        isError={isError}
                        season={seasonFromPayload(message.visualizationData)}
                        steps={message.steps}
                        iterations={message.iterations}
                        isStreaming={isStreaming}
                        lineBreaks={isUser}
                    />
                </div>

                {/* Confidence Badge (deep research mode) */}
                {message.confidence && (
                    <div className="mt-2 flex items-center gap-2">
                        <ShieldCheck className={cn(
                            "h-3.5 w-3.5",
                            message.confidence.overall > 0.7 ? "text-green-400" :
                            message.confidence.overall > 0.4 ? "text-yellow-400" : "text-red-400"
                        )} />
                        <span className={cn(
                            "text-xs font-bold",
                            message.confidence.overall > 0.7 ? "text-green-400" :
                            message.confidence.overall > 0.4 ? "text-yellow-400" : "text-red-400"
                        )}>
                            Confidence: {(message.confidence.overall * 100).toFixed(0)}%
                        </span>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="text-[10px] text-muted-foreground cursor-help">
                                    ({message.confidence.factors.sourceCount} sources · {message.confidence.factors.completeness > 0 ? `${(message.confidence.factors.completeness * 100).toFixed(0)}% complete` : "no expectations"})
                                    {message.confidence.factors.missingData.length > 0 && ` · missing: ${message.confidence.factors.missingData.join(", ")}`}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="text-[10px] px-2 py-1">
                                <div className="space-y-1">
                                    <div>Sources: {message.confidence.factors.sourceCount}</div>
                                    <div>Completeness: {(message.confidence.factors.completeness * 100).toFixed(0)}%</div>
                                    <div>Conflicts: {message.confidence.factors.conflicts}</div>
                                    <div>Data Quality: {(message.confidence.factors.dataQuality * 100).toFixed(0)}%</div>
                                </div>
                            </TooltipContent>
                        </Tooltip>
                    </div>
                )}

                {/* Deep research mode: evidence panel */}
                {message.evidence && message.evidence.length > 0 && (
                    <EvidencePanel evidence={message.evidence} />
                )}

                {isError && (
                    <div className="mt-2 flex items-center gap-2 text-xs font-bold uppercase">
                        <AlertTriangle className="h-3 w-3" />
                        <span>Transmission Error</span>
                    </div>
                )}

                {/* In-chat visualizations (t3code-style): charts render inline
                    below the answer for THIS message only. Deep research
                    uses pre-planned `chartSpecs`; standard mode synthesizes
                    specs from raw `visualizationData` + the user query.
                    Charts always render; empty → nothing. */}
                {!isUser && !isError && (
                    <InlineCharts
                        messageId={message.id}
                        chartSpecs={message.chartSpecs}
                        visualizationData={message.visualizationData}
                        query={userQuery}
                        isStreaming={isStreaming}
                        contentStarted={message.content.trim().length > 0}
                    />
                )}

                {/* Citations Section — only LLM-picked, reranked sources.
                    Entries with a url render as clickable links. */}
                {message.citations && message.citations.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Sources</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {message.citations.map((citation, i) => {
                                const label = citation.title || citation.source;
                                // Prefer the collection's canonical link field;
                                // non-http(s) values never become anchors.
                                const href = citationHref(citation);
                                const chipClassName = "flex items-center gap-1.5 px-2 py-1 rounded bg-muted/50 border border-border/50 text-[10px] text-muted-foreground hover:text-foreground transition-colors";
                                const chipContent = (
                                    <>
                                        <FileText className="h-3 w-3 shrink-0" />
                                        <span className="truncate max-w-[200px]" title={label}>{label}</span>
                                    </>
                                );
                                return href ? (
                                    <a
                                        key={i}
                                        href={href}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`${label} — open source`}
                                        className={chipClassName}
                                    >
                                        {chipContent}
                                    </a>
                                ) : (
                                    <div key={i} title={label} className={chipClassName}>
                                        {chipContent}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Per-message stats footer. Response time renders for
                    both modes (client-measured, so it exists even when
                    the backend sent no `usage` event); model + token
                    stats render BYOK-only. Shown on every assistant
                    message with stats — including ones that errored
                    mid-stream, so users still see what was spent. The
                    footer sits below the citations/actions to stay out
                    of the way of the answer itself. */}
                {(message.usage || message.durationMs != null) && !isUser && (
                    <UsageFooter usage={message.usage} durationMs={message.durationMs} />
                )}

                {/* Message Actions Toolbar - Inside for Assistant */}
                {!isUser && !readOnly && ActionsToolbar}
            </div>

            {/* Message Actions Toolbar - Outside for User */}
            {isUser && !readOnly && ActionsToolbar}
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
        prev.feedback === next.feedback &&
        prev.visualizationData === next.visualizationData &&
        prev.chartSpecs === next.chartSpecs &&
        prev.researchType === next.researchType &&
        prev.confidence === next.confidence &&
        // Usage is a single object set once per message via
        // setMessageUsage. Reference equality is sufficient; if
        // someone ever starts mutating it in place we'd need a
        // deeper check, but the store always replaces the whole
        // message object. durationMs is a scalar stamped on
        // completion, so a plain equality check suffices.
        prev.usage === next.usage &&
        prev.durationMs === next.durationMs &&
        prevProps.isLastAssistant === nextProps.isLastAssistant &&
        prevProps.readOnly === nextProps.readOnly &&
        prevProps.userQuery === nextProps.userQuery &&
        prevProps.isStreaming === nextProps.isStreaming &&
        JSON.stringify(prev.steps) === JSON.stringify(next.steps) &&
        JSON.stringify(prev.iterations) === JSON.stringify(next.iterations) &&
        JSON.stringify(prev.evidence) === JSON.stringify(next.evidence) &&
        JSON.stringify(prev.reflections) === JSON.stringify(next.reflections) &&
        JSON.stringify(prev.chartSpecs) === JSON.stringify(next.chartSpecs)
    );
});