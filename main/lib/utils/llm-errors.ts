/**
 * LLM Error Classification
 * ========================
 *
 * Distinguishes "non-recoverable" LLM errors (rate limit, quota, auth,
 * network) from "recoverable" LLM errors (LLM returned prose, malformed
 * JSON, schema-validation failed on a structurally valid response).
 *
 * Why this matters:
 *   - The IntentAnalyzer, Planner, and Responder all have heuristic
 *     fallbacks ("if the LLM gave bad output, do X instead").
 *   - A 429 Rate Limit is NOT a "bad output" — the LLM never even got
 *     to produce output. Silently falling back and proceeding
 *     (1) wastes the user's time, (2) hides the real problem,
 *     (3) usually cascades into another failure (the Responder hits
 *     the same 429), and (4) makes the UI spin forever.
 *
 * This helper centralizes the classification so each call site can
 * choose:
 *   - non-recoverable → throw / surface to user
 *   - recoverable      → use deterministic fallback (heuristic plan,
 *     intent heuristic, etc.)
 */

export type LlmErrorKind =
    | "rate_limit" // 429
    | "quota" // per-day / per-month quota, or 402 insufficient credits
    | "auth" // 401/403, invalid/missing API key
    | "model_not_found" // 404, model unavailable
    | "network" // DNS, connection reset, timeout
    | "overloaded" // 503, "model overloaded"
    | "bad_output" // 200 OK, but the LLM returned garbage / unparseable
    | "unknown"; // anything else

export interface ClassifiedLlmError {
    kind: LlmErrorKind;
    /** Short, user-friendly headline (no jargon). */
    userMessage: string;
    /** Whether a deterministic fallback can sensibly proceed. */
    recoverable: boolean;
    /** Original error for logging. */
    cause: unknown;
}

/**
 * Classify an error thrown by an LLM call.
 *
 * @param err - The error thrown by `model.invoke(...)` or `model.stream(...)`
 * @param context - Optional context (e.g. "IntentAnalyzer") to make logs clearer
 */
