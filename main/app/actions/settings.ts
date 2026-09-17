"use server"

import { cookies } from "next/headers"

export async function saveApiKeyAction(key: string) {
    // Next.js 15+ made cookies() async; await it before calling methods so
    // the action works on both Next 14 (sync) and Next 15+ (async).
    const cookieStore = await cookies()
    if (!key) {
        cookieStore.delete("api_key")
        return { success: true }
    }

    // Simple validation based on common prefixes, could be expanded.
    // H5: reject overlong values to bound cookie/header size.
    if (key.length < 10) {
        return { success: false, error: "API key is too short" }
    }
    if (key.length > 512 || /[\s\r\n]/.test(key)) {
        return { success: false, error: "API key format is invalid" }
    }

    cookieStore.set("api_key", key, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        // H5: 7-day retention (was 30) to shrink the exposure window.
        // Never log or return this value; `hasApiKeyAction` only reveals presence.
        maxAge: 60 * 60 * 24 * 7
    })

    return { success: true }
}

export async function hasApiKeyAction() {
    const cookieStore = await cookies()
    return cookieStore.has("api_key")
}
