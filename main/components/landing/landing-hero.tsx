"use client";

import { motion, useReducedMotion } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Quiet intro above the demo conversation. Deliberately restrained: the
 * chat below is the pitch, so the hero is one headline plus one subline —
 * no badges, buttons, glows or oversized display type. (Sign-in lives on
 * every slide and in the composer below.) Compact by design: the page is
 * exactly one viewport with no scroll.
 */
export function LandingHero() {
    const reduce = useReducedMotion();
    const fadeUp = (delay: number) =>
        reduce
            ? {}
            : {
                  initial: { opacity: 0, y: 14 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 0.6, delay, ease: EASE },
              };

    return (
        <section className="px-1 pb-1 pt-2 text-center sm:pt-3">
            <motion.h1
                {...fadeUp(0.06)}
                className="mx-auto max-w-xl text-balance text-[22px] font-bold leading-tight tracking-tight sm:text-[26px]"
            >
                Understand the race beyond the numbers.
            </motion.h1>
            <motion.p
                {...fadeUp(0.12)}
                className="mx-auto mt-1.5 hidden max-w-md text-pretty text-[12.5px] leading-snug text-muted-foreground min-[480px]:block sm:text-[13.5px]"
            >
                Live timing, telemetry, tyre strategy and regulations —
                answered in chat, with the data on screen.
            </motion.p>
            {/* crawlable summary for search indexers */}
            <p className="sr-only">
                Dbrief1 turns Formula 1 live timing, telemetry, tyre stints and FIA
                regulations into clear race strategy, pace and setup answers with
                interactive charts. Ask about Grand Prix strategy, qualifying pace,
                tyre degradation and technical regulations.
            </p>
        </section>
    );
}
