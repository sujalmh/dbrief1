"use client";

/**
 * Admin analysis page (`/admin`)
 * ================================
 * Feedback + contact overview for ADMIN_UIDS identities only. The API
 * enforces the gate (403 otherwise); this page renders stats (totals,
 * average rating, distribution, last-7-day volume) plus the latest
 * items table. Non-admins and signed-out visitors get a locked screen.
 */

import * as React from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Lock } from "lucide-react";
import { useSession } from "@/lib/cf/session-context";
import { loadFeedback, CfForbiddenError, type FeedbackStats, type FeedbackItem } from "@/lib/cf/client";
import { cn } from "@/lib/utils";

type KindFilter = "all" | "first_response" | "message" | "contact";

const KIND_LABELS: Record<string, string> = {
    first_response: "First response",
    message: "Message",
    contact: "Contact",
};

function timeLabel(ms: number): string {
    try {
        return new Date(ms).toLocaleString();
    } catch {
        return String(ms);
    }
}

function Stars({ value }: { value: number | null }) {
    if (value == null) return <span className="text-muted-foreground/50">—</span>;
    return (
        <span className="font-bold tabular-nums text-[var(--f1-yellow)]" title={`${value} of 5 stars`}>
            {"★".repeat(value)}
            <span className="text-muted-foreground/30">{"★".repeat(5 - value)}</span>
        </span>
    );
}

