"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Compact hero in the chat's own voice: mono status micro-label (like the
 * pipeline status line), italic black uppercase headline (like assistant
 * markdown H1), one subline, one red CTA. Sized so the hero + carousel
 * fit a single viewport — the landing needs no scrolling.
 */
export function HeroHeader() {
    const reduce = useReducedMotion();
    const fadeUp = (delay: number) =>
        reduce
            ? {}
            : {
                  initial: { opacity: 0, y: 22 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.75, delay, ease: EASE },
              };
    return (
        <section className="relative px-1 pb-2 pt-6 text-center sm:pt-9">
            <motion.p
                {...fadeUp(0)}
                className="flex items-center justify-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.24em] text-muted-foreground"
            >
                <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute h-full w-full animate-ping rounded-full bg-[#E10600] opacity-70" />
                    <span className="h-1.5 w-1.5 rounded-full bg-[#E10600]" />
                </span>
                Race Engineer // Online
            </motion.p>
            <motion.h1
                {...fadeUp(0.08)}
                className="mx-auto mt-3 max-w-3xl text-balance text-[34px] font-black uppercase italic leading-[0.98] tracking-tight sm:text-5xl md:text-[56px]"
            >
                Understand the race
                <br />
                <span className="text-muted-foreground">beyond the numbers.</span>
            </motion.h1>
            {/* skewed red underline — pit-wall accent */}
            <motion.div
                {...fadeUp(0.14)}
                aria-hidden="true"
                className="mx-auto mt-3 h-1 w-24 -skew-x-12 rounded-full bg-[#E10600]"
            />
            <motion.p
                {...fadeUp(0.16)}
                className="mx-auto mt-3 max-w-xl text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[15px]"
            >
                Live timing, telemetry and strategy answers — with the data
                on screen, not buried in tables.
            </motion.p>
            <motion.div {...fadeUp(0.24)} className="mt-4 flex flex-wrap items-center justify-center gap-3">
                <a
                    href="/api/auth/google"
                    className="group inline-flex h-11 items-center gap-2 rounded-full bg-[#E10600] px-6 text-sm font-semibold text-white shadow-[0_16px_30px_-12px_rgba(225,6,0,0.6)] transition-all hover:scale-[1.03] hover:bg-[#c90500] active:scale-[0.97]"
                >
                    Open DBRIEF1
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Free · Sign in with Google
                </span>
            </motion.div>
        </section>
    );
}
