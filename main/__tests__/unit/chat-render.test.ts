/**
 * Chat rendering: markdown upgrades + follow-model scroll.
 * ==========================================================
 * Source-level wiring checks (repo convention): the bubble must use the
 * incremental parser, alert/code-meta plugins, framed code blocks, table
 * copy actions, favicon links, streaming flags and user line-breaks —
 * and the list must follow the live edge with a jump pill instead of
 * yanking on completion.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("message-bubble markdown upgrades", () => {
    const source = readSource("components/chat/message-bubble.tsx");

    it("parses incrementally while streaming code", () => {
        expect(source).toMatch(/createIncrementalMarkdownPlugin/);
        expect(source).toMatch(/incrementalPlugin/);
        expect(source).toMatch(/content\.includes\("```"\)/);
    });

    it("supports alerts and break-tolerant remark plugins", () => {
        expect(source).toMatch(/remarkGithubAlerts/);
        expect(source).toMatch(/remarkBreaks/);
        expect(source).toMatch(/lineBreaks/);
    });

    it("keeps alert metadata through sanitization", () => {
        expect(source).toMatch(/rehypeSanitizeSchema/);
        expect(source).not.toMatch(/dataCodeMeta/);
        expect(source).toMatch(/dataAlert/);
    });

    it("renders alert callouts and native collapsibles", () => {
        expect(source).toMatch(/GITHUB_ALERT_STYLES/);
        expect(source).toMatch(/role="note"/);
        expect(source).toMatch(/<details/);
    });

    it("gives tables copy actions and links favicons", () => {
        expect(source).toMatch(/function TableBlock/);
        expect(source).toMatch(/serializeTableElementToMarkdown/);
        expect(source).toMatch(/serializeTableElementToCsv/);
        expect(source).toMatch(/favicons\?domain=/);
    });

    it("threads streaming state and user line-breaks into content", () => {
        expect(source).toMatch(/isStreaming\?/);
        expect(source).toMatch(/data-streaming/);
        expect(source).toMatch(/lineBreaks=\{isUser\}/);
    });

    it("keeps the inline-charts wiring untouched", () => {
        expect(source).toMatch(/<InlineCharts/);
        expect(source).toMatch(/messageId=\{message\.id\}/);
        expect(source).toMatch(/isStreaming=\{isStreaming\}/);
        expect(source).not.toMatch(/handleShowChart/);
    });
});

describe("message-list follow model", () => {
    const source = readSource("components/chat/message-list.tsx");

    it("follows only at the end band, never yanks", () => {
        expect(source).toMatch(/computeIsAtEnd/);
        expect(source).toMatch(/shouldAutoFollow/);
        expect(source).toMatch(/isAtEndRef/);
        expect(source).not.toMatch(/prevLoadingRef/);
        expect(source).not.toMatch(/scrollIntoView\(\{ behavior: "smooth" \}\)/);
    });

    it("shows a jump pill off-bottom with reduced-motion respect", () => {
        expect(source).toMatch(/showPill/);
        expect(source).toMatch(/Jump to latest message/);
        expect(source).toMatch(/resolveJumpBehavior/);
        expect(source).toMatch(/prefers-reduced-motion/);
        expect(source).toMatch(/passive: true/);
    });

    it("finds the shell scroller without prop drilling", () => {
        expect(source).toMatch(/data-chat-scroll/);
        const shell = readSource("components/chat/chat-shell.tsx");
        expect(shell).toMatch(/data-chat-scroll/);
    });
});
