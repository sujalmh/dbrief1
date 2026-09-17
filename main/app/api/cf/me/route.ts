import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited } from "@/lib/cf/route-util";
import { checkProvisionVelocity } from "@/lib/cf/quotas";
import { getUserProfile } from "@/lib/cf/store";
import { googleOAuthConfigured } from "@/lib/auth/google";

export async function GET(req: NextRequest) {
    try {
        const ctx = await cfIdentity(req);
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        // Anti-farming: cap fresh account provisions per network per day.
        // Returning WITHOUT the cookie means the caller keeps no identity
        // and will be checked again on retry (by design).
        if (ctx.fresh && ctx.ipHash) {
            const v = await checkProvisionVelocity(ctx.ipHash);
            if (!v.allowed) {
                return NextResponse.json(
                    { error: v.message, code: "provision_quota", resetsAt: v.resetsAt },
                    { status: 429 }
                );
            }
        }
        const profile = await getUserProfile(ctx.uid).catch(() => null);
        return withUidCookie(
            NextResponse.json({
                user: {
                    uid: ctx.uid,
                    displayName: profile?.displayName ?? ctx.displayName,
                    google: profile?.google ?? null,
                },
                googleLoginAvailable: googleOAuthConfigured(),
            }),
            ctx
        );
    } catch (e) {
        return cfError(e);
    }
}
