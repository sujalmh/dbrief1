"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { ArrowRight, Moon, Sun } from "lucide-react";

export function Logo({ compact = false }: { compact?: boolean }) {
    return (
        <Link href="/" className="flex items-center gap-2.5" aria-label="DBRIEF1 home">
            <svg width="26" height="26" viewBox="0 0 32 22" fill="none" aria-hidden="true">
                <g transform="skewX(-12)">
                    <rect x="2" y="1" width="7" height="6" rx="1.5" fill="#E10600" />
                    <rect x="11" y="1" width="7" height="6" rx="1.5" fill="currentColor" opacity="0.85" />
                    <rect x="20" y="1" width="7" height="6" rx="1.5" fill="#E10600" />
                    <rect x="6" y="8.5" width="7" height="6" rx="1.5" fill="currentColor" opacity="0.85" />
                    <rect x="15" y="8.5" width="7" height="6" rx="1.5" fill="#E10600" />
                    <rect x="10" y="16" width="7" height="5" rx="1.5" fill="#E10600" opacity="0.55" />
                </g>
            </svg>
            {!compact && (
                <span className="text-[15px] font-extrabold tracking-tight">
                    DBRIEF1
                </span>
            )}
        </Link>
    );
}

export function ThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    return (
        <button
            type="button"
            onClick={() => setTheme(isDark ? "light" : "dark")}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
            suppressHydrationWarning
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white/60 text-zinc-600 transition-all hover:scale-105 hover:text-zinc-900 active:scale-95 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400 dark:hover:text-white"
        >
            <span suppressHydrationWarning className="inline-flex">
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </span>
        </button>
    );
}

const NAV_LINKS = [
    { label: "Insights", href: "#features" },
    { label: "Telemetry", href: "#showcase" },
    { label: "Comparison", href: "#features" },
    { label: "Strategy", href: "#start" },
];

export function SiteNav() {
    return (
        <header className="sticky top-0 z-50 border-b border-black/[0.06] bg-background/70 backdrop-blur-xl dark:border-white/[0.06]">
            <nav
                className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5"
                aria-label="Primary"
            >
                <Logo />
                <div className="hidden items-center gap-8 lg:flex">
                    {NAV_LINKS.map((l) => (
                        <a
                            key={l.label}
                            href={l.href}
                            className="text-[13.5px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                        >
                            {l.label}
                        </a>
                    ))}
                </div>
                <div className="flex items-center gap-2.5">
                    <ThemeToggle />
                    <a
                        href="/api/auth/google"
                        className="hidden px-2 text-[13.5px] font-medium text-zinc-500 transition-colors hover:text-zinc-900 sm:block dark:text-zinc-400 dark:hover:text-white"
                    >
                        Sign in
                    </a>
                    <a
                        href="/api/auth/google"
                        className="group inline-flex h-9 items-center gap-1.5 rounded-full bg-[#E10600] px-4 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(225,6,0,0.6)] transition-all hover:scale-[1.03] hover:bg-[#c90500] active:scale-[0.97]"
                    >
                        Open App
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                    </a>
                </div>
            </nav>
        </header>
    );
}

export function SiteFooter() {
    return (
        <footer className="mx-auto w-full max-w-6xl px-5 pb-10 pt-4">
            <div className="flex flex-col items-center justify-between gap-4 border-t border-black/[0.06] pt-8 text-xs text-zinc-500 md:flex-row dark:border-white/[0.06] dark:text-zinc-500">
                <div className="flex items-center gap-3">
                    <Logo compact />
                    <span>© 2026 DBRIEF1 — F1 Intelligence.</span>
                </div>
                <div className="flex items-center gap-5">
                    <span className="hidden sm:inline">Light / dark ready</span>
                    <a href="/privacy" className="transition-colors hover:text-zinc-900 dark:hover:text-white">
                        Privacy
                    </a>
                    <a href="/terms" className="transition-colors hover:text-zinc-900 dark:hover:text-white">
                        Terms
                    </a>
                    <a href="/api/auth/google" className="transition-colors hover:text-zinc-900 dark:hover:text-white">
                        Sign in
                    </a>
                </div>
            </div>
        </footer>
    );
}
