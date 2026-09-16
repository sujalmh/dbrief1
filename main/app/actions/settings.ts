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

    // Simple validation based on common prefixes, could be expanded
    if (key.length < 10) {
        return { success: false, error: "API key is too short" }
    }

    cookieStore.set("api_key", key, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 60 * 24 * 30 // 30 days
    })

    return { success: true }
}

export async function hasApiKeyAction() {
    const cookieStore = await cookies()
    return cookieStore.has("api_key")
}
