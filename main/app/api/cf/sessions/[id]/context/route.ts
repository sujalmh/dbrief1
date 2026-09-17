import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited, cfOriginDenied, cfBodyTooLarge, bodyBytes, CF_MAX_BODY_BYTES, requireLinkedIdentity, readJson } from "@/lib/cf/route-util";
import { getSessionContext, setSessionContext } from "@/lib/cf/store";
import type { SessionUIState } from "@/lib/cf/serialization";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await cfIdentity();
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const { id } = await params;
        const context = await getSessionContext(ctx.uid, id);
        return withUidCookie(NextResponse.json({ context }), ctx);
    } catch (e) {
        return cfError(e);
    }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        if (cfBodyTooLarge(req)) {
            return withUidCookie(NextResponse.json({ error: "Payload too large" }, { status: 413 }), ctx);
        }
        const { id } = await params;
        const body = (await readJson(req)) as { context?: SessionUIState };
        if (bodyBytes(body) > CF_MAX_BODY_BYTES) {
            return withUidCookie(NextResponse.json({ error: "Payload too large" }, { status: 413 }), ctx);
        }
        await setSessionContext(ctx.uid, id, (body.context && typeof body.context === "object" ? body.context : {}) as SessionUIState);
        return withUidCookie(NextResponse.json({ ok: true }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
