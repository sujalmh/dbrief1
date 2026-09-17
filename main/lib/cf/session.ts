/**
 * Session identity (server-only).
 * ===============================
 * Replaces Firebase Auth: the server issues a random, unguessable `cf_uid`
 * httpOnly cookie on first contact and auto-provisions the matching D1
 * user row. All storage access is scoped to that UID.
 */

import { cookies } from "next/headers";
import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export const UID_COOKIE = "cf_uid";

function isValidUid(v: string | undefined): v is string {
    return !!v && v.length >= 8 && v.length <= 128 && /^[A-Za-z0-9_-]+$/.test(v);
}

function sessionSecret(): string | null {
    const s = process.env.CF_SESSION_SECRET;
    return s && s.length >= 16 ? s : null;
}

function b64url(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256 signature for a raw UID (empty when no secret configured). */
function signUid(uid: string): string {
    const secret = sessionSecret();
    if (!secret) return "";
    return b64url(createHmac("sha256", secret).update(uid).digest());
}

/**
 * Verify a cookie value. Returns the raw UID when valid, else null.
 * Accepts the signed `uid.sig` format when CF_SESSION_SECRET is set;
 * legacy unsigned values are only accepted when no secret is configured
 * (dev) so existing single-instance deployments keep working.
 */
export function verifyUidCookie(value: string | undefined): string | null {
    if (!value || value.length > 256) return null;
    const secret = sessionSecret();
    const dot = value.lastIndexOf(".");
    if (dot > 0) {
        const uid = value.slice(0, dot);
        const sig = value.slice(dot + 1);
        if (!isValidUid(uid) || !sig) return null;
        if (!secret) return null; // signed format requires a secret
        const expected = signUid(uid);
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return null;
        try {
            if (!timingSafeEqual(a, b)) return null;
        } catch {
            return null;
        }
        return uid;
    }
    // Legacy unsigned format — dev only.
    if (!secret && isValidUid(value)) return value;
    return null;
}

/** Extract the verified raw UID from a cookie header value (for rate keys). */
export function extractUid(cookieValue: string | null | undefined): string | null {
    return verifyUidCookie(cookieValue ?? undefined);
}

function newUid(): string {
    return `u_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Return the caller's UID, provisioning a fresh one (and remembering to
 * set the cookie via the returned flag) when absent/invalid.
 */
export async function getOrProvisionUid(): Promise<{ uid: string; fresh: boolean }> {
    const store = await cookies();
    const verified = verifyUidCookie(store.get(UID_COOKIE)?.value);
    if (verified) return { uid: verified, fresh: false };
    return { uid: newUid(), fresh: true };
}

/** `Secure` only in production (localhost dev is http). */
function secureFlag(): string {
    return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

/**
 * Serialize a Set-Cookie header value for the UID cookie.
 * Signed (`uid.sig`) when CF_SESSION_SECRET is set; SameSite=Strict to
 * block CSRF on the state-changing /api/cf/* routes. (__Host- prefix
 * omitted deliberately: it requires Secure on every response, which
 * breaks http localhost dev; Strict+HttpOnly+Secure-in-prod is equivalent
 * for CSRF here.)
 */
export function uidCookieHeader(uid: string): string {
    const sig = signUid(uid);
    const value = sig ? `${uid}.${sig}` : uid;
    return `${UID_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secureFlag()}`;
}

/** Serialize an expired UID cookie (sign out). */
export function clearUidCookieHeader(): string {
    return `${UID_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureFlag()}`;
}
