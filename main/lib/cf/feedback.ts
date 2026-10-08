/**
 * Feedback store (server-only).
 * ==============================
 * User feedback + contact messages live in D1 (`f1-sessions`, table
 * `feedback`), created lazily like the shares table — no separate
 * migration step. Reads are admin-scoped; writes are identity-scoped.
 */

import { d1Query, d1Exec } from "./d1";

export type FeedbackKind = "first_response" | "message" | "contact";

export interface FeedbackInput {
    kind: FeedbackKind;
    /** 1-5 stars. Required for first_response, optional otherwise. */
    rating?: number | null;
    /** Contact subject (contact only). */
    subject?: string | null;
    /** Optional comment (contact: required). */
    message?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
}

export interface FeedbackRow {
    id: string;
    userId: string;
    displayName: string | null;
    email: string | null;
    kind: FeedbackKind;
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
    /** Average over rated responses (first_response + message with rating). */
    avgRating: number | null;
    ratedCount: number;
    ratingCounts: Record<string, number>;
    /** Last 7 UTC days, oldest first: { day: "YYYY-MM-DD", count }. */
    byDay: Array<{ day: string; count: number }>;
}

const KINDS: FeedbackKind[] = ["first_response", "message", "contact"];
const MAX_MESSAGE = 2000;
const MAX_SUBJECT = 120;
const MAX_ID = 128;

async function ensureFeedbackTable(): Promise<void> {
    await d1Exec(
        `CREATE TABLE IF NOT EXISTS feedback (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            rating INTEGER,
            subject TEXT,
            message TEXT,
            session_id TEXT,
            message_id TEXT,
            created_at INTEGER NOT NULL
        )`
    );
    await d1Exec(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC)`);
    await d1Exec(`CREATE INDEX IF NOT EXISTS idx_feedback_kind ON feedback (kind)`);
}

/**
 * Validate untrusted client input. Pure — unit-tested without D1.
 * Returns the normalized value or a human-readable error.
 */
export function validateFeedbackInput(input: {
    kind?: unknown;
    rating?: unknown;
    subject?: unknown;
    message?: unknown;
    sessionId?: unknown;
    messageId?: unknown;
}): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
    const kind = typeof input.kind === "string" ? input.kind : "";
    if (!KINDS.includes(kind as FeedbackKind)) {
        return { ok: false, error: "Unknown feedback kind." };
    }
    let rating: number | null = null;
    if (input.rating !== undefined && input.rating !== null) {
        const n = typeof input.rating === "number" ? input.rating : Number(input.rating);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
            return { ok: false, error: "Rating must be a whole number from 1 to 5." };
        }
        rating = n;
    }
    if (kind === "first_response" && rating === null) {
        return { ok: false, error: "Pick a star rating first." };
    }
    const subject =
        typeof input.subject === "string" && input.subject.trim()
            ? input.subject.trim().slice(0, MAX_SUBJECT)
            : null;
    const message =
        typeof input.message === "string" && input.message.trim()
            ? input.message.trim().slice(0, MAX_MESSAGE)
            : null;
    if (kind === "contact" && !message) {
        return { ok: false, error: "Write a message first." };
    }
    const idOrNull = (v: unknown): string | null =>
        typeof v === "string" && v ? v.slice(0, MAX_ID) : null;
    return {
        ok: true,
        value: {
            kind: kind as FeedbackKind,
            rating,
            subject,
            message,
            sessionId: idOrNull(input.sessionId),
            messageId: idOrNull(input.messageId),
        },
    };
}

export async function saveFeedback(userId: string, input: FeedbackInput): Promise<string> {
    await ensureFeedbackTable();
    const { randomUUID } = await import("crypto");
    const id = `f_${randomUUID().replace(/-/g, "")}`.slice(0, 128);
    await d1Exec(
        `INSERT INTO feedback (id, user_id, kind, rating, subject, message, session_id, message_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            userId,
            input.kind,
            input.rating ?? null,
            input.subject ?? null,
            input.message ?? null,
            input.sessionId ?? null,
            input.messageId ?? null,
            Date.now(),
        ]
    );
    return id;
}

interface FeedbackDbRow {
    id: string;
    user_id: string;
    display_name: string | null;
    email: string | null;
    kind: string;
    rating: number | null;
    subject: string | null;
    message: string | null;
    session_id: string | null;
    message_id: string | null;
    created_at: number;
}

function toRow(r: FeedbackDbRow): FeedbackRow {
    return {
        id: r.id,
        userId: r.user_id,
        displayName: r.display_name,
        email: r.email,
        kind: (KINDS as string[]).includes(r.kind) ? (r.kind as FeedbackKind) : "message",
        rating: typeof r.rating === "number" ? r.rating : null,
        subject: r.subject,
        message: r.message,
        sessionId: r.session_id,
        messageId: r.message_id,
        createdAt: r.created_at,
    };
}

/** Latest-first page for the admin analysis view. */
export async function listFeedback(opts?: { limit?: number; kind?: FeedbackKind }): Promise<FeedbackRow[]> {
    await ensureFeedbackTable();
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
    const params: unknown[] = [];
    let where = "";
    if (opts?.kind && KINDS.includes(opts.kind)) {
        where = "WHERE f.kind = ?";
        params.push(opts.kind);
    }
    params.push(limit);
    const rows = await d1Query<FeedbackDbRow>(
        `SELECT f.id, f.user_id, u.display_name, u.email, f.kind, f.rating, f.subject, f.message,
                f.session_id, f.message_id, f.created_at
         FROM feedback f LEFT JOIN users u ON u.id = f.user_id
         ${where} ORDER BY f.created_at DESC LIMIT ?`,
        params
    );
    return rows.map(toRow);
}

export async function feedbackStats(): Promise<FeedbackStats> {
    await ensureFeedbackTable();
    const [totalRows, kindRows, ratingRows, dayRows] = await Promise.all([
        d1Query<{ n: number }>(`SELECT COUNT(*) AS n FROM feedback`),
        d1Query<{ kind: string; n: number }>(`SELECT kind, COUNT(*) AS n FROM feedback GROUP BY kind`),
        d1Query<{ rating: number; n: number }>(
            `SELECT rating, COUNT(*) AS n FROM feedback WHERE rating BETWEEN 1 AND 5 GROUP BY rating`
        ),
        d1Query<{ day: string; n: number }>(
            `SELECT date(created_at / 1000, 'unixepoch') AS day, COUNT(*) AS n
             FROM feedback WHERE created_at > ? GROUP BY day ORDER BY day ASC`,
            [Date.now() - 7 * 24 * 3600 * 1000]
        ),
    ]);
    const total = totalRows[0]?.n ?? 0;
    const byKind: Record<string, number> = {};
    for (const r of kindRows) byKind[r.kind] = r.n;
    const ratingCounts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    let ratedCount = 0;
    let ratedSum = 0;
    for (const r of ratingRows) {
        ratingCounts[String(r.rating)] = r.n;
        ratedCount += r.n;
        ratedSum += r.rating * r.n;
    }
    return {
        total,
        byKind,
        avgRating: ratedCount > 0 ? Math.round((ratedSum / ratedCount) * 100) / 100 : null,
        ratedCount,
        ratingCounts,
        byDay: dayRows.map((r) => ({ day: r.day, count: r.n })),
    };
}
