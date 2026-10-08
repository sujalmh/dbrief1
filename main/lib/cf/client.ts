"use client";

/**
 * Cloudflare session store client (browser).
 * ==========================================
 * Same-origin fetch wrappers over /api/cf/*. The server holds the
 * Cloudflare credentials; the browser only carries the `cf_uid` cookie.
 * All saves are best-effort from the UI's perspective — failures are
 * logged, never break the chat flow (IndexedDB still has everything).
 */

import type { Message, StoredSession } from "@/lib/store";
import type { SessionUIState } from "@/lib/cf/serialization";
import type { QuotaState } from "@/lib/cf/quotas";
import { sanitizeCitations } from "@/lib/utils";

export type { QuotaState };

export class CfUnconfiguredError extends Error {
    constructor() {
        super("Cloudflare storage is not configured");
        this.name = "CfUnconfiguredError";
    }
}

let warnedUnconfigured = false;

async function cfFetch<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetch(path, { credentials: "same-origin", ...init });
    } catch (e) {
        throw new Error(`Cloud store unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 503) {
        if (!warnedUnconfigured) {
            warnedUnconfigured = true;
            console.warn("[cf] Cloud storage is not configured (CF_API_TOKEN missing). Running local-only.");
        }
        throw new CfUnconfiguredError();
    }
    if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Cloud store error ${res.status}`);
    }
    return (await res.json()) as T;
}

function swallow<T>(p: Promise<T>, label: string): Promise<T | null> {
    return p.catch((err) => {
        if (!(err instanceof CfUnconfiguredError)) console.error(label, err);
        return null;
    });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionPayload {
    id: string;
    title: string;
    type: string | null;
    createdAt: number;
    lastMessageAt: number;
}

export async function listSessions(): Promise<StoredSession[]> {
    const data = await cfFetch<{ sessions: SessionPayload[] }>("/api/cf/sessions");
    return data.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        type: typeof s.type === "string" ? s.type : undefined,
        createdAt: s.createdAt,
        lastMessageAt: s.lastMessageAt,
    }));
}

export async function createSession(title: string, type?: string): Promise<string> {
    const data = await cfFetch<{ id: string }>("/api/cf/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, type }),
    });
    return data.id;
}

export function patchSessionMeta(sessionId: string, title: string, type: string): Promise<null> {
    return swallow(
        cfFetch(`/api/cf/sessions/${encodeURIComponent(sessionId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, type }),
        }),
        "[cf] patchSessionMeta failed:"
    );
}

export async function deleteSession(sessionId: string): Promise<void> {
    await cfFetch(`/api/cf/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Messages (full trace — save / edit / delete)
// ---------------------------------------------------------------------------

export async function loadMessages(sessionId: string): Promise<Message[]> {
    const data = await cfFetch<{ messages: Message[] }>(
        `/api/cf/sessions/${encodeURIComponent(sessionId)}/messages`
    );
    return (data.messages || []).map((m) => ({
        ...m,
        citations: sanitizeCitations(m.citations),
    }));
}

/** Insert or replace a full message (used after each completed turn). */
export function saveMessage(sessionId: string, message: Message): Promise<null> {
    return swallow(
        cfFetch(`/api/cf/sessions/${encodeURIComponent(sessionId)}/messages`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
        }),
        "[cf] saveMessage failed:"
    );
}

/** Delete one message and its blobs. */
export function deleteCloudMessage(sessionId: string, messageId: string): Promise<null> {
    return swallow(
        cfFetch(`/api/cf/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}`, {
            method: "DELETE",
        }),
        "[cf] deleteCloudMessage failed:"
    );
}

/** Delete all messages in a session (session kept). */
export function clearCloudMessages(sessionId: string): Promise<null> {
    return swallow(
        cfFetch(`/api/cf/sessions/${encodeURIComponent(sessionId)}/messages`, { method: "DELETE" }),
        "[cf] clearCloudMessages failed:"
    );
}

// ---------------------------------------------------------------------------
// Session UI context (panel data, pinned graphs, active message)
// ---------------------------------------------------------------------------

export async function loadContext(sessionId: string): Promise<SessionUIState> {
    try {
        const data = await cfFetch<{ context: SessionUIState }>(
            `/api/cf/sessions/${encodeURIComponent(sessionId)}/context`
        );
        return data.context ?? {};
    } catch (e) {
        if (!(e instanceof CfUnconfiguredError)) console.error("[cf] loadContext failed:", e);
        return {};
    }
}

export function saveContext(
    sessionId: string,
    context: { visualizationData?: unknown; activeMessageId?: string | null }
): Promise<null> {
    return swallow(
        cfFetch(`/api/cf/sessions/${encodeURIComponent(sessionId)}/context`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ context }),
        }),
        "[cf] saveContext failed:"
    );
}

