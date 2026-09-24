/**
 * Placeholder Argument Guard
 * ==========================
 * LLMs sometimes emit placeholder tokens instead of concrete tool args
 * (observed in production: `gp: "LAST_COMPLETED_GP"` for a "who won the
 * last race" query). The FastF1 backend fuzzy-matches unknown GP strings
 * to *some* event instead of failing, so a placeholder silently resolves
 * to the wrong race and the answer is confidently wrong.
 *
 * This module detects placeholder-like string args so executors can fail
 * the step fast (fail-closed) instead of executing it. It is deliberately
 * conservative: free-text fields (search queries, descriptions) are only
 * flagged for extreme SHOUTING_SNAKE tokens, while structured fields
 * (gp, driver, session, ...) also match recency/unknown keywords.
 */

// =============================================================================
// Configuration
// =============================================================================

/** Structured fields whose values must be concrete identifiers, never prose. */
const STRUCTURED_FIELDS = new Set([
    "gp",
    "driver",
    "session",
    "year",
    "lap",
    "compound",
    "stint",
    "event",
    "season",
    "driver_number",
]);

/**
 * Legitimate ALL-CAPS values that must never be flagged:
 * session codes, tyre compounds, sprint codes.
 */
const CAPS_ALLOWLIST = new Set([
    "FP1", "FP2", "FP3",
    "Q", "SQ", "SS", "S", "R",
    "SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET",
]);

/**
 * Keywords that signal "I don't know the concrete value" when they appear
 * in a structured field. Matched case-insensitively as whole words.
 */
const PLACEHOLDER_KEYWORDS =
    /\b(last|latest|previous|current|recent|tbd|todo|tba|unknown|placeholder|next|first)\b/i;

/** Extreme SHOUTING_SNAKE tokens like LAST_COMPLETED_GP (any field). */
const SNAKE_TOKEN_REGEX = /^[A-Z][A-Z0-9_]{3,}$/;

/** Error prefix executors use; the API route matches on it for tracing. */
export const PLACEHOLDER_ERROR_PREFIX = "Placeholder argument rejected";

/**
 * True when `value` looks like a placeholder rather than a concrete arg.
 * @param field - the arg name (structured fields are checked strictly)
 */
export function isPlaceholderLike(field: string, value: string): boolean {
    const v = value.trim();
    if (!v) return false;

    // Extreme SHOUTING_SNAKE tokens are never legitimate in any field.
    if (SNAKE_TOKEN_REGEX.test(v) && !CAPS_ALLOWLIST.has(v)) return true;

    // Structured identifier fields: also catch recency/unknown keywords
    // ("latest", "last race", "TBD", ...) and bare ALL-CAPS words (len>=4).
    if (STRUCTURED_FIELDS.has(field.toLowerCase())) {
        if (PLACEHOLDER_KEYWORDS.test(v)) return true;
        if (/^[A-Z0-9 ]{4,}$/.test(v) && !CAPS_ALLOWLIST.has(v)) return true;
    }

    return false;
}

export interface PlaceholderHit {
    /** Dotted arg path, e.g. "gp" or "filter.gp". */
    path: string;
    value: string;
}

/**
 * Recursively scan tool args for placeholder-like string values.
 * Returns the first hit, or null when all args look concrete.
 */
export function findPlaceholderArg(args: unknown, prefix = ""): PlaceholderHit | null {
    if (typeof args === "string") {
        const field = prefix.split(".").pop() || "";
        return isPlaceholderLike(field, args) ? { path: prefix || "(root)", value: args } : null;
    }
    if (Array.isArray(args)) {
        for (let i = 0; i < args.length; i++) {
            const hit = findPlaceholderArg(args[i], `${prefix}[${i}]`);
            if (hit) return hit;
        }
        return null;
    }
    if (args !== null && typeof args === "object") {
        for (const [key, val] of Object.entries(args as Record<string, unknown>)) {
            const hit = findPlaceholderArg(val, prefix ? `${prefix}.${key}` : key);
            if (hit) return hit;
        }
    }
    return null;
}

/**
 * Build the fail-closed error for a placeholder hit. The message tells
 * the responder (and the trace reader) exactly what to do instead.
 */
export function placeholderError(tool: string, hit: PlaceholderHit): string {
    return (
        `${PLACEHOLDER_ERROR_PREFIX} in '${tool}.${hit.path}': "${hit.value}". ` +
        `Replan with a fully concrete value — a canonical GP name from get_gp_names, ` +
        `a 3-letter driver code, or use web_search for latest/most-recent questions.`
    );
}
