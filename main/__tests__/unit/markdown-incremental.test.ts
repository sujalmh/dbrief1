/**
 * Incremental markdown parsing (streaming fast path).
 * =====================================================
 * The plugin must produce trees identical to a full parse while only
 * parsing the appended suffix after a closed-fence boundary. Uses a real
 * unified + remark-parse processor — no react rendering involved.
 */

import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { createIncrementalMarkdownPlugin } from "@/lib/markdown/incremental";

function fullParse(markdown: string): string {
    const tree = unified().use(remarkParse).parse(markdown);
    return JSON.stringify(tree);
}

/** One processor reused across parses so the plugin cache persists. */
function streamingProcessor() {
    return unified().use(remarkParse).use(createIncrementalMarkdownPlugin());
}

const PREFIX =
    "# Race\n\nSome intro text here.\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\n";

describe("createIncrementalMarkdownPlugin", () => {
    it("matches a full parse for appended suffixes", () => {
        const processor = streamingProcessor();
        const first = PREFIX + "Hello";
        processor.parse(first);
        const extended = first + " world, this is more text.";
        const incremental = JSON.stringify(processor.parse(extended));
        expect(incremental).toBe(fullParse(extended));
    });

    it("tracks multi-step streaming growth", () => {
        const processor = streamingProcessor();
        const steps = [PREFIX + "a", PREFIX + "a b", PREFIX + "a b\n\nMore.\n\n```py\nx=1\n"];
        let last = "";
        for (const step of steps) {
            last = JSON.stringify(processor.parse(step));
        }
        expect(last).toBe(fullParse(steps[steps.length - 1]!));
    });

    it("falls back to full parse for unrelated documents", () => {
        const processor = streamingProcessor();
        processor.parse(PREFIX + "done");
        const other = "# Totally different\n\nNo fences here.";
        expect(JSON.stringify(processor.parse(other))).toBe(fullParse(other));
    });

    it("falls back on carriage returns and definitions", () => {
        const processor = streamingProcessor();
        processor.parse(PREFIX + "done");
        const withCR = PREFIX + "line\r\nbreak";
        expect(JSON.stringify(processor.parse(withCR))).toBe(fullParse(withCR));
        const withDef = "[link]: https://example.com\n\nSome [link] text.";
        expect(JSON.stringify(processor.parse(withDef))).toBe(fullParse(withDef));
    });

    it("keeps source offsets correct after the boundary", () => {
        const processor = streamingProcessor();
        const first = PREFIX + "Hello";
        processor.parse(first);
        const extended = first + " world";
        const tree = processor.parse(extended);
        const last = tree.children[tree.children.length - 1];
        // Appending text extends the paragraph in place — its start stays
        // where "Hello" began and the merged text is complete.
        expect(last?.position?.start.offset).toBe(first.length - "Hello".length);
        expect(last?.type).toBe("paragraph");
        if (last?.type !== "paragraph") return;
        const text = last.children[0];
        expect(text?.type).toBe("text");
        if (text?.type !== "text") return;
        expect(text.value).toBe("Hello world");
    });
});
