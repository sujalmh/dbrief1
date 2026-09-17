"use client";

import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/lib/cf/session-context";
import { loadQuota, type QuotaState } from "@/lib/cf/client";
import { useChatStore } from "@/lib/store";
import { cn } from "@/lib/utils";

function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return `${n}`;
}

function resetLabel(resetsAt: number): string {
    const ms = Math.max(0, resetsAt - Date.now());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h <= 0) return `Resets in ${m}m`;
    return `Resets in ${h}h ${m}m`;
}

function Bar({ pct, tone }: { pct: number; tone: string }) {
    return (
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
            <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${Math.min(100, Math.max(0, pct * 100))}%` }} />
        </div>
    );
}

function Row({ label, used, cap }: { label: string; used: number; cap: number }) {
    const pct = cap > 0 ? used / cap : 0;
    const tone = pct >= 0.85 ? "bg-f1-red" : pct >= 0.6 ? "bg-amber-400/80" : "bg-emerald-400/70";
    return (
        <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
                <span className="uppercase tracking-wider text-muted-foreground">{label}</span>
                <span className="font-mono text-foreground/80">
                    {compact(used)}/{compact(cap)}
                </span>
            </div>
            <Bar pct={pct} tone={tone} />
        </div>
    );
}

/**
 * Subtle daily-usage indicator that lives on the profile avatar.
 * A small status dot (green → amber → red); hovering reveals a compact
 * card with per-feature usage vs caps. Hidden entirely when cloud sync
 * is unavailable. Refreshes after each completed turn.
 */
export function UsageIndicator() {
    const { user, cloudReady } = useSession();
    const aiMode = useChatStore((s) => s.settings.aiMode);
    const turnCount = useChatStore((s) => s.messages.length);
    const sessionId = useChatStore((s) => s.currentSessionId);
    const [quota, setQuota] = React.useState<QuotaState | null>(null);

    React.useEffect(() => {
        if (!user || !cloudReady) {
            setQuota(null);
            return;
        }
        let cancelled = false;
        loadQuota(aiMode === "byok").then((q) => {
            if (!cancelled) setQuota(q);
        });
        return () => {
            cancelled = true;
        };
    }, [user, cloudReady, aiMode, turnCount, sessionId]);

    const util = React.useMemo(() => {
        if (!quota) return 0;
        const slices = [
            quota.account.queriesUsed / Math.max(1, quota.account.queriesCap),
            quota.account.deepUsed / Math.max(1, quota.account.deepCap),
            quota.account.simUsed / Math.max(1, quota.account.simCap),
            quota.network.queriesUsed / Math.max(1, quota.network.queriesCap),
        ];
        return Math.max(0, ...slices);
    }, [quota]);

    if (!quota || !user) return null;

    const networkBinding =
        quota.network.queriesUsed / Math.max(1, quota.network.queriesCap) >
        quota.account.queriesUsed / Math.max(1, quota.account.queriesCap);
    const dotTone =
        quota.managedPaused || util >= 0.85
            ? "bg-f1-red"
            : util >= 0.6
              ? "bg-amber-400/80"
              : "bg-emerald-400/70";

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    data-testid="usage-dot"
                    className={cn(
                        "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-sidebar",
                        dotTone
                    )}
                />
            </TooltipTrigger>
            <TooltipContent side="right" align="end" className="w-52 space-y-2.5 p-3">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider">Daily usage</span>
                    <span className="text-[10px] text-muted-foreground">
                        {quota.tier === "byok" ? "BYOK" : "Free"}
                    </span>
                </div>
                {quota.managedPaused && (
                    <p className="text-[10px] text-f1-red">Free service paused today — high demand.</p>
                )}
                <Row label="Chats" used={quota.account.queriesUsed} cap={quota.account.queriesCap} />
                <Row label="Deep research" used={quota.account.deepUsed} cap={quota.account.deepCap} />
                <Row label="Simulations" used={quota.account.simUsed} cap={quota.account.simCap} />
                <Row label="Tokens out" used={quota.account.outTokensUsed} cap={quota.account.outTokensCap} />
                {networkBinding && (
                    <p className="text-[10px] text-muted-foreground">
                        Shared network is the limit right now (
                        {compact(quota.network.queriesUsed)}/{compact(quota.network.queriesCap)}).
                    </p>
                )}
                <p className="text-[10px] text-muted-foreground">{resetLabel(quota.resetsAt)} · UTC</p>
            </TooltipContent>
        </Tooltip>
    );
}