export default function AdminPage() {
    const { user, loading } = useSession();
    const [kind, setKind] = useState<KindFilter>("all");
    const [stats, setStats] = useState<FeedbackStats | null>(null);
    const [items, setItems] = useState<FeedbackItem[] | null>(null);
    const [forbidden, setForbidden] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        // Linked identity only (same gate as the chat shell) — anonymous
        // visitors get the sign-in screen without any fetch.
        if (loading || !user?.google) return;
        let cancelled = false;
        loadFeedback(kind === "all" ? undefined : kind)
            .then((data) => {
                if (cancelled) return;
                if (!data) {
                    setFailed(true);
                    return;
                }
                setStats(data.stats);
                setItems(data.items);
            })
            .catch((e) => {
                if (cancelled) return;
                if (e instanceof CfForbiddenError) setForbidden(true);
                else setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [loading, user, kind]);

    function selectKind(next: KindFilter) {
        // Reset here (user event, not the fetch effect) so switching
        // filters clears stale rows before fresh data lands.
        setStats(null);
        setItems(null);
        setForbidden(false);
        setFailed(false);
        setKind(next);
    }

    const last7Total = stats?.byDay.reduce((a, d) => a + d.count, 0) ?? 0;
    const maxDay = Math.max(1, ...((stats?.byDay ?? []).map((d) => d.count)));
    const maxRating = Math.max(1, ...[1, 2, 3, 4, 5].map((s) => stats?.ratingCounts[String(s)] ?? 0));

    return (
        <div className="h-dvh w-full overflow-y-auto bg-carbon text-foreground">
            <div className="mx-auto w-full min-w-0 max-w-4xl px-3 py-6 sm:px-4">
                <div className="mb-6 flex flex-wrap items-center gap-3">
                    <Link
                        href="/"
                        className="inline-flex h-8 items-center gap-2 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Back to chat
                    </Link>
                    <h1 className="text-base font-bold uppercase tracking-wider">
                        Feedback analysis
                    </h1>
                    {user && !user.google && (
                        <span className="text-xs text-muted-foreground">sign-in required</span>
                    )}
                </div>

                {loading ? (
                    <div className="flex h-64 items-center justify-center">
                        <Loader2 className="h-7 w-7 animate-spin text-[var(--f1-red)]" />
                    </div>
                ) : !user?.google ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                        <Lock className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">
                            Sign in to view this page.
                        </p>
                        <Link href="/" className="text-xs underline hover:text-foreground">
                            Back to chat
                        </Link>
                    </div>
                ) : forbidden ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                        <Lock className="h-8 w-8 text-muted-foreground/50" />
                        <p className="text-sm font-bold uppercase tracking-wider">Not authorized</p>
                        <p className="max-w-xs text-xs text-muted-foreground">
                            This page is limited to admin identities (ADMIN_UIDS).
                        </p>
                    </div>
                ) : failed || !stats || !items ? (
                    <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                        <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                            Couldn&apos;t load feedback
                        </p>
                        <p className="max-w-xs text-xs text-muted-foreground/70">
                            The cloud store may be unreachable. Check /api/cf/health and try again.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 pb-16">
                        {/* Stat cards */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                                { label: "Total", value: String(stats.total) },
                                {
                                    label: "Avg rating",
                                    value: stats.avgRating != null ? `${stats.avgRating.toFixed(2)} / 5` : "—",
                                    sub: stats.ratedCount > 0 ? `${stats.ratedCount} rated` : undefined,
                                },
                                {
                                    label: "Contacts",
                                    value: String(stats.byKind.contact ?? 0),
                                },
                                { label: "Last 7 days", value: String(last7Total) },
                            ].map((card) => (
                                <div
                                    key={card.label}
                                    className="rounded-xl border border-border/50 bg-card/40 px-4 py-3"
                                >
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                        {card.label}
                                    </p>
                                    <p className="mt-1 text-2xl font-black tabular-nums">{card.value}</p>
                                    {card.sub && (
                                        <p className="text-[10px] text-muted-foreground/70">{card.sub}</p>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Rating distribution + weekly volume */}
                        <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-border/50 bg-card/40 px-4 py-3">
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Rating distribution
                                </p>
                                <div className="space-y-1.5">
                                    {[5, 4, 3, 2, 1].map((star) => {
                                        const n = stats.ratingCounts[String(star)] ?? 0;
                                        return (
                                            <div key={star} className="flex items-center gap-2 text-xs">
                                                <span className="w-8 shrink-0 tabular-nums text-muted-foreground">
                                                    {star} ★
                                                </span>
                                                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/30">
                                                    <div
                                                        className="h-full rounded-full bg-[var(--f1-yellow)]"
                                                        style={{ width: `${(n / maxRating) * 100}%` }}
                                                    />
                                                </div>
                                                <span className="w-8 shrink-0 text-right tabular-nums">{n}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="rounded-xl border border-border/50 bg-card/40 px-4 py-3">
                                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                    Volume · last 7 days
                                </p>
                                {stats.byDay.length === 0 ? (
                                    <p className="py-6 text-center text-xs text-muted-foreground/70">
                                        Nothing yet.
                                    </p>
                                ) : (
                                    <div className="flex h-24 items-end gap-1.5">
                                        {stats.byDay.map((d) => (
                                            <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
                                                <span className="text-[10px] tabular-nums text-muted-foreground">
                                                    {d.count}
                                                </span>
                                                <div
                                                    className="w-full rounded-sm bg-[var(--f1-red)]/80"
                                                    style={{ height: `${Math.max((d.count / maxDay) * 64, 3)}px` }}
                                                />
                                                <span className="text-[9px] tabular-nums text-muted-foreground/70">
                                                    {d.day.slice(5)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Kind filter */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {(["all", "first_response", "message", "contact"] as KindFilter[]).map((k) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => selectKind(k)}
                                    data-active={kind === k}
                                    className={cn(
                                        "h-8 rounded-full border px-3 text-[11px] font-bold uppercase tracking-wider transition-colors",
                                        kind === k
                                            ? "border-[var(--f1-red)] bg-[var(--f1-red)]/10 text-foreground"
                                            : "border-border/50 text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {k === "all" ? "All" : (KIND_LABELS[k] ?? k)}
                                    {k !== "all" && stats.byKind[k] != null && (
                                        <span className="ml-1 tabular-nums opacity-70">{stats.byKind[k]}</span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Latest items */}
                        <div className="overflow-hidden rounded-xl border border-border/50">
                            {items.length === 0 ? (
                                <p className="px-4 py-8 text-center text-xs text-muted-foreground/70">
                                    No feedback in this view yet.
                                </p>
                            ) : (
                                <div className="divide-y divide-border/40">
                                    {items.map((item) => (
                                        <div key={item.id} className="grid gap-1 px-4 py-3 sm:grid-cols-[130px_90px_1fr] sm:gap-3">
                                            <div className="text-[11px] tabular-nums text-muted-foreground">
                                                {timeLabel(item.createdAt)}
                                                <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider">
                                                    {KIND_LABELS[item.kind] ?? item.kind}
                                                </div>
                                            </div>
                                            <div className="text-sm">
                                                <Stars value={item.rating} />
                                            </div>
                                            <div className="min-w-0 text-xs">
                                                {item.subject && (
                                                    <p className="font-bold">{item.subject}</p>
                                                )}
                                                {item.message ? (
                                                    <p className="whitespace-pre-wrap break-words text-muted-foreground">
                                                        {item.message}
                                                    </p>
                                                ) : (
                                                    <p className="italic text-muted-foreground/50">No comment.</p>
                                                )}
                                                <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/60">
                                                    {item.displayName ?? item.userId}
                                                    {item.email ? ` · ${item.email}` : ""}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
