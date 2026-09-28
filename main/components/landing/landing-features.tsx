"use client";

import {
    Activity,
    ArrowRight,
    ArrowUpRight,
    ChevronDown,
    MessageSquare,
    Sparkles,
    Users,
} from "lucide-react";
import { Reveal } from "./reveal";

function CardShell({
    children,
    className = "",
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`group flex flex-col rounded-2xl border border-black/[0.07] bg-white/70 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-[#E10600]/30 hover:shadow-[0_24px_50px_-24px_rgba(0,0,0,0.25)] dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:border-[#E10600]/40 dark:hover:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.9)] ${className}`}
        >
            {children}
        </div>
    );
}

function CardHead({
    icon: Icon,
    title,
}: {
    icon: React.ElementType;
    title: string;
}) {
    return (
        <div>
            <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-red-50 text-[#E10600] dark:bg-red-500/10">
                <Icon className="h-[18px] w-[18px]" />
            </span>
            <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-bold tracking-tight">{title}</h3>
                <ArrowUpRight className="h-4 w-4 text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#E10600] dark:text-zinc-600" />
            </div>
        </div>
    );
}

function Pill({ children }: { children: React.ReactNode }) {
    return (
        <span className="flex items-center gap-1 rounded-md border border-black/[0.08] px-2 py-1 text-[11px] font-medium text-zinc-500 dark:border-white/[0.08] dark:text-zinc-400">
            {children} <ChevronDown className="h-3 w-3 opacity-60" />
        </span>
    );
}

const TYRE_STRATEGY: { driver: string; segs: [string, string][] }[] = [
    { driver: "Antonelli", segs: [["32%", "bg-red-500"], ["28%", "bg-zinc-300 dark:bg-zinc-600"], ["22%", "bg-amber-300"]] },
    { driver: "Russell", segs: [["26%", "bg-amber-300"], ["44%", "bg-zinc-300 dark:bg-zinc-600"]] },
    { driver: "Hamilton", segs: [["24%", "bg-amber-300"], ["22%", "bg-red-500"], ["30%", "bg-zinc-300 dark:bg-zinc-600"]] },
    { driver: "Norris", segs: [["42%", "bg-amber-400"], ["30%", "bg-zinc-300 dark:bg-zinc-600"]] },
];

export function Features() {
    return (
        <section id="features" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 pt-20">
            <Reveal>
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E10600]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#E10600]" />
                    Key features
                </p>
            </Reveal>
            <div className="mt-3 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                <Reveal delay={0.05}>
                    <h2 className="max-w-xl text-balance text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                        Everything you need to understand F1.
                    </h2>
                </Reveal>
                <Reveal delay={0.1}>
                    <p className="max-w-xs text-[13.5px] leading-relaxed text-zinc-500 md:text-right dark:text-zinc-400">
                        From real-time data to AI-powered analysis, DBRIEF1 helps you go deeper into
                        every race.
                    </p>
                </Reveal>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Reveal delay={0}>
                    <CardShell className="h-full">
                        <CardHead icon={MessageSquare} title="Ask the race anything" />
                        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            Get clear answers using real F1 data and AI analysis.
                        </p>
                        <div className="mt-4 space-y-2 pt-1">
                            <p className="rounded-xl bg-zinc-100 px-3 py-2.5 text-[12px] text-zinc-600 dark:bg-white/[0.05] dark:text-zinc-300">
                                Who is more likely to win the championship?
                            </p>
                            <div className="flex gap-2 rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#E10600] text-white">
                                    <Sparkles className="h-3.5 w-3.5" />
                                </span>
                                <p className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                                    Based on 2026 season data, Antonelli has a 66-point lead over
                                    Russell and has won 8 races, showing consistent pace and
                                    performance.
                                </p>
                            </div>
                        </div>
                    </CardShell>
                </Reveal>

                <Reveal delay={0.07}>
                    <CardShell className="h-full">
                        <CardHead icon={Activity} title="See every lap" />
                        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            Explore detailed telemetry with interactive charts.
                        </p>
                        <div className="mt-4 pt-1">
                            <div className="mb-2 flex gap-1.5">
                                <Pill>Speed</Pill>
                                <Pill>Lap 1 - 58</Pill>
                            </div>
                            <svg viewBox="0 0 240 96" fill="none" className="h-[104px] w-full" aria-hidden="true">
                                {[20, 42, 64].map((y) => (
                                    <line key={y} x1="24" y1={y} x2="236" y2={y} stroke="currentColor" strokeWidth="1" className="text-black/[0.06] dark:text-white/[0.07]" />
                                ))}
                                <polyline points="24,74 40,50 56,58 72,32 88,48 104,28 120,56 136,50 152,64 168,40 184,54 200,36 216,58 236,34" fill="none" strokeWidth="1.8" className="stroke-zinc-400 dark:stroke-zinc-500" />
                                <polyline points="24,78 40,62 56,46 72,60 88,34 104,52 120,32 136,60 152,46 168,64 184,44 200,60 216,48 236,62" fill="none" stroke="#E10600" strokeWidth="1.8" />
                            </svg>
                            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-zinc-800 dark:bg-zinc-200" /> Antonelli</span>
                                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#E10600]" /> Russell</span>
                                <span className="ml-auto">Lap</span>
                            </div>
                        </div>
                    </CardShell>
                </Reveal>

                <Reveal delay={0.14}>
                    <CardShell className="h-full">
                        <CardHead icon={MessageSquare} title="Understand strategy" />
                        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            Analyse pit windows, tyre stints and race strategy.
                        </p>
                        <div className="mt-4 pt-1">
                            <p className="mb-2 text-[12px] font-bold">Tyre Strategy</p>
                            {TYRE_STRATEGY.map((row) => (
                                <div key={row.driver} className="mb-2 flex items-center gap-2">
                                    <span className="w-[52px] truncate text-[11px] text-zinc-500">{row.driver}</span>
                                    <div className="flex h-2 flex-1 gap-[3px]">
                                        {row.segs.map(([w, c], i) => (
                                            <div key={i} className={`h-full rounded-full ${c}`} style={{ width: w }} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                            <div className="mt-2.5 flex items-center gap-3 text-[11px] text-zinc-500">
                                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" /> Soft</span>
                                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> Medium</span>
                                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-500" /> Hard</span>
                            </div>
                        </div>
                    </CardShell>
                </Reveal>

                <Reveal delay={0.21}>
                    <CardShell className="h-full">
                        <CardHead icon={Users} title="Compare drivers" />
                        <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                            Head-to-head stats, lap times and performance trends.
                        </p>
                        <div className="mt-4 pt-1">
                            <div className="mb-2 flex gap-1.5">
                                <Pill>Lap Time</Pill>
                                <Pill>Last 10 Laps</Pill>
                            </div>
                            <svg viewBox="0 0 240 96" fill="none" className="h-[104px] w-full" aria-hidden="true">
                                <polyline points="24,60 52,48 80,64 108,40 136,52 164,36 192,44 220,38" fill="none" strokeWidth="1.8" className="stroke-zinc-500 dark:stroke-zinc-400" />
                                <polyline points="24,52 52,62 80,50 108,58 136,44 164,56 192,48 220,54" fill="none" stroke="#E10600" strokeWidth="1.8" />
                                {[24, 52, 80, 108, 136, 164, 192, 220].map((x, i) => (
                                    <g key={x}>
                                        <circle cx={x} cy={[60, 48, 64, 40, 52, 36, 44, 38][i]} r="2.5" className="fill-zinc-500" />
                                        <circle cx={x} cy={[52, 62, 50, 58, 44, 56, 48, 54][i]} r="2.5" fill="#E10600" />
                                    </g>
                                ))}
                            </svg>
                            <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500">
                                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-zinc-800 dark:bg-zinc-200" /> Antonelli</span>
                                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#E10600]" /> Russell</span>
                                <span className="ml-auto">Lap</span>
                            </div>
                        </div>
                    </CardShell>
                </Reveal>
            </div>
        </section>
    );
}

export function ClosingCta() {
    return (
        <section id="start" className="mx-auto w-full max-w-6xl scroll-mt-24 px-5 pt-6">
            <Reveal>
                <div className="relative overflow-hidden rounded-[28px] border border-black/[0.07] bg-gradient-to-br from-zinc-100 via-white to-zinc-200 dark:border-white/[0.08] dark:from-[#171717] dark:via-[#101010] dark:to-[#1c1c1c]">
                    {/* backdrop track lines + glow */}
                    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                        <svg viewBox="0 0 800 340" fill="none" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full text-black/[0.07] dark:text-white/[0.07]">
                            <path d="M-40 300 C 160 290, 240 200, 360 190 S 560 210, 640 120 S 760 60, 860 40" stroke="#E10600" strokeOpacity="0.35" strokeWidth="2" />
                            <path d="M-40 318 C 160 308, 240 218, 360 208 S 560 228, 640 138 S 760 78, 860 58" stroke="currentColor" strokeWidth="1.5" />
                            <path d="M-40 282 C 160 272, 240 182, 360 172 S 560 192, 640 102 S 760 42, 860 22" stroke="currentColor" strokeWidth="1" />
                        </svg>
                        <div className="absolute -right-20 top-1/2 h-[300px] w-[420px] -translate-y-1/2 rounded-full bg-[#E10600]/[0.12] blur-[100px]" />
                    </div>

                    <div className="relative grid gap-8 p-8 sm:p-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:p-14">
                        <div>
                            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#E10600]">
                                F1 data. Clearer insights.
                            </p>
                            <h2 className="mt-3 text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[40px]">
                                From raw race data
                                <br />
                                to a clearer picture.
                            </h2>
                            <p className="mt-3 text-[14px] text-zinc-500 dark:text-zinc-400">
                                Same data. Deeper understanding.
                            </p>
                            <div className="mt-6 flex flex-wrap items-center gap-3">
                                <a
                                    href="/api/auth/google"
                                    className="group inline-flex h-11 items-center gap-2 rounded-full bg-[#E10600] px-6 text-sm font-semibold text-white shadow-[0_16px_30px_-12px_rgba(225,6,0,0.6)] transition-all hover:scale-[1.03] hover:bg-[#c90500] active:scale-[0.97]"
                                >
                                    Open DBRIEF1
                                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                                </a>
                                <a
                                    href="#features"
                                    className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold text-zinc-700 transition-colors hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                                >
                                    Learn more
                                    <ArrowRight className="h-4 w-4" />
                                </a>
                            </div>
                        </div>

                        {/* stylised speed visual */}
                        <div className="relative hidden select-none sm:block" aria-hidden="true">
                            <svg viewBox="0 0 400 220" fill="none" className="w-full">
                                <path d="M10 190 C 120 185, 150 120, 220 112 S 320 130, 390 60" stroke="currentColor" strokeWidth="10" strokeLinecap="round" className="text-black/[0.05] dark:text-white/[0.06]" />
                                <path d="M10 190 C 120 185, 150 120, 220 112 S 320 130, 390 60" stroke="#E10600" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="10 8" strokeOpacity="0.8" />
                                <g transform="translate(215 62) rotate(-8)">
                                    <rect x="0" y="0" width="120" height="44" rx="10" fill="#E10600" />
                                    <rect x="86" y="30" width="52" height="16" rx="5" fill="#7a0300" />
                                    <rect x="-26" y="30" width="40" height="16" rx="5" fill="#1a1a1a" />
                                    <rect x="18" y="-14" width="52" height="14" rx="4" fill="#1a1a1a" opacity="0.85" />
                                </g>
                            </svg>
                            <div className="absolute right-2 top-2 rounded-xl border border-black/[0.08] bg-white/90 px-3 py-2 shadow-lg backdrop-blur dark:border-white/10 dark:bg-[#1c1c1c]/90">
                                <p className="flex items-center gap-1.5 text-[11px] font-bold">
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#E10600]" /> Sector 2
                                </p>
                                <p className="font-mono text-[12px] font-bold text-[#E10600]">-0.342s</p>
                                <p className="text-[10px] text-zinc-400">vs previous lap</p>
                            </div>
                        </div>
                    </div>
                </div>
            </Reveal>
        </section>
    );
}
