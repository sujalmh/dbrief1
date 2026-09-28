"use client";

import * as React from "react";
import { useQuota } from "@/lib/cf/use-quota";
import {
    QuotaCard,
    compact,
    resetLabel,
    quotaUtilization,
    quotaDotTone,
} from "@/components/layout/quota-card";
import { cn } from "@/lib/utils";

const HOVER_OPEN_MS = 120;
const HOVER_CLOSE_MS = 180;

/**
 * Compact daily-usage trigger for the composer row.
 * ================================================
 * Inline element rendered to the left of the Managed/BYOK pill (inside
 * ControlPanel): status dot + chats used + reset timing. Hovering reveals
 * the shared quota card in a floating card — nothing expands inline in
 * the input section. Tapping/clicking toggles it (touch has no hover),
 * Escape or moving away dismisses it. Hidden until quota data loads.
 * Shares useQuota() so no extra fetch.
 *
 * Implemented as a self-contained hover card (not a Tooltip) on purpose:
 * tooltips are tuned for tiny labels (long open delay, portal hover
 * grace tuned for text) and felt broken for a rich details card.
 */
export function QuotaStrip() {
    const quota = useQuota();
    const [open, setOpen] = React.useState(false);
    const openTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimers = () => {
        if (openTimer.current) {
            clearTimeout(openTimer.current);
            openTimer.current = null;
        }
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    };

    React.useEffect(() => clearTimers, []);

    if (!quota) return null;

    const util = quotaUtilization(quota);

    const scheduleOpen = () => {
        if (closeTimer.current) {
            clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
        if (open) return;
        if (openTimer.current) return;
        openTimer.current = setTimeout(() => {
            openTimer.current = null;
            setOpen(true);
        }, HOVER_OPEN_MS);
    };

    const scheduleClose = () => {
        if (openTimer.current) {
            clearTimeout(openTimer.current);
            openTimer.current = null;
        }
        if (!open) return;
        if (closeTimer.current) return;
        closeTimer.current = setTimeout(() => {
            closeTimer.current = null;
            setOpen(false);
        }, HOVER_CLOSE_MS);
    };

    return (
        <div
            className="relative min-w-0"
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
        >
            <button
                type="button"
                data-testid="quota-strip"
                aria-label="Daily usage details"
                aria-expanded={open}
                onClick={() => {
                    clearTimers();
                    setOpen((o) => !o);
                }}
                onFocus={scheduleOpen}
                onBlur={scheduleClose}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        clearTimers();
                        setOpen(false);
                    }
                }}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] font-mono text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:text-foreground"
            >
                <span
                    data-testid="quota-strip-dot"
                    className={cn("h-2 w-2 shrink-0 rounded-full", quotaDotTone(quota, util))}
                />
                <span className="truncate whitespace-nowrap">
                    {compact(quota.account.queriesUsed)}/{compact(quota.account.queriesCap)} chats
                </span>
                <span className="shrink-0">·</span>
                <span className="shrink-0 whitespace-nowrap">{resetLabel(quota.resetsAt)}</span>
            </button>
            {open && (
                <div
                    role="dialog"
                    aria-label="Daily usage details"
                    className="absolute bottom-full right-0 z-50 mb-2 rounded-xl border border-white/15 bg-background/90 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
                >
                    <QuotaCard quota={quota} />
                </div>
            )}
        </div>
    );
}