export function classifyLlmError(err: unknown, context?: string): ClassifiedLlmError {
    const tag = context ? `[${context}] ` : "";
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();

    // --- 1. Structured API errors (LangChain wraps provider errors) ---
    // Some providers expose `status` / `statusCode` / `response.status` on the error.
    const status = pickStatus(err);

    // --- 2. Rate limit / quota (HTTP 429) ---
    if (
        status === 429 ||
        lower.includes("rate limit") ||
        lower.includes("too many requests") ||
        lower.includes("429") ||
        lower.includes("quota") ||
        lower.includes("free-models-per-day") ||
        lower.includes("tpm") || // tokens per minute
        lower.includes("rpm") // requests per minute
    ) {
        return {
            kind: "rate_limit",
            userMessage:
                "The AI provider is rate-limiting requests right now. " +
                "This usually means a free-tier daily quota was reached or " +
                "too many requests were sent in a short window. " +
                "Please wait a minute, or check Settings (Managed / BYOK).",
            recoverable: false,
            cause: err,
        };
    }

    // --- 2b. Billing / credits exhausted (HTTP 402) ---
    if (
        status === 402 ||
        lower.includes("insufficient credits") ||
        lower.includes("402")
    ) {
        return {
            kind: "quota",
            userMessage:
                "The AI account is out of credits, so the managed model is " +
                "unavailable. Switch to BYOK in Settings with your own key.",
            recoverable: false,
            cause: err,
        };
    }

    // --- 3. Auth (401/403) ---
    if (
        status === 401 ||
        status === 403 ||
        lower.includes("api key") ||
        lower.includes("unauthorized") ||
        lower.includes("forbidden") ||
        lower.includes("invalid_api_key") ||
        lower.includes("authentication")
    ) {
        return {
            kind: "auth",
            userMessage:
                "The AI provider rejected the API key. " +
                "Open Settings and verify the key (Managed / BYOK).",
            recoverable: false,
            cause: err,
        };
    }

    // --- 4. Model not found / unavailable (404 / 410) ---
    if (
        status === 404 ||
        status === 410 ||
        lower.includes("model not found") ||
        lower.includes("model_not_found") ||
        lower.includes("no endpoints found") ||
        lower.includes("is not a valid model") ||
        lower.includes("invalid model")
    ) {
        return {
            kind: "model_not_found",
            userMessage:
                "The selected model is no longer available. " +
                "Open Settings and pick a different model.",
            recoverable: false,
            cause: err,
        };
    }

    // --- 5. Provider overloaded (503) ---
    if (
        status === 503 ||
        status === 502 ||
        lower.includes("overloaded") ||
        lower.includes("service unavailable") ||
        lower.includes("capacity")
    ) {
        return {
            kind: "overloaded",
            userMessage:
                "The AI provider is temporarily overloaded. " +
                "Please try again in a few seconds, or check Settings (Managed / BYOK).",
            recoverable: false,
            cause: err,
        };
    }

    // --- 6. Network ---
    if (
        lower.includes("econnrefused") ||
        lower.includes("econnreset") ||
        lower.includes("enotfound") ||
        lower.includes("etimedout") ||
        lower.includes("fetch failed") ||
        lower.includes("network") ||
        lower.includes("socket hang up") ||
        lower.includes("aborted")
    ) {
        return {
            kind: "network",
            userMessage:
                "Could not reach the AI provider (network error). " +
                "Check your connection and try again.",
            recoverable: false,
            cause: err,
        };
    }

    // --- 7. Bad output from the LLM (recoverable: use heuristic) ---
    // These are NOT terminal — the LLM responded, we just couldn't
    // parse/validate the output. Heuristic fallback is appropriate.
    if (
        lower.includes("output parser") ||
        lower.includes("parse") ||
        lower.includes("json") ||
        lower.includes("schema") ||
        lower.includes("zod") ||
        lower.includes("outputfixingparser") ||
        lower.includes("structured output failed") ||
        lower.includes("response_format")
    ) {
        return {
            kind: "bad_output",
            userMessage: "The AI model returned an unexpected response format.",
            recoverable: true,
            cause: err,
        };
    }

    // --- 8. Unknown ---
    // We deliberately default to "non-recoverable" here. The previous
    // behaviour of silently falling back on ANY error is what hid the
    // rate-limit problem from the user. When in doubt, surface it.
    console.warn(
        `${tag}Unclassified LLM error — treating as non-recoverable:`,
        message
    );
    return {
        kind: "unknown",
        userMessage:
            "The AI model could not be reached. " +
            "Please try again, or check Settings (Managed / BYOK).",
        recoverable: false,
        cause: err,
    };
}

/**
 * Convenience type guard: was this classified error non-recoverable?
 */
export function isNonRecoverable(cls: ClassifiedLlmError): boolean {
    return !cls.recoverable;
}

/**
 * True when the error looks like a client-side timeout/abort of an
 * in-flight LLM request (slow gateway, not a rejection). These are
 * worth exactly one retry: the call itself is side-effect-free, and
 * most gateway stalls clear within seconds.
 */
export function isTimeoutAbort(err: unknown): boolean {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        return true;
    }
    const lower = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    return (
        lower.includes("aborted") ||
        lower.includes("aborterror") ||
        lower.includes("timed out") ||
        lower.includes("timeout") ||
        lower.includes("etimedout")
    );
}

/**
 * Try to extract an HTTP status from an error object. Provider errors
 * in LangChain put the status in different places (`.status`,
 * `.statusCode`, `response.status`, `error.code`, etc.).
 */
function pickStatus(err: unknown): number | undefined {
    if (!err || typeof err !== "object") return undefined;
    const e = err as Record<string, unknown>;

    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
    if (typeof e.code === "number") return e.code;

    if (e.response && typeof e.response === "object") {
        const r = e.response as Record<string, unknown>;
        if (typeof r.status === "number") return r.status;
    }

    if (e.error && typeof e.error === "object") {
        const inner = e.error as Record<string, unknown>;
        if (typeof inner.status === "number") return inner.status;
        if (typeof inner.code === "number") return inner.code;
    }

    if (e.cause && typeof e.cause === "object") {
        const causeStatus = pickStatus(e.cause);
        if (causeStatus !== undefined) return causeStatus;
    }

    return undefined;
}
