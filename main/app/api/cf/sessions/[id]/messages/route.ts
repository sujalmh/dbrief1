import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited, cfOriginDenied, cfBodyTooLarge, bodyBytes, CF_MAX_BODY_BYTES, readJson } from "@/lib/cf/route-util";
import { listMessages, upsertMessage, clearMessages } from "@/lib/cf/store";
import type { Message } from "@/lib/store";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await cfIdentity();
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        const { id } = await params;
        const messages = await listMessages(ctx.uid, id);
        return withUidCookie(NextResponse.json({ messages }), ctx);
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
        if (cfBodyTooLarge(req)) {
            return withUidCookie(NextResponse.json({ error: "Payload too large" }, { status: 413 }), ctx);
        }
        const { id } = await params;
        const body = (await readJson(req)) as { message?: Message };
        if (bodyBytes(body) > CF_MAX_BODY_BYTES) {
            return withUidCookie(NextResponse.json({ error: "Payload too large" }, { status: 413 }), ctx);
        }
        if (!body.message || !body.message.id || !body.message.role) {
            return NextResponse.json({ error: "Invalid message" }, { status: 400 });
        }
        const savedId = await upsertMessage(ctx.uid, id, body.message);
        return withUidCookie(NextResponse.json({ ok: true, id: savedId }), ctx);
    } catch (e) {
        return cfError(e);
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        const { id } = await params;
        await clearMessages(ctx.uid, id);
        return withUidCookie(NextResponse.json({ ok: true }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
