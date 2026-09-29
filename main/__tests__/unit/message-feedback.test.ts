/**
 * Tests for message feedback (thumbs up/down).
 * ============================================
 * The rating lives on the message (`feedback?: 'up' | 'down'`) so it
 * rides along with the existing cloud save path. These tests cover the
 * store semantics the bubble relies on: set, switch, clear, and
 * non-interference with streaming content updates.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/lib/store";

const base = { id: "m_fb", role: "assistant" as const, content: "hi", timestamp: 1 };

beforeEach(() => {
    useChatStore.setState({ messages: [] });
});

describe("setMessageFeedback", () => {
    it("sets a rating on a message", () => {
        useChatStore.setState({ messages: [{ ...base }] });
        useChatStore.getState().setMessageFeedback("m_fb", "up");
        expect(useChatStore.getState().messages.find((m) => m.id === "m_fb")?.feedback).toBe("up");
    });

    it("switches rating directly from up to down", () => {
        useChatStore.setState({ messages: [{ ...base, feedback: "up" as const }] });
        useChatStore.getState().setMessageFeedback("m_fb", "down");
        expect(useChatStore.getState().messages.find((m) => m.id === "m_fb")?.feedback).toBe("down");
    });

    it("clears the rating on null (toggle-off)", () => {
        useChatStore.setState({ messages: [{ ...base, feedback: "up" as const }] });
        useChatStore.getState().setMessageFeedback("m_fb", null);
        const stored = useChatStore.getState().messages.find((m) => m.id === "m_fb");
        expect(stored?.feedback).toBeUndefined();
        // The key drops out of serialized messages (stays optional).
        expect("feedback" in (stored ?? {})).toBe(false);
    });

    it("leaves other messages untouched", () => {
        useChatStore.setState({
            messages: [{ ...base }, { ...base, id: "m_other", feedback: "down" as const }],
        });
        useChatStore.getState().setMessageFeedback("m_fb", "up");
        expect(useChatStore.getState().messages.find((m) => m.id === "m_other")?.feedback).toBe("down");
    });

    it("survives streaming content updates (spread preserves it)", () => {
        useChatStore.setState({ messages: [{ ...base, feedback: "up" as const }] });
        useChatStore.getState().updateMessage("m_fb", "hi there");
        const stored = useChatStore.getState().messages.find((m) => m.id === "m_fb");
        expect(stored?.content).toBe("hi there");
        expect(stored?.feedback).toBe("up");
    });

    it("is a no-op for unknown ids", () => {
        useChatStore.setState({ messages: [{ ...base }] });
        useChatStore.getState().setMessageFeedback("m_missing", "up");
        expect(useChatStore.getState().messages).toHaveLength(1);
        expect(useChatStore.getState().messages[0]?.feedback).toBeUndefined();
    });
});
