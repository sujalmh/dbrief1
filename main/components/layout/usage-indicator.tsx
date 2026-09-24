"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuota } from "@/lib/cf/use-quota";
import { QuotaCard, quotaUtilization, quotaDotTone } from "@/components/layout/quota-card";
import { cn } from "@/lib/utils";

/**
 * Subtle daily-usage indicator that lives on the profile avatar.
 * A small status dot (green → amber → red); hovering reveals the shared
 * quota card with per-feature usage vs caps. Hidden entirely until quota
 * data loads or when cloud sync is unavailable. Refreshes after each
 * completed turn (via useQuota).
 */
export function UsageIndicator() {
    const quota = useQuota();

    if (!quota) return null;

    const util = quotaUtilization(quota);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    data-testid="usage-dot"
                    className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-sidebar",
                        quotaDotTone(quota, util)
                    )}
                />
            </TooltipTrigger>
            <TooltipContent side="right" align="end" className="p-0">
                <QuotaCard quota={quota} />
            </TooltipContent>
        </Tooltip>
    );
}
