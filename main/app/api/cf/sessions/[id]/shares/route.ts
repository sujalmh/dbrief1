import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited, cfOriginDenied, requireLinkedIdentity } from "@/lib/cf/route-util";
import { createShareLink, listShareLinks } from "@/lib/cf/shares";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await cfIdentity();
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const { id } = await params;
        const links = await listShareLinks(ctx.uid, id);
        return withUidCookie(NextResponse.json({ links }), ctx);
    } catch (e) {
        return cfError(e);
    }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const { id } = await params;
        const link = await createShareLink(ctx.uid, id);
        return withUidCookie(NextResponse.json(link, { status: 201 }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
