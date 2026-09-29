"use client";

import { useCallback, useState } from "react";
import { MotionConfig } from "framer-motion";
import type { ModeLabel } from "@/components/layout/header-shell";
import { LandingHeader } from "./landing-chrome";
import { LandingComposer } from "./landing-composer";
import { LandingHero } from "./landing-hero";
import { DEMO_SLIDES } from "./landing-showcase";
import { DevicesSection } from "./landing-devices";
import { InfoSections, LandingFooter } from "./landing-info";

/**
 * Public landing page.
 * ====================
 * Shaped exactly like the signed-in chat shell: the app header on top, a
 * scrolling message column rendered with the real MessageBubble, and the
 * frosted composer floating above the bottom edge. The only difference is
 * the content — a self-playing demo conversation instead of your session —
 * and the composer, which is a link into Google sign-in.
 *
 * Shown to signed-out visitors; signed-in users get the chat shell. The
 * whole pitch fits one viewport on desktop and most phones.
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
                            </div>
                        </div>
                        <DevicesSection index={index} onAdvance={advance} />
                        <InfoSections />
                        <LandingFooter />
                        {/* Clearance for the floating composer. */}
                        <div className="h-40" aria-hidden="true" />
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
