"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
    Activity,
    ArrowDown,
    ArrowRight,
    ChevronDown,
    Database,
    Flag,
    Search,
    Send,
    Sparkles,
} from "lucide-react";
import { Float, Reveal } from "./reveal";

const EASE = [0.22, 1, 0.36, 1] as const;

const STANDINGS = [
    { pos: "1", driver: "Antonelli", color: "text-zinc-900 dark:text-white", pts: "302", wins: "8", gap: "-" },
    { pos: "2", driver: "Russell", color: "text-teal-600 dark:text-teal-400", pts: "236", wins: "3", gap: "-66" },
    { pos: "3", driver: "Hamilton", color: "text-teal-600 dark:text-teal-400", pts: "199", wins: "1", gap: "-103" },
    { pos: "4", driver: "Norris", color: "text-orange-500", pts: "186", wins: "2", gap: "-116" },
    { pos: "5", driver: "Leclerc", color: "text-red-600 dark:text-red-500", pts: "179", wins: "1", gap: "-123" },
    { pos: "6", driver: "Verstappen", color: "text-blue-700 dark:text-blue-400", pts: "163", wins: "0", gap: "-139" },
];

function TyreBar({ segments }: { segments: { w: string; c: string }[] }) {
    return (
        <div className="flex h-2 flex-1 gap-[3px] overflow-hidden">
            {segments.map((s, i) => (
                <div key={i} className={`h-full rounded-full ${s.c}`} style={{ width: s.w }} />
            ))}
        </div>
    );
}

function TrackOutline({ className = "" }: { className?: string }) {
    return (
        <svg viewBox="0 0 200 110" fill="none" className={className} aria-hidden="true">
            <path
                d="M18 92 C 34 92, 30 64, 48 58 S 62 66, 76 40 S 102 22, 118 40 S 128 66, 148 62 S 162 44, 182 46"
                stroke="currentColor"
                strokeWidth="5"
                strokeLinecap="round"
                className="text-zinc-300 dark:text-zinc-700"
            />
            <path
                d="M18 92 C 34 92, 30 64, 48 58 S 62 66, 76 40 S 102 22, 118 40 S 128 66, 148 62 S 162 44, 182 46"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 5"
                strokeLinecap="round"
                className="text-zinc-400 dark:text-zinc-500"
            />
            <circle cx="182" cy="46" r="5" fill="#E10600" />
            <circle cx="182" cy="46" r="8.5" fill="none" stroke="#E10600" strokeOpacity="0.35" strokeWidth="2" />
        </svg>
    );
}

function TelemetryLines({ id }: { id: string }) {
    return (
        <svg viewBox="0 0 240 86" fill="none" className="h-[86px] w-full" aria-hidden="true">
            {[18, 38, 58].map((y) => (
                <line key={y} x1="24" y1={y} x2="236" y2={y} stroke="currentColor" strokeWidth="1" className="text-black/[0.06] dark:text-white/[0.07]" />
            ))}
            <polyline
                points="24,66 38,52 52,56 66,34 80,44 94,30 108,52 122,48 136,60 150,40 164,50 178,36 192,54 206,44 220,56 236,38"
                fill="none"
                strokeWidth="1.8"
                className="stroke-zinc-400 dark:stroke-zinc-500"
            />
            <polyline
                points={`24,70 38,60 52,48 66,58 80,36 94,50 108,34 122,58 136,44 150,62 164,42 178,58 192,40 206,60 220,46 236,58`}
                fill="none"
                stroke="#E10600"
                strokeWidth="1.8"
            />
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E10600" stopOpacity="0.18" />
                    <stop offset="100%" stopColor="#E10600" stopOpacity="0" />
                </linearGradient>
            </defs>
        </svg>
    );
}

