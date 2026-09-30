"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Plus, MessageSquare, LogOut, User as UserIcon, Trash2 } from "lucide-react";
import { useChatStore } from "@/lib/store"
import type { StoredSession } from "@/lib/store"
import { useSession } from "@/lib/cf/session-context";
import { UsageIndicator } from "@/components/layout/usage-indicator";
import { useMediaQuery } from "@/lib/hooks/use-media-query";
import {
    listSessions,
    deleteSession,
} from "@/lib/cf/client";
import { resetToFreshChat } from "@/lib/cf/session-loader";
import { cn } from "@/lib/utils";

export function Sidebar() {
    // Slice subscriptions: streaming tokens update `messages`, which this
    // component doesn't render — a full-store spread would re-render the
    // whole session list on every token frame.
    const sessions = useChatStore((s) => s.sessions);
    const currentSessionId = useChatStore((s) => s.currentSessionId);
    const setSessions = useChatStore((s) => s.setSessions);
    const isSidebarOpen = useChatStore((s) => s.isSidebarOpen);
    const setSidebarOpen = useChatStore((s) => s.setSidebarOpen);
    const { user, signOut, googleLoginAvailable } = useSession();
    const router = useRouter();
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

    const handleNewChat = () => {
        // Fresh composer WITHOUT creating a session: no "New Chat" row
        // appears in the sidebar until the first message is sent (the
        // send handler lazily creates the session then, titled from the
        // message text). This keeps repeated New Chat clicks from piling
        // up empty sessions. Client-side navigation only — no reload.
        resetToFreshChat();
        // On phones the sidebar is a drawer — get out of the way.
        if (!isDesktop) setSidebarOpen(false);
        router.push("/");
    };

    const handleSelectSession = (sessionId: string) => {
        // URL-driven: push the session URL and let the chat shell load
        // it from the cloud. Client-side navigation only — no reload.
        // On phones the sidebar is a drawer — get out of the way.
        if (!isDesktop) setSidebarOpen(false);
        if (sessionId === currentSessionId) return;
        router.push(`/c/${sessionId}`);
    };

    const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        // Optimistic update
        setSessions(sessions.filter(s => s.id !== sessionId));

        if (currentSessionId === sessionId) {
            // Leaving the deleted session: fresh composer at the root URL
            // so the shell doesn't try to reload a session that's gone.
            resetToFreshChat();
            router.push("/");
        }

        try {
            await deleteSession(sessionId);
        } catch (error) {
            console.error("Failed to delete session:", error);
            // Revert on failure (optional, but good practice)
            listSessions().then(setSessions).catch(() => undefined);
        }
    };

    // Helper for type colors — steering-wheel classifier hues (see
    // lib/mode-colors.ts): Telemetry yellow, Comparison blue, Strategy
    // cyan, Insights orange. Yellow text is unreadable on light
    // backgrounds, so it uses a darker amber in light mode.
    const getTypeColor = (type?: string) => {
        switch (type) {
            case "telemetry": return "bg-yellow-500/10 text-yellow-700 border-yellow-500/30 dark:bg-[#FFEA00]/10 dark:text-[#FFEA00] dark:border-[#FFEA00]/30";
            case "comparison": return "bg-[#0090FF]/10 text-[#0066CC] border-[#0090FF]/30 dark:bg-[#0090FF]/10 dark:text-[#0090FF] dark:border-[#0090FF]/30";
            case "strategy": return "bg-[#00D2BE]/10 text-[#00796B] border-[#00D2BE]/30 dark:bg-[#00D2BE]/10 dark:text-[#00D2BE] dark:border-[#00D2BE]/30";
            case "insights": return "bg-[#FF8700]/10 text-[#CC5500] border-[#FF8700]/30 dark:bg-[#FF8700]/10 dark:text-[#FF8700] dark:border-[#FF8700]/30";
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
            {...(!isDesktop && !isSidebarOpen ? { inert: true } : {})}
            className={cn(
                "flex flex-col border-r transition-all duration-300 ease-in-out shadow-2xl backdrop-blur-xl",
                // Glassmorphism: frosted sidebar over the carbon backdrop.
                // bg-sidebar at reduced opacity + blur + inner top highlight
                // so session rows feel layered under glass.
                "bg-sidebar/70 supports-[backdrop-filter]:bg-sidebar/60 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
                // Mobile: fixed overlay drawer (never squeezes chat).
                !isDesktop && "fixed inset-y-0 left-0 z-50 h-dvh w-72",
                !isDesktop && !isSidebarOpen && "-translate-x-full",
                !isDesktop && isSidebarOpen && "translate-x-0",
                // Desktop: collapsible in-flow rail (unchanged).
                isDesktop && "relative z-30 h-screen",
                isDesktop && (isSidebarOpen ? "w-64" : "w-[60px]")
            )}
        >
            {/* Header — title only. The single sidebar toggle lives in
                the app header, so there is exactly one collapse control. */}
            <div className={cn(
                "flex items-center p-3 h-16 shrink-0 transition-all duration-300 border-b border-white/10 bg-white/5 dark:bg-white/5 backdrop-blur-xl",
                isSidebarOpen ? "justify-start" : "justify-center"
            )}>
                {isSidebarOpen ? (
                    <div className="font-orbitron font-bold text-sm tracking-wider text-f1-red whitespace-nowrap flex-1">
                        DBRIEF1
                    </div>
                ) : (
                    <div className="flex items-center justify-center rounded-sm bg-[var(--f1-red)] p-1.5">
                        <span className="font-orbitron font-bold text-[10px] text-white">D1</span>
                    </div>
                )}
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
