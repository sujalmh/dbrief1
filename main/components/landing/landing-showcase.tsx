"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
    /** Race context kicker shown with the classification badge. */
    context: string;
    question: string;
    answer: string;
    /** Rendered after the prose lands — mirrors a late visualization event. */
    table?: string;
    /** Static chart preview — mirrors the app's visualization panel. */
    chart?: { title: string; caption: string };
    steps: { description: string; tool: string }[];
}

/** Classification colors — one per capability, reused by the slide badge. */
const MODE_DOT: Record<ModeLabel, string> = {
    Telemetry: "var(--f1-green)",
    Comparison: "#3b82f6",
    Strategy: "var(--f1-yellow)",
    Insights: "var(--f1-purple)",
};

/**
 * The four capabilities, in the same order and with the same names the
 * signed-in header shows. Each slide is a real chat exchange rendered by
 * the real MessageBubble — markdown, driver highlights, planning grid,
 * sources and usage footer are the app's own components, not mock-ups.
 * Questions carry race context (GP, session, lap) so visitors see the
 * kind of specific prompts the product answers.
 */
export const DEMO_SLIDES: DemoSlide[] = [
    {
        id: "telemetry",
        mode: "Telemetry",
        context: "Singapore GP · Race · Lap 38",
        question: "Singapore, lap 38 — where is Verstappen losing time to Norris?",
        answer: "Mostly the final sector. Through Turns 13–16 Norris carries **6 km/h** more apex speed and gets on the throttle **8 m** earlier — about **0.2s per lap**. VER's rears run 4° hotter, so he's sliding on exit.",
        steps: [
            { description: "Load VER / NOR telemetry — Singapore, laps 36–38", tool: "get_telemetry" },
            { description: "Compare speed traces through Turns 13–16", tool: "get_telemetry_summary" },
            { description: "Quantify the delta vs rear-tyre temps", tool: "get_laps" },
        ],
    },
    {
        id: "comparison",
        mode: "Comparison",
        context: "Suzuka · Last 10 laps · RUS vs HAM",
        question: "Russell vs Hamilton over the last 10 laps — who's got the pace?",
        answer: "Russell, clearly. On fresher mediums he's **0.3s a lap** quicker since lap 42 and closing at **0.4s per lap** — at this rate he's on Hamilton's gearbox by lap 52.",
        chart: { title: "Gap to HAM (s)", caption: "RUS closing 0.4s / lap · overtake ~lap 52" },
        steps: [
            { description: "Load the last 10 laps for RUS and HAM — Suzuka", tool: "get_laps" },
            { description: "Compare pace and gap evolution", tool: "get_fastest_lap" },
        ],
    },
    {
        id: "strategy",
        mode: "Strategy",
        context: "Singapore · P4 on softs · Pit window",
        question: "Starting P4 on softs in Singapore — one-stop or two?",
        answer: "Two-stop: soft → medium on **lap 18**, then medium to the flag. The undercut opens at lap 18 — staying out past lap 24 costs ~2 places. Keep a soft in hand: safety-car chance is **68%** here.",
        steps: [
            { description: "Load stint and degradation data — top four", tool: "get_tyres" },
            { description: "Model one-stop vs two-stop windows", tool: "get_race" },
            { description: "Factor safety-car probability and track temps", tool: "get_weather" },
        ],
    },
    {
        id: "insights",
        mode: "Insights",
        context: "After Monza · Round 14 · Standings",
        question: "Who leads the championship after Monza?",
        answer: "Verstappen, on **302 points** — 66 clear of Norris with 8 wins from 14. Norris needs back-to-back wins to reopen it before Austin.",
        table: "| Driver | Points | Gap |\n| --- | --- | --- |\n| VER | 302 | — |\n| NOR | 236 | −66 |\n| LEC | 199 | −103 |",
        steps: [
            { description: "Load the drivers' standings after Monza", tool: "get_driver_standings" },
            { description: "Check the latest championship coverage", tool: "web_search" },
        ],
    },
];

