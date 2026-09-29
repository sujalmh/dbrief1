"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ModeLabel } from "@/components/layout/header-shell";
import type { Message } from "@/lib/store";

const EASE = [0.22, 1, 0.36, 1] as const;

// Timeline per demo: question sits, the pipeline runs, the answer streams
// word by word (like live tokens), the sources/footer land, hold, advance.
const THINK_MS = 900;
const WORD_MS = 55;
const HOLD_MS = 3400;
const REDUCED_HOLD_MS = 5200;

interface DemoSlide {
    id: string;
    /** Matches the header mode selector so the same control drives the demo. */
    mode: ModeLabel;
    question: string;
    answer: string;
    /** Rendered after the prose lands — mirrors a late visualization event. */
    table?: string;
    steps: { description: string; tool: string }[];
    citations?: NonNullable<Message["citations"]>;
    durationMs: number;
}

/**
 * The four capabilities, in the same order and with the same names the
 * signed-in header shows. Each slide is a real chat exchange rendered by
 * the real MessageBubble — markdown, driver highlights, planning grid,
 * sources and usage footer are the app's own components, not mock-ups.
 */
export const DEMO_SLIDES: DemoSlide[] = [
    {
        id: "telemetry",
        mode: "Telemetry",
        question: "Where is VER losing time to NOR?",
        answer: "Norris is quicker through the final sector. He carries **6 km/h** more apex speed into Turn 13 and gets on throttle **8 m** earlier — worth about two tenths a lap, every lap.",
        steps: [
            { description: "Load telemetry for VER and NOR", tool: "get_telemetry" },
            { description: "Compare speed traces through Turn 13", tool: "get_telemetry_summary" },
            { description: "Quantify the lap-time delta", tool: "get_laps" },
        ],
        durationMs: 2400,
    },
    {
        id: "comparison",
        mode: "Comparison",
        question: "Russell vs Hamilton, last 10 laps?",
        answer: "Russell is **0.3s** quicker on average and closing at **0.4s per lap**. On this trend he is on Hamilton's gearbox by lap 52.",
        steps: [
            { description: "Load the last 10 laps for RUS and HAM", tool: "get_laps" },
            { description: "Compare pace and gap evolution", tool: "get_fastest_lap" },
        ],
        durationMs: 1900,
    },
    {
        id: "strategy",
        mode: "Strategy",
        question: "Best tyre strategy for Singapore?",
        answer: "Soft to medium suits the top four. The undercut window opens on **lap 18** — pit then and you jump the cars ahead. Staying out past lap 24 costs track position.",
        steps: [
            { description: "Load stint data for the top four", tool: "get_tyres" },
            { description: "Model the pit-window alternatives", tool: "get_race" },
            { description: "Check track temperature evolution", tool: "get_weather" },
        ],
        durationMs: 2600,
    },
    {
        id: "insights",
        mode: "Insights",
        question: "Who is more likely to win the championship?",
        answer: "Verstappen leads Norris by **66 points** with 8 wins from 14 rounds. At this pace the title is his to lose — Norris needs back-to-back wins to reopen it.",
        table: "| Driver | Points | Gap |\n| --- | --- | --- |\n| VER | 302 | — |\n| NOR | 236 | −66 |\n| LEC | 199 | −103 |",
        steps: [
            { description: "Load the 2026 drivers' standings", tool: "get_driver_standings" },
            { description: "Check the latest championship coverage", tool: "web_search" },
        ],
        citations: [
            {
                source: "formula1.com/driver-standings",
                title: "2026 Driver Standings",
                url: "https://www.formula1.com/en/results",
                type: "web",
            },
        ],
        durationMs: 2200,
    },
];

/**
 * Auto-playing demo exchange.
 * ==========================
 * Renders exactly what the signed-in chat renders — a user bubble and the
 * race engineer's reply — then advances to the next capability. Hover or
 * touch pauses the timeline (and the progress line); the header's mode
 * selector jumps straight to a capability.
 */
