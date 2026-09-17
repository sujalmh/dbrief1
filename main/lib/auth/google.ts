/**
 * Direct Google OAuth (server-only, no Firebase).
 * ==============================================
 * Passwordless-by-default app + optional "Sign in with Google" that links
 * the browser's anonymous identity to a Google account. Uses plain OAuth
 * 2.0 code flow + ID-token verification against Google's JWKS — no SDK.
 *
 * Security properties:
 * - `state` (CSRF) validated with constant-time compare, single-use,
 *   10-minute httpOnly cookie.
 * - `nonce` bound into the ID token and verified (replay protection).
 * - ID token: RS256 signature via Google JWKS (1h cache), iss/aud/exp
 *   checks, `email_verified` required.
 * - Client secret never leaves the server (token exchange is server-side).
 */

import { randomBytes, timingSafeEqual, createVerify, createPublicKey, type JsonWebKey } from "node:crypto";
import type { NextRequest } from "next/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export const OAUTH_STATE_COOKIE = "g_oauth_state";
const STATE_TTL_SECONDS = 600;

export interface GoogleProfile {
    sub: string;
    email: string;
    name?: string;
    avatarUrl?: string;
}

export function googleOAuthConfigured(): boolean {
    return !!(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

export function googleClientId(): string {
    return process.env.GOOGLE_OAUTH_CLIENT_ID || "";
}

/**
 * Redirect URI for the callback. Explicit env wins (use it when the
 * public URL differs from request headers, e.g. behind rewrites);
 * otherwise derived from the request (works across preview deploys as
 * long as each URL is registered in Google Cloud console).
 */
export function redirectUriFor(req: NextRequest): string {
    const pinned = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (pinned) return pinned;
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}/api/auth/callback`;
}

function secureFlag(): string {
    return process.env.NODE_ENV === "production" ? "; Secure" : "";
}

export function newOAuthState(): { state: string; nonce: string } {
    return { state: randomBytes(32).toString("hex"), nonce: randomBytes(32).toString("hex") };
}

export function oauthStateCookieHeader(state: string, nonce: string): string {
    return `${OAUTH_STATE_COOKIE}=${state}.${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}${secureFlag()}`;
}

export function clearOAuthStateCookieHeader(): string {
    return `${OAUTH_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag()}`;
}

export function parseOAuthStateCookie(value: string | undefined): { state: string; nonce: string } | null {
    if (!value) return null;
    const dot = value.indexOf(".");
    if (dot <= 0) return null;
    const state = value.slice(0, dot);
    const nonce = value.slice(dot + 1);
    if (!/^[0-9a-f]{64}$/.test(state) || !/^[0-9a-f]{64}$/.test(nonce)) return null;
    return { state, nonce };
}

export function statesEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    try {
        return timingSafeEqual(ab, bb);
    } catch {
        return false;
    }
}

export function buildAuthUrl(args: { redirectUri: string; state: string; nonce: string }): string {
    const q = new URLSearchParams({
        client_id: googleClientId(),
        redirect_uri: args.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: args.state,
        nonce: args.nonce,
    });
    return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

/** Exchange an authorization code for tokens. Throws with a safe message. */
export async function exchangeCode(args: { code: string; redirectUri: string }): Promise<{ idToken: string }> {
    let res: Response;
    try {
        res = await fetch(GOOGLE_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                code: args.code,
                client_id: googleClientId(),
                client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
                redirect_uri: args.redirectUri,
                grant_type: "authorization_code",
            }).toString(),
        });
    } catch (e) {
        throw new Error(`Google token exchange unreachable: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) {
        // Never forward Google's body (may contain hints); log status only.
        console.error("[oauth] token exchange failed:", res.status);
        throw new Error("Google rejected the login request");
    }
    const data = (await res.json().catch(() => ({}))) as { id_token?: unknown; error?: unknown };
    if (typeof data.id_token !== "string" || !data.id_token) {
        console.error("[oauth] token exchange returned no id_token:", typeof data.error === "string" ? data.error : "?");
        throw new Error("Google login did not return an identity token");
    }
    return { idToken: data.id_token };
}

// ---------------------------------------------------------------------------
// ID-token verification
// ---------------------------------------------------------------------------

interface Jwk {
    kid?: string;
    kty?: string;
    n?: string;
    e?: string;
}

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 3600_000;

async function getGoogleKeys(fetchCerts?: () => Promise<{ keys: Jwk[] }>): Promise<Jwk[]> {
    if (fetchCerts) return (await fetchCerts()).keys;
    const now = Date.now();
    if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
    const res = await fetch(GOOGLE_CERTS_URL);
    if (!res.ok) throw new Error("Could not fetch Google signing keys");
    const data = (await res.json()) as { keys?: Jwk[] };
    if (!Array.isArray(data.keys)) throw new Error("Malformed Google signing keys");
    jwksCache = { keys: data.keys, fetchedAt: now };
    return data.keys;
}

function b64urlJson(part: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

export interface VerifyOptions {
    clientId?: string;
    nonce?: string;
    /** Unix seconds; defaults to now. Injectable for tests. */
    nowSec?: number;
    /** Injectable JWKS source for tests. */
    fetchCerts?: () => Promise<{ keys: Jwk[] }>;
}

/** Verify a Google ID token and return the profile. Throws on any problem. */
export async function verifyIdToken(idToken: string, opts: VerifyOptions = {}): Promise<GoogleProfile> {
    const clientId = opts.clientId ?? googleClientId();
    if (!clientId) throw new Error("OAuth client ID is not configured");
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new Error("Malformed identity token");
    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
        header = b64urlJson(parts[0]!);
        payload = b64urlJson(parts[1]!);
    } catch {
        throw new Error("Malformed identity token");
    }
    if (header.alg !== "RS256" || typeof header.kid !== "string") {
        throw new Error("Unexpected token signing algorithm");
    }
    const keys = await getGoogleKeys(opts.fetchCerts);
    const jwk = keys.find((k) => k.kid === header.kid && k.kty === "RSA" && k.n && k.e);
    if (!jwk) throw new Error("Unknown token signing key");
    const key = createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" });
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const sig = Buffer.from(parts[2]!, "base64url");
    let ok = false;
    try {
        ok = createVerify("RSA-SHA256").update(data).verify(key, sig);
    } catch {
        ok = false;
    }
    if (!ok) throw new Error("Invalid token signature");

    const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
    if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
        throw new Error("Wrong token issuer");
    }
    if (payload.aud !== clientId) throw new Error("Token was not issued to this app");
    if (typeof payload.exp !== "number" || payload.exp + 60 < now) throw new Error("Token has expired");
    if (typeof payload.iat !== "number" || payload.iat - 300 > now) throw new Error("Token issued in the future");
    if (opts.nonce !== undefined && payload.nonce !== opts.nonce) throw new Error("Nonce mismatch");
    if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Token has no subject");
    if (payload.email_verified !== true) throw new Error("Google email is not verified");
    if (typeof payload.email !== "string" || !payload.email.includes("@")) {
        throw new Error("Token has no email");
    }
    return {
        sub: payload.sub,
        email: payload.email,
        name: typeof payload.name === "string" ? payload.name : undefined,
        avatarUrl: typeof payload.picture === "string" ? payload.picture : undefined,
    };
}
