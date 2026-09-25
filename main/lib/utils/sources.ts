/**
 * Source Citation Utilities
 * =========================
 * Shared contract for FIA document sources ("Sources" shown under answers).
 *
 * Pipeline guarantee: the raw RAG candidate list (top-N after vector search)
 * is NEVER shown directly. A document becomes a UI source only when:
 *   1. it survived Voyage rerank-3 (see `relevance_score` + MIN_RELEVANCE_SCORE
 *      in lib/agents/regulationRetriever.ts), AND
 *   2. an LLM actually used it — via a dedicated `.withStructuredOutput()`
 *      pick call over the reranked candidates (normal mode), or via the
 *      evidence IDs cited in the final report (deep-research synthesizer).
 *
 * Deliberately, the chat responder is NEVER asked to emit machine-readable
 * reply markers — free-text format instructions are brittle across models.
 * Source selection is always a separate schema-validated structured call.
 *
 * Hallucinated filenames (not present in the retrieved set) are dropped, so
 * the UI can only ever link to documents that were really retrieved — each
 * carrying its `source_url` for a clickable link.
 */

import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { LLM_TIMEOUT_MS } from "@/lib/llm";

// =============================================================================
// Types
// =============================================================================

/**
 * A single UI source: stable filename id + human title + clickable URL.
 * `url` is null when the vector store has no link for the document — the UI
 * renders those as plain text instead of anchors.
 */
export interface SourceCitation {
    source: string;
    title?: string | null;
    url?: string | null;
    /** Canonical link from the collection payload — preferred for the UI link. */
    source_url?: string | null;
    type: string;
}

/** Loose shape of a retrieved RAG document (tool output, possibly stringified). */
export interface RetrievedDocLike {
    source?: unknown;
    title?: unknown;
    url?: unknown;
    source_url?: unknown;
    doc_type?: unknown;
    type?: unknown;
    relevance_score?: unknown;
    [key: string]: unknown;
}

// =============================================================================
// Retrieval output → citations
// =============================================================================

/** Normalize one retrieved document into a UI citation. */
export function toCitation(doc: RetrievedDocLike): SourceCitation {
    const kind =
        typeof doc.doc_type === "string"
            ? doc.doc_type
            : typeof doc.type === "string"
              ? doc.type
              : "regulation";
    return {
        source: String(doc.source),
        title: typeof doc.title === "string" ? doc.title : null,
        url: typeof doc.url === "string" ? doc.url : null,
        source_url: typeof doc.source_url === "string" ? doc.source_url : null,
        type: kind,
    };
}

/**
 * Pull the `retrieved_documents` array out of a retrieve_regulations tool
 * result (object or JSON string). Returns [] for anything else.
 */
export function extractRegulationDocs(data: unknown): RetrievedDocLike[] {
    let parsed: unknown = data;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed) as unknown;
        } catch {
            return [];
        }
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    if (!("retrieved_documents" in parsed)) return [];
    const arr = (parsed as { retrieved_documents: unknown }).retrieved_documents;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
        (item): item is RetrievedDocLike => typeof item === "object" && item !== null
    );
}

/** All retrieved docs as citations, deduplicated by filename. */
export function citationsFromDocs(docs: RetrievedDocLike[]): SourceCitation[] {
    const seen = new Set<string>();
    const out: SourceCitation[] = [];
    for (const doc of docs) {
        if (typeof doc.source !== "string" || !doc.source || seen.has(doc.source)) {
            continue;
        }
        seen.add(doc.source);
        out.push(toCitation(doc));
    }
    return out;
}

/**
 * Match LLM-picked filenames against the actually-retrieved documents.
 * Unknown/hallucinated names are dropped — a source is only citable when it
 * was really retrieved. Order follows the LLM's listing.
 */
export function matchCitations(
    filenames: string[],
    docs: RetrievedDocLike[]
): SourceCitation[] {
    const bySource = new Map<string, RetrievedDocLike>();
    for (const doc of docs) {
        if (typeof doc.source === "string" && doc.source && !bySource.has(doc.source)) {
            bySource.set(doc.source, doc);
        }
    }
    const seen = new Set<string>();
    const out: SourceCitation[] = [];
    for (const raw of filenames) {
        const name = raw.trim();
        if (!name || seen.has(name)) continue;
        const doc = bySource.get(name);
        if (!doc) continue;
        seen.add(name);
        out.push(toCitation(doc));
    }
    return out;
}

// =============================================================================
// Structured LLM pick of actually-used sources
// =============================================================================
//
// After the responder streams its free-text answer, a cheap model maps the
// finished answer back onto the reranked candidate filenames via a
// schema-validated structured call — still an LLM pick over reranked docs,
// never the raw candidate list. Structured output (not reply-format
// instructions) is the only mechanism: on failure we return [] and the UI
// simply shows no sources rather than wrong ones.

const PickedSourcesSchema = z.object({
    used_sources: z
        .array(z.string())
        .describe("Exact source filenames from the candidate list that support claims in the answer"),
});

/**
 * Ask a cheap model which retrieved sources the answer actually used.
 * Returns matched citations (possibly empty). Never throws — failures
 * resolve to [] so the route can simply show no sources.
 */
export async function pickUsedSources(
    model: BaseChatModel,
    question: string,
    answer: string,
    candidates: RetrievedDocLike[]
): Promise<SourceCitation[]> {
    const names = candidates.filter(
        (d): d is RetrievedDocLike & { source: string } =>
            typeof d.source === "string" && d.source.length > 0
    );
    if (names.length === 0) return [];

    const candidateList = names
        .map(
            (d) =>
                `- ${d.source}${typeof d.title === "string" && d.title ? ` — ${d.title}` : ""}`
        )
        .join("\n");

    try {
        const structured = model.withStructuredOutput(PickedSourcesSchema, {
            name: "pick_used_sources",
            strict: true,
        });
        const result = await structured.invoke(
            [
                new SystemMessage(
                    "You select which retrieved FIA document sources were actually used in an answer. " +
                        "Return ONLY exact source filenames copied from the candidate list — " +
                        "filenames that support factual claims made in the answer. " +
                        "Never invent filenames. Use an empty list when none were used."
                ),
                new HumanMessage(
                    `Question: ${question}\n\nAnswer:\n${answer.slice(0, 6000)}\n\nCandidate sources:\n${candidateList}`
                ),
            ],
            { signal: AbortSignal.timeout(LLM_TIMEOUT_MS.intent) }
        );
        const picked = (result as { used_sources?: unknown }).used_sources;
        if (!Array.isArray(picked)) return [];
        return matchCitations(
            picked.filter((s): s is string => typeof s === "string"),
            names
        );
    } catch (error) {
        console.warn(
            "[Sources] Structured source pick failed:",
            error instanceof Error ? error.message : error
        );
        return [];
    }
}

// =============================================================================
// Deep-research helpers: evidence IDs cited in the final report
// =============================================================================

/** Extract [E#] references from report text, in order, deduplicated. */
export function extractEvidenceIds(text: string): string[] {
    const refs = text.match(/\[E\d+\]/g) ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const ref of refs) {
        const id = ref.slice(1, -1);
        if (!seen.has(id)) {
            seen.add(id);
            out.push(id);
        }
    }
    return out;
}
