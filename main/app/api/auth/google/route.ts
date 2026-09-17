import { NextRequest, NextResponse } from "next/server";
import {
    googleOAuthConfigured,
    redirectUriFor,
    newOAuthState,
    oauthStateCookieHeader,
    buildAuthUrl,
} from "@/lib/auth/google";

/** Start Google sign-in: set single-use state cookie, redirect to Google. */
export async function GET(req: NextRequest) {
    if (!googleOAuthConfigured()) {
        return NextResponse.json(
            { error: "Google sign-in is not configured on this deployment." },
            { status: 503 }
        );
    }
    const { state, nonce } = newOAuthState();
    const url = buildAuthUrl({ redirectUri: redirectUriFor(req), state, nonce });
    const res = NextResponse.redirect(url);
    res.headers.set("Set-Cookie", oauthStateCookieHeader(state, nonce));
    return res;
}
