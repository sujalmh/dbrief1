"use client";

import { cn } from "@/lib/utils";
import type { QuotaState } from "@/lib/cf/quotas";

/**
 * Quota presentation primitives.
 * ==============================
 * Pure presentational layer for daily usage vs caps, shared by every
 * usage surface (sidebar avatar hover card, input-section strip).
 * No fetching here — data comes from useQuota().
 */

export function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return `${n}`;
}

export function resetLabel(resetsAt: number): string {
    const ms = Math.max(0, resetsAt - Date.now());
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h <= 0) return `Resets in ${m}m`;
    return `Resets in ${h}h ${m}m`;
}

/** Worst-case utilization across the binding quota slices (0-1+). */
export function quotaUtilization(quota: QuotaState): number {
    const slices = [
        quota.account.queriesUsed / Math.max(1, quota.account.queriesCap),
        quota.account.deepUsed / Math.max(1, quota.account.deepCap),
        quota.account.simUsed / Math.max(1, quota.account.simCap),
        quota.network.queriesUsed / Math.max(1, quota.network.queriesCap),
    ];
    return Math.max(0, ...slices);
}

export function quotaDotTone(quota: QuotaState, util: number): string {
    if (quota.managedPaused || util >= 0.85) return "bg-f1-red";
    if (util >= 0.6) return "bg-amber-400/80";
    return "bg-emerald-400/70";
}

/** True when the shared network cap binds harder than the account cap. */
export function isNetworkBinding(quota: QuotaState): boolean {
    return (
        quota.network.queriesUsed / Math.max(1, quota.network.queriesCap) >
        quota.account.queriesUsed / Math.max(1, quota.account.queriesCap)
    );
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
 * Full daily-usage card: tier, per-feature used-vs-cap rows, shared
 * network callout (only when it binds), reset timing. Rendered inside
 * the sidebar avatar hover tooltip and the input-section expander —
 * identical numbers everywhere by construction (same QuotaState in).
 */
export function QuotaCard({ quota }: { quota: QuotaState }) {
    const networkBinding = isNetworkBinding(quota);
    return (
        <div className="w-52 space-y-2.5 p-3">
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
        </div>
    );
}
