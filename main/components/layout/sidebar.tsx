"use client";

import React from "react";
import { Plus, MessageSquare, LogOut, User as UserIcon, PanelLeft, Trash2 } from "lucide-react";
import { useChatStore } from "@/lib/store"
import type { StoredSession } from "@/lib/store"
import { useSession } from "@/lib/cf/session-context";
import { UsageIndicator } from "@/components/layout/usage-indicator";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import {
    listSessions,
    createSession,
    deleteSession,
    loadMessages,
    loadContext,
} from "@/lib/cf/client";
import { cn, sanitizeCitations } from "@/lib/utils";

export function Sidebar() {
    const {
        sessions,
        currentSessionId,
        setCurrentSessionId,
        setSessions,
        setMessages,
        isSidebarOpen,
        setSidebarOpen
    } = useChatStore();
    const { user, signOut, googleLoginAvailable } = useSession();
    // Mobile (<md) renders as an overlay drawer instead of squeezing
    // the chat column; desktop keeps the collapsible rail.
    const isDesktop = useMediaQuery("(min-width: 768px)");

    // The store defaults the sidebar to open (desktop-first). On a
    // phone that would cover the whole chat on first paint, so park
    // it closed on mobile mounts and whenever the viewport shrinks
    // below md. The header hamburger re-opens it as a drawer.
    // (Mount check reads window directly so desktop SSR hydration
    // doesn't collapse the rail.)
    React.useEffect(() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
            setSidebarOpen(false);
        }
    }, [setSidebarOpen]);
    const prevDesktop = React.useRef<boolean | null>(null);
    React.useEffect(() => {
        if (prevDesktop.current === true && !isDesktop) setSidebarOpen(false);
        prevDesktop.current = isDesktop;
    }, [isDesktop, setSidebarOpen]);

    React.useEffect(() => {
        // Sessions are scoped to the server-issued identity cookie; user
        // is always present after bootstrap (null only when cloud sync is
        // unconfigured, in which case we stay local-only).
        if (user) {
            listSessions().then(setSessions).catch(() => undefined);
        }
    }, [user, setSessions]);

    const handleNewChat = async () => {
        // Check if an empty session already exists
        const emptySession = sessions.find(s => s.title === "New Chat");
        if (emptySession) {
            handleSelectSession(emptySession.id);
            return;
        }

        try {
            const sessionId = await createSession("New Chat");
            const now = Date.now();
            const newSession = {
                id: sessionId,
                title: "New Chat",
                createdAt: now,
                lastMessageAt: now,
                context: {}
            };
            setSessions([newSession, ...sessions]);
            setCurrentSessionId(sessionId);
        } catch {
            // Cloud sync unavailable — fall back to a local-only session.
            const sessionId = `local_${Date.now()}`;
            const now = Date.now();
            setSessions([{
                id: sessionId,
                title: "New Chat",
                createdAt: now,
                lastMessageAt: now,
                context: {}
            }, ...sessions]);
            setCurrentSessionId(sessionId);
        }
        setMessages([]); // Clear messages for new chat
        // Reset panel state so the previous session's charts don't linger.
        useChatStore.setState({ visualizationData: null, graphHistory: [], activeMessageId: null });
        // On phones the sidebar is a drawer — get out of the way.
        if (!isDesktop) setSidebarOpen(false);
    };

    const handleSelectSession = async (sessionId: string) => {
        setCurrentSessionId(sessionId);
        // On phones the sidebar is a drawer — get out of the way.
        if (!isDesktop) setSidebarOpen(false);
        try {
            // Full resume: messages with steps/visualization/evidence/usage
            // plus session-level UI (panel data, pinned graphs, active msg).
            const [messages, ui] = await Promise.all([
                loadMessages(sessionId),
                loadContext(sessionId),
            ]);
            setMessages(messages.map(m => {
                const citations = sanitizeCitations(m.citations);
                return { ...m, ...(citations.length > 0 ? { citations } : m.citations ? { citations: [] } : {}) };
            }));
            // Re-learn driver colors from restored payloads so highlights
            // are season-correct even before any new query runs.
            try {
                const { learnColorsFromPayload } = await import("@/lib/f1-colors");
                for (const m of messages) {
                    if (m.visualizationData) learnColorsFromPayload(m.visualizationData);
                }
            } catch {
                // Best-effort: static grid fallback still applies.
            }
            // Restore panel + pinned graphs + active message. Fall back to
            // the latest message's visualization when no UI state was ever
            // saved (pre-existing sessions).
            type StoreState = ReturnType<typeof useChatStore.getState>;
            const patch: { graphHistory?: StoreState["graphHistory"]; visualizationData?: StoreState["visualizationData"]; activeMessageId?: string | null } = {};
            if (ui.graphHistory) {
                patch.graphHistory = ui.graphHistory as StoreState["graphHistory"];
            }
            const activeId = ui.activeMessageId ?? messages.filter(m => m.role === "assistant").slice(-1)[0]?.id ?? null;
            const activeMsg = messages.find(m => m.id === activeId);
            const panelData = ui.visualizationData ?? activeMsg?.chartSpecs ?? activeMsg?.visualizationData ?? null;
            useChatStore.setState({
                ...patch,
                visualizationData: (panelData ?? null) as StoreState["visualizationData"],
                activeMessageId: activeId,
            });
        } catch (err) {
            console.error("Session load failed:", err);
            setMessages([]);
        }
    };

    const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        // Optimistic update
        setSessions(sessions.filter(s => s.id !== sessionId));

        if (currentSessionId === sessionId) {
            setCurrentSessionId(null);
            setMessages([]);
        }

        try {
            await deleteSession(sessionId);
        } catch (error) {
            console.error("Failed to delete session:", error);
            // Revert on failure (optional, but good practice)
            listSessions().then(setSessions).catch(() => undefined);
        }
    };

    // Helper for type colors
    const getTypeColor = (type?: string) => {
        switch (type) {
            case "telemetry": return "bg-blue-500/10 text-blue-400 border-blue-500/20";
            case "comparison": return "bg-purple-500/10 text-purple-400 border-purple-500/20";
            case "strategy": return "bg-green-500/10 text-green-400 border-green-500/20";
            case "insights": return "bg-orange-500/10 text-orange-400 border-orange-500/20";
            default: return "bg-gray-500/10 text-gray-400 border-gray-500/20";
        }
    };

    const [nowMs, setNowMs] = React.useState(() => Date.now());

    React.useEffect(() => {
        const intervalId = window.setInterval(() => setNowMs(Date.now()), 30000);
        return () => window.clearInterval(intervalId);
    }, []);

    const getSessionTimeMs = (session: StoredSession): number | null => {
        const v = session?.lastMessageAt ?? session?.createdAt;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
    };

    const formatSessionDelta = (session: StoredSession, isActive: boolean): string => {
        const sessionMs = getSessionTimeMs(session);

        if (isActive) {
            return sessionMs ? "+0s" : "--";
        }

        if (!sessionMs) return "--";

        const diffSeconds = Math.max(0, Math.floor((nowMs - sessionMs) / 1000));

        const days = Math.floor(diffSeconds / 86400);
        if (days > 0) return `+${days}d`;

        const hours = Math.floor(diffSeconds / 3600);
        if (hours > 0) return `+${hours}hr`;

        const minutes = Math.floor(diffSeconds / 60);
        if (minutes > 0) return `+${minutes}m`;

        if (diffSeconds < 60) return `+${diffSeconds}s`;

        return "+0s";
    };

    return (
        <>
            {/* Mobile drawer backdrop — taps dismiss. Desktop has no
                backdrop (the rail is in-flow). */}
            {!isDesktop && isSidebarOpen && (
                <button
                    aria-label="Close session menu"
                    onClick={() => setSidebarOpen(false)}
                    className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px] md:hidden"
                />
            )}
        <div
            // Off-canvas drawer content must not be focusable/tappable.
            // (Desktop rail stays interactive — its toggle lives inside.)
            {...(!isDesktop && !isSidebarOpen ? { inert: true } : {})}
            className={cn(
                "flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out shadow-2xl",
                // Mobile: fixed overlay drawer (never squeezes chat).
                !isDesktop && "fixed inset-y-0 left-0 z-50 h-dvh w-72",
                !isDesktop && !isSidebarOpen && "-translate-x-full",
                !isDesktop && isSidebarOpen && "translate-x-0",
                // Desktop: collapsible in-flow rail (unchanged).
                isDesktop && "relative z-30 h-screen",
                isDesktop && (isSidebarOpen ? "w-64" : "w-[60px]")
            )}
        >
            {/* Header / Toggle */}
            <div className={cn(
                "flex items-center p-3 h-16 bg-carbon-header shrink-0 transition-all duration-300",
                isSidebarOpen ? "justify-between" : "justify-center"
            )}>
                <div className={cn(
                    "flex items-center overflow-hidden transition-all duration-300",
                    isSidebarOpen ? "w-full opacity-100" : "w-0 opacity-0"
                )}>
                    <div className="font-orbitron font-bold text-sm tracking-wider text-f1-red whitespace-nowrap flex-1">
                        DBRIEF1
                    </div>
                </div>

                <button
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className={cn(
                        "p-2 hover:bg-white/10 rounded-md text-sidebar-foreground transition-colors shrink-0",
                        !isSidebarOpen && "mx-auto"
                    )}
                >
                    <PanelLeft className="h-5 w-5" />
                </button>
            </div>

            {/* New Chat Button */}
            <div className="p-3">
                <button
                    onClick={handleNewChat}
                    className={cn(
                        "flex items-center w-full bg-f1-red hover:bg-f1-red/90 text-white rounded-md p-2 transition-all shadow-sm overflow-hidden",
                        !isSidebarOpen && "justify-center px-0"
                    )}
                    title="New Chat"
                >
                    <Plus className={cn("h-5 w-5 shrink-0 transition-all duration-300", isSidebarOpen && "mr-2")} />
                    <span className={cn(
                        "font-bold text-xs uppercase tracking-wide whitespace-nowrap transition-all duration-300",
                        isSidebarOpen ? "w-auto opacity-100" : "w-0 opacity-0"
                    )}>
                        New Session
                    </span>
                </button>
            </div>

            {/* Session List */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-800 hover:scrollbar-thumb-gray-700">
                {sessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-20 text-muted-foreground opacity-50">
                        <div className={cn("transition-all duration-300 overflow-hidden text-center", isSidebarOpen ? "w-auto opacity-100" : "w-0 opacity-0")}>
                            <span className="text-[10px] uppercase tracking-widest whitespace-nowrap">No Sessions</span>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-1 p-2">
                        {sessions.map((session) => (
                            <div
                                key={session.id}
                                onClick={() => isSidebarOpen && handleSelectSession(session.id)}
                                className={cn(
                                    "group relative flex items-center w-full p-2 rounded-md transition-all border border-transparent overflow-hidden",
                                    isSidebarOpen && currentSessionId === session.id
                                        ? "bg-sidebar-accent border-sidebar-border text-foreground shadow-sm"
                                        : isSidebarOpen ? "hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground cursor-pointer" : "text-transparent pointer-events-none",
                                    !isSidebarOpen && "justify-center"
                                )}
                            >
                                {/* Icon */}
                                <MessageSquare className={cn(
                                    "h-4 w-4 shrink-0 transition-all duration-300",
                                    isSidebarOpen && currentSessionId === session.id ? "text-f1-red" : "text-muted-foreground group-hover:text-f1-red",
                                    isSidebarOpen ? "mr-3 opacity-100 w-4" : "mr-0 opacity-0 w-0"
                                )} />

                                {/* Content (Text) */}
                                <div className={cn(
                                    "flex flex-col items-start gap-0.5 whitespace-nowrap overflow-hidden transition-all duration-300",
                                    isSidebarOpen ? "w-full opacity-100" : "w-0 opacity-0"
                                )}>
                                    <div className="flex items-center justify-between w-full gap-2 overflow-hidden">
                                        <span className="text-xs font-medium truncate min-w-0">
                                            {session.title || "New Chat"}
                                        </span>
                                        <div className="relative h-6 w-6 shrink-0 max-md:h-9 max-md:w-9">
                                            {/* Delta badge is hover-revealed on desktop; on
                                                touch there is no hover, so the delete action
                                                stays visible instead. */}
                                            <span className="absolute inset-0 flex items-center justify-end text-[10px] font-mono tracking-wide text-muted-foreground/80 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0 max-md:hidden">
                                                {formatSessionDelta(session, currentSessionId === session.id)}
                                            </span>
                                            {isSidebarOpen && (
                                                <button
                                                    onClick={(e) => handleDeleteSession(session.id, e)}
                                                    className="absolute inset-0 flex items-center justify-center rounded-md transition-opacity duration-150 bg-sidebar-accent hover:bg-red-500/20 text-muted-foreground hover:text-f1-red max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                                                    title="Delete Session"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5 max-md:h-4 max-md:w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 w-full overflow-hidden">
                                        {session.type && (
                                            <span className={cn(
                                                "text-[9px] px-1 rounded border uppercase font-bold tracking-wider truncate",
                                                getTypeColor(session.type)
                                            )}>
                                                {session.type}
                                            </span>
                                        )}
                                    </div>
                                </div>

                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Footer / User Profile */}
            <div className="p-3 border-t border-sidebar-border mt-auto">
                <div className={cn(
                    "flex items-center rounded-md p-2 hover:bg-sidebar-accent transition-colors cursor-default overflow-hidden",
                    !isSidebarOpen && "justify-center"
                )}>
                    {user?.google?.avatarUrl ? (
                        <span className="relative h-8 w-8 shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element -- Google avatar from verified ID-token claim */}
                            <img
                                src={user.google.avatarUrl}
                                alt=""
                                referrerPolicy="no-referrer"
                                className="h-8 w-8 rounded-full border border-sidebar-border object-cover"
                            />
                            <UsageIndicator />
                        </span>
                    ) : user ? (
                        <div className="relative h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center border border-sidebar-border shrink-0 text-foreground">
                            <span className="text-[10px] font-bold">
                                {(user.displayName || "DRV").slice(0, 3).toUpperCase()}
                            </span>
                            <UsageIndicator />
                        </div>
                    ) : (
                        <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center border border-sidebar-border shrink-0 text-foreground">
                            <UserIcon className="h-4 w-4" />
                        </div>
                    )}

                    <div className={cn(
                        "flex flex-col overflow-hidden whitespace-nowrap transition-all duration-300",
                        isSidebarOpen ? "w-full opacity-100 ml-3" : "w-0 opacity-0 ml-0"
                    )}>
                        <p className="text-xs font-medium truncate" title={user?.google?.email}>
                            {user?.displayName || "Driver"}
                        </p>
                        {user?.google ? (
                            <button
                                onClick={() => signOut()}
                                className="text-[10px] text-muted-foreground hover:text-f1-red transition-colors flex items-center gap-1 mt-0.5"
                            >
                                <LogOut className="h-3 w-3" />
                                SIGN OUT
                            </button>
                        ) : googleLoginAvailable && user ? (
                            <a
                                href="/api/auth/google"
                                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 mt-0.5"
                            >
                                <UserIcon className="h-3 w-3" />
                                SIGN IN WITH GOOGLE
                            </a>
                        ) : (
                            <button
                                onClick={() => signOut()}
                                className="text-[10px] text-muted-foreground hover:text-f1-red transition-colors flex items-center gap-1 mt-0.5"
                            >
                                <LogOut className="h-3 w-3" />
                                NEW IDENTITY
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
        </>
    );
}
