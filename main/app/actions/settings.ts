"use server";

import { cookies } from "next/headers";

const BYOK_COOKIE = "byok_api_key";
const LEGACY_COOKIE = "api_key";

function cookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict" as const,
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30 days
    };
}

/**
 * Save the user's BYOK API key to an httpOnly cookie.
 * The key never touches localStorage/IndexedDB — the browser sends it
 * automatically and the chat route reads it server-side.
 */
export async function saveByokKeyAction(key: string) {
    const cookieStore = await cookies();
    if (!key) {
        cookieStore.delete(BYOK_COOKIE);
        cookieStore.delete(LEGACY_COOKIE);
        return { success: true };
    }

    if (key.length < 10) {
        return { success: false, error: "API key is too short" };
    }

    cookieStore.set(BYOK_COOKIE, key, cookieOptions());

    return { success: true };
}

export async function hasByokKeyAction() {
    const cookieStore = await cookies();
    return cookieStore.has(BYOK_COOKIE) || cookieStore.has(LEGACY_COOKIE);
}

export async function clearByokKeyAction() {
    const cookieStore = await cookies();
    cookieStore.delete(BYOK_COOKIE);
    cookieStore.delete(LEGACY_COOKIE);
    return { success: true };
}

// --- Deprecated aliases (pre two-mode simplification) ---
// Kept so any lingering imports don't break during the transition.

/** @deprecated Use saveByokKeyAction instead. */
export async function saveApiKeyAction(key: string) {
    return saveByokKeyAction(key);
}

/** @deprecated Use hasByokKeyAction instead. */
export async function hasApiKeyAction() {
    return hasByokKeyAction();
}
