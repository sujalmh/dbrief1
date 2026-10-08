"use client";

/**
 * Session resume loader (browser).
 * ================================
 * Single place that hydrates the client store from the cloud for a given
 * session id: messages (with steps/visualization/evidence/usage). Each
 * message owns its charts inline (t3code-style) — there is no panel UI
 * state to restore. Used both by the route shell (URL-driven session
 * changes) and any direct session picker. Throws on failure so callers
 * can render an error state.
 */

import { useChatStore } from "@/lib/store";
import { loadMessages, loadContext } from "@/lib/cf/client";

export async function loadSessionIntoStore(sessionId: string, shouldApply?: () => boolean): Promise<void> {
    const [messages] = await Promise.all([
        loadMessages(sessionId),
        // Load (and ignore) legacy session context for backward compat
        // with sessions saved by the old side-panel build. New sessions
        // carry no panel state — charts live on their messages.
        loadContext(sessionId).catch(() => ({})),
    ]);
    // A newer navigation may have superseded this load — never paint
    // stale messages over the current route's session.
    if (shouldApply && !shouldApply()) return;
    // Citations arrive pre-sanitized from loadMessages — no second pass.
    useChatStore.getState().setMessages(messages);
    // Re-learn driver colors from restored payloads so highlights are
    // season-correct even before any new query runs.
    try {
        const { learnColorsFromPayload } = await import("@/lib/f1-colors");
        for (const m of messages) {
            if (m.visualizationData) learnColorsFromPayload(m.visualizationData);
        }
    } catch {
        // Best-effort: static grid fallback still applies.
    }
}

/** Reset the store to a fresh composer (new chat). */
export function resetToFreshChat(): void {
    useChatStore.getState().setCurrentSessionId(null);
    useChatStore.getState().setMessages([]);
}
