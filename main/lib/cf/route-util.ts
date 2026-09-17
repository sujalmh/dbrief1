/**
 * Shared helpers for /api/cf routes.
 * ===================================
 * Every route identifies the caller via the `cf_uid` cookie (provisioning
 * a fresh UID when absent) and maps store errors to HTTP statuses.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrProvisionUid, uidCookieHeader } from "@/lib/cf/session";
import { ensureUser } from "@/lib/cf/store";
import { CfStoreError } from "@/lib/cf/d1";
import { extractIpKey, hashIp } from "@/lib/cf/quotas";

export interface CfContext {
    uid: string;
    displayName: string;
    fresh: boolean;
    /** Salted hash of the normalized client IP (null when unresolvable). */
    ipHash: string | null;
}

/**
 * Resolve identity (provisioning on first contact) + ensure D1 user row.
 * Pass the request when available so the provision IP is stamped for
 * anti-farming velocity checks (no-op for callers without it).
 */
export async function cfIdentity(req?: NextRequest): Promise<CfContext> {
    const { uid, fresh } = await getOrProvisionUid();
    let ipHash: string | null = null;
    if (req) {
        try {
            const key = extractIpKey(req);
            ipHash = key ? hashIp(key) : null;
        } catch {
            ipHash = null;
        }
    }
    try {
        const user = await ensureUser(uid, ipHash ? { ipHash } : undefined);
        return { uid, displayName: user.displayName, fresh, ipHash };
    } catch (e) {
        if (e instanceof CfStoreError && e.status === 503) {
            // Storage unconfigured — still hand out the UID so the app
            // works local-only; routes will 503 with a clear message.
            return { uid, displayName: "Driver", fresh, ipHash };
        }
        throw e;
    }
}

/** Attach the UID cookie to a response when freshly provisioned. */
export function withUidCookie<T>(res: NextResponse<T>, ctx: CfContext): NextResponse<T> {
    if (ctx.fresh) res.headers.set("Set-Cookie", uidCookieHeader(ctx.uid));
    return res;
}

export function cfError(e: unknown): NextResponse {
    if (e instanceof CfStoreError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof Error && (e as Error & { status?: number }).status === 404) {
        return NextResponse.json({ error: e.message || "Not found" }, { status: 404 });
    }
    const message = e instanceof Error ? e.message : "Internal Server Error";
    console.error("[cf]", message);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
}

export function readJson(req: NextRequest): unknown {
    return req.json().catch(() => ({}));
}

// ---------------------------------------------------------------------------
// Abuse protection (in-process; per-instance like the chat rate limiter)
// ---------------------------------------------------------------------------

const CF_WRITE_WINDOW_MS = 60_000;
const CF_WRITE_MAX = 180; // 3 writes/sec sustained per caller
const CF_READ_WINDOW_MS = 60_000;
const CF_READ_MAX = 600;
const cfBuckets = new Map<string, number[]>();

const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^[0-9a-fA-F:.]+$/;

function clientIp(req: NextRequest): string {
    // Validate format; x-forwarded-for is client-controlled without a
    // trusted proxy, so garbage is dropped to "anon". Rotation with valid
    // IPs still bypasses per-IP limits — UID-scoped keys + a shared limiter
    // (Redis/Upstash) are required for true multi-instance enforcement.
    const candidates = [
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        req.headers.get("x-real-ip")?.trim(),
    ];
    for (const c of candidates) {
        if (!c) continue;
        const host = c.replace(/^\[(.*)\](:\d+)?$/, "$1").split(":")[0]!.slice(0, 64);
        if (IPV4_RE.test(host) || (host.includes(":") && IPV6_RE.test(host) && host.length >= 3)) {
            return host;
        }
    }
    return "anon";
}

/**
 * Sliding-window limit. Returns null when allowed, or the ms to wait.
 * `kind` separates cheap reads from D1/R2-costly writes.
 */
export function cfRateLimit(req: NextRequest, uid: string, kind: "read" | "write"): number | null {
    const now = Date.now();
    const windowMs = kind === "write" ? CF_WRITE_WINDOW_MS : CF_READ_WINDOW_MS;
    const max = kind === "write" ? CF_WRITE_MAX : CF_READ_MAX;
    const key = `${kind}:${uid || `ip:${clientIp(req)}`}`;
    const cutoff = now - windowMs;
    const bucket = (cfBuckets.get(key) || []).filter((t) => t > cutoff);
    if (bucket.length >= max) {
        cfBuckets.set(key, bucket);
        return Math.max(0, windowMs - (now - bucket[0]!));
    }
    bucket.push(now);
    // Bound memory: drop fully-expired keys opportunistically.
    if (cfBuckets.size > 5000) {
        for (const [k, stamps] of cfBuckets) {
            if (stamps.length === 0 || stamps[stamps.length - 1]! <= now - windowMs) cfBuckets.delete(k);
        }
    }
    cfBuckets.set(key, bucket);
    return null;
}

export function cfLimited(
    req: NextRequest,
    uid: string,
    kind: "read" | "write"
): NextResponse | null {
    const waitMs = cfRateLimit(req, uid, kind);
    if (waitMs === null) return null;
    return NextResponse.json(
        { error: "Rate limit exceeded. Please slow down.", retryAfterMs: waitMs },
        { status: 429, headers: { "Retry-After": Math.ceil(waitMs / 1000).toString() } }
    );
}

/**
 * Same-origin check for state-changing routes (CSRF defense-in-depth on
 * top of SameSite=Strict cookies). Allows missing Origin/Referer (curl,
 * same-origin fetch without Origin) but rejects a present Origin whose
 * host does not match the request Host.
 */
export function cfOriginDenied(req: NextRequest): NextResponse | null {
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const candidate = origin ?? referer;
    if (!candidate) return null;
    let originHost: string;
    try {
        originHost = new URL(candidate).host.toLowerCase();
    } catch {
        return NextResponse.json({ error: "Invalid Origin" }, { status: 403 });
    }
    const host =
        req.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase() ||
        req.headers.get("host")?.split(",")[0]?.trim().toLowerCase() ||
        "";
    if (host && originHost !== host) {
        return NextResponse.json({ error: "Cross-origin writes are not allowed" }, { status: 403 });
    }
    return null;
}

/** Max request JSON body accepted by the write routes (12MB). */
export const CF_MAX_BODY_BYTES = 12_000_000;

/**
 * Reject oversized bodies before D1/R2 work. Uses Content-Length when
 * present; route handlers re-check parsed size via `bodyBytes()`.
 */
export function cfBodyTooLarge(req: NextRequest): boolean {
    const len = req.headers.get("content-length");
    if (!len) return false;
    const n = Number(len);
    return Number.isFinite(n) && n > CF_MAX_BODY_BYTES;
}

/** Approximate parsed-body size for the post-parse check. */
export function bodyBytes(value: unknown): number {
    try {
        return JSON.stringify(value)?.length ?? 0;
    } catch {
        return CF_MAX_BODY_BYTES + 1;
    }
}
