"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Quiet intro above the demo conversation. Deliberately restrained: the
 * chat below is the pitch, so the hero is one headline, one subline and
 * one sign-in action — no badges, glows or oversized display type.
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
        <section className="px-1 pb-1 pt-4 text-center sm:pt-8">
            <motion.h1
                {...fadeUp(0.06)}
                className="mx-auto mt-2.5 max-w-xl text-balance text-[25px] font-bold leading-tight tracking-tight sm:text-[30px]"
            >
                Understand the race beyond the numbers.
            </motion.h1>
            <motion.p
                {...fadeUp(0.12)}
                className="mx-auto mt-2.5 max-w-md text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[15px]"
            >
                Live timing, telemetry, tyre strategy and regulations —
                answered in chat, with the data on screen.
            </motion.p>
            <motion.div {...fadeUp(0.18)} className="mt-4 flex justify-center">
                <Button asChild className="h-10 gap-2 px-5 text-sm font-semibold">
                    <a href="/api/auth/google">
                        {/* eslint-disable-next-line @next/next/no-img-element -- 20px remote favicon; next/image buys nothing here */}
                        <img
                            src="https://www.google.com/favicon.ico"
                            alt=""
                            className="h-4 w-4"
                        />
                        Sign in with Google
                    </a>
                </Button>
            </motion.div>
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
