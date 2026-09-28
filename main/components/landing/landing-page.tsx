"use client";

import { MotionConfig } from "framer-motion";
import { SiteFooter, SiteNav } from "./landing-chrome";
import { HeroShowcase, StatsStrip } from "./landing-hero";
import { ClosingCta, Features } from "./landing-features";

/**
 * Public marketing page — same vibe as the DBRIEF1 concept:
 * minimal Apple-style layout, light + dark ready, calm motion.
 * Shown to signed-out visitors; signed-in users get the chat shell.
 */
export function LandingPage() {
    return (
        <MotionConfig reducedMotion="user">
            <div className="min-h-dvh bg-background font-sans text-foreground antialiased selection:bg-[#E10600]/15">
                <SiteNav />
                <main className="pb-10">
                    <HeroShowcase />
                    <StatsStrip />
                    <Features />
                    <div className="pt-12">
                        <ClosingCta />
                    </div>
                    {/* crawlable summary for search indexers */}
                    <p className="sr-only">
                        Dbrief1 turns Formula 1 live timing, telemetry, tyre stints and FIA
                        regulations into clear race strategy, pace and setup answers with
                        interactive charts.
                    </p>
                </main>
                <SiteFooter />
            </div>
        </MotionConfig>
    );
}
