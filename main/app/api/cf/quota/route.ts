import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited } from "@/lib/cf/route-util";
import { getQuotaState, type Tier } from "@/lib/cf/quotas";

/**
 * Today's quota usage vs caps for the subtle sidebar usage indicator.
 * `?byok=1` selects BYOK caps (the client knows whether a user key is set;
 * enforcement stays server-side per chat request, so lying gains nothing).
 */
export async function GET(req: NextRequest) {
    try {
        const ctx = await cfIdentity(req);
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        const tier: Tier = new URL(req.url).searchParams.get("byok") === "1" ? "byok" : "managed";
        const state = await getQuotaState(ctx.uid, ctx.ipHash, tier);
        return withUidCookie(NextResponse.json(state), ctx);
    } catch (e) {
        return cfError(e);
    }
}
