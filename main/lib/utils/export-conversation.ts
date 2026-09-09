/**
 * Conversation Export
 * ===================
 * Serialize a chat session to Markdown or JSON for download or sharing.
 * Keeps export logic out of the React layer so it can be unit-tested
 * and reused from server actions if we ever want server-side export.
 */

import type { Message } from "@/lib/store";
import { citationHref } from "@/lib/utils";

export type ExportFormat = "markdown" | "json";

export interface ExportOptions {
    /**
     * Title used for the document and as the default filename.
     * If omitted, falls back to "conversation" / a timestamp.
     */
    title?: string;
    /**
     * ISO 8601 timestamp to embed in the export. Defaults to now.
     */
    generatedAt?: string;
    /**
     * When true (default), pretty-print JSON with 2-space indentation.
     */
    prettyJson?: boolean;
}

const DEFAULT_TITLE = "F1 Telemetry Conversation";

/**
 * Build a Markdown representation of the given messages. Reasoning, steps,
 * iterations, evidence, reflections, and confidence are rendered as nested
 * sections so the exported file mirrors the on-screen experience.
 */
export function exportToMarkdown(
    messages: Message[],
    options: ExportOptions = {}
): string {
    const title = options.title?.trim() || DEFAULT_TITLE;
    const generatedAt = options.generatedAt || new Date().toISOString();
    const lines: string[] = [];

    lines.push(`# ${title}`);
    lines.push("");
    lines.push(`*Generated: ${generatedAt}*`);
    lines.push(`*Messages: ${messages.length}*`);
    lines.push("");

    messages.forEach((msg, idx) => {
        const role = msg.role === "user" ? "User" : "Race Engineer";
        const ts = new Date(msg.timestamp).toISOString();
        lines.push(`## ${idx + 1}. ${role} (${ts})`);
        lines.push("");

        if (msg.role === "assistant" && msg.isError) {
            lines.push("> ⚠️ **Error response**");
            lines.push("");
        }

        if (msg.content) {
            lines.push(msg.content.trim());
            lines.push("");
        }

        // Reasoning (chain-of-thought)
        if (msg.reasoning) {
            lines.push("<details><summary>Reasoning</summary>");
            lines.push("");
            lines.push("```");
            lines.push(msg.reasoning.trim());
            lines.push("```");
            lines.push("");
            lines.push("</details>");
            lines.push("");
        }

        // Plan steps
        if (msg.steps && msg.steps.length > 0) {
            lines.push("### Plan");
            lines.push("");
            msg.steps.forEach((step, i) => {
                lines.push(`${i + 1}. **[${step.status}]** ${step.description} \`(${step.tool})\``);
            });
            lines.push("");
        }

        // Deep research iterations
        if (msg.iterations && msg.iterations.length > 0) {
            lines.push("### Research Iterations");
            lines.push("");
            msg.iterations.forEach((iter) => {
                lines.push(`- **Iteration ${iter.iteration}** — ${iter.tasks.length} task(s)`);
                iter.tasks.forEach((t) => {
                    lines.push(`  - [${t.status}] ${t.description} \`(${t.tool})\``);
                });
            });
            lines.push("");
        }

        // Evidence store
        if (msg.evidence && msg.evidence.length > 0) {
            lines.push("### Evidence");
            lines.push("");
            msg.evidence.forEach((e) => {
                lines.push(
                    `- [${e.id}] (${e.type}) ${e.summary} — source: \`${e.source.tool}\` (confidence ${(e.confidence * 100).toFixed(0)}%)`
                );
            });
            lines.push("");
        }

        // Reflections
        if (msg.reflections && msg.reflections.length > 0) {
            lines.push("### Reflections");
            lines.push("");
            msg.reflections.forEach((r) => {
                lines.push(`- **Iter ${r.iteration}**: ${r.useful ? "useful" : "not useful"} — ${r.reasoning}`);
            });
            lines.push("");
        }

        // Confidence
        if (msg.confidence) {
            lines.push(
                `> Confidence: **${(msg.confidence.overall * 100).toFixed(0)}%** (sources: ${msg.confidence.factors.sourceCount})`
            );
            lines.push("");
        }

        // Citations
        if (msg.citations && msg.citations.length > 0) {
            lines.push("### Sources");
            lines.push("");
            msg.citations.forEach((c) => {
                const label = c.title || c.source;
                const href = citationHref(c);
                lines.push(href ? `- [${c.type}] [${label}](${href})` : `- [${c.type}] ${c.source}`);
            });
            lines.push("");
        }

        lines.push("---");
        lines.push("");
    });

    return lines.join("\n");
}

/**
 * Build a JSON representation of the given messages plus export metadata.
 * The wrapper is stable so downstream tools can rely on the schema.
 */
export function exportToJson(
    messages: Message[],
    options: ExportOptions = {}
): string {
    const title = options.title?.trim() || DEFAULT_TITLE;
    const generatedAt = options.generatedAt || new Date().toISOString();
    const payload = {
        title,
        generatedAt,
        messageCount: messages.length,
        messages,
    };
    return JSON.stringify(payload, null, options.prettyJson === false ? undefined : 2);
}

/**
 * Trigger a browser download of the given text content.
 * Safe to call on the client only — uses URL.createObjectURL.
 */
export function downloadAsFile(content: string, filename: string, mimeType: string): void {
    if (typeof window === "undefined" || typeof document === "undefined") {
        throw new Error("downloadAsFile must be called in the browser");
    }
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Defer revocation so the browser has a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Convenience helper: serialize + download in one call.
 */
export function exportConversation(
    messages: Message[],
    format: ExportFormat,
    options: ExportOptions = {}
): void {
    const titleSlug =
        (options.title || "conversation")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "conversation";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `${titleSlug}-${stamp}.${format === "markdown" ? "md" : "json"}`;

    if (format === "markdown") {
        downloadAsFile(exportToMarkdown(messages, options), filename, "text/markdown;charset=utf-8");
    } else {
        downloadAsFile(exportToJson(messages, options), filename, "application/json;charset=utf-8");
    }
}
