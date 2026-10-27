"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { MessageBubble } from "@/components/chat/message-bubble";
import { LogoBadge } from "@/components/layout/header-shell";
import { F1Disclaimer } from "@/components/legal/f1-disclaimer";
import { loadSharedSnapshot, type SharedSnapshot } from "@/lib/cf/client";
import type { Message } from "@/lib/store";

/**
 * Public read-only view of a shared chat.
 * ======================================
 * No sign-in required — the unguessable token is the access grant.
 * Renders message text + citations only (snapshots never include usage,
 * internals, or chart dumps). All bubbles are readOnly: no copy/retry/
 * delete, no store writes.
 */
export function ShareView({ token }: { token: string }) {
    const [snapshot, setSnapshot] = React.useState<SharedSnapshot | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        loadSharedSnapshot(token)
            .then((s) => {
                if (!cancelled) setSnapshot(s);
            })
            .catch((e: unknown) => {
                if (!cancelled)
                    setError(e instanceof Error ? e.message : "Couldn't load this shared chat.");
            });
        return () => {
            cancelled = true;
        };
    }, [token]);

    return (
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background font-sans antialiased text-foreground">
            <header className="relative z-50 w-full border-b border-[var(--header-line)] bg-carbon-header text-[var(--header-fg)]">
                <span aria-hidden className="wheel-led-strip" />
                <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-2 px-4">
                    <div className="flex min-w-0 items-center gap-3">
                        {/* Same theme-aware mark as the app/landing header:
                            no hard-coded white plate (it glowed on dark). */}
                        <LogoBadge onBackground className="shrink-0 bg-transparent shadow-none" />
                        <span className="truncate text-xs font-mono text-[var(--header-dim)]">
                            {snapshot ? snapshot.title.toUpperCase() : "SHARED CHAT"}
                        </span>
                    </div>
                    <span className="wheel-well hidden shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--wheel-text-dim)] sm:inline">
                        Read-only
                    </span>
                </div>
            </header>

            <main className="relative flex h-full w-full overflow-hidden bg-carbon">
                <div className="relative z-10 w-full flex-1 overflow-y-auto overscroll-contain">
                    {!snapshot && !error ? (
                        <div className="flex h-full items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin text-f1-red" />
                        </div>
                    ) : error || !snapshot ? (
                        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                            <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                                Link unavailable
                            </p>
                            <p className="max-w-xs text-xs text-muted-foreground/70">{error}</p>
                            <Link
                                href="/"
                                className="btn-wheel mt-1 inline-flex h-9 items-center px-4 text-xs font-bold uppercase tracking-wide"
                            >
                                Open Dbrief1
                            </Link>
                        </div>
                    ) : snapshot.messages.length === 0 ? (
                        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground opacity-70">
                            <p className="text-sm font-bold uppercase tracking-wider">
                                Empty chat
                            </p>
                            <p className="text-xs">This shared chat has no messages yet.</p>
                        </div>
                    ) : (
                        <div className="h-full p-3 sm:p-4">
                            <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 pb-12">
                                {snapshot.messages.map((m) => (
                                    <MessageBubble
                                        key={m.id}
                                        message={m as Message}
                                        readOnly
                                    />
                                ))}
                                <p className="pt-2 text-center text-[10px] font-mono text-muted-foreground/60">
                                    Shared from Dbrief1 · {snapshot.messageCount} message
                                    {snapshot.messageCount === 1 ? "" : "s"} · read-only
                                </p>
                                <F1Disclaimer className="text-center" />
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
