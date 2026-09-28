/**
 * Share links (server-only).
 * ==========================
 * Read-only public links for chat sessions. A link is an unguessable
 * token (`sh_<32 hex>`) mapped to a session id in D1. Anyone holding the
 * token can read a stripped snapshot (title + message text + citations)
 * with NO sign-in — usage/cost internals, evidence payloads, and chart
 * dumps are never shared. Owners manage links per session; deleting a
 * session or revoking a link disables it immediately.
 *
 * The `shares` table is created lazily (idempotent) so no external
 * migration step is needed.
 */

import { d1Exec, d1Query } from "./d1";
import { sanitizeCitations } from "@/lib/utils";
import type { Message } from "@/lib/store";

/** Public snapshot served to link holders (no auth). */
export interface SharedMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: number;
    citations?: NonNullable<Message["citations"]>;
}

export interface SharedSnapshot {
    title: string;
    createdAt: number;
    messageCount: number;
    messages: SharedMessage[];
}

export interface ShareLinkRecord {
    token: string;
    createdAt: number;
}

/** Max active links per session (abuse bound). */
export const MAX_LINKS_PER_SESSION = 10;
/** Max messages served per shared snapshot. */
const SHARED_MESSAGE_LIMIT = 200;

const TOKEN_RE = /^sh_[0-9a-f]{32}$/;

/** True for well-formed share tokens (cheap reject before any D1 work). */
export function isShareToken(value: unknown): value is string {
    return typeof value === "string" && TOKEN_RE.test(value);
}

async function ensureSharesTable(): Promise<void> {
    await d1Exec(
        `CREATE TABLE IF NOT EXISTS shares (
            token TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )`
    );
    await d1Exec(
        `CREATE INDEX IF NOT EXISTS idx_shares_session ON shares (session_id)`
    );
}

interface ShareRow {
    token: string;
    session_id: string;
    user_id: string;
    created_at: number;
}

async function sessionOwnedBy(sessionId: string, userId: string): Promise<boolean> {
    const rows = await d1Query<{ id: string }>(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
        [sessionId, userId]
    );
    return rows.length > 0;
}

/** Mint a new share link for a session owned by `userId`. */
export async function createShareLink(userId: string, sessionId: string): Promise<ShareLinkRecord> {
    if (!sessionId || typeof sessionId !== "string") {
        throw Object.assign(new Error("Invalid session"), { status: 400 });
    }
    await ensureSharesTable();
    if (!(await sessionOwnedBy(sessionId, userId))) {
        throw Object.assign(new Error("Session not found"), { status: 404 });
    }
    const existing = await d1Query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM shares WHERE session_id = ?`,
        [sessionId]
    );
    if ((existing[0]?.n ?? 0) >= MAX_LINKS_PER_SESSION) {
        throw Object.assign(new Error("Share link limit reached for this session"), { status: 429 });
    }
    const { randomUUID } = await import("crypto");
    const token = `sh_${randomUUID().replace(/-/g, "")}`;
    const now = Date.now();
    await d1Exec(`INSERT INTO shares (token, session_id, user_id, created_at) VALUES (?, ?, ?, ?)`, [
        token,
        sessionId,
        userId,
        now,
    ]);
    return { token, createdAt: now };
}

/** List a session's active links (owner only). */
export async function listShareLinks(userId: string, sessionId: string): Promise<ShareLinkRecord[]> {
    await ensureSharesTable();
    if (!(await sessionOwnedBy(sessionId, userId))) {
        throw Object.assign(new Error("Session not found"), { status: 404 });
    }
    const rows = await d1Query<ShareRow>(
        `SELECT token, created_at FROM shares WHERE session_id = ? AND user_id = ? ORDER BY created_at DESC`,
        [sessionId, userId]
    );
    return rows.map((r) => ({ token: r.token, createdAt: r.created_at }));
}

/** Revoke one link (owner only). */
export async function revokeShareLink(userId: string, token: string): Promise<void> {
    if (!isShareToken(token)) {
        throw Object.assign(new Error("Invalid share link"), { status: 404 });
    }
    await ensureSharesTable();
    await d1Exec(`DELETE FROM shares WHERE token = ? AND user_id = ?`, [token, userId]);
}

/**
 * Map one stored message row to its public shape. Everything not needed
 * to read the conversation (usage/cost, evidence blobs, chart dumps,
 * traces, confidence) is dropped — the public page stays light and
 * nothing sensitive leaks through a link.
 */
export function toSharedMessage(row: {
    id: string;
    role: string;
    content: string;
    timestamp: number;
    data_json?: unknown;
}): SharedMessage {
    let citations: SharedMessage["citations"];
    if (typeof row.data_json === "string" && row.data_json) {
        try {
            const doc = JSON.parse(row.data_json) as { citations?: unknown };
            const clean = sanitizeCitations(doc.citations);
            if (clean.length > 0) citations = clean;
        } catch {
            // Corrupt doc — serve the text without citations.
        }
    }
    return {
        id: String(row.id ?? "").slice(0, 128),
        role: row.role === "assistant" ? "assistant" : "user",
        content: String(row.content ?? "").slice(0, 200_000),
        timestamp: typeof row.timestamp === "number" && Number.isFinite(row.timestamp) ? row.timestamp : Date.now(),
        ...(citations ? { citations } : {}),
    };
}

/** Resolve a token to its public snapshot (no auth — possession is access). */
export async function resolveSharedSnapshot(token: string): Promise<SharedSnapshot> {
    if (!isShareToken(token)) {
        throw Object.assign(new Error("This link is invalid or was revoked"), { status: 404 });
    }
    await ensureSharesTable();
    const links = await d1Query<ShareRow>(`SELECT session_id FROM shares WHERE token = ?`, [token]);
    const sessionId = links[0]?.session_id;
    if (!sessionId) {
        throw Object.assign(new Error("This link is invalid or was revoked"), { status: 404 });
    }
    const sessions = await d1Query<{ title: string; created_at: number }>(
        `SELECT title, created_at FROM sessions WHERE id = ?`,
        [sessionId]
    );
    const session = sessions[0];
    if (!session) {
        // Owner deleted the session — retire the orphaned token.
        await d1Exec(`DELETE FROM shares WHERE token = ?`, [token]).catch(() => undefined);
        throw Object.assign(new Error("This chat no longer exists"), { status: 404 });
    }
    const rows = await d1Query<{
        id: string;
        role: string;
        content: string;
        timestamp: number;
        data_json: string;
    }>(
        `SELECT id, role, content, timestamp, data_json FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ${SHARED_MESSAGE_LIMIT}`,
        [sessionId]
    );
    return {
        title: session.title || "Shared chat",
        createdAt: session.created_at,
        messageCount: rows.length,
        messages: rows.map(toSharedMessage),
    };
}
