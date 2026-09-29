"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
    Activity,
    ChevronLeft,
    ChevronRight,
    Flag,
    MessageSquare,
    RotateCcw,
    Sparkles,
    Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
// Real chat components — the demo exchange renders exactly what the app
// renders: markdown + driver highlights (MessageContent) and the pipeline
// status indicator (RadioWave).
import { MessageContent } from "@/components/chat/message-bubble";
import { RadioWave } from "@/components/chat/radio-wave";

const EASE = [0.22, 1, 0.36, 1] as const;

// Timeline per slide: question pops, status runs, answer streams word by
// word (like chat tokens), visual fades in, hold, advance.
const THINK_MS = 900;
const WORD_MS = 55;
const VISUAL_MS = 500;
const HOLD_MS = 2800;
const REDUCED_HOLD_MS = 4500;

type VisualKind = "standings" | "telemetry" | "tyres" | "compare";

interface Slide {
    id: string;
    icon: React.ElementType;
    tab: string;
    title: string;
    question: string;
    answer: string;
    visual: VisualKind;
    caption: string;
}

const SLIDES: Slide[] = [
    {
        id: "ask",
        icon: MessageSquare,
        tab: "Ask",
        title: "Ask the race anything",
        question: "Who is more likely to win the championship?",
        answer:
            "Antonelli leads Russell by 66 points with 8 wins. At this pace the title is his to lose — Russell needs back-to-back wins to reopen it.",
        visual: "standings",
        caption: "Live standings, cited from official data",
    },
    {
        id: "telemetry",
        icon: Activity,
        tab: "Telemetry",
        title: "See every lap",
        question: "Where is VER losing time to NOR?",
        answer:
            "Turn 13. Norris carries 6 km/h more apex speed and gets on throttle 8 metres earlier. That's two tenths a lap, every lap.",
        visual: "telemetry",
        caption: "Speed traces, throttle and brake",
    },
    {
        id: "strategy",
        icon: Flag,
        tab: "Strategy",
        title: "Understand strategy",
        question: "Best tyre strategy for Singapore?",
        answer:
            "Soft-medium suits the top four. The undercut window opens on lap 18 — pit then and you jump the cars ahead.",
        visual: "tyres",
        caption: "Pit windows and stint analysis",
    },
    {
        id: "compare",
        icon: Users,
        tab: "Compare",
        title: "Compare drivers",
        question: "Russell vs Hamilton, last 10 laps?",
        answer:
            "Russell is three tenths quicker on average and closing at 0.4s per lap. At this rate he is on Hamilton's gearbox by lap 52.",
        visual: "compare",
        caption: "Head-to-head pace trends",
    },
];

function StandingsVisual() {
    const rows = [
        { pos: "1", driver: "ANT", pts: "302", gap: "-" },
        { pos: "2", driver: "RUS", pts: "236", gap: "-66" },
        { pos: "3", driver: "HAM", pts: "199", gap: "-103" },
    ];
    return (
        <div>
            {rows.map((r) => (
                <div
                    key={r.pos}
                    className="grid grid-cols-[28px_1fr_52px_56px] items-center gap-1 border-b border-border/50 px-2 py-[7px] font-mono text-[12px] last:border-0"
                >
                    <span className="text-muted-foreground">{r.pos}</span>
                    <span className="font-sans font-bold">{r.driver}</span>
                    <span className="text-right tabular-nums">{r.pts}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{r.gap}</span>
                </div>
            ))}
        </div>
    );
}

