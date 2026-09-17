/**
 * Cloudflare session store (server-only).
 * ======================================
 * Sessions + messages live in D1 (`f1-sessions`); large fields live as
 * JSON objects in R2 (`f1-ai`) with keys tracked in the `blobs` table so
 * deletes never need a bucket listing.
 *
 * Every function is ownership-scoped by (userId, sessionId). Message
 * payloads reuse the pure builders in ./serialization so what is saved is
 * exactly what the UI needs to resume (steps+args, visualizationData,
 * iterations/evidence/reflections/confidence/chartSpecs, usage, ...).
 */

import { d1Query, d1Exec } from "./d1";
import { r2PutJson, r2GetJson, r2Delete } from "./r2";
import {
    buildFullMessageDoc,
    docToMessage,
    estimateJsonBytes,
    truncateVisualizationPayload,
    OVERFLOW_FIELD_THRESHOLD,
    INLINE_BUDGET,
    type FullMessageDoc,
    type SessionUIState,
} from "./serialization";
import type { Message } from "@/lib/store";

export type { SessionUIState };

export interface SessionRow {
    id: string;
    title?: string;
    type?: string | null;
    userId?: string;
    createdAt?: number;
    lastMessageAt?: number;
}

interface SessionDbRow {
    id: string;
    user_id: string;
    title: string;
    type: string | null;
    created_at: number;
    last_message_at: number;
    context_json: string;
}

interface MessageDbRow {
    id: string;
    session_id: string;
    user_id: string;
    role: string;
    content: string;
    timestamp: number;
    data_json: string;
}

function sessionToRow(r: SessionDbRow): SessionRow {
    return {
        id: r.id,
        title: r.title,
        type: r.type,
        userId: r.user_id,
        createdAt: r.created_at,
        lastMessageAt: r.last_message_at,
    };
}

function blobKey(sessionId: string, suffix: string): string {
    return `sessions/${sessionId}/${suffix}.json`;
}

