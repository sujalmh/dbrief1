/**
 * Feedback + contact API (Cloudflare D1).
 * ========================================
 * POST: any Google-linked identity saves first-response ratings,
 * message ratings, or contact messages.
 * GET: admins only (ADMIN_UIDS) — aggregate stats + latest items for
 * the /admin analysis page.
 */

import { NextRequest, NextResponse } from "next/server";
import {
    cfIdentity,
    withUidCookie,
    cfError,
    cfLimited,
    cfOriginDenied,
    requireLinkedIdentity,
    readJson,
} from "@/lib/cf/route-util";
import { saveFeedback, listFeedback, feedbackStats, validateFeedbackInput, type FeedbackKind } from "@/lib/cf/feedback";
import { isAdmin } from "@/lib/cf/quotas";

export async function POST(req: NextRequest) {
    try {
        const ctx = await cfIdentity();
        const originDenied = cfOriginDenied(req);
        if (originDenied) return withUidCookie(originDenied, ctx);
        const limited = cfLimited(req, ctx.uid, "write");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        const body = (await readJson(req)) as {
            kind?: unknown;
            rating?: unknown;
            subject?: unknown;
            message?: unknown;
            sessionId?: unknown;
            messageId?: unknown;
        };
        const validated = validateFeedbackInput(body);
        if (!validated.ok) {
            return withUidCookie(NextResponse.json({ error: validated.error }, { status: 400 }), ctx);
        }
        const id = await saveFeedback(ctx.uid, validated.value);
        return withUidCookie(NextResponse.json({ id }, { status: 201 }), ctx);
    } catch (e) {
        return cfError(e);
    }
}

export async function GET(req: NextRequest) {
    try {
        const ctx = await cfIdentity();
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        const linked = await requireLinkedIdentity(ctx.uid);
        if (linked) return withUidCookie(linked, ctx);
        if (!isAdmin(ctx.uid)) {
            return withUidCookie(NextResponse.json({ error: "Not authorized.", code: "forbidden" }, { status: 403 }), ctx);
        }
        const kindParam = new URL(req.url).searchParams.get("kind");
        const kind = kindParam === "first_response" || kindParam === "message" || kindParam === "contact"
            ? (kindParam as FeedbackKind)
            : undefined;
        const [stats, items] = await Promise.all([feedbackStats(), listFeedback({ limit: 100, kind })]);
        return withUidCookie(NextResponse.json({ stats, items }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