function TelemetryVisual() {
    return (
        <div>
            <svg viewBox="0 0 240 86" fill="none" className="h-[86px] w-full" aria-hidden="true">
                {[18, 38, 58].map((y) => (
                    <line key={y} x1="24" y1={y} x2="236" y2={y} stroke="currentColor" strokeWidth="1" className="text-foreground/[0.07]" />
                ))}
                <polyline
                    points="24,66 38,52 52,56 66,34 80,44 94,30 108,52 122,48 136,60 150,40 164,50 178,36 192,54 206,44 220,56 236,38"
                    fill="none"
                    strokeWidth="1.8"
                    className="stroke-zinc-400 dark:stroke-zinc-500"
                />
                <polyline
                    points="24,70 38,60 52,48 66,58 80,36 94,50 108,34 122,58 136,44 150,62 164,42 178,58 192,40 206,60 220,46 236,58"
                    fill="none"
                    stroke="#E10600"
                    strokeWidth="1.8"
                />
            </svg>
            <div className="mt-1 flex items-center gap-3 px-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-zinc-500" /> VER
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[#E10600]" /> NOR
                </span>
                <span className="ml-auto font-mono">T13 +6 km/h</span>
            </div>
        </div>
    );
}

function TyresVisual() {
    const rows = [
        { d: "ANT", segs: [["32%", "bg-red-500"], ["28%", "bg-zinc-400 dark:bg-zinc-600"], ["22%", "bg-amber-300"]], tag: "S H M" },
        { d: "RUS", segs: [["26%", "bg-amber-300"], ["44%", "bg-zinc-400 dark:bg-zinc-600"]], tag: "M H" },
        { d: "HAM", segs: [["24%", "bg-amber-300"], ["22%", "bg-red-500"], ["30%", "bg-zinc-400 dark:bg-zinc-600"]], tag: "M S H" },
    ];
    return (
        <div>
            {rows.map((r) => (
                <div key={r.d} className="mb-2 flex items-center gap-2 last:mb-0">
                    <span className="w-8 font-mono text-[10px] font-bold text-muted-foreground">{r.d}</span>
                    <div className="flex h-2 flex-1 gap-[3px]">
                        {r.segs.map(([w, c], i) => (
                            <div key={i} className={`h-full rounded-full ${c}`} style={{ width: w }} />
                        ))}
                    </div>
                    <span className="font-mono text-[9px] tracking-wider text-muted-foreground">{r.tag}</span>
                </div>
            ))}
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[#E10600]">
                Undercut window · Lap 18
            </p>
        </div>
    );
}

function CompareVisual() {
    const rows = [
        { d: "RUS", t: "1:32.421", hot: true },
        { d: "HAM", t: "1:32.784", hot: false },
    ];
    return (
        <div>
            {rows.map((r) => (
                <div key={r.d} className="mb-1.5 flex items-center gap-2 text-[12px] last:mb-0">
                    <span className={cn("h-2 w-2 rounded-[3px]", r.hot ? "bg-[#E10600]" : "bg-zinc-500")} />
                    <span className="font-bold">{r.d}</span>
                    <span className="ml-auto font-mono tabular-nums text-muted-foreground">{r.t}</span>
                </div>
            ))}
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-[#E10600]">
                Gap closing · 0.4s / lap
            </p>
        </div>
    );
}

function SlideVisual({ kind }: { kind: VisualKind }) {
    return (
        <div className="rounded-xl border border-border/60 bg-muted/40 p-3">
            {kind === "standings" && <StandingsVisual />}
            {kind === "telemetry" && <TelemetryVisual />}
            {kind === "tyres" && <TyresVisual />}
            {kind === "compare" && <CompareVisual />}
        </div>
    );
}

/**
 * Auto-playing capability carousel styled as the chat itself: a user
 * question bubble, a RACE ENGINEER status line, then the answer streaming
 * in word by word with a cursor — like live response tokens — followed by
 * the supporting visual. Tabs, arrows and dots jump between capabilities;
 * hovering (or touching) pauses the timeline. Fits one viewport so the
 * landing needs no scrolling on desktop and most phones.
 */
export function ShowcaseCarousel() {
    const reduce = useReducedMotion();
    const [index, setIndex] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const pausedRef = useRef(false);

    const slide = SLIDES[index];
    const words = useMemo(() => slide.answer.split(" "), [slide]);

    const think = reduce ? 0 : THINK_MS;
    const stream = reduce ? 0 : words.length * WORD_MS;
    const visualMs = reduce ? 0 : VISUAL_MS;
    const hold = reduce ? REDUCED_HOLD_MS : HOLD_MS;
    const total = think + stream + visualMs + hold;

    // rAF accumulator (pausable) drives phases + progress from one clock.
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
                    setElapsedMs(0);
                    setIndex((i) => (i + 1) % SLIDES.length);
                    return;
                }
                const bucket = Math.floor(acc / 60);
                if (bucket !== lastBucket) {
                    lastBucket = bucket;
                    setElapsedMs(acc);
                }
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [index, total]);

    const go = (dir: number) => {
        pausedRef.current = false;
        setElapsedMs(0);
        setIndex((i) => (i + dir + SLIDES.length) % SLIDES.length);
    };
    const jump = (i: number) => {
        if (i === index) return;
        pausedRef.current = false;
        setElapsedMs(0);
        setIndex(i);
    };
    const replay = () => {
        pausedRef.current = false;
        setElapsedMs(0);
        setIndex(0);
    };
    const setPaused = (p: boolean) => {
        pausedRef.current = p;
    };

    const shown = reduce
        ? words.length
        : Math.max(0, Math.min(words.length, Math.floor((elapsedMs - think) / WORD_MS)));
    const thinking = !reduce && elapsedMs < think;
    const streaming = !reduce && elapsedMs >= think && shown < words.length;
    const visualOn = !!reduce || elapsedMs >= think + stream;
    const progress = Math.min(1, elapsedMs / total);

    return (
        <motion.section
            aria-label="Capabilities demo"
            initial={reduce ? false : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35, ease: EASE }}
            className="relative mx-auto mt-5 w-full max-w-4xl flex-1 sm:mt-8"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onTouchStart={() => setPaused(true)}
            onTouchEnd={() => setPaused(false)}
        >
            {/* glow backdrop */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div className="absolute left-1/2 top-1/3 h-[280px] w-[560px] -translate-x-1/2 rounded-full bg-[#E10600]/[0.08] blur-[110px] dark:bg-[#E10600]/[0.13]" />
            </div>

            <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-[0_40px_90px_-40px_rgba(0,0,0,0.45)] backdrop-blur">
                {/* tab bar */}
                <div className="flex items-center gap-1 border-b border-border/60 px-2 py-2 sm:px-3" role="tablist" aria-label="Capabilities">
                    {SLIDES.map((s, i) => (
                        <button
                            key={s.id}
                            role="tab"
                            aria-selected={i === index}
                            onClick={() => jump(i)}
                            className={cn(
                                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-semibold transition-colors sm:flex-none sm:px-3.5",
                                i === index
                                    ? "bg-[#E10600]/10 text-[#E10600]"
                                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            )}
                        >
                            <s.icon className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">{s.tab}</span>
                        </button>
                    ))}
                    <span className="ml-auto hidden pr-2 font-mono text-[10px] tracking-widest text-muted-foreground sm:block">
                        0{index + 1} / 0{SLIDES.length}
                    </span>
                </div>

                {/* progress */}
                <div className="h-px w-full bg-border/50" aria-hidden="true">
                    <div className="h-full bg-[#E10600] transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
                </div>

                {/* slide */}
                <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[1.05fr_0.95fr]">
                    <div className="min-h-[228px] sm:min-h-[248px]">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={slide.id}
                                initial={reduce ? false : { opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={reduce ? undefined : { opacity: 0, x: -16 }}
                                transition={{ duration: 0.3, ease: EASE }}
                            >
                                <div className="flex items-center gap-2">
                                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E10600]/10 text-[#E10600]">
                                        <slide.icon className="h-3.5 w-3.5" />
                                    </span>
                                    <h3 className="text-[14px] font-bold tracking-tight">{slide.title}</h3>
                                </div>

                                {/* user question bubble (chat style) */}
                                <div className="ml-auto mt-3 w-fit max-w-[92%] rounded-xl border border-[var(--f1-red)] bg-[var(--f1-red)]/[0.06] px-3 py-2 text-[13px] leading-snug">
                                    {slide.question}
                                </div>

                                {/* assistant line */}
                                <div className="mt-3 flex gap-2">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#E10600] text-white" aria-hidden="true">
                                        <Sparkles className="h-3 w-3" />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                                            Race Engineer
                                        </p>
                                        {thinking ? (
                                            <div className="flex items-center gap-3 py-2">
                                                <span className="max-w-[300px] truncate font-mono text-xs text-muted-foreground animate-pulse">
                                                    ANALYSING…
                                                </span>
                                                <RadioWave />
                                            </div>
                                        ) : (
                                            <div className="prose prose-sm break-words dark:prose-invert max-w-none leading-relaxed text-foreground">
                                                {shown > 0 && (
                                                    <MessageContent
                                                        content={words.slice(0, shown).join(" ")}
                                                        isUser={false}
                                                        season={2026}
                                                    />
                                                )}
                                                {streaming && (
                                                    <span className="ml-1 inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse bg-[#E10600]" aria-hidden="true" />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        </AnimatePresence>
                    </div>

                    {/* visual */}
                    <div className="flex flex-col justify-center">
                        <AnimatePresence>
                            {visualOn && (
                                <motion.div
                                    key={`v-${slide.id}`}
                                    initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.45, ease: EASE }}
                                >
                                    <SlideVisual kind={slide.visual} />
                                    <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                        {slide.caption}
                                    </p>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* controls */}
                <div className="flex items-center justify-between border-t border-border/60 px-3 py-2">
                    <div className="flex items-center gap-1.5" aria-label="Choose capability">
                        {SLIDES.map((s, i) => (
                            <button
                                key={s.id}
                                onClick={() => jump(i)}
                                aria-label={s.title}
                                className={cn(
                                    "h-1.5 rounded-full transition-all",
                                    i === index ? "w-6 bg-[#E10600]" : "w-1.5 bg-border hover:bg-muted-foreground"
                                )}
                            />
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={replay}
                            aria-label="Replay demo"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                            <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                            onClick={() => go(-1)}
                            aria-label="Previous capability"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => go(1)}
                            aria-label="Next capability"
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                        >
                            <ChevronRight className="h-4 w-4" />
                        </button>
                    </div>
                </div>
            </div>
        </motion.section>
    );
}
