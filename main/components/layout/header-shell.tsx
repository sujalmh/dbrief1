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
                "sticky top-0 z-50 w-full border-b border-[var(--header-line)] bg-carbon-header text-[var(--header-fg)] shadow-md transition-all duration-500",
                className
            )}
        >
            <span aria-hidden className="wheel-led-strip" />
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
                "wheel-well flex min-w-0 items-center gap-2.5 rounded-full px-3 py-1.5 transition-all duration-500 md:px-4",
                className
            )}
        >
            {/* Live-session LED — the one status light on the wheel. */}
            <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--f1-red)] shadow-[0_0_8px_var(--f1-red)]"
            />
            <span className="max-w-[150px] truncate font-mono text-[11px] font-medium tracking-wide text-[var(--wheel-text-dim)] sm:max-w-[220px] sm:text-xs md:max-w-[300px]">
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
                "wheel-well hidden items-center rounded-full p-1 lg:flex",
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
                                      backgroundColor: color,
                                      color: "#0d0d10",
                                      boxShadow: `0 0 0 1px ${color}66, 0 0 14px ${color}59`,
                                  }
                                : undefined
                        }
                        className={cn(
                            "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-all duration-300",
                            !isActive &&
                                "text-[var(--wheel-text-dim)] hover:bg-[var(--wheel-face)] hover:text-[var(--wheel-text)]"
                        )}
                    >
                        {!isActive && (
                            <span
                                aria-hidden
                                className="h-1.5 w-1.5 rounded-full opacity-80"
                                style={{ backgroundColor: color }}
                            />
                        )}
                        {m}
                    </button>
                );
            })}
        </div>
    );
}
