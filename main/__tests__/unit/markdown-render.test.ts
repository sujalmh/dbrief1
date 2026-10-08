/**
 * Markdown render helpers: alerts, fence meta, table serializers.
 * =================================================================
 * Pure unit tests — plugins run against hand-built mdast trees, no
 * parser or DOM needed except for the table serializers (lightweight
 * document-created tables).
 */

import { describe, it, expect } from "vitest";
import type { Root } from "mdast";
import { remarkGithubAlerts, GITHUB_ALERT_KINDS } from "@/lib/markdown/alerts";
import {
    serializeTableElementToMarkdown,
    serializeTableElementToCsv,
} from "@/lib/markdown/tables";

function blockquote(paragraphs: string[]): Root {
    return {
        type: "root",
        children: [
            {
                type: "blockquote",
                children: paragraphs.map((text) => ({
                    type: "paragraph",
                    children: [{ type: "text", value: text }],
                })),
            },
        ],
    };
}

// =============================================================================
// GitHub alerts
// =============================================================================

describe("remarkGithubAlerts", () => {
    it.each(GITHUB_ALERT_KINDS.map((k) => [k] as const))("tags [!(%s)] quotes", (kind) => {
        const upper = kind.toUpperCase();
        const tree = blockquote([`[!${upper}] Watch out`, "second line"]);
        remarkGithubAlerts()(tree);
        const quote = tree.children[0];
        expect(quote?.type).toBe("blockquote");
        if (quote?.type === "blockquote") {
            expect((quote.data?.hProperties as Record<string, unknown> | undefined)?.dataAlert).toBe(kind);
            const first = quote.children[0];
            expect(first?.type).toBe("paragraph");
        }
    });

    it("strips the marker line, keeps the rest", () => {
        const tree = blockquote(["[!NOTE] Heads up"]);
        remarkGithubAlerts()(tree);
        const quote = tree.children[0];
        expect(quote?.type).toBe("blockquote");
        if (quote?.type !== "blockquote") return;
        const para = quote.children[0];
        expect(para?.type).toBe("paragraph");
        if (para?.type !== "paragraph") return;
        const text = para.children[0];
        expect(text?.type).toBe("text");
        if (text?.type !== "text") return;
        expect(text.value).toBe("Heads up");
    });

    it("leaves ordinary quotes and unknown markers alone", () => {
        const plain = blockquote(["Just a quote"]);
        remarkGithubAlerts()(plain);
        const quote = plain.children[0];
        expect(quote?.type).toBe("blockquote");
        if (quote?.type !== "blockquote") return;
        expect(quote.data).toBeUndefined();

        const unknown = blockquote(["[!FUN] party"]);
        remarkGithubAlerts()(unknown);
        const quote2 = unknown.children[0];
        if (quote2?.type !== "blockquote") return;
        expect(quote2.data).toBeUndefined();
    });
});

// =============================================================================
// Fence meta
// =============================================================================
// NOTE: fenced-code filename headers were removed — code embeds don't fit
// the F1 app. Plain <pre> rendering needs no helpers.

// =============================================================================
// Table serializers
// =============================================================================

/** Structural table fake (node env has no DOM) — serializers only read rows/cells/textContent. */
function makeTable(headers: string[], rows: string[][]): HTMLTableElement {
    const row = (cells: string[]) => ({
        cells: cells.map((textContent) => ({ textContent })),
    });
    return {
        rows: [row(headers), ...rows.map(row)],
    } as unknown as HTMLTableElement;
}

describe("table serializers", () => {
    it("serializes to GFM markdown with separator row", () => {
        const table = makeTable(["Driver", "Points"], [["VER", "437"], ["NOR", "374"]]);
        expect(serializeTableElementToMarkdown(table)).toBe(
            "| Driver | Points |\n| --- | --- |\n| VER | 437 |\n| NOR | 374 |"
        );
    });

    it("serializes to CSV with RFC-4180 quoting", () => {
        const table = makeTable(["Driver", "Note"], [["VER", 'fast, "clean" race']]);
        expect(serializeTableElementToCsv(table)).toBe('Driver,Note\nVER,"fast, ""clean"" race"');
    });

    it("pads ragged rows and handles empty tables", () => {
        const table = makeTable(["A", "B"], [["x"]]);
        expect(serializeTableElementToMarkdown(table)).toBe("| A | B |\n| --- | --- |\n| x |  |");
        const empty = { rows: [] } as unknown as HTMLTableElement;
        expect(serializeTableElementToMarkdown(empty)).toBe("");
        expect(serializeTableElementToCsv(empty)).toBe("");
    });
});
