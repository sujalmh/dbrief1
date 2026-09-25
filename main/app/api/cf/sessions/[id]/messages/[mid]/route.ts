import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited, cfOriginDenied, requireLinkedIdentity } from "@/lib/cf/route-util";
import { deleteMessage } from "@/lib/cf/store";

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; mid: string }> }
) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const { id, mid } = await params;
        await deleteMessage(ctx.uid, id, mid);
        return withUidCookie(NextResponse.json({ ok: true }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
