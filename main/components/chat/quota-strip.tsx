"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useQuota } from "@/lib/cf/use-quota";
import {
    QuotaCard,
    compact,
    resetLabel,
    quotaUtilization,
    quotaDotTone,
} from "@/components/layout/quota-card";
import { cn } from "@/lib/utils";

/**
 * Compact daily-usage strip for the composer.
 * ==========================================
 * Always-visible one-liner (status dot + chats used + reset timing);
 * tapping/clicking expands the same shared quota card the sidebar
 * avatar shows on hover — hover doesn't exist on touch, so the input
 * section is the usage surface on phones (and a persistent one on
 * desktop, where the sidebar may be collapsed). Hidden until quota
 * data loads. Refreshes after each completed turn (via useQuota, one
 * network call shared with the avatar dot).
 */
export function QuotaStrip() {
    const quota = useQuota();
    const [open, setOpen] = React.useState(false);

    if (!quota) return null;

    const util = quotaUtilization(quota);

    return (
        <div data-testid="quota-strip" className="pt-1">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-label="Daily usage details"
                className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-[10px] font-mono text-muted-foreground/80 transition-colors hover:text-foreground"
            >
                <span
                    data-testid="quota-strip-dot"
                    className={cn("h-2 w-2 shrink-0 rounded-full", quotaDotTone(quota, util))}
                />
                <span className="truncate">
                    {compact(quota.account.queriesUsed)}/{compact(quota.account.queriesCap)} chats
                </span>
                <span className="shrink-0">·</span>
                <span className="shrink-0">{resetLabel(quota.resetsAt)}</span>
                <ChevronDown
                    className={cn("h-3 w-3 shrink-0 transition-transform", open && "rotate-180")}
                />
            </button>
            {open && (
                <div className="rounded-md border border-white/10 bg-black/40 dark:bg-black/40">
                    <QuotaCard quota={quota} />
                </div>
            )}
        </div>
    );
}
