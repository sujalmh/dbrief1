/**
 * Message ordering (reload preserves user-above-assistant).
 * ===========================================================
 * Regression tests for the reload inversion: the persisted user copy
 * used to be re-stamped after session creation (seconds AFTER the
 * assistant placeholder), and ORDER BY timestamp broke ties arbitrarily
 * via the (session_id, timestamp) index — so reloads rendered the user
 * message below the AI response. Ordering is now insertion (rowid =
 * causal order; edits upsert in place, retries append) plus a single
 * timestamp shared by the optimistic bubble and its persisted copy.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("message ordering", () => {
    it("listMessages orders by insertion, never wall-clock", () => {
        const source = readSource("lib/cf/store.ts");
        expect(source).toMatch(/ORDER BY rowid ASC/);
        expect(source).not.toMatch(/ORDER BY timestamp ASC/);
        expect(source).toMatch(/idx_messages_session_rowid/);
    });

    it("share snapshots use the same insertion ordering", () => {
        const source = readSource("lib/cf/shares.ts");
        expect(source).toMatch(/ORDER BY rowid ASC/);
    });

    it("user turn shares one timestamp between bubble and persisted copy", () => {
        const source = readSource("lib/hooks/use-chat-handler.ts");
        expect(source).toMatch(/const userMsgTimestamp = Date\.now\(\)/);
        // Optimistic bubble ...
        expect(source).toMatch(/content: messageText,\s*timestamp: userMsgTimestamp/);
        // ... and persisted copy both use it (exactly twice, nowhere else).
        const uses = source.match(/timestamp: userMsgTimestamp/g) ?? [];
        expect(uses).toHaveLength(2);
        // No fresh Date.now() timestamp on the persisted user copy.
        expect(source).not.toMatch(/content: messageText,\s*timestamp: Date\.now\(\)/);
    });
});
