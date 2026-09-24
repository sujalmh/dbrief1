"use client";

import * as React from "react";
import { useSession } from "@/lib/cf/session-context";
import { loadQuota } from "@/lib/cf/client";
import type { QuotaState } from "@/lib/cf/quotas";
import { useChatStore } from "@/lib/store";

/**
 * Shared daily-quota readout.
 * ===========================
 * Single source of truth for every usage surface (sidebar avatar dot,
 * input-section strip). Refreshes after each completed turn, on session
 * switch, and on AI-mode change. Returns null until data loads or when
 * cloud sync is unavailable — callers render nothing in those states.
 *
 * Same-tick duplicate fetches (both surfaces mount together and share
 * refresh keys) collapse into one network call via module-level
 * in-flight dedupe.
 */

let inflight: { key: string; promise: Promise<QuotaState | null> } | null = null;

function requestQuota(key: string, byok: boolean): Promise<QuotaState | null> {
    if (inflight && inflight.key === key) return inflight.promise;
    const promise = loadQuota(byok).finally(() => {
        if (inflight?.promise === promise) inflight = null;
    });
    inflight = { key, promise };
    return promise;
}

export function useQuota(): QuotaState | null {
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
        requestQuota(aiMode === "byok" ? "byok" : "managed", aiMode === "byok").then((q) => {
            if (!cancelled) setQuota(q);
        });
        return () => {
            cancelled = true;
        };
    }, [user, cloudReady, aiMode, turnCount, sessionId]);

    return quota;
}
