/**
 * Jev Pre-Classifier (System One, via OpenCode Zen)
 * ==================================================
 * Fast typed classification of user prompts BEFORE the full
 * planner → executor → responder pipeline.
 *
 * Why: the planner is a full LLM call (up to 60s timeout, thousands of
 * tokens of prompt). Jev is a decision-only model: no text generation,
 * just typed answers + probabilities, typically ~1s. A single SystemOne
 * request evaluates all questions in parallel, so adding questions barely
 * changes latency.
 *
 * Usage format (verified against the live endpoint):
 *   POST https://opencode.ai/zen/v1/systemone
 *   Authorization: Bearer <OPENCODE_ZEN_API_KEY>
 *   { "model": "jev-1.13-free",
 *     "state": "<user message>",
 *     "questions": {
 *       "intent": { "type": "choice", "instructions": "...",
 *                   "criteria": { "<option>": "<rubric>", ... } },
 *       "is_conversational": { "type": "noul", "instructions": "..." },
 *       "is_recency": { "type": "noul", "instructions": "..." },
 *       "is_meaningful": { "type": "noul", "instructions": "..." },
 *       "is_in_scope": { "type": "noul", "instructions": "..." } } }
 * Response:
 *   { "model": "jev-1.13-free",
 *     "answers": {
 *       "intent": { "type": "choice", "choice": "...",
 *                   "probabilities": {...}, "confidence": 0..1 },
 *       "is_conversational": { "type": "noul", "noul": 0..1 },
 *       "is_recency": { "type": "noul", "noul": 0..1 },
 *       "is_meaningful": { "type": "noul", "noul": 0..1 },
 *       "is_in_scope": { "type": "noul", "noul": 0..1 } },
 *     "usage": { "input_tokens": n, "output_tokens": n } }
 *
 * See: https://opencode.ai/docs/zen#jev
 *      https://docs.typesafe.ai/api
 *      https://docs.typesafe.ai/patterns/intent-routing (confidence-gated routing)
 *
 * Design (confidence-gated routing):
 * - High-confidence `conversational` → skip the planner LLM entirely and
 *   return a canned reply (biggest speedup: 2 LLM calls saved).
 * - `recency_news` (or high is_recency noul) → force the planner's
 *   recency-only web path even when the user toggled web search off,
 *   same as the existing regex fallback.
 * - Low confidence (< threshold) → fail open to the full pipeline.
 *   The classifier NEVER blocks chat: any error/timeout/misconfig
 *   returns null and the route proceeds exactly as before.
 */

import { z } from "zod";
import { getManagedApiKey } from "./providers";
import { OPENCODE_SESSION_HEADER, OPENCODE_USER_AGENT } from "./llm";

// =============================================================================
// Constants
// =============================================================================

/** OpenCode Zen SystemOne endpoint (serves jev-1.13 + jev-1.13-free). */
export const JEV_SYSTEMONE_URL = "https://opencode.ai/zen/v1/systemone";

/** Default model: the limited-time free Jev. Override with JEV_MODEL=jev-1.13. */
export const JEV_DEFAULT_MODEL = "jev-1.13-free";

/** Bounded wait for the classifier — it must never stall the chat stream. */
export const JEV_TIMEOUT_MS = (() => {
    const raw = process.env.JEV_TIMEOUT_MS;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 30_000) : 8_000;
})();

/** Model id actually sent (env override, trimmed, fallback to free). */
export function getJevModelId(): string {
    const raw = (process.env.JEV_MODEL || "").trim();
    return raw || JEV_DEFAULT_MODEL;
}

/**
 * Kill-switch for before/after testing and ops: JEV_ENABLED=false|0|off
 * disables the classifier (classifyPrompt returns null immediately and
 * the route runs the legacy full-pipeline path). Default: enabled.
 */
export function isJevEnabled(): boolean {
    const raw = (process.env.JEV_ENABLED || "").trim().toLowerCase();
    return raw !== "false" && raw !== "0" && raw !== "off" && raw !== "disabled";
}

// Confidence gates (calibrated against live probes, 2026-09-29):
// - "Hey! How can you help with F1?" → choice conversational 1.0, noul 0.42
// - "Who won the last race?" → choice recency_news 0.81/conf 0.76, noul 0.97
// - telemetry compare → choice race_result 0.99, conversational noul 0.02
// - simulation what-if → choice simulation 1.0
// - "Who got the first penalty in 2024?" → top prob 0.41, conf 0.26 (must fall through)

