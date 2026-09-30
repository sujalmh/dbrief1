"use client";

import { Lock } from "lucide-react";
import { LandingShowcase } from "./landing-showcase";

/**
 * Product preview on a single realistic laptop.
 * ============================================
 * One display: a MacBook-style unit (camera bezel, browser chrome,
 * aluminium deck with thumb scoop) playing the auto-advancing demo
 * through the real MessageBubble. Positioned to break the first
 * viewport's fold so the screen is visible without scrolling.
 */

function Laptop({
    index,
    onAdvance,
}: {
    index: number;
    onAdvance: () => void;
}) {
    return (
        <div className="mx-auto w-full max-w-5xl">
            {/* screen + bezel (hardware black in both themes) */}
            <div className="overflow-hidden rounded-t-2xl border border-b-0 border-zinc-800 bg-black shadow-[0_40px_90px_-40px_rgba(0,0,0,0.55)]">
                {/* camera */}
                <div className="flex items-center justify-center gap-1.5 bg-black py-1.5" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-800" />
                    <span className="h-1 w-1 rounded-full bg-[#1d4ed8]/70" />
                </div>
                {/* browser chrome */}
                <div className="mx-2 flex items-center gap-2 rounded-t-lg border border-border/60 bg-muted/40 px-4 py-2">
                    <span className="flex gap-1.5" aria-hidden="true">
                        <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                        <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                        <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                    </span>
                    <span className="mx-auto flex items-center gap-1.5 rounded-md bg-muted/70 px-3 py-1 font-mono text-[11px] text-muted-foreground">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        dbrief1.xyz
                    </span>
                    <span className="w-10" aria-hidden="true" />
                </div>
                {/* screen */}
                <div className="mx-2 mb-2 rounded-b-lg bg-card p-3 sm:p-5">
                    <LandingShowcase index={index} onAdvance={onAdvance} />
                </div>
            </div>
            {/* deck */}
            <div
                aria-hidden="true"
                className="relative h-3.5 rounded-b-2xl bg-gradient-to-b from-zinc-300 via-zinc-400 to-zinc-500 shadow-[0_24px_50px_-16px_rgba(0,0,0,0.55)] dark:from-zinc-700 dark:via-zinc-800 dark:to-zinc-900"
            >
                <div className="absolute left-1/2 top-0 h-1.5 w-28 -translate-x-1/2 rounded-b-lg bg-black/30 dark:bg-black/60" />
            </div>
        </div>
    );
}

export function DevicesSection({
    index,
    onAdvance,
}: {
    index: number;
    onAdvance: () => void;
}) {
    return (
        <section aria-label="Product preview" className="mx-auto w-full max-w-6xl px-5 pt-6 sm:pt-8">
            <div className="mt-3 flex flex-col justify-between gap-3 md:flex-row md:items-end">
                <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                    The app itself, live.
                </h2>
                <p className="max-w-xs text-[13.5px] leading-relaxed text-muted-foreground md:text-right">
                    Every pixel below is the real interface — the demo runs
                    the same components as your sessions.
                </p>
            </div>
            <div className="mt-6">
                <Laptop index={index} onAdvance={onAdvance} />
            </div>
        </section>
    );
}
