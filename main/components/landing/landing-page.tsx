"use client";

import { MotionConfig } from "framer-motion";
import { SiteFooter, SiteNav } from "./landing-chrome";
import { HeroHeader } from "./landing-hero";
import { ShowcaseCarousel } from "./landing-showcase";

/**
 * Public marketing page in the chat's own theme (carbon texture, F1 red,
 * mono micro-labels, italic black headlines).
 *
 * Single-viewport design: compact hero + auto-playing capability carousel
 * (a mock chat exchange that streams answers like live response tokens),
 * so the whole pitch lands with no scrolling on desktop and most phones.
 * The root still scrolls as a fallback for short viewports (the global
 * layout locks body scroll for the chat shell).
 *
 * Shown to signed-out visitors; signed-in users get the chat shell.
 */
export function LandingPage() {
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-dvh flex-col overflow-y-auto overscroll-contain bg-carbon font-sans text-foreground antialiased selection:bg-[#E10600]/15">
                <SiteNav />
                <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-3">
                    <HeroHeader />
                    <ShowcaseCarousel />
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
