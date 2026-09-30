"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MODE_COLORS, type ModeLabel as ClassifierMode } from "@/lib/mode-colors";

/**
 * Shared header chrome.
 * =====================
 * The app header (`components/layout/header.tsx`), the public landing page
 * and any other public surface render through these pieces so the top bar
 * is physically one component — same carbon weave, same logo badge, same
 * session pill, same mode selector. Change it here and every surface
 * follows; there is no second copy to drift.
 */

/** Modes shown in the header selector — also the landing demo's capabilities. */
export const MODE_LABELS = ["Telemetry", "Comparison", "Strategy", "Insights"] as const;
export type ModeLabel = ClassifierMode;

/** Sticky carbon-weave bar with the app's max-width row. */
export function AppHeaderShell({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <header
            className={cn(
                "sticky top-0 z-50 w-full border-b border-white/10 bg-carbon-header text-white shadow-md transition-all duration-500",
                className
            )}
        >
            <div className="mx-auto flex h-14 w-full max-w-screen-2xl items-center justify-between gap-2 px-3 md:h-16 md:px-6">
                {children}
            </div>
        </header>
    );
}

/** White plate carrying the falcon mark — the app's header identity.
 * Pass `onBackground` when the badge sits directly on the header/page
 * background with no plate (landing): the black strokes vanish on the
 * dark carbon header, so it renders the white-line variant there and the
 * black-line variant in light mode. */
export function LogoBadge({
    className,
    onBackground = false,
}: {
    className?: string;
    onBackground?: boolean;
}) {
    if (onBackground) {
        return (
            <div
                className={cn(
                    "flex items-center justify-center rounded-sm px-1.5 py-1",
                    className
                )}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- local static logo */}
                <img
                    src="/logo.svg"
                    alt="Logo"
                    className="h-6 w-auto dark:hidden"
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- local static logo */}
                <img
                    src="/logo-on-dark.svg"
                    alt="Logo"
                    className="hidden h-6 w-auto dark:block"
                />
            </div>
        );
    }
    return (
        <div
            className={cn(
                "flex items-center justify-center rounded-sm bg-white px-1.5 py-1 shadow-[0_0_10px_rgba(225,6,0,0.4)]",
                className
            )}
        >
            {/* eslint-disable-next-line @next/next/no-img-element -- local static logo */}
            <img src="/logo.svg" alt="Logo" className="h-6 w-auto" />
        </div>
    );
}

/** Recessed pill showing the active session (app) or the product (landing). */
export function SessionBadge({ label, className }: { label: string; className?: string }) {
    return (
        <div
            className={cn(
                "flex min-w-0 items-center gap-3 rounded-full border border-white/5 bg-black/40 px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] transition-all duration-500 md:px-4",
                className
            )}
        >
            <span className="max-w-[110px] truncate font-mono text-xs font-medium tracking-wide text-zinc-300 sm:max-w-[200px] md:max-w-[300px]">
                {label}
            </span>
        </div>
    );
}

/**
 * Mode selector pill. The app renders it as a status readout (no
 * `onSelect`); the landing wires it to the demo so the same control that
 * describes a session also picks what the demo shows.
 */
export function ModePill({
    active,
    onSelect,
    className,
}: {
    active: string;
    onSelect?: (mode: ModeLabel) => void;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "hidden items-center rounded-full border border-white/5 bg-black/30 p-1 shadow-inner lg:flex",
                className
            )}
        >
            {MODE_LABELS.map((m) => {
                const color = MODE_COLORS[m];
                const isActive = active === m;
                return (
                    <button
                        key={m}
                        type="button"
                        onClick={onSelect ? () => onSelect(m) : undefined}
                        aria-pressed={onSelect ? isActive : undefined}
                        style={
                            isActive
                                ? {
                                      backgroundColor: `${color}26`,
                                      color,
                                      boxShadow: `0 0 10px ${color}33`,
                                  }
                                : undefined
                        }
                        className={cn(
                            "px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all duration-500",
                            !isActive && "text-zinc-500 hover:text-zinc-300"
                        )}
                    >
                        {m}
                    </button>
                );
            })}
        </div>
    );
}