/** Escape %, _ and \ so IDs are matched literally in LIKE patterns. */
function escapeLike(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function trackBlob(sessionId: string, key: string): Promise<void> {
    await d1Exec(`INSERT OR IGNORE INTO blobs (key, session_id, created_at) VALUES (?, ?, ?)`, [
        key,
        sessionId,
        Date.now(),
    ]);
}

async function untrackBlob(key: string): Promise<void> {
    await d1Exec(`DELETE FROM blobs WHERE key = ?`, [key]);
}

async function deleteBlob(sessionId: string, key: string): Promise<void> {
    await r2Delete(key).catch(() => undefined);
    await untrackBlob(key).catch(() => undefined);
    void sessionId;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function ensureUser(
    userId: string,
    opts?: { ipHash?: string | null; day?: string }
): Promise<{ uid: string; displayName: string }> {
    const now = Date.now();
    const day = opts?.day ?? new Date(now).toISOString().slice(0, 10);
    await d1Exec(
        `INSERT INTO users (id, display_name, created_at, last_seen_at, ip_hash, created_day) VALUES (?, 'Driver', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at, ip_hash = COALESCE(excluded.ip_hash, users.ip_hash)`,
        [userId, now, now, opts?.ipHash ?? null, day]
    );
    const rows = await d1Query<{ display_name: string }>(`SELECT display_name FROM users WHERE id = ?`, [userId]);
    return { uid: userId, displayName: rows[0]?.display_name || "Driver" };
}

export interface UserProfile {
    uid: string;
    displayName: string;
    google: { email: string; name: string | null; avatarUrl: string | null } | null;
}

/** Full identity profile for /api/cf/me (auth badge + sign-in state). */
export async function getUserProfile(userId: string): Promise<UserProfile> {
    const rows = await d1Query<{
        display_name: string;
        google_sub: string | null;
        email: string | null;
        avatar_url: string | null;
    }>(`SELECT display_name, google_sub, email, avatar_url FROM users WHERE id = ?`, [userId]);
    const r = rows[0];
    return {
        uid: userId,
        displayName: r?.display_name || "Driver",
        google:
            r?.google_sub && r.email
                ? { email: r.email, name: r.display_name || null, avatarUrl: r.avatar_url }
                : null,
    };
}

export interface GoogleLinkProfile {
    sub: string;
    email: string;
    name?: string;
    avatarUrl?: string;
}

/**
 * Link the browser's (possibly anonymous) identity to a Google account.
 * The Google-linked UID is deterministic (`g_<sub>`) so re-login restores
 * the same identity on any device. Anonymous history migrates ONLY when
 * the previous row has no Google link of its own (never merge two linked
 * accounts on a shared device). Quota ledgers intentionally stay behind
 * (abuse history must not reset on login).
 */
export async function linkGoogleAccount(prevUid: string | null, profile: GoogleLinkProfile): Promise<string> {
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const uid = `g_${profile.sub}`.slice(0, 128);
    const displayName = (profile.name || profile.email.split("@")[0] || "Driver").slice(0, 200);
    await d1Exec(
        `INSERT INTO users (id, display_name, created_at, last_seen_at, created_day, google_sub, email, avatar_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           display_name = excluded.display_name,
           email = excluded.email,
           avatar_url = excluded.avatar_url`,
        [uid, displayName, now, now, day, profile.sub, profile.email.slice(0, 320), (profile.avatarUrl || "").slice(0, 2048)]
    );
    if (prevUid && prevUid !== uid) {
        const prev = await d1Query<{ google_sub: string | null }>(`SELECT google_sub FROM users WHERE id = ?`, [prevUid]);
        if (prev.length > 0 && !prev[0]?.google_sub) {
            await d1Exec(`UPDATE sessions SET user_id = ? WHERE user_id = ?`, [uid, prevUid]);
            await d1Exec(`UPDATE messages SET user_id = ? WHERE user_id = ?`, [uid, prevUid]);
            await d1Exec(`DELETE FROM users WHERE id = ?`, [prevUid]);
        }
    }
    return uid;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function listSessions(userId: string): Promise<SessionRow[]> {
    const rows = await d1Query<SessionDbRow>(
        `SELECT * FROM sessions WHERE user_id = ? ORDER BY last_message_at DESC LIMIT 100`,
        [userId]
    );
    return rows.map(sessionToRow);
}

export async function createSession(userId: string, title = "New Chat", type?: string, id?: string): Promise<string> {
    const now = Date.now();
    // Unpredictable IDs: randomUUID (122-bit entropy), not timestamp+rand.
    const { randomUUID } = await import("crypto");
    const sid = (id || `s_${randomUUID().replace(/-/g, "")}`).slice(0, 128);
    await d1Exec(
        `INSERT INTO sessions (id, user_id, title, type, created_at, last_message_at, context_json)
         VALUES (?, ?, ?, ?, ?, ?, '{}')`,
        [sid, userId, title.slice(0, 200), type ? type.slice(0, 64) : null, now, now]
    );
    return sid;
}

async function requireSession(userId: string, sessionId: string): Promise<SessionDbRow> {
    const rows = await d1Query<SessionDbRow>(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`, [
        sessionId,
        userId,
    ]);
    const s = rows[0];
    if (!s) throw Object.assign(new Error("Session not found"), { status: 404 });
    return s;
}

export async function patchSession(
    userId: string,
    sessionId: string,
    patch: { title?: string; type?: string | null }
): Promise<void> {
    await requireSession(userId, sessionId);
    const updates: string[] = [];
    const params: unknown[] = [];
    if (patch.title !== undefined) {
        updates.push("title = ?");
        params.push(patch.title.slice(0, 200));
    }
    if (patch.type !== undefined) {
        updates.push("type = ?");
        params.push(patch.type ? patch.type.slice(0, 64) : null);
    }
    if (updates.length === 0) return;
    updates.push("last_message_at = ?");
    params.push(Date.now(), sessionId);
    await d1Exec(`UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`, params);
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
    await requireSession(userId, sessionId);
    const blobs = await d1Query<{ key: string }>(`SELECT key FROM blobs WHERE session_id = ?`, [sessionId]);
    await Promise.all(blobs.map((b) => r2Delete(b.key).catch(() => undefined)));
    await d1Exec(`DELETE FROM blobs WHERE session_id = ?`, [sessionId]);
    await d1Exec(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
    await d1Exec(`DELETE FROM sessions WHERE id = ?`, [sessionId]);
}

// ---------------------------------------------------------------------------
// Session UI context (visualization panel, pinned graphs, active message)
// ---------------------------------------------------------------------------

export async function getSessionContext(userId: string, sessionId: string): Promise<SessionUIState> {
    const s = await requireSession(userId, sessionId);
    let ctx: SessionUIState & { __blob?: string } = {};
    try {
        ctx = JSON.parse(s.context_json || "{}");
    } catch {
        ctx = {};
    }
    if (ctx.__blob) {
        const v = await r2GetJson<SessionUIState>(ctx.__blob);
        return v ?? {};
    }
    return ctx;
}

export async function setSessionContext(userId: string, sessionId: string, context: SessionUIState): Promise<void> {
    await requireSession(userId, sessionId);
    // Drop previous UI blob (only one UI blob per session by construction).
    const prev = await d1Query<{ key: string }>(
        `SELECT key FROM blobs WHERE session_id = ? AND key LIKE ? ESCAPE '\'`,
        [sessionId, `sessions/${sessionId}/ui-state.json`]
    );
    let contextJson = JSON.stringify(context);
    if (contextJson.length > OVERFLOW_FIELD_THRESHOLD) {
        const key = blobKey(sessionId, "ui-state");
        await r2PutJson(key, context);
        await trackBlob(sessionId, key);
        contextJson = JSON.stringify({ __blob: key });
    } else if (estimateJsonBytes(context) > INLINE_BUDGET && (context as SessionUIState).graphHistory) {
        const trimmed: SessionUIState = {
            ...context,
            graphHistory: context.graphHistory!.map((g) => ({
                ...g,
                data: estimateJsonBytes(g.data) > OVERFLOW_FIELD_THRESHOLD ? null : g.data,
            })),
        };
        contextJson = JSON.stringify(trimmed);
    }
    await d1Exec(`UPDATE sessions SET context_json = ?, last_message_at = ? WHERE id = ?`, [
        contextJson,
        Date.now(),
        sessionId,
    ]);
    for (const p of prev) {
        if (contextJson.includes(p.key)) continue;
        await deleteBlob(sessionId, p.key);
    }
}

// ---------------------------------------------------------------------------
// Messages (full trace — everything needed to resume)
// ---------------------------------------------------------------------------

async function offloadDoc(sessionId: string, messageId: string, doc: FullMessageDoc): Promise<FullMessageDoc> {
    const out: FullMessageDoc = { ...doc };
    const vizSize = out.visualizationData !== undefined ? estimateJsonBytes(out.visualizationData) : 0;
    if (vizSize > OVERFLOW_FIELD_THRESHOLD) {
        const key = blobKey(sessionId, `messages/${messageId}/visualization`);
        try {
            await r2PutJson(key, out.visualizationData);
            await trackBlob(sessionId, key);
            out.visualizationData = null;
            out.visualizationRef = key;
        } catch {
            const { payload, truncated } = truncateVisualizationPayload(out.visualizationData);
            out.visualizationData = payload;
            if (truncated) out.visualizationTruncated = true;
        }
    }
    if (out.evidence) {
        for (const ev of out.evidence) {
            const rec = ev as { data?: unknown; dataRef?: string | null; dataTruncated?: boolean };
            if (rec.data === undefined || rec.data === null || rec.dataRef) continue;
            if (estimateJsonBytes(rec.data) <= OVERFLOW_FIELD_THRESHOLD) continue;
            const key = blobKey(sessionId, `messages/${messageId}/evidence-${ev.id}`);
            try {
                await r2PutJson(key, rec.data);
                await trackBlob(sessionId, key);
                rec.data = null;
                rec.dataRef = key;
            } catch {
                rec.data = null;
                rec.dataTruncated = true;
            }
        }
    }
    if (estimateJsonBytes(out) > INLINE_BUDGET && out.visualizationData) {
        const { payload, truncated } = truncateVisualizationPayload(out.visualizationData);
        out.visualizationData = payload;
        if (truncated) out.visualizationTruncated = true;
    }
    return out;
}

async function hydrateDoc(doc: FullMessageDoc): Promise<FullMessageDoc> {
    const out: FullMessageDoc = { ...doc };
    if (out.visualizationRef && out.visualizationData == null) {
        const v = await r2GetJson(out.visualizationRef);
        if (v !== null) out.visualizationData = v;
    }
    if (out.evidence) {
        for (const ev of out.evidence) {
            const rec = ev as { data?: unknown; dataRef?: string | null };
            if (rec.dataRef && rec.data == null) {
                const v = await r2GetJson(rec.dataRef);
                if (v !== null) rec.data = v;
            }
        }
    }
    return out;
}

function rowToMessage(row: MessageDbRow, data: FullMessageDoc): Message {
    return docToMessage(row.id, {
        ...(data as unknown as Record<string, unknown>),
        role: row.role,
        content: row.content,
        timestamp: row.timestamp,
        clientId: row.id,
        clientTimestamp: row.timestamp,
    });
}

/** Insert or replace a full message (stable client ID). */
export async function upsertMessage(userId: string, sessionId: string, message: Message): Promise<string> {
    await requireSession(userId, sessionId);
    const doc = await offloadDoc(sessionId, message.id, buildFullMessageDoc(userId, message));
    const { userId: _u, clientId: _c, clientTimestamp: _t, role, content, timestamp, ...rest } = doc;
    void _u;
    void _c;
    void _t;
    await d1Exec(
        `INSERT INTO messages (id, session_id, user_id, role, content, timestamp, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET role = excluded.role, content = excluded.content,
           timestamp = excluded.timestamp, data_json = excluded.data_json`,
        [
            message.id.slice(0, 128),
            sessionId,
            userId,
            role === "assistant" ? "assistant" : "user",
            String(content ?? "").slice(0, 200_000),
            typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : Date.now(),
            JSON.stringify(rest),
        ]
    );
    await d1Exec(`UPDATE sessions SET last_message_at = ? WHERE id = ?`, [Date.now(), sessionId]);
    return message.id;
}

/** Partial message edit (content and/or data fields). */
export async function patchMessage(
    userId: string,
    sessionId: string,
    messageId: string,
    patch: { content?: string; data?: Record<string, unknown> }
): Promise<void> {
    await requireSession(userId, sessionId);
    const rows = await d1Query<MessageDbRow>(`SELECT * FROM messages WHERE id = ? AND session_id = ?`, [
        messageId,
        sessionId,
    ]);
    const row = rows[0];
    if (!row) throw Object.assign(new Error("Message not found"), { status: 404 });
    let data: FullMessageDoc;
    try {
        data = JSON.parse(row.data_json || "{}");
    } catch {
        data = buildFullMessageDoc(userId, {
            id: row.id,
            role: row.role as "user" | "assistant",
            content: row.content,
            timestamp: row.timestamp,
        });
    }
    const content = patch.content !== undefined ? patch.content.slice(0, 200_000) : row.content;
    let merged = data;
    if (patch.data && typeof patch.data === "object") {
        merged = { ...data, ...patch.data };
    }
    merged = await offloadDoc(sessionId, messageId, merged);
    await d1Exec(`UPDATE messages SET content = ?, data_json = ? WHERE id = ?`, [
        content,
        JSON.stringify(merged),
        messageId,
    ]);
    await d1Exec(`UPDATE sessions SET last_message_at = ? WHERE id = ?`, [Date.now(), sessionId]);
}

/** Delete one message and its blobs. */
export async function deleteMessage(userId: string, sessionId: string, messageId: string): Promise<void> {
    await requireSession(userId, sessionId);
    const blobs = await d1Query<{ key: string }>(
        `SELECT key FROM blobs WHERE session_id = ? AND key LIKE ? ESCAPE '\'`,
        [sessionId, `sessions/${escapeLike(sessionId)}/messages/${escapeLike(messageId)}/%`]
    );
    await d1Exec(`DELETE FROM messages WHERE id = ? AND session_id = ?`, [messageId, sessionId]);
    await Promise.all(blobs.map((b) => deleteBlob(sessionId, b.key)));
    await d1Exec(`UPDATE sessions SET last_message_at = ? WHERE id = ?`, [Date.now(), sessionId]);
}

/** Delete all messages in a session (blobs included, session kept). */
export async function clearMessages(userId: string, sessionId: string): Promise<void> {
    await requireSession(userId, sessionId);
    const blobs = await d1Query<{ key: string }>(
        `SELECT key FROM blobs WHERE session_id = ? AND key LIKE ? ESCAPE '\'`,
        [sessionId, `sessions/${escapeLike(sessionId)}/messages/%`]
    );
    await d1Exec(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
    await d1Exec(`DELETE FROM blobs WHERE session_id = ? AND key LIKE ? ESCAPE '\'`, [
        sessionId,
        `sessions/${escapeLike(sessionId)}/messages/%`,
    ]);
    await Promise.all(blobs.map((b) => r2Delete(b.key).catch(() => undefined)));
    await d1Exec(`UPDATE sessions SET last_message_at = ? WHERE id = ?`, [Date.now(), sessionId]);
}

export async function listMessages(userId: string, sessionId: string): Promise<Message[]> {
    await requireSession(userId, sessionId);
    const rows = await d1Query<MessageDbRow>(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 500`,
        [sessionId]
    );
    const out: Message[] = [];
    for (const row of rows) {
        try {
            let data = {} as FullMessageDoc;
            try {
                data = JSON.parse(row.data_json || "{}");
            } catch {
                data = {} as FullMessageDoc;
            }
            out.push(rowToMessage(row, await hydrateDoc(data)));
        } catch {
            // Skip corrupt rows, never break the whole session load.
        }
    }
    return out;
}
