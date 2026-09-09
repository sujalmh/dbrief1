/**
 * Shared Text Tokenizer
 * =====================
 * Single implementation of the keyword tokenizer used by ResearchMemory and
 * EvidenceStore for relevance matching. Stop-words and the minimum token
 * length are config-driven (MEMORY_STOP_WORDS_JSON / MEMORY_MIN_TOKEN_CHARS)
 * instead of being duplicated as literals in each consumer.
 *
 * Generic English stop-words only. F1-specific nouns (race, lap, qualifying,
 * driver, team, etc.) are intentionally KEPT because they are the primary
 * query terms users use to find evidence. Filtering them out would make
 * "fastest lap in qualifying" tokenize to almost nothing, breaking
 * relevance matching.
 */

import { envJson, researchConfig } from "@/lib/config";

const BUILTIN_STOP_WORDS = [
    // common English
    "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
    "her", "was", "one", "our", "out", "day", "had", "has", "his", "how",
    "its", "let", "may", "new", "now", "old", "see", "way", "who", "did",
    "get", "got", "him", "man", "own", "put", "say", "she", "too",
    "use", "with", "this", "that", "from",
    "they", "them", "then", "than", "have", "what", "when",
    "where", "which", "their", "there", "would", "could", "should", "about",
    "into", "over", "after", "before", "again", "still", "being", "these",
    "those", "very", "just", "only", "some", "such",
];

/** Live stop-word set (built-ins + MEMORY_STOP_WORDS_JSON extras). */
export function getStopWords(): Set<string> {
    const extra = envJson<string[]>("MEMORY_STOP_WORDS_JSON", []);
    return new Set([...BUILTIN_STOP_WORDS, ...(Array.isArray(extra) ? extra : [])]);
}

/**
 * Tokenize a string into meaningful keywords for matching.
 *   - lowercases
 *   - strips punctuation
 *   - removes stop-words
 *   - removes tokens shorter than the configured minimum
 */
export function tokenize(text: string): string[] {
    const stopWords = getStopWords();
    const minChars = researchConfig.memoryMinTokenChars();
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= minChars && !stopWords.has(w));
}
