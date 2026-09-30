"use client";

import { F1Disclaimer } from "@/components/legal/f1-disclaimer";

/**
 * Sign-in gate.
 * ============
 * Shown instead of the chat UI when the visitor has no Google-linked
 * identity. The app is passwordless-first: anonymous visitors get a
 * throwaway identity for quota purposes, but the chat experience
 * requires signing in so history, quotas, and abuse controls attach
 * to a stable account.
 */
export function SignInPage() {
    return (
        <div className="flex h-dvh w-full items-center justify-center bg-carbon relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute inset-0 z-0">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-f1-red/5 rounded-full blur-[120px] animate-pulse" />
            </div>

            <div className="relative z-10 w-full max-w-md p-8 bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col items-center text-center space-y-8">
                {/* Logo */}
                <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center h-16 rounded-xl bg-white px-3 shadow-[0_0_30px_rgba(225,6,0,0.4)]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- local static logo */}
                        <img src="/logo.svg" alt="Logo" className="h-12 w-auto" />
                    </div>
                </div>

                <div className="space-y-2">
                    <h1 className="text-3xl font-bold tracking-tighter text-white">
                        DBRIEF<span className="text-f1-red">1</span>
                    </h1>
                    <p className="text-muted-foreground text-sm font-medium tracking-wide">
                        RACE ENGINEERING &amp; STRATEGY ANALYSIS
                    </p>
                    {/* Crawlable landing copy: descriptive for search indexers,
                        visually hidden so the sign-in card design is unchanged. */}
                    <p className="sr-only">
                        Dbrief1 turns Formula 1 live timing, telemetry, tyre
                        stints and FIA regulations into clear race strategy,
                        pace and setup answers with interactive charts. Ask
                        about Grand Prix strategy, qualifying pace, tyre
                        degradation and technical regulations.
                    </p>
                </div>

                <div className="w-full space-y-4">
                    <a
                        href="/api/auth/google"
                        className="flex w-full h-12 items-center justify-center bg-white text-black hover:bg-gray-100 font-bold tracking-wide shadow-lg transition-all active:scale-95 rounded-md"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element -- 20px remote favicon; next/image buys nothing here */}
                        <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5 mr-3" />
                        CONTINUE WITH GOOGLE
                    </a>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-white/10" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-transparent px-2 text-muted-foreground">
                                Sign in to start chatting
                            </span>
                        </div>
                    </div>
                </div>

                <div className="text-[10px] text-zinc-500 font-mono space-y-1.5">
                    <div>SECURE ACCESS • END-TO-END ENCRYPTED • PRO TIER</div>
                    <div className="flex items-center justify-center gap-3">
                        <a href="/privacy" className="hover:text-zinc-300 transition-colors">PRIVACY</a>
                        <span className="text-zinc-700">•</span>
                        <a href="/terms" className="hover:text-zinc-300 transition-colors">TERMS</a>
                    </div>
                    <F1Disclaimer className="text-center text-zinc-600" />
                </div>
            </div>
        </div>
    );
}