/** Choice must pick conversational with at least this confidence for fast-path. */
export const JEV_CONVERSATIONAL_CONFIDENCE_MIN = 0.7;
/** Companion noul must also clear this (blocks false fast-paths on data queries). */
export const JEV_CONVERSATIONAL_NOUL_MIN = 0.35;
/** The message must look coherent (blocks gibberish fast-paths — see sweep). */
export const JEV_MEANINGFUL_NOUL_MIN = 0.5;
/** Choice picks recency_news with at least this confidence to force web-recency. */
export const JEV_RECENCY_CHOICE_CONFIDENCE_MIN = 0.5;
/** …or the recency noul alone clears this. */
export const JEV_RECENCY_NOUL_MIN = 0.7;

/** Canned reply for the conversational fast-path (mirrors the planner prompt). */
export const JEV_CONVERSATIONAL_REPLY =
    "Hey! 🏎️ I can pull race results, compare drivers, analyze telemetry, explain regulations, or run what-if simulations — what are you curious about?";

// =============================================================================
// Types
// =============================================================================

export const JEV_INTENTS = [
    "conversational",
    "race_result",
    "standings",
    "telemetry",
    "regulations",
    "recency_news",
    "simulation",
    "history_general",
] as const;

export type JevIntent = (typeof JEV_INTENTS)[number];

export interface JevClassification {
    intent: JevIntent;
    /** Choice confidence 0..1 (derived from the probability distribution). */
    confidence: number;
    /** Full per-option distribution (sums to 1). */
    probabilities: Record<string, number>;
    /** Noul P(conversational) 0..1. */
    conversationalNoul: number;
    /** Noul P(recency) 0..1. */
    recencyNoul: number;
    /** Noul P(coherent/meaningful) 0..1. */
    meaningfulNoul: number;
    /** Noul P(this F1 assistant should handle it) 0..1. */
    inScopeNoul: number;
    /** Round-trip latency in ms (for observability). */
    latencyMs: number;
    /** Model that answered (echoed from the response). */
    model: string;
}

export interface ClassifyOptions {
    /** Per-conversation id → x-opencode-session header (routing + caching). */
    sessionId?: string;
    /** Per-call timeout override (ms). */
    timeoutMs?: number;
    /** Model override (defaults to JEV_MODEL / jev-1.13-free). */
    model?: string;
    /**
     * Recent conversation turns for follow-up resolution ("and in 2023?").
     * Folded into the evaluated state (labeled, truncated) so pronouns and
     * topic continuity classify correctly. Empty → state is just the message.
     */
    history?: JevHistoryItem[];
}

/** A single conversation turn passed to the classifier for context. */
export interface JevHistoryItem {
    role: string;
    content: string;
}

// =============================================================================
// Question definition (single source of truth)
// =============================================================================

function buildJevQuestions(): Record<string, unknown> {
    return {
        intent: {
            type: "choice",
            instructions: "What does the user want? Choose the single best match.",
            criteria: {
                conversational:
                    "Greeting, thanks, goodbye, small talk, or asking what the assistant can do. No F1 data needed.",
                race_result:
                    "Wants race, qualifying, sprint, practice or session results, winners, podiums, lap times for a specific GP and year.",
                standings:
                    "Wants championship points, driver or constructor standings, season rankings.",
                telemetry:
                    "Wants telemetry traces, speed/throttle/brake data, driver comparisons, fastest laps, tyre strategy, weather or race-control detail.",
                regulations:
                    "Wants FIA rules, technical or sporting regulations, penalties, fines, disqualifications, stewards decisions, investigations, protests or appeals.",
                recency_news:
                    "Asks about the LATEST or CURRENT race, season or standings, breaking news, or who won most recently. Needs web search. Historical 'when did X last …' questions are NOT this.",
                simulation:
                    "What-if, hypothetical, counterfactual, predict, project or simulate a scenario.",
                history_general:
                    "General F1 history, driver biography, explains a concept, historical 'when did X last …' lookups, or any other F1 data lookup.",
            },
        },
        is_conversational: {
            type: "noul",
            instructions:
                "Is this message plain conversation (greeting, thanks, goodbye, capability question) with no request for F1 data, analysis, or news?",
        },
        is_recency: {
            type: "noul",
            instructions:
                "Does this ask about the latest or most recent race, the current season, or breaking news? Historical questions (e.g. 'when did X last win') do NOT count.",
        },
        is_meaningful: {
            type: "noul",
            instructions:
                "Is this a coherent, meaningful message (not random characters, gibberish, or keysmash)?",
        },
        is_in_scope: {
            type: "noul",
            instructions:
                "Should this Formula 1 assistant handle the current message? Yes for F1/motorsport questions, plain chit-chat (greetings, thanks, goodbyes), questions about its capabilities, and follow-ups to the previous conversation. No for unrelated tasks (homework, recipes, poems, other sports, coding, general knowledge).",
        },
    };
}

