/**
 * GitHub alert callouts (`> [!NOTE]` …).
 * ======================================
 * Turns blockquotes whose first line is a GitHub alert marker into a
 * `dataAlert` hast property; the markdown renderer styles those as
 * colored callouts. Unknown markers are left untouched.
 */

import type { Root } from "mdast";
import { visit } from "unist-util-visit";

export const GITHUB_ALERT_KINDS = ["note", "tip", "important", "warning", "caution"] as const;

export type GithubAlertKind = (typeof GITHUB_ALERT_KINDS)[number];

const MARKER_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

export function remarkGithubAlerts() {
    return (tree: Root) => {
        visit(tree, "blockquote", (node, index, parent) => {
            const first = node.children[0];
            if (!first || first.type !== "paragraph") return;
            const text = first.children[0];
            if (!text || text.type !== "text") return;
            const match = MARKER_RE.exec(text.value);
            if (!match) return;
            const kind = (match[1] ?? "").toLowerCase();
            if (!(GITHUB_ALERT_KINDS as readonly string[]).includes(kind)) return;
            // Strip the marker line, keep the rest of the quote.
            text.value = text.value.slice(match[0].length);
            if (!text.value.trim() && first.children.length === 1) {
                node.children.splice(0, 1);
            }
            node.data = {
                ...node.data,
                hProperties: {
                    ...((node.data?.hProperties as Record<string, unknown> | undefined) ?? {}),
                    dataAlert: kind,
                },
            };
            void index;
            void parent;
        });
    };
}
