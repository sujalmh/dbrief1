"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { MessageBubble } from "@/components/chat/message-bubble";
import type { ModeLabel } from "@/components/layout/header-shell";
import type { Message } from "@/lib/store";

const EASE = [0.22, 1, 0.36, 1] as const;

// Timeline per demo: question sits, the pipeline runs, the answer streams
// word by word (like live tokens), the sources/footer land, hold long
// enough to read, advance. Hold dominates: ~30-word answers need ~6s at a
// relaxed reading pace, and hovering pauses everything.
const THINK_MS = 900;
const WORD_MS = 60;
const HOLD_MS = 5200;
const REDUCED_HOLD_MS = 6000;

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
        question: "Where is Verstappen losing time to Norris?",
        answer: "Mostly in the final sector. Norris carries **6 km/h** more apex speed through Turn 13 and opens the throttle **8 m** earlier — about two tenths per lap.",
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
        question: "Russell vs Hamilton over the last 10 laps?",
        answer: "Russell averages three tenths quicker and is closing at **0.4s per lap**. On this trend, he reaches Hamilton's gearbox by lap 52.",
        steps: [
            { description: "Load the last 10 laps for RUS and HAM", tool: "get_laps" },
            { description: "Compare pace and gap evolution", tool: "get_fastest_lap" },
        ],
        durationMs: 1900,
    },
    {
        id: "strategy",
        mode: "Strategy",
        question: "What is the best tyre strategy for Singapore?",
        answer: "Soft to medium for the top four. The undercut opens on **lap 18** — stop then for track position. Staying out past lap 24 costs places.",
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
        question: "Who is leading the drivers’ championship?",
        answer: "Verstappen, on **302 points** — 66 ahead of Norris, with 8 wins from 14 rounds. Norris needs consecutive wins to reopen it.",
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
 * Auto-playing demo exchange in a fixed-height stage.
 * ================================================
 * Renders exactly what the signed-in chat renders — a user bubble and the
 * race engineer's reply — then advances to the next capability. The stage
 * height never changes between slides (tallest slide sets it; verified by
 * screenshot), so autoplay causes zero layout shift. Hover or touch pauses
 * the timeline (and the progress line); the header's mode selector jumps
 * straight to a capability. Every slide ends in the same sign-in action.
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
        <div className="flex h-full flex-col overflow-hidden">
            <motion.section
                key={slide.id}
                aria-label="Example Dbrief1 conversation"
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="min-h-0 flex-1"
            >
                <DemoExchange slide={slide} onAdvance={onAdvance} />
            </motion.section>
            <div className="flex shrink-0 justify-center pb-1 pt-2">
                <a
                    href="/api/auth/google"
                    className="group inline-flex h-10 items-center gap-2 rounded-full bg-[#E10600] px-5 text-sm font-semibold text-white shadow-[0_16px_30px_-12px_rgba(225,6,0,0.6)] transition-all hover:scale-[1.03] hover:bg-[#c90500] active:scale-[0.97]"
                >
                    Sign in to use Dbrief1
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
            </div>
        </div>
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
            className="relative flex h-full w-full flex-col gap-4 overflow-hidden"
            data-paused={paused}
            onMouseEnter={() => setPausedState(true)}
            onMouseLeave={() => setPausedState(false)}
            onTouchStart={() => setPausedState(true)}
            onTouchEnd={() => setPausedState(false)}
        >
            {/* Auto-advance progress — green reads as live/running (timing
                semantics), leaving red for the brand CTA only. Unlabelled:
                it reads as a timeline, not a badge. */}
            {!reduce && (
                <div className="h-px w-full overflow-hidden bg-border/50" aria-hidden="true">
                    <div
                        className="landing-progress h-full bg-[var(--f1-green)]"
                        style={{ animationDuration: `${total}ms` }}
                    />
                </div>
            )}

            <div className="flex min-w-0 flex-col gap-6">
                <MessageBubble message={userMessage} readOnly />
                <MessageBubble message={assistantMessage} readOnly />
            </div>
        </div>
    );
}
