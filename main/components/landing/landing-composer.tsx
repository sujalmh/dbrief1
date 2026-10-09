"use client";

import { Brain, Send, Server } from "lucide-react";

/**
 * Sign-in gate shaped like the chat composer.
 * ===========================================
 * Same flat liquid-glass skin as `components/chat/chat-input.tsx`
 * (single `.modal-glass` surface, no gradient ring) — but inert: the
 * whole card is a link to Google sign-in, and the controls are
 * decorative. Visitors see exactly what they will type into; tapping
 * it starts the one step they need to take.
 */
export function LandingComposer() {
    return (
        <a
            href="/api/auth/google"
            aria-label="Sign in with Google to ask about race strategy"
            className="group block w-full rounded-[2rem] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
            <div className="modal-glass relative rounded-[2rem] transition-all duration-300">
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
                            <span className="relative h-8 w-[76px] rounded-full border border-white/10 bg-black/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                                <span className="absolute left-1 top-1/2 -translate-y-1/2">
                                    <span className="btn-wheel btn-wheel-purple flex h-6 w-6 items-center justify-center rounded-full">
                                        <Brain className="h-3.5 w-3.5" />
                                    </span>
                                </span>
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/40">
                                    Off
                                </span>
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
        </a>
    );
}
