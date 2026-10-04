"use client";

import { BarChart3, Brain, Send, Server } from "lucide-react";

/**
 * Sign-in gate shaped like the chat composer.
 * ===========================================
 * Same skin as `components/chat/chat-input.tsx` — gradient ring, frosted
 * body, wheel controls — but inert: the whole card is a link to Google
 * sign-in, and the controls are decorative. Visitors see exactly what they
 * will type into; tapping it starts the one step they need to take.
 */
export function LandingComposer() {
    return (
        <a
            href="/api/auth/google"
            aria-label="Sign in with Google to ask about race strategy"
            className="group block w-full rounded-[2rem] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
            <div className="rounded-[2rem] bg-gradient-to-r from-white/40 via-white/10 to-white/40 p-px shadow-[0_8px_32px_rgba(0,0,0,0.25)] dark:from-white/25 dark:via-white/5 dark:to-white/25 dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                <div className="relative rounded-[calc(2rem-1px)] bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl transition-all duration-300 group-hover:bg-white/80 dark:bg-black/40 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] dark:group-hover:bg-black/50">
                    {/* Input row */}
                    <div className="flex gap-2 p-3 pb-0">
                        {/* Parked: image upload affordance (feature not
                            required for now) — mirrors chat-input. */}
                        <span className="min-h-[50px] w-full p-1 pt-2.5 text-base font-medium text-muted-foreground">
                            Sign in to ask anything…
                        </span>
                        <span
                            aria-hidden="true"
                            className="btn-wheel mt-1 h-8 w-8 shrink-0 cursor-not-allowed opacity-50"
                        >
                            <Send className="h-4 w-4" />
                        </span>
                    </div>

                    {/* Control row — mirrors ControlPanel: mode toggles left,
                        active AI mode right. */}
                    <div className="flex w-full items-center justify-between px-3 pb-2 pt-2">
                        <div className="flex items-center gap-1" aria-hidden="true">
                            <span className="btn-wheel btn-wheel-purple h-8 w-8">
                                <Brain className="h-4 w-4" />
                            </span>
                            <span className="btn-wheel btn-wheel-yellow h-8 w-8">
                                <BarChart3 className="h-4 w-4" />
                            </span>
                        </div>
                        <span
                            aria-hidden="true"
                            className="btn-wheel btn-wheel-orange h-8 gap-2 px-3 text-xs"
                        >
                            <Server className="h-3.5 w-3.5" />
                            <span className="hidden font-bold sm:inline-block">
                                Managed
                            </span>
                        </span>
                    </div>
                </div>
            </div>
        </a>
    );
}
