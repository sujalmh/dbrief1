"use client";

import { Lock } from "lucide-react";
import { LandingShowcase } from "./landing-showcase";

/**
 * Product preview in a single desktop window.
 * ==========================================
 * One display, not two: the phone showed the identical exchange, so it
 * was decoration rather than information. The browser window plays the
 * auto-advancing demo (driven by the header mode selector), rendered by
 * the real MessageBubble — the app's own UI, not a mock-up.
 */

function DesktopFrame({
    index,
    onAdvance,
}: {
    index: number;
    onAdvance: () => void;
}) {
    return (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.45)]">
            {/* browser chrome */}
            <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-4 py-2.5">
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
            <div className="p-3 sm:p-5">
                <LandingShowcase index={index} onAdvance={onAdvance} />
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
        <section aria-label="Product preview" className="mx-auto w-full max-w-5xl px-5 pt-10 sm:pt-14">
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
                <DesktopFrame index={index} onAdvance={onAdvance} />
            </div>
        </section>
    );
}
