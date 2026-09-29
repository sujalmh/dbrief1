"use client";

import { useMemo } from "react";
import { Lock } from "lucide-react";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { Message } from "@/lib/store";
import { DEMO_SLIDES, LandingShowcase } from "./landing-showcase";

/**
 * Product preview in device frames.
 * ================================
 * The same live demo, presented the way professional sites present the
 * product: a desktop browser window playing the auto-advancing exchange
 * (driven by the header mode selector), plus a phone showing a frozen
 * exchange rendered by the same real MessageBubble. No mock components —
 * both frames show the app's own UI.
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

function PhoneFrame() {
    // Frozen exchange — the finished state of the Insights demo, rendered
    // by the real bubbles. Static on purpose: one timeline drives the page.
    const slide = DEMO_SLIDES.find((s) => s.id === "insights") ?? DEMO_SLIDES[0]!;
    const userMessage: Message = useMemo(
        () => ({
            id: "demo-phone-user",
            role: "user",
            content: slide.question,
            timestamp: 0,
        }),
        [slide.question]
    );
    const assistantMessage: Message = useMemo(
        () => ({
            id: "demo-phone-assistant",
            role: "assistant",
            // Prose only: the 520px results table can't fit a 250px frame,
            // and the desktop window next to it shows the full version.
            content: slide.answer,
            timestamp: 0,
            durationMs: slide.durationMs,
        }),
        [slide]
    );

    return (
        <div className="mx-auto w-[250px] shrink-0 overflow-hidden rounded-[2.2rem] border border-border/70 bg-card shadow-[0_40px_90px_-40px_rgba(0,0,0,0.45)]">
            {/* notch */}
            <div className="flex justify-center bg-muted/40 pb-1 pt-2.5" aria-hidden="true">
                <div className="h-5 w-24 rounded-full bg-foreground/15" />
            </div>
            <div className="flex max-h-[460px] flex-col gap-4 overflow-hidden p-2.5">
                <MessageBubble message={userMessage} readOnly />
                <MessageBubble message={assistantMessage} readOnly />
                <a
                    href="/api/auth/google"
                    className="mt-auto flex h-10 items-center justify-center rounded-xl bg-[#E10600] text-sm font-semibold text-white transition-colors hover:bg-[#c90500]"
                >
                    Open App
                </a>
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
        <section aria-label="Product preview" className="mx-auto w-full max-w-6xl px-5 pt-10 sm:pt-14">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E10600]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#E10600]" aria-hidden="true" />
                The product
            </p>
            <div className="mt-3 flex flex-col justify-between gap-3 md:flex-row md:items-end">
                <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                    The app itself, live.
                </h2>
                <p className="max-w-xs text-[13.5px] leading-relaxed text-muted-foreground md:text-right">
                    Every pixel below is the real interface — the demo runs
                    the same components as your sessions.
                </p>
            </div>
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_250px]">
                <DesktopFrame index={index} onAdvance={onAdvance} />
                <PhoneFrame />
            </div>
        </section>
    );
}