// =============================================================================
// Response validation
// =============================================================================

const JevResponseSchema = z.object({
    model: z.string().optional(),
    answers: z.object({
        intent: z.object({
            type: z.literal("choice"),
            choice: z.string(),
            probabilities: z.record(z.string(), z.number()),
            confidence: z.number(),
        }),
        is_conversational: z.object({
            type: z.literal("noul"),
            noul: z.number(),
        }),
        is_recency: z.object({
            type: z.literal("noul"),
            noul: z.number(),
        }),
        is_meaningful: z.object({
            type: z.literal("noul"),
            noul: z.number(),
        }),
        is_in_scope: z.object({
            type: z.literal("noul"),
            noul: z.number(),
        }),
    }),
});

function clamp01(n: number): number {
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function isKnownIntent(s: string): s is JevIntent {
    return (JEV_INTENTS as readonly string[]).includes(s);
}

/**
 * Build the evaluated state: the bare message for standalone turns, or the
 * recent conversation (labeled, oldest-first, truncated) plus the current
 * message for follow-ups. Keeps Jev's topic continuity ("and in 2023?")
 * without changing standalone-turn behavior.
 */
export function buildJevState(message: string, history: JevHistoryItem[] = []): string {
    const turns = (history || [])
        .filter(
            (t) =>
                t &&
                (t.role === "user" || t.role === "assistant") &&
                typeof t.content === "string" &&
                t.content.trim()
        )
        .slice(-4)
        .map((t) => `${t.role}: ${t.content.trim().slice(0, 300)}`);
    if (turns.length === 0) return message;
    return `Previous conversation (oldest first):\n${turns.join("\n")}\n\nCurrent message:\n${message}`;
}

// =============================================================================
// API
// =============================================================================

/** True when the server can reach Zen SystemOne (reuses the managed key). */
export function isJevConfigured(): boolean {
    return !!getManagedApiKey();
}

/**
 * Classify a user prompt with Jev. FAIL-OPEN: returns null on any
 * misconfiguration, timeout, network error, or malformed response —
 * callers must proceed down the normal pipeline when null.
 */
export async function classifyPrompt(
    state: string,
    opts: ClassifyOptions = {}
): Promise<JevClassification | null> {
    const text = (state || "").trim();
    if (!text) return null;
    if (!isJevEnabled()) return null;
    const apiKey = getManagedApiKey();
    if (!apiKey) return null;

    const model = (opts.model || "").trim() || getJevModelId();
    const timeoutMs = opts.timeoutMs ?? JEV_TIMEOUT_MS;
    const startedAt = Date.now();
    const evalState = buildJevState(text, opts.history).slice(0, 2000);

    let res: Response;
    try {
        res = await fetch(JEV_SYSTEMONE_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
                "User-Agent": OPENCODE_USER_AGENT,
                ...(opts.sessionId ? { [OPENCODE_SESSION_HEADER]: opts.sessionId } : {}),
            },
            body: JSON.stringify({
                model,
                state: evalState,
                questions: buildJevQuestions(),
            }),
            signal: AbortSignal.timeout(timeoutMs),
        });
    } catch {
        return null;
    }

    if (!res.ok) return null;

    let json: unknown;
    try {
        json = await res.json();
    } catch {
        return null;
    }

    const parsed = JevResponseSchema.safeParse(json);
    if (!parsed.success) return null;
    const { answers } = parsed.data;
    if (!isKnownIntent(answers.intent.choice)) return null;

    return {
        intent: answers.intent.choice,
        confidence: clamp01(answers.intent.confidence),
        probabilities: Object.fromEntries(
            Object.entries(answers.intent.probabilities).map(([k, v]) => [k, clamp01(v)])
        ),
        conversationalNoul: clamp01(answers.is_conversational.noul),
        recencyNoul: clamp01(answers.is_recency.noul),
        meaningfulNoul: clamp01(answers.is_meaningful.noul),
        inScopeNoul: clamp01(answers.is_in_scope.noul),
        latencyMs: Date.now() - startedAt,
        model: parsed.data.model || model,
    };
}

