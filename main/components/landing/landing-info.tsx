"use client";

import { Activity, FileText, LineChart, MessagesSquare } from "lucide-react";

/**
 * Bottom information sections + footer.
 * =====================================
 * Short, factual, chat-styled: what the app answers, how a session works,
 * and where the data comes from (with attribution). No marketing fluff.
 */

const ANSWER_BULLETS = [
    "Race, qualifying and championship results",
    "Telemetry traces, lap times and driver comparisons",
    "Tyre strategy, pit windows and what-if simulations",
    "FIA regulations and stewards' decisions, cited",
];

const STEPS = [
    { n: "01", title: "Sign in with Google", body: "One click. No key to configure, no setup." },
    { n: "02", title: "Ask in plain words", body: "Follow-ups work — it remembers the session." },
    { n: "03", title: "Get cited answers", body: "Every claim traces to data, with charts." },
];

const SOURCES = ["FastF1", "Ergast", "FIA documents", "Web"];

export function InfoSections() {
    return (
        <section aria-label="About Dbrief1" className="mx-auto w-full max-w-6xl px-5 pt-12 sm:pt-16">
            <div className="grid gap-4 md:grid-cols-3">
                <div className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-5">
                    <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <MessagesSquare className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="text-[15px] font-bold tracking-tight">What it answers</h3>
                    <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                        {ANSWER_BULLETS.map((b) => (
                            <li key={b} className="flex gap-2">
                                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                                {b}
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-5">
                    <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        <LineChart className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="text-[15px] font-bold tracking-tight">How it works</h3>
                    <ol className="mt-3 space-y-3">
                        {STEPS.map((s) => (
                            <li key={s.n} className="flex gap-3">
                                <span className="font-mono text-[11px] font-bold text-muted-foreground">{s.n}</span>
                                <span>
                                    <span className="block text-[13px] font-semibold">{s.title}</span>
                                    <span className="block text-[12.5px] text-muted-foreground">{s.body}</span>
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>

                <div className="flex flex-col rounded-2xl border border-border/60 bg-card/60 p-5">
                    <span className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                        <Activity className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="text-[15px] font-bold tracking-tight">Where data comes from</h3>
                    <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                        Official timing and results, the FIA rulebook and
                        stewards&apos; decisions, plus current-season web
                        coverage — cited inline, never from memory.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                        {SOURCES.map((s) => (
                            <span
                                key={s}
                                className="rounded-md border border-border/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                            >
                                {s}
                            </span>
                        ))}
                    </div>
                    <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground/80">
                        <FileText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                        Race data via FastF1 and Ergast. Regulations via the FIA.
                    </p>
                </div>
            </div>
        </section>
    );
}

export function LandingFooter() {
    return (
        <footer className="mx-auto w-full max-w-6xl px-5 pb-8 pt-10">
            <div className="flex flex-col items-center justify-between gap-3 border-t border-border/50 pt-5 text-xs text-muted-foreground/80 md:flex-row">
                <span>© 2026 Dbrief1 · Race data via FastF1 &amp; Ergast · Regulations via the FIA</span>
                <div className="flex items-center gap-5">
                    <a href="/privacy" className="transition-colors hover:text-foreground">
                        Privacy
                    </a>
                    <a href="/terms" className="transition-colors hover:text-foreground">
                        Terms
                    </a>
                    <a href="/api/auth/google" className="transition-colors hover:text-foreground">
                        Sign in
                    </a>
                </div>
            </div>
        </footer>
    );
}
