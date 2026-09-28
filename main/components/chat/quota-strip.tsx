"use client";

import { useQuota } from "@/lib/cf/use-quota";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import {
    QuotaCard,
    compact,
    resetLabel,
    quotaUtilization,
    quotaDotTone,
} from "@/components/layout/quota-card";
import { cn } from "@/lib/utils";

/**
 * Compact daily-usage trigger for the composer row.
 * ================================================
 * Inline element rendered to the left of the Managed/BYOK pill (inside
 * ControlPanel): status dot + chats used + reset timing. Hovering (or
 * keyboard focus / tap) reveals the shared quota card as a floating
 * tooltip modal — nothing expands inline in the input section.
 * Hidden until quota data loads. Shares useQuota() so no extra fetch.
 */
export function QuotaStrip() {
    const quota = useQuota();

    if (!quota) return null;

    const util = quotaUtilization(quota);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    data-testid="quota-strip"
                    aria-label="Daily usage details"
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
            </TooltipTrigger>
            <TooltipContent side="top" align="end" className="p-0">
                <QuotaCard quota={quota} />
            </TooltipContent>
        </Tooltip>
    );
}
