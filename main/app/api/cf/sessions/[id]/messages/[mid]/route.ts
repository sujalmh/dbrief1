import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited, cfOriginDenied, cfBodyTooLarge, bodyBytes, CF_MAX_BODY_BYTES, readJson } from "@/lib/cf/route-util";
import { patchMessage, deleteMessage } from "@/lib/cf/store";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string; mid: string }> }
) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        if (cfBodyTooLarge(req)) {
            return withUidCookie(NextResponse.json({ error: "Payload too large" }, { status: 413 }), ctx);
        }
        const { id, mid } = await params;
        const body = (await readJson(req)) as { content?: string; data?: Record<string, unknown> };
        if (bodyBytes(body) > CF_MAX_BODY_BYTES) {
            return withUidCookie(NextResponse.json({ error: "Payload too large" }, { status: 413 }), ctx);
        }
        await patchMessage(ctx.uid, id, mid, {
            ...(body.content !== undefined ? { content: String(body.content) } : {}),
            ...(body.data && typeof body.data === "object" ? { data: body.data } : {}),
        });
        return withUidCookie(NextResponse.json({ ok: true }), ctx);
    } catch (e) {
        return cfError(e);
    }
}

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
        const { id, mid } = await params;
        await deleteMessage(ctx.uid, id, mid);
        return withUidCookie(NextResponse.json({ ok: true }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
