import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited } from "@/lib/cf/route-util";
import { resolveSharedSnapshot } from "@/lib/cf/shares";

/**
 * Public read of a shared chat snapshot.
 * ======================================
 * Deliberately NOT gated on Google sign-in: possession of the unguessable
 * token is access. Still rate-limited per caller and served over
 * same-origin fetch from the share page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    try {
        const ctx = await cfIdentity(req);
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        const { token } = await params;
        const snapshot = await resolveSharedSnapshot(token);
        const res = NextResponse.json(snapshot);
        // Shared snapshots are immutable per token+session state; keep
        // caches honest but short so revokes propagate quickly.
        res.headers.set("Cache-Control", "private, max-age=60");
        return withUidCookie(res, ctx);
    } catch (e) {
        return cfError(e);
    }
}