/**
 * Auto-playing demo exchange in a flex-fill clipped stage.
 * ======================================================
 * Renders exactly what the signed-in chat renders — a user bubble and the
 * race engineer's reply — then advances to the next capability. Layout is
 * rock-stable by construction: the stage fills the leftover viewport
 * space, everything below it is static, and the demo carries no trailing
 * metadata (sources/footer are live-app chrome that would pop in late and
 * shift things). Streaming text grows downward inside the clipped area;
 * nothing outside it ever moves. Hover or touch pauses the timeline (and
 * the progress line); the header's mode selector jumps straight to a
 * capability.
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
        };
    }, [words, shown, done, slide, steps]);

    const showChart = done && slide.chart;

    return (
        <div
            className="relative flex h-full w-full flex-col gap-3 overflow-hidden sm:gap-4"
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

            {/* Capability classification — the header pill is hidden below
                lg, so every slide labels itself: mode + race context. */}
            <div className="flex min-w-0 items-center gap-2 px-1">
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
                    <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: MODE_DOT[slide.mode] }}
                    />
                    {slide.mode}
                </span>
                <span className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
                    {slide.context}
                </span>
            </div>

            <div className="flex min-w-0 flex-col gap-4 overflow-hidden sm:gap-6">
                <MessageBubble message={userMessage} readOnly />
                <MessageBubble message={assistantMessage} readOnly />
                {slide.chart && (
                    <div
                        className={`transition-opacity duration-500 ${showChart ? "opacity-100" : "opacity-0"}`}
                        aria-hidden={!showChart}
                    >
                        {showChart && (
                            <DemoChartPreview
                                title={slide.chart.title}
                                caption={slide.chart.caption}
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * Static gap-evolution preview for the Comparison slide.
 * Mirrors the app's visualization panel (title + chart + caption) without
 * pulling recharts into the landing bundle — a lightweight SVG with the
 * same gap-closing story the answer narrates.
 */
function DemoChartPreview({ title, caption }: { title: string; caption: string }) {
    // Gap (s) from lap 42 → 51: 4.2s closing to 0.5s.
    const points: Array<[number, number]> = [
        [0, 4.2],
        [1, 3.9],
        [2, 3.4],
        [3, 3.0],
        [4, 2.6],
        [5, 2.1],
        [6, 1.7],
        [7, 1.3],
        [8, 0.9],
        [9, 0.5],
    ];
    const W = 320;
    const H = 96;
    const PAD = 10;
    const maxY = 4.5;
    const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
    const y = (v: number) => PAD + (1 - v / maxY) * (H - PAD * 2);
    const line = points.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = `${PAD},${H - PAD} ${line} ${W - PAD},${H - PAD}`;

    return (
        <div className="ml-11 overflow-hidden rounded-xl border border-border/60 bg-background/60 backdrop-blur-sm md:ml-12">
            <div className="flex items-center justify-between px-3 pt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    {title}
                </span>
                <span className="rounded-full bg-[#3b82f6]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#3b82f6]">
                    Visualization
                </span>
            </div>
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="h-[104px] w-full"
                role="img"
                aria-label="Gap closing from 4.2 seconds to 0.5 seconds"
            >
                {[4, 3, 2, 1].map((g) => (
                    <line
                        key={g}
                        x1={PAD}
                        x2={W - PAD}
                        y1={y(g)}
                        y2={y(g)}
                        stroke="currentColor"
                        strokeOpacity="0.12"
                        strokeDasharray="3 4"
                    />
                ))}
                <polygon points={area} fill="#3b82f6" fillOpacity="0.12" />
                <polyline
                    points={line}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                {points.map(([i, v]) => (
                    <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="#3b82f6" />
                ))}
                <circle cx={x(9)} cy={y(0.5)} r="4" fill="none" stroke="#3b82f6" strokeWidth="1.5" />
            </svg>
            <div className="flex items-center justify-between px-3 pb-2">
                <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                    Lap 42 → 51
                </span>
                <span className="text-[10px] font-medium text-muted-foreground">{caption}</span>
            </div>
        </div>
    );
}
