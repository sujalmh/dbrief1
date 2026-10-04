/**
 * Evidence Store
 * ==============
 *
 * Accumulates structured evidence from tool executions. Each tool result is
 * converted to an Evidence object with provenance tracking, auto-classified
 * type (from tool metadata), a heuristic summary, and per-evidence confidence.
 *
 * The Synthesizer reads from the evidence store (not a flat string) to produce
 * the final report with inline citations like [E3].
 */

import type { Evidence, EvidenceType, EvidenceSource, ToolMetadata } from "./types";

// =============================================================================
// Execution Result (mirrors executor's shape, kept local to avoid circular deps)
// =============================================================================

export interface ExecutionResult {
    taskId: string;
    tool: string;
    args: Record<string, unknown>;
    success: boolean;
    data?: unknown;
    error?: string;
    durationMs: number;
    evidenceId?: string;
}

// =============================================================================
// Confidence by tool category (higher = more trustworthy data)
// =============================================================================

const CATEGORY_CONFIDENCE: Record<string, number> = {
    data: 0.9, // F1 API — authoritative
    regulation: 0.85, // FIA documents via RAG
    simulation: 0.7, // Synthetic — depends on input quality
    search: 0.5, // Web search — unverified
    visualization: 0.5, // Marker, not real data
};

/**
 * Maximum number of evidence items retained in the store. Once exceeded,
 * the least-recently-accessed evidence is evicted (LRU). This prevents
 * unbounded memory growth in long-running sessions.
 */
const MAX_EVIDENCE_ITEMS = 200;

// =============================================================================
// Evidence Store
// =============================================================================

export class EvidenceStore {
    private evidence: Map<string, Evidence> = new Map();
    private counter = 0;

    /**
     * Touch an evidence item to mark it as recently used.
     * Used for LRU eviction. Re-insertion moves the key to the end of the
     * iteration order, which is what we use to define "least recently used".
     */
    private touch(id: string, evidence: Evidence): void {
        this.evidence.delete(id);
        this.evidence.set(id, evidence);
    }

    /**
     * Evict least-recently-used evidence until we're at or below the cap.
     * Map iteration order is insertion order, so the first key is the LRU.
     */
    private evictIfOverCap(): void {
        while (this.evidence.size > MAX_EVIDENCE_ITEMS) {
            const oldestId = this.evidence.keys().next().value;
            if (oldestId === undefined) break;
            this.evidence.delete(oldestId);
        }
    }

    /**
     * Add a tool execution result as structured evidence.
     * Auto-classifies the type from tool metadata and generates a heuristic summary.
     */
    add(result: ExecutionResult, toolMetadata: ToolMetadata): Evidence | null {
        if (!result.success || result.data == null) {
            return null;
        }

        const id = `E${++this.counter}`;
        const source: EvidenceSource = {
            tool: result.tool,
            taskId: result.taskId,
            args: result.args,
        };

        // Extract race/season/driver from args if present
        const race = this.extractString(result.args, ["gp", "grand_prix", "event_name"]);
        const season = this.extractNumber(result.args, ["year", "season"]);
        const driver = this.extractString(result.args, ["driver", "driver_code"]);

        // Generate heuristic summary from the data
        const summary = this.generateSummary(result.data);

        // Compute per-evidence confidence from tool category
        const confidence = CATEGORY_CONFIDENCE[toolMetadata.category] ?? 0.7;

        // Extract tags for searchability
        const tags = this.extractTags(result.data, toolMetadata);

        const evidence: Evidence = {
            id,
            type: toolMetadata.outputType,
            source,
            race,
            season,
            driver,
            data: result.data,
            summary,
            confidence,
            timestamp: Date.now(),
            tags,
        };

        this.evidence.set(id, evidence);
        this.evictIfOverCap();
        return evidence;
    }

    /**
     * Get all evidence.
     */
    getAll(): Evidence[] {
        return Array.from(this.evidence.values());
    }

    /**
     * Get evidence by ID. Marks the entry as recently used for LRU.
     */
    getById(id: string): Evidence | undefined {
        const ev = this.evidence.get(id);
        if (ev) this.touch(id, ev);
        return ev;
    }

    /**
     * Get evidence by type.
     */
    getByType(type: EvidenceType): Evidence[] {
        return this.getAll().filter((e) => e.type === type);
    }

    /**
     * Get evidence by race.
     */
    getByRace(race: string): Evidence[] {
        return this.getAll().filter((e) => e.race?.toLowerCase() === race.toLowerCase());
    }

    /**
     * Get evidence by driver.
     */
    getByDriver(driver: string): Evidence[] {
        return this.getAll().filter((e) => e.driver?.toUpperCase() === driver.toUpperCase());
    }

