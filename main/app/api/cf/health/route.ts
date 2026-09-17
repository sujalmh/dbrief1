import { NextRequest, NextResponse } from "next/server";
import { cfIdentity, withUidCookie, cfError, cfLimited } from "@/lib/cf/route-util";
import { d1Query } from "@/lib/cf/d1";
import { r2PutJson, r2GetJson, r2Delete } from "@/lib/cf/r2";
import { cfConfigured } from "@/lib/cf/env";

export async function GET(req: NextRequest) {
    try {
        const ctx = await cfIdentity();
        const limited = cfLimited(req, ctx.uid, "read");
        if (limited) return withUidCookie(limited, ctx);
        if (!cfConfigured()) {
            return withUidCookie(
                NextResponse.json({ ok: false, configured: false, d1: false, r2: false }, { status: 200 }),
                ctx
            );
        }
        let d1 = false;
        let r2 = false;
        try {
            await d1Query(`SELECT 1 AS one`);
            d1 = true;
        } catch {
            d1 = false;
        }
        try {
            const key = "health/probe.json";
            await r2PutJson(key, { ok: true, at: Date.now() });
            const back = await r2GetJson<{ ok: boolean }>(key);
            await r2Delete(key);
            r2 = back?.ok === true;
        } catch {
            r2 = false;
        }
        return withUidCookie(NextResponse.json({ ok: d1 && r2, configured: true, d1, r2 }), ctx);
    } catch (e) {
        return cfError(e);
    }
}
