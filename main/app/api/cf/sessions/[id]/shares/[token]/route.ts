import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited, cfOriginDenied, requireLinkedIdentity } from "@/lib/cf/route-util";
import { revokeShareLink } from "@/lib/cf/shares";

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; token: string }> }
) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const { token } = await params;
        await revokeShareLink(ctx.uid, token);
        return withUidCookie(NextResponse.json({ ok: true }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
