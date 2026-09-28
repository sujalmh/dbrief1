"use client";

/**
 * Session resume loader (browser).
 * ================================
 * Single place that hydrates the client store from the cloud for a given
 * session id: messages (with steps/visualization/evidence/usage) plus
 * session-level UI (panel data, active message). Used both by the route
 * shell (URL-driven session changes) and any direct session picker.
 * Throws on failure so callers can render an error state.
 */

import { useChatStore } from "@/lib/store";
import { loadMessages, loadContext } from "@/lib/cf/client";

export async function loadSessionIntoStore(sessionId: string, shouldApply?: () => boolean): Promise<void> {
    const [messages, ui] = await Promise.all([
        loadMessages(sessionId),
        loadContext(sessionId),
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
    // Restore panel + active message. Fall back to the latest message's
    // visualization when no UI state was ever saved (pre-existing sessions).
    type StoreState = ReturnType<typeof useChatStore.getState>;
    const activeId =
        ui.activeMessageId ??
        messages.filter((m) => m.role === "assistant").slice(-1)[0]?.id ??
        null;
    const activeMsg = messages.find((m) => m.id === activeId);
    const panelData =
        ui.visualizationData ?? activeMsg?.chartSpecs ?? activeMsg?.visualizationData ?? null;
    useChatStore.setState({
        visualizationData: (panelData ?? null) as StoreState["visualizationData"],
        activeMessageId: activeId,
    });
}

/** Reset the store to a fresh composer (new chat). */
export function resetToFreshChat(): void {
    useChatStore.getState().setCurrentSessionId(null);
    useChatStore.getState().setMessages([]);
    useChatStore.setState({ visualizationData: null, activeMessageId: null });
}
