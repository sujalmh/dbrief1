/**
 * Feedback + contact + admin analysis
 * =====================================
 * Covers the full loop without D1 or LLM calls:
 *
 *   - validateFeedbackInput: kinds, ratings, lengths (pure).
 *   - shouldPromptFirstFeedback: exactly-once first-answer trigger.
 *   - Store: popup flags default off, setters work.
 *   - Wiring (source checks): settings Contact section, feedback dialog,
 *     shell mount, handler trigger, API routes, client wrappers, admin page.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { validateFeedbackInput } from "@/lib/cf/feedback";
import { shouldPromptFirstFeedback, FIRST_FEEDBACK_DELAY_MS } from "@/lib/feedback";
import { useChatStore } from "@/lib/store";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

// =============================================================================
// Validation
// =============================================================================

describe("validateFeedbackInput", () => {
    it("accepts a first-response rating with optional comment", () => {
        const out = validateFeedbackInput({ kind: "first_response", rating: 5, message: "Great!" });
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.value).toMatchObject({ kind: "first_response", rating: 5, message: "Great!" });
        }
    });

    it("rejects unknown kinds", () => {
        expect(validateFeedbackInput({ kind: "spam" }).ok).toBe(false);
        expect(validateFeedbackInput({}).ok).toBe(false);
    });

    it("requires a rating for first_response", () => {
        expect(validateFeedbackInput({ kind: "first_response" }).ok).toBe(false);
        expect(validateFeedbackInput({ kind: "first_response", rating: null }).ok).toBe(false);
    });

    it("rejects out-of-range and non-integer ratings", () => {
        for (const rating of [0, 6, 2.5, "high", NaN]) {
            const out = validateFeedbackInput({ kind: "message", rating });
            expect(out.ok, `rating ${String(rating)}`).toBe(false);
        }
        expect(validateFeedbackInput({ kind: "message", rating: "4" }).ok).toBe(true);
    });

    it("rating is optional outside first_response", () => {
        expect(validateFeedbackInput({ kind: "contact", message: "Hi" }).ok).toBe(true);
        expect(validateFeedbackInput({ kind: "message" }).ok).toBe(true);
    });

    it("requires a message for contact", () => {
        expect(validateFeedbackInput({ kind: "contact" }).ok).toBe(false);
        expect(validateFeedbackInput({ kind: "contact", message: "   " }).ok).toBe(false);
    });

    it("trims and caps lengths", () => {
        const out = validateFeedbackInput({
            kind: "contact",
            subject: `  ${"s".repeat(200)}  `,
            message: `  ${"m".repeat(5000)}  `,
            sessionId: "s_" + "x".repeat(300),
        });
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.value.subject).toHaveLength(120);
            expect(out.value.message).toHaveLength(2000);
            expect(out.value.sessionId).toHaveLength(128);
        }
    });
});

// =============================================================================
// Trigger
// =============================================================================

describe("shouldPromptFirstFeedback", () => {
    it("fires exactly once for the first completed answer", () => {
        expect(
            shouldPromptFirstFeedback({ prompted: false, assistantCount: 1, isError: false, hasContent: true })
        ).toBe(true);
    });

    it("popup delay lands in the 10-15s reading window", () => {
        expect(FIRST_FEEDBACK_DELAY_MS).toBeGreaterThanOrEqual(10_000);
        expect(FIRST_FEEDBACK_DELAY_MS).toBeLessThanOrEqual(15_000);
    });

    it("never fires twice, on errors, on empty content, or on later turns", () => {
        const base = { prompted: false, assistantCount: 1, isError: false, hasContent: true };
        expect(shouldPromptFirstFeedback({ ...base, prompted: true })).toBe(false);
        expect(shouldPromptFirstFeedback({ ...base, isError: true })).toBe(false);
        expect(shouldPromptFirstFeedback({ ...base, hasContent: false })).toBe(false);
        expect(shouldPromptFirstFeedback({ ...base, assistantCount: 0 })).toBe(false);
        expect(shouldPromptFirstFeedback({ ...base, assistantCount: 2 })).toBe(false);
    });
});

// =============================================================================
// Store flags
// =============================================================================

describe("feedback popup store flags", () => {
    it("defaults to closed and unprompted", () => {
        const state = useChatStore.getState();
        expect(state.isFeedbackOpen).toBe(false);
        expect(state.feedbackPrompted).toBe(false);
    });

    it("setFeedbackOpen + markFeedbackPrompted work", () => {
        useChatStore.getState().setFeedbackOpen(true);
        expect(useChatStore.getState().isFeedbackOpen).toBe(true);
        useChatStore.getState().setFeedbackOpen(false);
        useChatStore.getState().markFeedbackPrompted();
        expect(useChatStore.getState().feedbackPrompted).toBe(true);
        // Reset so other tests start clean.
        useChatStore.setState({ feedbackPrompted: false, isFeedbackOpen: false });
    });
});

// =============================================================================
// Wiring
// =============================================================================

describe("feedback + contact + admin wiring", () => {
    it("contact lives in the profile modal (not settings), saving to the cloud", () => {
        const profile = readSource("components/profile/profile-modal.tsx");
        expect(profile).toMatch(/Contact/);
        expect(profile).toMatch(/ContactForm/);
        expect(profile).toMatch(/Settings/);
        expect(profile).toMatch(/Logout/);
        expect(profile).toMatch(/signOut\(\)/);
        const contact = readSource("components/profile/contact-form.tsx");
        expect(contact).toMatch(/saveFeedback\(\{/);
        expect(contact).toMatch(/kind: "contact"/);
        const settings = readSource("components/chat/settings-modal.tsx");
        expect(settings).not.toMatch(/contactMessage/);
        expect(settings).not.toMatch(/ContactForm/);
    });

    it("settings modal keeps the admin-gated analysis link", () => {
        const settings = readSource("components/chat/settings-modal.tsx");
        expect(settings).toMatch(/\/admin/);
        expect(settings).toMatch(/user\?\.isAdmin/);
    });

    it("navbar avatar opens the profile modal (all sizes)", () => {
        const header = readSource("components/layout/header.tsx");
        expect(header).toMatch(/ProfileModal/);
        expect(header).toMatch(/profile-modal/);
        expect(header).toMatch(/setProfileOpen\(true\)/);
        expect(header).toMatch(/avatarUrl/);
    });

    it("phone navbar: logo + sidebar toggle, icon buttons desktop-only", () => {
        const header = readSource("components/layout/header.tsx");
        expect(header).toMatch(/LogoBadge/);
        expect(header).toMatch(/onBackground/);
        expect(header).toMatch(/setSidebarOpen\(!isSidebarOpen\)/);
        expect(header).toMatch(/md:hidden/);
        expect(header).toMatch(/hidden items-center.*md:flex/);
    });

    it("profile modal holds settings, share, about, contact, logout", () => {
        const profile = readSource("components/profile/profile-modal.tsx");
        expect(profile).toMatch(/Settings/);
        expect(profile).toMatch(/Share session/);
        expect(profile).toMatch(/About/);
        expect(profile).toMatch(/InfoModal/);
        expect(profile).toMatch(/ShareDialog/);
        expect(profile).toMatch(/Logout/);
    });

    it("feedback dialog collects stars + comment and saves first_response", () => {
        const source = readSource("components/chat/feedback-dialog.tsx");
        expect(source).toMatch(/isFeedbackOpen/);
        expect(source).toMatch(/kind: "first_response"/);
        expect(source).toMatch(/role="radiogroup"/);
        expect(source).toMatch(/saveFeedback\(/);
        expect(source).toMatch(/Skip/);
    });

    it("chat shell mounts the feedback dialog", () => {
        const source = readSource("components/chat/chat-shell.tsx");
        expect(source).toMatch(/FeedbackDialog/);
        expect(source).toMatch(/feedback-dialog/);
    });

    it("chat handler schedules the popup after a reading delay", () => {
        const source = readSource("lib/hooks/use-chat-handler.ts");
        expect(source).toMatch(/shouldPromptFirstFeedback/);
        expect(source).toMatch(/markFeedbackPrompted\(\)/);
        expect(source).toMatch(/setTimeout\(\(\) => \{\s*useChatStore\.getState\(\)\.setFeedbackOpen\(true\);\s*\}, FIRST_FEEDBACK_DELAY_MS\)/);
        expect(source).toMatch(/FIRST_FEEDBACK_DELAY_MS/);
    });

    it("feedback API writes for linked users, reads for admins only", () => {
        const source = readSource("app/api/cf/feedback/route.ts");
        expect(source).toMatch(/export async function POST/);
        expect(source).toMatch(/export async function GET/);
        expect(source).toMatch(/requireLinkedIdentity/);
        expect(source).toMatch(/isAdmin\(ctx\.uid\)/);
        expect(source).toMatch(/status: 403/);
        expect(source).toMatch(/validateFeedbackInput/);
        const store = readSource("lib/cf/feedback.ts");
        expect(store).toMatch(/CREATE TABLE IF NOT EXISTS feedback/);
        expect(store).toMatch(/feedbackStats/);
        expect(store).toMatch(/listFeedback/);
    });

    it("client exposes save + admin load wrappers", async () => {
        const source = readSource("lib/cf/client.ts");
        expect(source).toMatch(/export function saveFeedback/);
        expect(source).toMatch(/export async function loadFeedback/);
        expect(source).toMatch(/CfForbiddenError/);
        const client = await import("@/lib/cf/client");
        expect(typeof client.saveFeedback).toBe("function");
        expect(typeof client.loadFeedback).toBe("function");
    });

    it("identity carries the admin flag", () => {
        const me = readSource("app/api/cf/me/route.ts");
        expect(me).toMatch(/isAdmin\(ctx\.uid\)/);
        const ctx = readSource("lib/cf/session-context.tsx");
        expect(ctx).toMatch(/isAdmin\?: boolean/);
    });

    it("admin page renders stats, distribution, and items (locked otherwise)", () => {
        const source = readSource("app/admin/page.tsx");
        expect(source).toMatch(/Feedback analysis/);
        expect(source).toMatch(/Avg rating/);
        expect(source).toMatch(/Rating distribution/);
        expect(source).toMatch(/last 7 days/i);
        expect(source).toMatch(/Not authorized/);
        expect(source).toMatch(/loadFeedback\(/);
    });
});