export function LandingShowcase({
    index,
    onAdvance,
}: {
    index: number;
    onAdvance: () => void;
}) {
    const reduce = useReducedMotion();
    const slide = DEMO_SLIDES[index] ?? DEMO_SLIDES[0]!;

    return (
        <motion.section
            key={slide.id}
            aria-label="Example Dbrief1 conversation"
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
        >
            <DemoExchange slide={slide} onAdvance={onAdvance} />
        </motion.section>
    );
}

function DemoExchange({
    slide,
    onAdvance,
}: {
    slide: DemoSlide;
    onAdvance: () => void;
}) {
    const reduce = useReducedMotion();
    const [elapsed, setElapsed] = useState(0);
    const [paused, setPaused] = useState(false);
    const pausedRef = useRef(false);

    const words = useMemo(() => slide.answer.split(" "), [slide.answer]);
    const think = reduce ? 0 : THINK_MS;
    const stream = reduce ? 0 : words.length * WORD_MS;
    const hold = reduce ? REDUCED_HOLD_MS : HOLD_MS;
    const total = think + stream + hold;

    // rAF accumulator drives the phases; the interval bucket keeps
    // re-renders to ~16/s instead of one per frame.
    useEffect(() => {
        let acc = 0;
        let last = performance.now();
        let lastBucket = -1;
        let raf = 0;
        const tick = (now: number) => {
            const dt = now - last;
            last = now;
            if (!pausedRef.current) {
                acc += dt;
                if (acc >= total) {
                    onAdvance();
                    return;
                }
                const bucket = Math.floor(acc / 60);
                if (bucket !== lastBucket) {
                    lastBucket = bucket;
                    setElapsed(acc);
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [total, onAdvance]);

    const setPausedState = (p: boolean) => {
        pausedRef.current = p;
        setPaused(p);
    };

    const shown = reduce
        ? words.length
        : Math.max(0, Math.min(words.length, Math.floor((elapsed - think) / WORD_MS)));
    const thinking = !reduce && elapsed < think;
    const done = reduce || shown >= words.length;

    const steps = useMemo(
        () =>
            slide.steps.map((s, i) => ({
                description: s.description,
                tool: s.tool,
                status:
                    done || !thinking
                        ? ("success" as const)
                        : i === 0
                          ? ("running" as const)
                          : ("pending" as const),
            })),
        [slide.steps, done, thinking]
    );

    const userMessage: Message = useMemo(
        () => ({
            id: `demo-user-${slide.id}`,
            role: "user",
            content: slide.question,
            timestamp: 0,
        }),
        [slide.id, slide.question]
    );

    const assistantMessage: Message = useMemo(() => {
        const prose = words.slice(0, shown).join(" ");
        const content = done && slide.table ? `${prose}\n\n${slide.table}` : prose;
        return {
            id: `demo-engineer-${slide.id}`,
            role: "assistant",
            content,
            timestamp: 0,
            steps,
            // Sources and the usage footer land with the finished answer,
            // exactly as they do in the live app.
            ...(done ? { durationMs: slide.durationMs } : {}),
            ...(done && slide.citations ? { citations: slide.citations } : {}),
        };
    }, [words, shown, done, slide, steps]);

    return (
        <div
            className="relative flex min-h-[280px] w-full flex-col gap-4 sm:min-h-[320px]"
            data-paused={paused}
            onMouseEnter={() => setPausedState(true)}
            onMouseLeave={() => setPausedState(false)}
            onTouchStart={() => setPausedState(true)}
            onTouchEnd={() => setPausedState(false)}
        >
            {/* Auto-advance progress — same weight as the planning bars in
                chat, labelled so the line reads as a demo timeline rather
                than a stray rule. Hidden for reduced motion. */}
            {!reduce && (
                <div className="flex items-center gap-3" aria-hidden="true">
                    <span className="font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70">
                        Live demo
                    </span>
                    <div className="h-px flex-1 overflow-hidden bg-border/50">
                        <div
                            className="landing-progress h-full bg-[var(--f1-red)]"
                            style={{ animationDuration: `${total}ms` }}
                        />
                    </div>
                </div>
            )}

            <div className="flex min-w-0 flex-col gap-6">
                <MessageBubble message={userMessage} readOnly />
                <MessageBubble message={assistantMessage} readOnly />
            </div>
        </div>
    );
}