    /**
     * Get evidence ranked by relevance to a query.
     *
     * Ranking combines:
     *   - token overlap between the query and the evidence's summary/tags
     *   - per-evidence confidence
     *   - a small recency boost for evidence fetched recently
     *
     * Returns up to `limit` items, descending by score. If `limit` is not
     * provided, all evidence is returned (still sorted by relevance).
     */
    getRelevant(query: string, limit?: number): Evidence[] {
        const all = this.getAll();
        if (all.length === 0) return [];

        // Reuse the same stop-word-aware tokenizer the memory uses so the
        // two systems agree on what counts as a meaningful token.
        const queryTokens = this.tokenize(query);
        if (queryTokens.length === 0) {
            // No usable tokens — fall back to confidence ordering.
            const sorted = [...all].sort((a, b) => b.confidence - a.confidence);
            return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
        }

        const now = Date.now();
        const scored = all.map((e) => {
            const haystack = `${e.summary} ${e.tags.join(" ")}`.toLowerCase();
            let matches = 0;
            let weighted = 0;
            for (const tok of queryTokens) {
                if (haystack.includes(tok)) {
                    matches++;
                    weighted += tok.length;
                }
            }
            const matchScore = matches === 0 ? 0 : (matches * 10 + weighted);
            // Slight recency boost (decays after 1 hour).
            const ageHours = (now - e.timestamp) / (1000 * 60 * 60);
            const recencyBoost = ageHours < 1 ? 0.5 : ageHours < 24 ? 0 : -0.2;
            const score = matchScore + e.confidence * 2 + recencyBoost;
            return { e, score };
        });

        scored.sort((a, b) => b.score - a.score);
        const filtered = scored.filter((s) => s.score > 0).map((s) => s.e);
        // If nothing matched, return top-confidence items as a fallback.
        const result = filtered.length > 0
            ? filtered
            : [...all].sort((a, b) => b.confidence - a.confidence);
        return typeof limit === "number" ? result.slice(0, limit) : result;
    }

    /**
     * Get the set of evidence types currently in the store.
     */
    getEvidenceTypes(): Set<EvidenceType> {
        return new Set(this.getAll().map((e) => e.type));
    }

    /**
     * Get the count of evidence pieces.
     */
    size(): number {
        return this.evidence.size;
    }

    /**
     * Remove redundant evidence (same tool + same args → keep highest confidence).
     */
    deduplicate(): void {
        const seen = new Map<string, Evidence>();
        for (const evidence of this.evidence.values()) {
            const key = `${evidence.source.tool}:${JSON.stringify(evidence.source.args)}`;
            const existing = seen.get(key);
            if (!existing || evidence.confidence > existing.confidence) {
                if (existing) {
                    this.evidence.delete(existing.id);
                }
                seen.set(key, evidence);
            } else {
                this.evidence.delete(evidence.id);
            }
        }
    }

    /**
     * Get provenance for an evidence item.
     */
    getProvenance(evidenceId: string): EvidenceSource | undefined {
        return this.evidence.get(evidenceId)?.source;
    }

    /**
     * Render evidence as structured markdown for the Synthesizer.
     * Replaces the old `aggregateContext` function.
     */
    toContextString(): string {
        const all = this.getAll();
        if (all.length === 0) {
            return "No evidence collected.";
        }

        // Budget: distribute tokens across evidence items
        // Total budget ~120K chars (~30K tokens), min 2K per item
        const totalBudget = 120000;
        const perItemBudget = Math.max(2000, Math.floor(totalBudget / all.length));

        const sections = all.map((e) => {
            const header = `### Evidence [${e.id}] — ${e.type}`;
            const meta = [
                e.race ? `Race: ${e.race}` : null,
                e.season ? `Season: ${e.season}` : null,
                e.driver ? `Driver: ${e.driver}` : null,
                `Source: ${e.source.tool}`,
                `Confidence: ${(e.confidence * 100).toFixed(0)}%`,
            ]
                .filter(Boolean)
                .join(" | ");

            const dataStr = this.truncateForContext(e.data, perItemBudget);
            return `${header}\n${meta}\nSummary: ${e.summary}\n\`\`\`json\n${dataStr}\n\`\`\``;
        });

        return `## Evidence Store (${all.length} items)\n\n${sections.join("\n\n")}`;
    }