function DashboardMock() {
    const reduce = useReducedMotion();
    return (
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 40, scale: 0.985 }}
            whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.9, ease: EASE }}
            className="relative z-10 mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_50px_100px_-40px_rgba(0,0,0,0.3)] dark:border-white/10 dark:bg-[#141414] dark:shadow-[0_50px_120px_-30px_rgba(0,0,0,0.8)]"
        >
            {/* window bar */}
            <div className="flex items-center gap-2 border-b border-black/[0.06] px-4 py-2.5 dark:border-white/[0.06]">
                <span className="h-2 w-2 rounded-full bg-[#FF5F57]" />
                <span className="h-2 w-2 rounded-full bg-[#FEBC2E]" />
                <span className="h-2 w-2 rounded-full bg-[#28C840]" />
                <span className="ml-2 text-[12px] font-extrabold tracking-tight">DBRIEF1</span>
                <span className="ml-3 hidden items-center gap-1 text-[12px] font-semibold sm:flex">
                    Championship <ChevronDown className="h-3 w-3 text-zinc-400" />
                </span>
                <span className="ml-auto hidden items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 text-[11px] text-zinc-500 sm:flex dark:border-white/10">
                    2026 Season <ChevronDown className="h-3 w-3" />
                </span>
            </div>

            <div className="grid md:grid-cols-[148px_1fr]">
                {/* sidebar */}
                <div className="hidden border-r border-black/[0.06] p-3 md:block dark:border-white/[0.06]">
                    {[
                        { icon: Search, label: "Insights", active: true },
                        { icon: Activity, label: "Telemetry", active: false },
                        { icon: Database, label: "Comparison", active: false },
                        { icon: Flag, label: "Strategy", active: false },
                    ].map((it) => (
                        <div
                            key={it.label}
                            className={`mb-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] font-medium ${
                                it.active
                                    ? "bg-red-50 text-[#E10600] dark:bg-red-500/10"
                                    : "text-zinc-500 dark:text-zinc-400"
                            }`}
                        >
                            <it.icon className="h-3.5 w-3.5" />
                            {it.label}
                        </div>
                    ))}
                    <p className="mb-1 mt-4 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Season 2026
                    </p>
                    {["Calendar", "Drivers", "Constructors"].map((l) => (
                        <div key={l} className="px-2.5 py-1.5 text-[12px] text-zinc-500 dark:text-zinc-400">
                            {l}
                        </div>
                    ))}
                </div>

                {/* main */}
                <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-[1fr_190px]">
                    <div className="overflow-hidden">
                        <div className="grid grid-cols-[44px_1fr_52px_40px_64px] gap-1 border-b border-black/[0.06] px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:border-white/[0.06]">
                            <span>Pos</span>
                            <span>Driver</span>
                            <span className="text-right">Pts</span>
                            <span className="text-right">W</span>
                            <span className="text-right">Gap</span>
                        </div>
                        {STANDINGS.map((r) => (
                            <div
                                key={r.pos}
                                className="grid grid-cols-[44px_1fr_52px_40px_64px] gap-1 border-b border-black/[0.04] px-2 py-[7px] text-[12px] last:border-0 dark:border-white/[0.04]"
                            >
                                <span className="text-zinc-400">{r.pos}</span>
                                <span className={`font-semibold ${r.color}`}>{r.driver}</span>
                                <span className="text-right tabular-nums">{r.pts}</span>
                                <span className="text-right tabular-nums text-zinc-500">{r.wins}</span>
                                <span className="text-right tabular-nums text-zinc-500">{r.gap}</span>
                            </div>
                        ))}
                    </div>
                    <div className="rounded-xl border border-black/[0.06] bg-zinc-50/80 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                        <div className="flex items-center gap-1.5">
                            <span className="flex h-4 w-5 items-center justify-center rounded-[3px] bg-[#008C45] text-[8px] font-bold text-white">
                                SG
                            </span>
                            <div>
                                <p className="text-[12px] font-bold leading-none">Singapore GP</p>
                                <p className="mt-0.5 text-[10px] text-zinc-400">Marina Bay Street Circuit</p>
                            </div>
                        </div>
                        <TrackOutline className="mx-auto mt-1 h-[104px] w-full" />
                        <div className="mt-1 grid grid-cols-3 text-center">
                            {[
                                ["4.940 km", "Track"],
                                ["19", "Turns"],
                                ["62", "Laps"],
                            ].map(([v, l]) => (
                                <div key={l}>
                                    <p className="text-[12px] font-bold tabular-nums">{v}</p>
                                    <p className="text-[10px] text-zinc-400">{l}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="lg:col-span-2">
                        <div className="flex items-center gap-2 rounded-xl border border-black/[0.06] bg-zinc-50/60 px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.02]">
                            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                            <span className="flex-1 truncate text-[12px] text-zinc-400">
                                Ask about the race, strategy, drivers…
                            </span>
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E10600] text-white">
                                <Send className="h-3.5 w-3.5" />
                            </span>
                        </div>
                        <div className="mt-2 hidden gap-1.5 sm:flex">
                            {["Who's more likely to win?", "Best tyre strategy for Singapore?", "Compare Russell vs Hamilton"].map(
                                (c) => (
                                    <span
                                        key={c}
                                        className="truncate rounded-full border border-black/[0.07] px-2.5 py-1 text-[11px] text-zinc-500 dark:border-white/[0.08] dark:text-zinc-400"
                                    >
                                        {c}
                                    </span>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

function FloatingShell({
    className,
    style,
    duration,
    delay,
    children,
}: {
    className?: string;
    style?: React.CSSProperties;
    duration: number;
    delay: number;
    children: React.ReactNode;
}) {
    return (
        <Float
            duration={duration}
            delay={delay}
            style={style}
            className={`absolute z-20 hidden lg:block w-60 rounded-2xl border border-black/[0.08] bg-white/90 p-4 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.3)] backdrop-blur-xl dark:border-white/10 dark:bg-[#1a1a1a]/90 dark:shadow-[0_24px_60px_-20px_rgba(0,0,0,0.8)] ${className ?? ""}`}
        >
            {children}
        </Float>
    );
}

export function HeroShowcase() {
    const reduce = useReducedMotion();
    const fadeUp = (delay: number) =>
        reduce
            ? {}
            : {
                  initial: { opacity: 0, y: 26 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.8, delay, ease: EASE },
              };
    return (
        <section id="showcase" className="relative overflow-clip px-5 pb-6 pt-14 sm:pt-20">
            {/* faint backdrop: glow + ghost track lines */}
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                <div className="absolute left-1/2 top-[-180px] h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-[#E10600]/[0.07] blur-[120px] dark:bg-[#E10600]/[0.12]" />
                <svg viewBox="0 0 600 300" fill="none" className="absolute -right-24 top-0 h-[280px] w-[480px] text-black/[0.05] dark:text-white/[0.06]">
                    <path d="M40 280 C 140 260, 180 180, 260 170 S 380 190, 420 120 S 500 60, 580 40" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M60 295 C 160 275, 200 195, 280 185 S 400 205, 440 135 S 515 78, 595 58" stroke="currentColor" strokeWidth="1" />
                </svg>
                <span className="absolute right-[9%] top-10 text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-400/70 dark:text-zinc-600">
                    Turn 1
                </span>
            </div>

            <div className="relative mx-auto max-w-3xl text-center">
                <motion.p
                    {...fadeUp(0)}
                    className="flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400"
                >
                    <span className="h-1.5 w-1.5 rounded-full bg-[#E10600]" />
                    F1 Intelligence · 2026
                </motion.p>
                <motion.h1
                    {...fadeUp(0.08)}
                    className="mt-5 text-balance text-[42px] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-6xl md:text-[68px]"
                >
                    Understand the race
                    <br />
                    <span className="text-zinc-400 dark:text-zinc-500">beyond the numbers.</span>
                </motion.h1>
                <motion.p
                    {...fadeUp(0.16)}
                    className="mx-auto mt-5 max-w-xl text-pretty text-[15px] leading-relaxed text-zinc-500 sm:text-base dark:text-zinc-400"
                >
                    DBRIEF1 combines official F1 data, telemetry and AI analysis to give you clear,
                    actionable insights — before, during and after every race.
                </motion.p>
                <motion.div {...fadeUp(0.24)} className="mt-7 flex flex-wrap items-center justify-center gap-3">
                    <a
                        href="/api/auth/google"
                        className="group inline-flex h-11 items-center gap-2 rounded-full bg-[#E10600] px-6 text-sm font-semibold text-white shadow-[0_16px_30px_-12px_rgba(225,6,0,0.6)] transition-all hover:scale-[1.03] hover:bg-[#c90500] active:scale-[0.97]"
                    >
                        Explore DBRIEF1
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </a>
                    <a
                        href="#features"
                        className="inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-zinc-700 transition-colors hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                    >
                        See features
                        <ArrowDown className="h-4 w-4" />
                    </a>
                </motion.div>
            </div>

            {/* dashboard + floating cards */}
            <div className="relative mx-auto mt-12 max-w-5xl sm:mt-16">
                <FloatingShell style={{ transform: "rotate(-6deg)" }} className="-left-14 top-2" duration={7} delay={0.4}>
                    <div className="mb-3 flex items-center justify-between">
                        <p className="text-[13px] font-bold">Race Strategy</p>
                        <ArrowRight className="h-3.5 w-3.5 -rotate-45 text-zinc-400" />
                    </div>
                    {[
                        { d: "ANT", segs: [{ w: "22%", c: "bg-red-500" }, { w: "48%", c: "bg-blue-500" }], tag: "S M H" },
                        { d: "RUS", segs: [{ w: "30%", c: "bg-amber-400" }, { w: "42%", c: "bg-blue-500" }], tag: "S M" },
                        { d: "HAM", segs: [{ w: "34%", c: "bg-amber-300" }, { w: "30%", c: "bg-zinc-300 dark:bg-zinc-600" }], tag: "M H" },
                        { d: "NOR", segs: [{ w: "36%", c: "bg-orange-400" }, { w: "26%", c: "bg-red-500" }], tag: "S M" },
                    ].map((r) => (
                        <div key={r.d} className="mb-2 flex items-center gap-2 last:mb-0">
                            <span className="w-8 text-[10px] font-bold text-zinc-500">{r.d}</span>
                            <TyreBar segments={r.segs} />
                            <span className="text-[9px] tracking-wider text-zinc-400">{r.tag}</span>
                        </div>
                    ))}
                </FloatingShell>

                <FloatingShell style={{ transform: "rotate(5deg)" }} className="-right-10 top-6 w-64" duration={6.4} delay={1.1}>
                    <div className="mb-1.5 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-[#E10600]" />
                        <p className="text-[13px] font-bold">AI Insight</p>
                    </div>
                    <p className="text-[12px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                        Russell is 0.3s faster on mediums in the final stint based on last 3 races at
                        similar track conditions.
                    </p>
                </FloatingShell>

                <DashboardMock />

                <FloatingShell style={{ transform: "rotate(-4deg)" }} className="-left-16 bottom-8 w-64" duration={7.4} delay={0.8}>
                    <div className="mb-1 flex items-center justify-between">
                        <p className="text-[13px] font-bold">Telemetry</p>
                        <span className="flex items-center gap-1 rounded-md border border-black/10 px-2 py-0.5 text-[11px] text-zinc-500 dark:border-white/10">
                            Speed <ChevronDown className="h-3 w-3" />
                        </span>
                    </div>
                    <TelemetryLines id="hero-tel" />
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-zinc-800 dark:bg-zinc-200" /> Antonelli
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-[#E10600]" /> Russell
                        </span>
                    </div>
                </FloatingShell>

                <FloatingShell style={{ transform: "rotate(4deg)" }} className="-right-14 bottom-4" duration={6.8} delay={1.6}>
                    <p className="mb-2 text-[13px] font-bold">Driver Comparison</p>
                    <div className="mb-2.5 flex items-center gap-1 rounded-md border border-black/10 px-2 py-1 text-[11px] text-zinc-500 dark:border-white/10">
                        Lap Time <ChevronDown className="ml-auto h-3 w-3" />
                    </div>
                    {[
                        ["Antonelli", "1:32.421", "bg-zinc-800 dark:bg-zinc-200"],
                        ["Russell", "1:32.784", "bg-[#E10600]"],
                    ].map(([d, t, dot]) => (
                        <div key={d as string} className="mb-1.5 flex items-center gap-2 text-[12px] last:mb-0">
                            <span className={`h-2 w-2 rounded-[3px] ${dot}`} />
                            <span className="font-medium">{d}</span>
                            <span className="ml-auto tabular-nums text-zinc-500">{t}</span>
                        </div>
                    ))}
                </FloatingShell>
            </div>
        </section>
    );
}

const STATS = [
    { icon: Database, title: "24+", sub: "Races analysed" },
    { icon: Activity, title: "Telemetry", sub: "Speed, throttle, brake and more" },
    { icon: Flag, title: "Strategy", sub: "Pit windows, tyre analysis" },
    { icon: Sparkles, title: "AI insights", sub: "Clear, data-backed answers" },
];

export function StatsStrip() {
    return (
        <section className="mx-auto w-full max-w-6xl px-5 pt-10" aria-label="Coverage">
            <Reveal>
                <div className="grid grid-cols-2 gap-y-6 rounded-2xl border border-black/[0.07] bg-white/60 px-6 py-5 backdrop-blur lg:grid-cols-4 dark:border-white/[0.07] dark:bg-white/[0.02]">
                    {STATS.map((s, i) => (
                        <div
                            key={s.title}
                            className={`flex items-center gap-3.5 ${i > 0 ? "lg:border-l lg:border-black/[0.07] lg:pl-8 dark:lg:border-white/[0.07]" : ""}`}
                        >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-black/[0.07] text-zinc-700 dark:border-white/[0.08] dark:text-zinc-200">
                                <s.icon className="h-[18px] w-[18px]" />
                            </span>
                            <span>
                                <span className="block text-[14px] font-bold leading-tight">{s.title}</span>
                                <span className="block text-[12px] text-zinc-500 dark:text-zinc-400">{s.sub}</span>
                            </span>
                        </div>
                    ))}
                </div>
            </Reveal>
        </section>
    );
}
