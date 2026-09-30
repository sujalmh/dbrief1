"use client";

import { useCallback, useState } from "react";
import { MotionConfig } from "framer-motion";
import type { ModeLabel } from "@/components/layout/header-shell";
import { LandingHeader } from "./landing-chrome";
import { LandingComposer } from "./landing-composer";
import { LandingHero } from "./landing-hero";
import { DEMO_SLIDES, LandingShowcase } from "./landing-showcase";

/**
 * Public landing page.
 * ====================
 * Shaped exactly like the signed-in chat shell: the app header on top, a
 * compact intro, a fixed-height self-playing demo exchange rendered with
 * the real MessageBubble, and the frosted composer floating above the
 * bottom edge. The composer and the per-slide sign-in button both link
 * into Google sign-in.
 *
 * Shown to signed-out visitors; signed-in users get the chat shell.
 */
export function LandingPage() {
    const [index, setIndex] = useState(0);

    const selectMode = useCallback((mode: ModeLabel) => {
        const i = DEMO_SLIDES.findIndex((s) => s.mode === mode);
        if (i >= 0) setIndex(i);
    }, []);
    const advance = useCallback(() => {
        setIndex((i) => (i + 1) % DEMO_SLIDES.length);
    }, []);

    const activeMode = DEMO_SLIDES[index]?.mode ?? DEMO_SLIDES[0]!.mode;

    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-dvh w-full flex-col overflow-hidden bg-background font-sans text-foreground antialiased selection:bg-[#E10600]/15">
                <LandingHeader activeMode={activeMode} onSelectMode={selectMode} />

                <main className="relative flex h-full w-full overflow-hidden bg-carbon">
                    <div className="relative z-10 w-full flex-1 overflow-y-auto overscroll-contain">
                        <div className="w-full min-w-0 max-w-full p-3 sm:p-4">
                            <div className="mx-auto w-full min-w-0 max-w-3xl">
                                <LandingHero />
                                <div className="mt-4">
                                    <LandingShowcase index={index} onAdvance={advance} />
                                </div>
                            </div>
                            {/* Clearance for the floating composer. */}
                            <div className="mx-auto h-40 max-w-3xl" aria-hidden="true" />
                        </div>
                    </div>

                    {/* Floating composer layer — same placement as the chat shell. */}
                    <div className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 z-20 w-full">
                        <div className="pointer-events-auto mx-auto max-w-3xl px-4">
                            <LandingComposer />
                        </div>
                    </div>
                </main>
            </div>
        </MotionConfig>
    );
}