    /**
     * Compact summary for the Reasoner — shows evidence types present,
     * key facts, and visible gaps. Less verbose than toContextString.
     */
    toReasonerContextString(): string {
        const all = this.getAll();
        if (all.length === 0) {
            return "No evidence collected yet.";
        }

        const types = Array.from(this.getEvidenceTypes());
        const typeSummary = `Evidence types present: ${types.join(", ")}`;

        const facts = all.map((e) => {
            const context = [e.race, e.season, e.driver].filter(Boolean).join(" ");
            return `[${e.id}] ${e.type}${context ? ` (${context})` : ""}: ${e.summary}`;
        });

        return `${typeSummary}\n\nCollected facts:\n${facts.join("\n")}`;
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    private extractString(args: Record<string, unknown>, keys: string[]): string | undefined {
        for (const key of keys) {
            const val = args[key];
            if (typeof val === "string" && val.trim()) {
                return val.trim();
            }
        }
        return undefined;
    }

    /**
     * Lowercase, strip punctuation, drop generic English stop-words and
     * very short tokens. F1-specific nouns (race, lap, qualifying, etc.) are
     * intentionally KEPT because they are the primary query terms users use
     * to find evidence. Used for query-aware relevance scoring. Kept in sync
     * with the same logic in memory.ts so the two rankers behave consistently.
     */
    private tokenize(text: string): string[] {
        const STOP_WORDS = new Set<string>([
            // Generic English stop-words only — F1 nouns are kept on purpose.
            "the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
            "her", "was", "one", "our", "out", "day", "had", "has", "his", "how",
            "its", "let", "may", "now", "old", "see", "way", "who", "did",
            "get", "got", "him", "man", "own", "put", "say", "she", "too",
            "use", "with", "this", "that", "from", "they", "them", "then", "than",
            "have", "what", "when", "where", "which", "their",
            "there", "would", "could", "should", "about", "into", "over",
            "after", "before", "again", "still", "being", "these", "those",
            "very", "just", "only", "some", "such",
        ]);
        return text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
    }

    private extractNumber(args: Record<string, unknown>, keys: string[]): number | undefined {
        for (const key of keys) {
            const val = args[key];
            if (typeof val === "number") {
                return val;
            }
        }
        return undefined;
    }

    /**
     * Generate a heuristic summary from the tool output data.
     * No LLM call — uses field extraction for speed.
     */
    private generateSummary(data: unknown): string {
        if (data == null) return "No data returned.";

        // Parse string JSON if needed
        let parsed = data;
        if (typeof data === "string") {
            try {
                parsed = JSON.parse(data);
            } catch {
                return data.slice(0, 200);
            }
        }

        if (typeof parsed !== "object" || parsed === null) {
            return String(parsed).slice(0, 200);
        }

        const obj = parsed as Record<string, unknown>;

        // Look for common array fields
        for (const field of ["results", "laps", "tyres", "standings", "events", "sessions", "messages", "data", "retrieved_documents", "seasons"]) {
            const val = obj[field];
            if (Array.isArray(val)) {
                const count = val.length;
                if (count === 0) return `${field}: empty array`;
                // Try to extract a representative item
                const first = val[0] as Record<string, unknown> | undefined;
                if (first && typeof first === "object") {
                    const keyFields = Object.keys(first).slice(0, 4).join(", ");
                    return `${field}: ${count} items (fields: ${keyFields})`;
                }
                return `${field}: ${count} items`;
            }
        }

        // For single-object results, show key fields
        const keys = Object.keys(obj).slice(0, 5);
        return `Object with fields: ${keys.join(", ")}`;
    }

    private extractTags(data: unknown, metadata: ToolMetadata): string[] {
        const tags: string[] = [metadata.outputType, metadata.category];
        if (typeof data === "object" && data !== null) {
            const obj = data as Record<string, unknown>;
            for (const field of ["driver", "gp", "year", "team"]) {
                if (obj[field]) tags.push(String(obj[field]));
            }
        }
        return tags;
    }

    private truncateForContext(data: unknown, maxChars: number = 8000): string {
        const str = typeof data === "string" ? data : JSON.stringify(data, null, 2);
        if (str.length <= maxChars) return str;

        // Try to smart-summarize large data instead of just truncating
        const summarized = this.summarizeForContext(data, maxChars);
        if (summarized) return summarized;

        // Fallback: truncate but keep valid JSON structure
        return this.smartTruncate(str, maxChars);
    }

    /**
     * Smart-summarize large tool outputs. Instead of cutting off data mid-object,
     * extract the most important fields and reduce large arrays to key statistics.
     */
    private summarizeForContext(data: unknown, maxChars: number): string | null {
        let parsed = data;
        if (typeof data === "string") {
            try {
                parsed = JSON.parse(data);
            } catch {
                return null;
            }
        }

        if (typeof parsed !== "object" || parsed === null) return null;
        const obj = parsed as Record<string, unknown>;

        const parts: string[] = [];

        // Copy non-array scalar fields directly
        for (const [key, val] of Object.entries(obj)) {
            if (Array.isArray(val)) {
                // Summarize arrays
                const summarized = this.summarizeArray(key, val, maxChars);
                parts.push(`"${key}": ${summarized}`);
            } else if (typeof val === "object" && val !== null) {
                // Nested object — include if small
                const valStr = JSON.stringify(val, null, 2);
                if (valStr.length < maxChars / 4) {
                    parts.push(`"${key}": ${valStr}`);
                } else {
                    parts.push(`"${key}": { ... (${valStr.length} chars, summarized) }`);
                }
            } else {
                parts.push(`"${key}": ${JSON.stringify(val)}`);
            }
        }

        const result = `{\n  ${parts.join(",\n  ")}\n}`;
        if (result.length <= maxChars) return result;

        // Still too large — truncate the summarized version
        return this.smartTruncate(result, maxChars);
    }

    /**
     * Summarize a large array by keeping the first few items, last few items,
     * and count. For arrays of objects, extracts key fields.
     *
     * Schedules (`events`, `grand_prix`) and full classifications
     * (`results`, `standings`) are NEVER shredded: the synthesizer anchors
     * "last"/"next" race by comparing every event_date against today, and
     * answers backmarker questions from full tables. These payloads are
     * small (a 25-event schedule ≈ 6KB), so they are included whole
     * whenever they fit the per-item budget.
     */
    private summarizeArray(key: string, arr: unknown[], maxChars: number): string {
        if (arr.length === 0) return "[]";

        // Complete-data keys: include whole when they fit the budget.
        // Schedules are always included whole — even over budget — because
        // a shredded schedule silently moves the "latest completed event"
        // anchor and produces confidently-wrong recency answers. A full
        // season schedule is only ~6KB.
        if (key === "events" || key === "grand_prix") {
            return JSON.stringify(arr, null, 2);
        }
        if (key === "results" || key === "standings") {
            const whole = JSON.stringify(arr, null, 2);
            if (whole.length <= maxChars) return whole;
            // Over budget (shouldn't happen for real payloads): fall through
            // to the generic head+tail summary below.
        }

        // For small arrays, include all
        const allStr = JSON.stringify(arr, null, 2);
        if (allStr.length <= maxChars / 3) return allStr;

        const headCount = Math.min(5, arr.length);
        const tailCount = Math.min(3, arr.length - headCount);
        const head = arr.slice(0, headCount);
        const tail = tailCount > 0 ? arr.slice(-tailCount) : [];

        // For arrays of objects, try to extract key fields
        if (arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null) {
            const first = arr[0] as Record<string, unknown>;
            const fields = Object.keys(first);

            // Build a compact representation
            const headCompact = head.map((item) => {
                const obj = item as Record<string, unknown>;
                const compact: Record<string, unknown> = {};
                for (const f of fields.slice(0, 8)) {
                    compact[f] = obj[f];
                }
                return compact;
            });

            let result = JSON.stringify(headCompact, null, 2);
            if (tail.length > 0) {
                const tailCompact = tail.map((item) => {
                    const obj = item as Record<string, unknown>;
                    const compact: Record<string, unknown> = {};
                    for (const f of fields.slice(0, 8)) {
                        compact[f] = obj[f];
                    }
                    return compact;
                });
                result = `[\n  ...first ${headCount} items...,\n  ${JSON.stringify(headCompact[0]).slice(0, 200)},\n  ...last ${tailCount} items: ${JSON.stringify(tailCompact).slice(0, 300)}\n]`;
            } else {
                result = `[\n  ${headCompact.map((item) => JSON.stringify(item)).join(",\n  ")}\n]`;
            }

            return `/* ${arr.length} items total, showing ${headCount} */ ${result}`;
        }

        // For arrays of primitives
        return `/* ${arr.length} items, showing first ${headCount} */ ${JSON.stringify(head)}`;
    }

    /**
     * Truncate a string to maxChars, trying to break at a sensible boundary.
     */
    private smartTruncate(str: string, maxChars: number): string {
        if (str.length <= maxChars) return str;

        // Try to break at a newline
        let cutPoint = str.lastIndexOf("\n", maxChars);
        if (cutPoint < maxChars * 0.5) {
            // Try to break at a space
            cutPoint = str.lastIndexOf(" ", maxChars);
        }
        if (cutPoint < maxChars * 0.5) {
            cutPoint = maxChars;
        }

        return str.slice(0, cutPoint) + "\n... (data summarized, " + str.length + " chars total)";
    }
}
