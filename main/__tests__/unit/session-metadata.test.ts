/**
 * Tests for session title/type generation (mocked LLM, no network)
 * ==================================================================
 * Covers: the empty-completion retry (first attempt returns "", the
 * nudged retry returns JSON) and the graceful fallback when both
 * attempts come back empty.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();

// Mock only the model factory; keep the real chatContentToText so the
// empty-string path under test behaves exactly like production.
vi.mock("@/lib/llm", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/llm")>();
    return {
        ...orig,
        getChatModel: vi.fn(async () => ({ invoke: invokeMock })),
    };
});

import { generateSessionMetadata } from "@/lib/utils/generate-session-metadata";

function assistantMessage(content: unknown) {
    return { content, additional_kwargs: {} };
}

describe("generateSessionMetadata", () => {
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        invokeMock.mockReset();
        consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    it("recovers when the first attempt is empty and the retry returns JSON", async () => {
        invokeMock
            .mockResolvedValueOnce(assistantMessage(""))
            .mockResolvedValueOnce(
                assistantMessage('{"title": "Monaco 2024 Laps", "type": "telemetry"}')
            );
        const meta = await generateSessionMetadata("Show Verstappen's laps in Monaco 2024");
        expect(meta).toEqual({ title: "Monaco 2024 Laps", type: "telemetry" });
        expect(invokeMock).toHaveBeenCalledTimes(2);
        // The retry carries a stricter JSON-only nudge, not an identical prompt.
        expect(invokeMock.mock.calls[1][0]).toContain("ONLY the JSON object");
        expect(consoleError).not.toHaveBeenCalled();
    });

    it("falls back to the raw query when both attempts are empty", async () => {
        invokeMock
            .mockResolvedValueOnce(assistantMessage(""))
            .mockResolvedValueOnce(assistantMessage("   "));
        const meta = await generateSessionMetadata(
            "Who won the most recent Grand Prix?"
        );
        expect(meta.type).toBe("insights");
        expect(meta.title).toContain("Who won");
        expect(invokeMock).toHaveBeenCalledTimes(2);
        // The diagnostic log carries the mode and a content preview so
        // the next occurrence is a one-line diagnosis, not a mystery.
        expect(consoleError).toHaveBeenCalledTimes(1);
        const [, loggedError, context] = consoleError.mock.calls[0];
        expect(String(loggedError)).toContain("Empty LLM response");
        expect(context).toMatchObject({ mode: "managed" });
        expect(typeof (context as { contentPreview?: unknown }).contentPreview).toBe("string");
    });
});
