import { NextResponse } from "next/server";
import { clearUidCookieHeader } from "@/lib/cf/session";

export async function POST() {
    const res = NextResponse.json({ ok: true });
    res.headers.set("Set-Cookie", clearUidCookieHeader());
    return res;
}
