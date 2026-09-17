import { NextRequest, NextResponse } from "next/server";
import {
    googleOAuthConfigured,
    redirectUriFor,
    parseOAuthStateCookie,
    statesEqual,
    clearOAuthStateCookieHeader,
    exchangeCode,
    verifyIdToken,
    OAUTH_STATE_COOKIE,
} from "@/lib/auth/google";
import { linkGoogleAccount } from "@/lib/cf/store";
import { extractUid, uidCookieHeader } from "@/lib/cf/session";

function fail(req: NextRequest, reason: string): NextResponse {
    const url = new URL("/", req.url);
    url.searchParams.set("auth", "error");
    url.searchParams.set("reason", reason);
    const res = NextResponse.redirect(url);
    res.headers.set("Set-Cookie", clearOAuthStateCookieHeader());
    return res;
}

/** Google redirects here after consent. Verifies, links, signs in. */
export async function GET(req: NextRequest) {
    if (!googleOAuthConfigured()) return fail(req, "unconfigured");
    const params = new URL(req.url).searchParams;
    if (params.get("error")) {
        console.warn("[oauth] provider error:", params.get("error"));
        return fail(req, "denied");
    }
    const code = params.get("code");
    const state = params.get("state");
    const stored = parseOAuthStateCookie(req.cookies.get(OAUTH_STATE_COOKIE)?.value);
    if (!code || !state || !stored || !statesEqual(state, stored.state)) {
        console.warn("[oauth] state mismatch or missing code");
        return fail(req, "state");
    }
    try {
        const { idToken } = await exchangeCode({ code, redirectUri: redirectUriFor(req) });
        const profile = await verifyIdToken(idToken, { nonce: stored.nonce });
        const prevUid = extractUid(req.cookies.get("cf_uid")?.value ?? null);
        const uid = await linkGoogleAccount(prevUid, profile);
        const res = NextResponse.redirect(new URL("/", req.url));
        // Replace the single-use state cookie with the signed session cookie.
        res.headers.append("Set-Cookie", clearOAuthStateCookieHeader());
        res.headers.append("Set-Cookie", uidCookieHeader(uid));
        return res;
    } catch (e) {
        console.error("[oauth] callback failed:", e instanceof Error ? e.message : e);
        return fail(req, "verify");
    }
}
