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
 * Strictly one viewport — no page scroll, no overflow. A flex column fills
 * h-dvh exactly: app header, compact intro, the self-playing demo exchange
 * (fixed stage, real MessageBubble), per-slide sign-in, and the composer
 * in normal flow at the bottom. Shown to signed-out visitors; signed-in
 * users get the chat shell.
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

                <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden bg-carbon px-3 sm:px-4">
                    <div className="shrink-0">
                        <LandingHero />
                    </div>
                    <div className="min-h-0 flex-1">
                        <LandingShowcase index={index} onAdvance={advance} />
                    </div>
                    <div className="shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
                        <LandingComposer />
                    </div>
                </main>
            </div>
        </MotionConfig>
    );
}
