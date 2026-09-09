/**
 * LLM Response JSON Extraction
 * ============================
 *
 * Robustly extracts JSON from LLM responses that may contain:
 *   - Reasoning/thinking text before the JSON
 *   - Markdown code blocks (```json ... ``` or ``` ... ```)
 *   - Multiple JSON objects (reasoning + output)
 *   - Trailing text after the JSON
 *   - Content blocks arrays (from reasoning models)
 *
 * This is shared across all research agents (Reasoner, Planner, Synthesizer)
 * to ensure consistent parsing behavior.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * LLM response content can be either a string or an array of content blocks
 * (e.g., reasoning models return [{ type: "text", text: "..." }]).
 */
export function extractContent(responseContent: unknown): string {
    if (typeof responseContent === "string") {
        return responseContent;
    }

    // Handle array of content blocks (reasoning models)
    if (Array.isArray(responseContent)) {
        return responseContent
            .map((block: unknown) => {
                if (typeof block === "string") return block;
                if (typeof block !== "object" || block === null) return "";
                const rec = block as Record<string, unknown>;
                if (rec.type === "text" && typeof rec.text === "string") return rec.text;
                if (rec.type === "reasoning" && typeof rec.text === "string") return ""; // skip reasoning blocks
                return "";
            })
            .join("");
    }

    // Fallback: stringify
    if (responseContent != null) {
        return JSON.stringify(responseContent);
    }

    return "";
}

// =============================================================================
// JSON Extraction
// =============================================================================

/**
 * Robustly extract a JSON object from an LLM response string.
 *
 * Strategy (in order):
 *   1. If the content has a "PLAN:" or "JSON:" marker, extract everything after it
 *   2. If the content is wrapped in a markdown code block, extract the block content
 *   3. Try direct JSON.parse
 *   4. Find the first balanced { ... } or [ ... ] and parse that
 *   5. Try to fix common JSON issues (trailing commas, single quotes) and re-parse
 *
 * @returns The parsed JSON object
 * @throws Error if no valid JSON could be extracted
 */
export function extractJson(content: string): Record<string, unknown> {
    const text = content.trim();

    if (!text) {
        throw new Error("Empty LLM response");
    }

    // --- Strategy 1: Look for explicit markers ---
    for (const marker of ["PLAN:", "JSON:", "RESULT:", "OUTPUT:"]) {
        const markerIndex = text.lastIndexOf(marker);
        if (markerIndex !== -1) {
            const afterMarker = text.substring(markerIndex + marker.length).trim();
            // Try to parse what's after the marker
            const result = tryParseJson(afterMarker);
            if (result !== null) return result;
        }
    }

    // --- Strategy 2: Extract from markdown code block ---
    // Match ```json ... ``` or ``` ... ``` (greedy to capture multi-line JSON)
    const codeBlockMatch = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        const blockContent = codeBlockMatch[1].trim();
        const result = tryParseJson(blockContent);
        if (result !== null) return result;
    }

    // --- Strategy 3: Try direct parse ---
    const directResult = tryParseJson(text);
    if (directResult !== null) return directResult;

    // --- Strategy 4: Find the first balanced JSON object ---
    const balancedResult = extractBalancedJson(text);
    if (balancedResult !== null) return balancedResult;

    // --- Strategy 5: Try to fix common JSON issues ---
    const fixedResult = tryParseJson(fixCommonJsonIssues(text));
    if (fixedResult !== null) return fixedResult;

    // --- Last resort: find first { and last } ---
    const startBrace = text.indexOf("{");
    const endBrace = text.lastIndexOf("}");
    if (startBrace !== -1 && endBrace !== -1 && endBrace > startBrace) {
        const substring = text.slice(startBrace, endBrace + 1);
        const result = tryParseJson(substring);
        if (result !== null) return result;

        // Try fixing the substring
        const fixedResult2 = tryParseJson(fixCommonJsonIssues(substring));
        if (fixedResult2 !== null) return fixedResult2;
    }

    throw new Error("Could not parse JSON from LLM response");
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Try to parse JSON, returning null on failure instead of throwing.
 */
function tryParseJson(text: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return parsed as Record<string, unknown>;
        }
        // If it's an array, wrap it
        if (Array.isArray(parsed)) {
            return { items: parsed } as Record<string, unknown>;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Extract the first balanced JSON object from a string.
 * Tracks brace depth to handle nested objects and strings.
 */
function extractBalancedJson(text: string): Record<string, unknown> | null {
    const start = text.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (char === "\\") {
            escape = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === "{") depth++;
        else if (char === "}") {
            depth--;
            if (depth === 0) {
                // Found a balanced object
                const jsonStr = text.slice(start, i + 1);
                const result = tryParseJson(jsonStr);
                if (result !== null) return result;
                // Try fixing it
                const fixed = tryParseJson(fixCommonJsonIssues(jsonStr));
                if (fixed !== null) return fixed;
            }
        }
    }

    return null;
}

/**
 * Fix common JSON issues that LLMs produce:
 *   - Trailing commas before } or ]
 *   - Single quotes instead of double quotes
 *   - Unquoted property names
 *   - Comments (single-line or multi-line)
 */
function fixCommonJsonIssues(text: string): string {
    let fixed = text;

    // Remove single-line comments
    fixed = fixed.replace(/\/\/.*$/gm, "");

    // Remove multi-line comments
    fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, "");

    // Remove trailing commas (before } or ])
    fixed = fixed.replace(/,\s*([}\]])/g, "$1");

    // Replace single quotes with double quotes (only outside of double-quoted strings)
    // This is a simple heuristic — may not handle all edge cases
    fixed = fixed.replace(/'([^']*)'(?=\s*[:,}\]])/g, '"$1"');

    // Quote unquoted property names (word followed by colon)
    fixed = fixed.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

    return fixed;
}
