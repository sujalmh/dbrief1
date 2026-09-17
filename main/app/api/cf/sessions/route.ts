import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited, cfOriginDenied, requireLinkedIdentity, readJson } from "@/lib/cf/route-util";
import { listSessions, createSession } from "@/lib/cf/store";

export async function GET(req: NextRequest) {
    try {
        const ctx = await cfIdentity();
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const sessions = await listSessions(ctx.uid);
        return withUidCookie(NextResponse.json({ sessions }), ctx);
    } catch (e) {
        return cfError(e);
    }
}

export async function POST(req: NextRequest) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const body = (await readJson(req)) as { title?: string; type?: string };
        const id = await createSession(
            ctx.uid,
            typeof body.title === "string" && body.title ? body.title : "New Chat",
            typeof body.type === "string" ? body.type : undefined
        );
        return withUidCookie(NextResponse.json({ id }, { status: 201 }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