// ---------------------------------------------------------------------------
// Quota readout (sidebar usage indicator)
// ---------------------------------------------------------------------------

/** Today's usage vs caps, or null when cloud sync is unavailable. */
export async function loadQuota(byok: boolean): Promise<QuotaState | null> {
    try {
        return await cfFetch<QuotaState>(`/api/cf/quota${byok ? "?byok=1" : ""}`);
    } catch (e) {
        if (!(e instanceof CfUnconfiguredError)) console.error("[cf] loadQuota failed:", e);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Feedback + contact (Cloudflare D1)
// ---------------------------------------------------------------------------

export interface FeedbackPayload {
    kind: "first_response" | "message" | "contact";
    rating?: number | null;
    subject?: string | null;
    message?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
}

export interface FeedbackItem extends FeedbackPayload {
    id: string;
    userId: string;
    displayName: string | null;
    email: string | null;
    rating: number | null;
    subject: string | null;
    message: string | null;
    sessionId: string | null;
    messageId: string | null;
    createdAt: number;
}

export interface FeedbackStats {
    total: number;
    byKind: Record<string, number>;
    avgRating: number | null;
    ratedCount: number;
    ratingCounts: Record<string, number>;
    byDay: Array<{ day: string; count: number }>;
}

/** Save a rating or contact message. Null when the cloud store is down. */
export function saveFeedback(payload: FeedbackPayload): Promise<{ id: string } | null> {
    return swallow(
        cfFetch<{ id: string }>("/api/cf/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }),
        "[cf] saveFeedback failed:"
    );
}

export class CfForbiddenError extends Error {
    constructor() {
        super("Not authorized.");
        this.name = "CfForbiddenError";
    }
}

/**
 * Admin analysis data. Throws CfForbiddenError for non-admins, returns
 * null when the cloud store is unreachable/unconfigured.
 */
export async function loadFeedback(kind?: string): Promise<{ stats: FeedbackStats; items: FeedbackItem[] } | null> {
    const qs = kind === "first_response" || kind === "message" || kind === "contact"
        ? `?kind=${encodeURIComponent(kind)}`
        : "";
    let res: Response;
    try {
        res = await fetch(`/api/cf/feedback${qs}`, { credentials: "same-origin" });
    } catch (e) {
        console.error("[cf] loadFeedback failed:", e instanceof Error ? e.message : String(e));
        return null;
    }
    if (res.status === 503) return null;
    if (res.status === 403) throw new CfForbiddenError();
    if (!res.ok) {
        console.error("[cf] loadFeedback failed:", res.status);
        return null;
    }
    const data = (await res.json()) as { stats: FeedbackStats; items: FeedbackItem[] };
    return { stats: data.stats, items: data.items ?? [] };
}

// ---------------------------------------------------------------------------
// Share links (read-only public links for a session)
// ---------------------------------------------------------------------------

export interface ShareLinkInfo {
    token: string;
    createdAt: number;
}

export type { SharedSnapshot, SharedMessage } from "@/lib/cf/shares";

/** Absolute URL for a share token (built in the browser — needs origin). */
export function shareUrl(token: string): string {
    return `${window.location.origin}/share/${token}`;
}

export async function listShareLinks(sessionId: string): Promise<ShareLinkInfo[]> {
    const data = await cfFetch<{ links: ShareLinkInfo[] }>(
        `/api/cf/sessions/${encodeURIComponent(sessionId)}/shares`
    );
    return data.links ?? [];
}

export async function createShareLink(sessionId: string): Promise<ShareLinkInfo> {
    return cfFetch<ShareLinkInfo>(`/api/cf/sessions/${encodeURIComponent(sessionId)}/shares`, {
        method: "POST",
    });
}

export async function revokeShareLink(sessionId: string, token: string): Promise<void> {
    await cfFetch(`/api/cf/sessions/${encodeURIComponent(sessionId)}/shares/${encodeURIComponent(token)}`, {
        method: "DELETE",
    });
}

/** Public snapshot for a share token — throws when invalid/revoked. */
export async function loadSharedSnapshot(token: string): Promise<import("@/lib/cf/shares").SharedSnapshot> {
    return cfFetch(`/api/cf/shared/${encodeURIComponent(token)}`);
}
