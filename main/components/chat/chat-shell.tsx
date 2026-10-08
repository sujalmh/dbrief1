"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { MessageList } from "@/components/chat/message-list";
import { ChatInput } from "@/components/chat/chat-input";
import { useChatStore } from "@/lib/store";
import { useSession } from "@/lib/cf/session-context";
import { LandingPage } from "@/components/landing/landing-page";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadSessionIntoStore, resetToFreshChat } from "@/lib/cf/session-loader";

// Heavy, non-critical UI is code-split out of the initial bundle so
// first paint only downloads the chat shell:
// - SettingsModal pulls in Radix Dialog + form controls.
// - ErrorModal pulls in framer-motion.
// Charts (recharts via InlineCharts → ChartDispatcher) split at the
// message bubble instead — see message-bubble.tsx. There is no side
// panel anymore: charts render inline in each assistant message.
const SettingsModal = dynamic(
    () => import("@/components/chat/settings-modal").then((m) => m.SettingsModal),
    { ssr: false }
);
const ErrorModal = dynamic(
    () => import("@/components/ui/error-modal").then((m) => m.ErrorModal),
    { ssr: false }
);
const FeedbackDialog = dynamic(
    () => import("@/components/chat/feedback-dialog").then((m) => m.FeedbackDialog),
    { ssr: false }
);

const AUTH_ERRORS: Record<string, string> = {
    denied: "Google sign-in was cancelled before completing.",
    state: "Google sign-in expired or was tampered with — please try again.",
    verify: "Google sign-in could not be verified — please try again.",
    unconfigured: "Google sign-in is not set up on this deployment yet.",
};

function useAuthErrorBanner() {
    const setError = useChatStore((s) => s.setError);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        // Server redirects here as /?auth=error&reason=<code> on OAuth failure.
        if (params.get("auth") !== "error") return;
        const reason = params.get("reason") || "verify";
        setError(AUTH_ERRORS[reason] || AUTH_ERRORS.verify!);
        window.history.replaceState(null, "", window.location.pathname);
    }, [setError]);
}

/**
 * Sync the URL session id with the client store (no page reloads).
 * ================================================================
 * - `/c/<id>` with a session already live in the store: no-op (the
 *   common case right after sending the first message — replacing the
 *   URL must not wipe the optimistic/streaming messages).
 * - `/c/<id>` for any other session: clear + load from the cloud.
 * - `/` with a stale in-memory session (manual navigation): reset to
 *   a fresh composer.
 * Client-side navigations (sidebar, new chat, first send) only push /
 * replace the URL — Next swaps the route without reloading the page.
 */
function useRouteSession(routeSessionId: string | null) {
    const [routeLoading, setRouteLoading] = useState(false);
    const [routeError, setRouteError] = useState<string | null>(null);
    const handledRef = useRef<string | null | undefined>(undefined);
    const runRef = useRef(0);

    useEffect(() => {
        if (handledRef.current === routeSessionId) return;
        handledRef.current = routeSessionId;
        const runId = ++runRef.current;
        const isCurrent = () =>
            runRef.current === runId &&
            useChatStore.getState().currentSessionId === routeSessionId;

        if (routeSessionId) {
            // Already live (just sent the first message, URL replaced) —
            // leave the optimistic state alone.
            if (useChatStore.getState().currentSessionId === routeSessionId) return;
            setRouteError(null);
            setRouteLoading(true);
            useChatStore.getState().setCurrentSessionId(routeSessionId);
            useChatStore.getState().setMessages([]);
            loadSessionIntoStore(routeSessionId, isCurrent)
                .catch((err: unknown) => {
                    if (!isCurrent()) return;
                    setRouteError(
                        err instanceof Error ? err.message : "Couldn't load this chat."
                    );
                })
                .finally(() => {
                    if (isCurrent()) setRouteLoading(false);
                });
        } else {
            if (useChatStore.getState().currentSessionId) resetToFreshChat();
            setRouteError(null);
            setRouteLoading(false);
        }
    }, [routeSessionId]);

    return { routeLoading, routeError };
}

export function ChatShell({ routeSessionId }: { routeSessionId: string | null }) {
    const { user, loading } = useSession();
    const router = useRouter();
    useAuthErrorBanner();
    const { routeLoading, routeError } = useRouteSession(routeSessionId);

    if (loading) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-carbon text-white">
                <Loader2 className="h-8 w-8 animate-spin text-f1-red" />
            </div>
        );
    }

    // Signed-out visitors get the public landing page — the chat UI (and
    // its history, quotas, and usage) requires a Google-linked identity.
    if (!user?.google) {
        return <LandingPage />;
    }

    return (
        <div className="flex h-dvh w-full bg-background font-sans antialiased text-foreground overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
                <Header />

                <main className="relative flex h-full w-full overflow-hidden bg-carbon">
                    {/* Full width message area — charts render inline in
                        each assistant bubble (no side panel reserve). */}
                    <div
                        data-chat-scroll
                        className="flex-1 overflow-y-auto w-full relative z-10 overscroll-contain"
                    >
                        {routeError ? (
                            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                                <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                                    Couldn&apos;t load this chat
                                </p>
                                <p className="max-w-xs text-xs text-muted-foreground/70">
                                    {routeError}
                                </p>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => router.push("/")}
                                    className="btn-wheel h-9 px-4 text-xs"
                                >
                                    Back to new chat
                                </Button>
                            </div>
                        ) : routeLoading ? (
                            <div className="flex h-full items-center justify-center">
                                <Loader2 className="h-8 w-8 animate-spin text-f1-red" />
                            </div>
                        ) : (
                            <MessageList />
                        )}
                    </div>

                    {/* Floating Input Layer — clears the iPhone home bar */}
                    <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 w-full z-20 pointer-events-none">
                        <div className="mx-auto max-w-3xl px-4 pointer-events-auto">
                            <ChatInput />
                        </div>
                    </div>
                </main>
            </div>

            <SettingsModal />
            <ErrorModal />
            <FeedbackDialog />
        </div>
    );
}