/**
 * Conversational fast-path gate: the choice (high confidence) AND both
 * companion nouls must agree — conversational AND coherent. Requiring all
 * three blocks false fast-paths where a data question is misclassified as
 * chit-chat, or gibberish defaults to conversational (both observed live),
 * which would wrongly skip the data pipeline with no recovery.
 */
export function isConversationalFastPath(c: JevClassification | null): boolean {
    if (!c) return false;
    return (
        c.intent === "conversational" &&
        c.confidence >= JEV_CONVERSATIONAL_CONFIDENCE_MIN &&
        c.conversationalNoul >= JEV_CONVERSATIONAL_NOUL_MIN &&
        c.meaningfulNoul >= JEV_MEANINGFUL_NOUL_MIN
    );
}

/**
 * Recency gate: the choice picks recency_news confidently, OR the recency
 * noul fires while the choice itself is uncertain. The second leg is
 * deliberate confidence-routing (see docs.typesafe.ai/confidence): a
 * confident data intent (race_result 1.0, standings 0.70 — observed live)
 * beats a general recency noul, so the noul can only override when the
 * model isn't confidently saying something else. Either way this only
 * forces the planner's recency-only web path (same effect as the
 * `isRecencyQuery` regex, but semantic).
 */
export function isRecencyRoute(c: JevClassification | null): boolean {
    if (!c) return false;
    if (c.intent === "recency_news" && c.confidence >= JEV_RECENCY_CHOICE_CONFIDENCE_MIN) {
        return true;
    }
    if (c.confidence >= 0.7) {
        // Confident data intent — the noul cannot override it.
        return false;
    }
    return c.recencyNoul >= JEV_RECENCY_NOUL_MIN;
}

// =============================================================================
// Off-topic guard (F1-only app)
// =============================================================================
// The app answers Formula 1 questions. Anything else (homework, recipes,
// poems, other sports, general coding, …) is refused BEFORE the pipeline —
// no planner LLM call, no tools, no responder call. Previously such prompts
// fell into the planner's conversational direct-reply path and got answered.

/**
 * Scope thresholds — calibrated by live sweep (18 F1 + 8 unrelated + 2
 * follow-up prompts):
 * - F1 prompts score 0.86–0.98, except bare "latest news" at 0.48.
 * - Unrelated tasks score 0.02–0.05 (haiku, math, recipes, Super Bowl,
 *   quicksort), except jokes at 0.23–0.48 (chit-chat-shaped).
 * - Greetings/capability questions score 0.90–0.93.
 *
 * Two tiers: confident out-of-scope (< MIN) always refuses; the middle
 * band (< CHAT_MIN) refuses only chit-chat-shaped turns that would
 * otherwise take the conversational fast-path (jokes, trivia) instead of
 * serving them the capability greeting. Bare "latest news" (0.48,
 * recency-shaped, not fast-path-eligible) still reaches the pipeline.
 */
export const JEV_IN_SCOPE_MIN = 0.4;
export const JEV_IN_SCOPE_CHAT_MIN = 0.6;

/** Streamed refusal for out-of-scope prompts (mirrors the fast-path style). */
export const JEV_OFF_TOPIC_REPLY =
    "I'm an F1-only assistant, so I can't help with that. 🏎️ I can pull race results, compare drivers, analyze telemetry, explain regulations, or run what-if simulations — got an F1 question for me?";

/**
 * Off-topic refusal gate. Checked BEFORE the conversational fast-path so
 * chit-chat-shaped off-topic prompts ("what's the capital of France?",
 * scope 0.05 — observed live) refuse instead of receiving the capability
 * greeting. Returns false (→ fast-path/pipeline) when the classifier is
 * unavailable or the scope signal is ambiguous — fail toward answering.
 */
export function isOffTopicRefusal(c: JevClassification | null): boolean {
    if (!c) return false;
    if (c.inScopeNoul < JEV_IN_SCOPE_MIN) return true;
    if (c.inScopeNoul < JEV_IN_SCOPE_CHAT_MIN && isConversationalFastPath(c)) return true;
    return false;
}
