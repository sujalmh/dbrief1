"use client";

import React from "react";
import { Plus, MessageSquare, LogOut, User as UserIcon, PanelLeft, Trash2 } from "lucide-react";
import { useChatStore } from "@/lib/store"
import type { StoredSession } from "@/lib/store"
import { firestoreTimestampToMs } from "@/lib/firebase/firestore";
import { useAuth } from "@/lib/firebase/auth-context";
import { createSession, getSessions, getSessionMessages, deleteSession } from "@/lib/firebase/firestore";
import { cn } from "@/lib/utils";

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
    const { user, logout } = useAuth();

    React.useEffect(() => {
        if (user) {
            getSessions(user.uid).then(setSessions);
        }
    }, [user, setSessions]);

    const handleNewChat = async () => {
        if (!user) return;

        // Check if an empty session already exists
        const emptySession = sessions.find(s => s.title === "New Chat");
        if (emptySession) {
            handleSelectSession(emptySession.id);
            return;
        }

        const sessionId = await createSession(user.uid);
        const newSession = {
            id: sessionId,
            userId: user.uid,
            title: "New Chat",
            createdAt: new Date(),
            lastMessageAt: new Date(),
            context: {}
        };
        setSessions([newSession, ...sessions]);
        setCurrentSessionId(sessionId);
        setMessages([]); // Clear messages for new chat
    };

    const handleSelectSession = async (sessionId: string) => {
        setCurrentSessionId(sessionId);
        const messages = await getSessionMessages(sessionId);
        setMessages(messages.map(m => ({
            id: m.id!,
            role: m.role,
            content: m.content,
            timestamp: firestoreTimestampToMs(m.timestamp) ?? Date.now(),
            // Map other fields if necessary
        })));
    };

    const handleDeleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (!user) return;

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
            if (user) getSessions(user.uid).then(setSessions);
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

    const getSessionTimeMs = (session: StoredSession): number | null =>
        firestoreTimestampToMs(session?.lastMessageAt ?? session?.createdAt);

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
        <div
            className={cn(
                "flex flex-col h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out relative z-30 shadow-2xl", // Added shadow-2xl
                isSidebarOpen ? "w-64" : "w-[60px]"
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
                        F1 TELEM.AI
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
                                        <div className="relative h-6 w-6 shrink-0">
                                            <span className="absolute inset-0 flex items-center justify-end text-[10px] font-mono tracking-wide text-muted-foreground/80 transition-opacity duration-150 group-hover:opacity-0 group-focus-within:opacity-0">
                                                {formatSessionDelta(session, currentSessionId === session.id)}
                                            </span>
                                            {isSidebarOpen && (
                                                <button
                                                    onClick={(e) => handleDeleteSession(session.id, e)}
                                                    className="absolute inset-0 flex items-center justify-center rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 bg-sidebar-accent hover:bg-red-500/20 text-muted-foreground hover:text-f1-red"
                                                    title="Delete Session"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
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
                    {user?.photoURL ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user avatar from arbitrary OAuth domains; unsuitable for next/image without wildcard remotePatterns
                            <img src={user.photoURL} alt="User" className="h-8 w-8 rounded-full border border-sidebar-border shrink-0" />
                    ) : (
                        <div className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center border border-sidebar-border shrink-0 text-foreground">
                            <UserIcon className="h-4 w-4" />
                        </div>
                    )}

                    <div className={cn(
                        "flex flex-col overflow-hidden whitespace-nowrap transition-all duration-300",
                        isSidebarOpen ? "w-full opacity-100 ml-3" : "w-0 opacity-0 ml-0"
                    )}>
                        <p className="text-xs font-medium truncate">{user?.displayName || "User"}</p>
                        <button
                            onClick={() => logout()}
                            className="text-[10px] text-muted-foreground hover:text-f1-red transition-colors flex items-center gap-1 mt-0.5"
                        >
                            <LogOut className="h-3 w-3" />
                            SIGN OUT
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
