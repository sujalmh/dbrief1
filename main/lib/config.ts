/**
 * Central Dynamic Configuration
 * ==============================
 * Single source of truth for every tunable value in the app. Each accessor
 * reads its environment variable at call time (with a default that preserves
 * the historical behavior), so the system is driven by configuration, request
 * inputs, and runtime state instead of hardcoded literals scattered across
 * modules.
 *
 * Conventions:
 * - `envStr / envInt / envFloat / envBool / envJson / envCsv` are the only
 *   places that touch `process.env` (guarded so this module is safe to import
 *   from client components — unknown vars simply yield defaults).
 * - Getters (functions) are preferred over frozen constants so tests and
 *   runtime overrides take effect without a server restart.
 * - Complex structures (provider catalogs, pattern tables, keyword lists) can
 *   be overridden wholesale via `*_JSON` env vars.
 *
 * To override locally, copy `env.example` to `.env.local`.
 */

// =============================================================================
// Env readers (the only direct process.env accessors in the app)
// =============================================================================

function rawEnv(name: string): string | undefined {
    try {
        if (typeof process === "undefined") return undefined;
        const env = (process as unknown as { env?: Record<string, string | undefined> }).env;
        const value = env?.[name];
        if (value === undefined || value === null || value === "") return undefined;
        return value;
    } catch {
        return undefined;
    }
}

export function envStr(name: string, fallback: string): string {
    return rawEnv(name) ?? fallback;
}

export function envInt(name: string, fallback: number): number {
    const raw = rawEnv(name);
    if (raw === undefined) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function envFloat(name: string, fallback: number): number {
    const raw = rawEnv(name);
    if (raw === undefined) return fallback;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function envBool(name: string, fallback: boolean): boolean {
    const raw = rawEnv(name);
    if (raw === undefined) return fallback;
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
    return fallback;
}

/** Parse a JSON env var; returns the fallback (and warns) when unset/invalid. */
export function envJson<T>(name: string, fallback: T): T {
    const raw = rawEnv(name);
    if (raw === undefined) return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch (error) {
        console.warn(`[config] Ignoring invalid JSON in ${name}:`, error instanceof Error ? error.message : error);
        return fallback;
    }
}

/** Parse a comma-separated env var into a string list. */
export function envCsv(name: string, fallback: string[]): string[] {
    const raw = rawEnv(name);
    if (raw === undefined) return fallback;
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : fallback;
}

// =============================================================================
// Season / year bounds (driven by the calendar + inputs, not literals)
// =============================================================================

export function minSeasonYear(): number {
    return envInt("F1_MIN_SEASON_YEAR", 1950);
}

/** How many years past the current calendar year are accepted (next season). */
export function seasonYearBuffer(): number {
    return envInt("F1_SEASON_YEAR_BUFFER", 2);
}

export function maxSeasonYear(): number {
    return new Date().getFullYear() + seasonYearBuffer();
}

/** First season with full telemetry/laps/weather coverage. */
export function telemetryStartYear(): number {
    return envInt("F1_TELEMETRY_START_YEAR", 2018);
}

/** Upper bound accepted by the RAG season filter (far-future guard). */
export function ragMaxSeasonYear(): number {
    return envInt("F1_RAG_MAX_SEASON_YEAR", 2100);
}

export function seasonYearRangeLabel(): string {
    return `${minSeasonYear()}-${new Date().getFullYear()}`;
}

// =============================================================================
// Execution (executor + research executor)
// =============================================================================

export const executionConfig = {
    stepTimeoutMs: () => envInt("F1_STEP_TIMEOUT_MS", 30_000),
    maxConcurrency: () => envInt("F1_MAX_CONCURRENCY", 6),
    maxRetries: () => envInt("F1_MAX_RETRIES", 1),
    retryBackoffBaseMs: () => envInt("F1_RETRY_BACKOFF_BASE_MS", 400),
    /** Non-retryable HTTP-ish status fragments (configurable for new backends). */
    nonRetryableStatusFragments: (): string[] => envCsv("F1_NON_RETRYABLE_STATUS", ["400", "401", "403", "404"]),
    maxContextTokens: () => envInt("F1_MAX_CONTEXT_TOKENS", 150_000),
    charsPerToken: () => envInt("F1_CHARS_PER_TOKEN", 3),
    maxRowsPerList: () => envInt("F1_MAX_ROWS_PER_LIST", 12),
    maxInlinePayloadChars: () => envInt("F1_MAX_INLINE_PAYLOAD_CHARS", 10_000),
    dedupIdenticalSteps: () => envBool("F1_EXECUTOR_DEDUP", true),
};

// =============================================================================
// Planner (query planner + research planner agent)
// =============================================================================

export const plannerConfig = {
    maxSteps: () => envInt("F1_PLANNER_MAX_STEPS", 5),
    deepMaxSteps: () => envInt("F1_PLANNER_DEEP_MAX_STEPS", 25),
    schemaMaxSteps: () => envInt("F1_PLANNER_SCHEMA_MAX_STEPS", 25),
    maxTasksPerIteration: () => envInt("F1_PLANNER_MAX_TASKS_PER_ITERATION", 6),
    evidenceTruncateChars: () => envInt("F1_PLANNER_EVIDENCE_TRUNCATE_CHARS", 2000),
    memoryTruncateChars: () => envInt("F1_PLANNER_MEMORY_TRUNCATE_CHARS", 1500),
    fastPathMaxMessageChars: () => envInt("F1_FASTPATH_MAX_MESSAGE_CHARS", 80),
    /** Fallback conversational reply when the model omits one. */
    fallbackReply: () =>
        envStr("F1_FALLBACK_REPLY", "Hey! \u{1F3CE}\uFE0F How can I help you with F1 today?"),
    fallbackReasoning: () =>
        envStr("F1_FALLBACK_REASONING", "Conversational message \u2014 no tools needed"),
};

// =============================================================================
// LLM timeouts / sampling / budgets
// =============================================================================

export const llmTimeouts = {
    intent: () => envInt("LLM_TIMEOUT_INTENT_MS", 15_000),
    planner: () => envInt("LLM_TIMEOUT_PLANNER_MS", 45_000),
    responder: () => envInt("LLM_TIMEOUT_RESPONDER_MS", 180_000),
    viz: () => envInt("LLM_TIMEOUT_VIZ_MS", 8_000),
    sources: () => envInt("LLM_TIMEOUT_SOURCES_MS", 8_000),
    critic: () => envInt("LLM_TIMEOUT_CRITIC_MS", 10_000),
};

export const llmSampling = {
    defaultTemperature: () => envFloat("LLM_TEMPERATURE_DEFAULT", 0.7),
    plannerTemperature: () => envFloat("LLM_TEMPERATURE_PLANNER", 0),
    responderReasoningTemperature: () => envFloat("LLM_TEMPERATURE_RESPONDER_REASONING", 0.3),
    sessionMetadataTemperature: () => envFloat("LLM_TEMPERATURE_SESSION_METADATA", 0.3),
    defaultMaxTokens: () => envInt("LLM_MAX_TOKENS_DEFAULT", 4096),
    plannerMaxTokens: () => envInt("LLM_MAX_TOKENS_PLANNER", 1500),
    responderMaxTokens: () => envInt("LLM_MAX_TOKENS_RESPONDER", 8192),
    sessionMetadataMaxTokens: () => envInt("LLM_MAX_TOKENS_SESSION_METADATA", 512),
};

// =============================================================================
// Provider gateway endpoints / client identity
// =============================================================================

export const gatewayConfig = {
    openRouterBaseUrl: () => envStr("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    zenBaseUrl: () => envStr("OPENCODE_ZEN_BASE_URL", "https://opencode.ai/zen/v1"),
    goBaseUrl: () => envStr("OPENCODE_GO_BASE_URL", "https://opencode.ai/zen/go/v1"),
    huggingFaceBaseUrl: () =>
        envStr("HUGGINGFACE_BASE_URL", "https://api-inference.huggingface.co/v1"),
    userAgent: () => envStr("OPENCODE_USER_AGENT", "f1-ai-chatbot/1.0"),
    sessionHeader: () => envStr("OPENCODE_SESSION_HEADER", "x-opencode-session"),
};

// =============================================================================
// F1 data API + GET cache
// =============================================================================

export const f1ApiConfig = {
    baseUrl: () => envStr("F1_API_URL", "http://localhost:8000"),
    toolTimeoutMs: () => envInt("F1_TOOL_TIMEOUT_MS", 30_000),
    maxResponseBytes: () => envInt("F1_MAX_RESPONSE_MB", 50) * 1024 * 1024,
    getCacheTtlMs: () => envInt("F1_GET_CACHE_TTL_MS", 5 * 60 * 1000),
    getCacheMaxEntries: () => envInt("F1_GET_CACHE_MAX_ENTRIES", 200),
};

// =============================================================================
// RAG retrieval (embeddings / vector search / rerank)
// =============================================================================

export const ragConfig = {
    embeddingsUrl: () => envStr("VOYAGE_EMBEDDINGS_URL", "https://ai.mongodb.com/v1/embeddings"),
    rerankUrl: () => envStr("VOYAGE_RERANK_URL", "https://ai.mongodb.com/v1/rerank"),
    embeddingModel: () => envStr("EMBEDDING_MODEL", "voyage-4"),
    embeddingDim: () => envInt("EMBEDDING_DIM", 1024),
    rerankModel: () => envStr("RERANK_MODEL", "rerank-3"),
    collection: () => envStr("RAG_COLLECTION", "fia_documents"),
    maxSubqueries: () => envInt("RAG_MAX_SUBQUERIES", 5),
    minSubqueries: () => envInt("RAG_MIN_SUBQUERIES", 2),
    defaultMatchCount: () => envInt("RAG_DEFAULT_MATCH_COUNT", 10),
    topNResults: () => envInt("RAG_TOP_N_RESULTS", 5),
    minRelevanceScore: () => envFloat("RAG_MIN_RELEVANCE_SCORE", 0.2),
    sectionVariants: (): Record<string, string[]> =>
        envJson("RAG_SECTION_VARIANTS_JSON", {
            Sporting: ["Sporting", "Section B [Sporting]"],
            Technical: ["Technical", "Section C [Technical]"],
            Financial: [
                "Financial",
                "Section D [Financial - F1 Teams]",
                "Section D [Financial Regulations - F1 Teams]",
                "Section E [Financial \u2013 PU Manufacturers]",
                "Section E [Financial Regulations - Power Unit Manufacturers]",
                "Section E [Financial - Power Unit Manufacturers]",
                "Section E [Financial - PU Manufacturers]",
            ],
        }),
};

// =============================================================================
// Research loop budgets + evidence store + confidence
// =============================================================================

export const researchConfig = {
    overallTimeoutMs: () => envInt("RESEARCH_OVERALL_TIMEOUT_MS", 5 * 60 * 1000),
    defaultMaxTasks: () => envInt("RESEARCH_DEFAULT_MAX_TASKS", 50),
    defaultMaxIterations: () => envInt("RESEARCH_DEFAULT_MAX_ITERATIONS", 20),
    deepMaxTasks: () => envInt("RESEARCH_DEEP_MAX_TASKS", 15),
    deepMaxIterations: () => envInt("RESEARCH_DEEP_MAX_ITERATIONS", 6),
    consecutiveStopsToHalt: () => envInt("RESEARCH_CONSECUTIVE_STOPS_TO_HALT", 2),
    criticMinCharsForReview: () => envInt("CRITIC_MIN_CHARS_FOR_REVIEW", 500),
    memoryMinTokenChars: () => envInt("MEMORY_MIN_TOKEN_CHARS", 3),
    maxEvidenceItems: () => envInt("EVIDENCE_MAX_ITEMS", 200),
    evidenceBudgetChars: () => envInt("EVIDENCE_BUDGET_CHARS", 120_000),
    evidenceMinPerItemChars: () => envInt("EVIDENCE_MIN_PER_ITEM_CHARS", 2000),
    evidenceDefaultTruncateChars: () => envInt("EVIDENCE_DEFAULT_TRUNCATE_CHARS", 8000),
    confidence: () => ({
        defaultCompleteness: envFloat("CONFIDENCE_DEFAULT_COMPLETENESS", 0.8),
        fullScoreSourceCount: envInt("CONFIDENCE_FULL_SCORE_SOURCE_COUNT", 5),
        maxConflictPenalty: envInt("CONFIDENCE_MAX_CONFLICT_PENALTY", 3),
        weightSourceCount: envFloat("CONFIDENCE_WEIGHT_SOURCE_COUNT", 0.3),
        weightCompleteness: envFloat("CONFIDENCE_WEIGHT_COMPLETENESS", 0.3),
        weightConflicts: envFloat("CONFIDENCE_WEIGHT_CONFLICTS", 0.2),
        weightDataQuality: envFloat("CONFIDENCE_WEIGHT_DATA_QUALITY", 0.2),
    }),
};

// =============================================================================
// Chat route: rate limits, validation caps, responder context, research opts
// =============================================================================

export const routeConfig = {
    rateLimitWindowMs: () => envInt("CHAT_RATE_LIMIT_WINDOW_MS", 60_000),
    rateLimitMaxRequests: () => envInt("CHAT_RATE_LIMIT_MAX", 20),
    rateLimitMaxKeys: () => envInt("RATE_LIMIT_MAX_KEYS", 5000),
    messageMaxChars: () => envInt("CHAT_MESSAGE_MAX_CHARS", 4000),
    historyMaxItems: () => envInt("CHAT_HISTORY_MAX_ITEMS", 50),
    historyMaxCharsPerItem: () => envInt("CHAT_HISTORY_MAX_CHARS", 8000),
    responderHistoryItems: () => envInt("CHAT_RESPONDER_HISTORY_ITEMS", 10),
    responderHistoryCharsPerItem: () => envInt("CHAT_RESPONDER_HISTORY_CHARS", 2000),
    imageMaxCount: () => envInt("CHAT_IMAGE_MAX_COUNT", 5),
    imageMaxBytes: () => envInt("CHAT_IMAGE_MAX_BYTES", 7_000_000),
    sessionIdMaxChars: () => envInt("CHAT_SESSION_ID_MAX_CHARS", 128),
    metadataTimeoutMs: () => envInt("SESSION_METADATA_TIMEOUT_MS", 10_000),
};

// =============================================================================
// Web search tool
// =============================================================================

export const searchConfig = {
    timeoutMs: () => envInt("SEARCH_TIMEOUT_MS", 15_000),
    baseUrl: () =>
        envStr(
            "SEARCH_BASE_URL",
            "https://api.duckduckgo.com/?q={query}&format=json&no_html=1&skip_disambig=1"
        ),
    relatedTopicsLimit: () => envInt("SEARCH_RELATED_TOPICS_LIMIT", 5),
    resultsLimit: () => envInt("SEARCH_RESULTS_LIMIT", 5),
};

// =============================================================================
// Simulation tool
// =============================================================================

export const simulationConfig = {
    horizons: (): string[] => envJson("SIMULATION_HORIZONS_JSON", ["lap", "race", "season", "custom"]),
    metrics: (): string[] => envJson("SIMULATION_METRICS_JSON", ["time", "points", "score", "position", "gap"]),
    iterationsMin: () => envInt("SIMULATION_ITERATIONS_MIN", 100),
    iterationsMax: () => envInt("SIMULATION_ITERATIONS_MAX", 10_000),
    iterationsDefault: () => envInt("SIMULATION_ITERATIONS_DEFAULT", 1000),
    referenceArrayFields: (): string[] =>
        envCsv("SIMULATION_REFERENCE_ARRAY_FIELDS", ["results", "laps", "tyres", "standings", "data", "messages", "values"]),
    metricDefaults: (): Record<string, { base: number; variance: number }> =>
        envJson("SIMULATION_METRIC_DEFAULTS_JSON", {
            time: { base: 90, variance: 15 },
            points: { base: 12, variance: 8 },
            score: { base: 50, variance: 25 },
            position: { base: 10, variance: 5 },
            gap: { base: 0, variance: 30 },
        }),
    metricConstraints: (): Record<string, { min?: number; max?: number; round?: boolean }> =>
        envJson("SIMULATION_METRIC_CONSTRAINTS_JSON", {
            time: { min: 1 },
            points: { min: 0, max: 25, round: true },
            score: { min: 0, max: 100 },
            position: { min: 1, max: 20, round: true },
        }),
    histogramBuckets: () => envInt("SIMULATION_HISTOGRAM_BUCKETS", 10),
    maxDegPerStint: () => envFloat("SIMULATION_MAX_DEG_PER_STINT", 8.0),
    compoundDegPerLap: (): Record<string, number> =>
        envJson("SIMULATION_COMPOUND_DEG_JSON", {
            SOFT: 0.06,
            MEDIUM: 0.04,
            HARD: 0.025,
            INTERMEDIATE: 0.05,
            WET: 0.045,
        }),
    compoundBasePace: (): Record<string, number> =>
        envJson("SIMULATION_COMPOUND_PACE_JSON", {
            SOFT: -0.4,
            MEDIUM: 0.0,
            HARD: 0.3,
            INTERMEDIATE: 3.0,
            WET: 5.0,
        }),
    fuelBurnPerLap: () => envFloat("SIMULATION_FUEL_BURN_PER_LAP", 0.035),
    defaultBaseLapTime: () => envFloat("SIMULATION_DEFAULT_BASE_LAP_TIME", 90),
    defaultPitStopSeconds: () => envFloat("SIMULATION_DEFAULT_PIT_STOP_SECONDS", 22.0),
};

// =============================================================================
// Citations / session metadata heuristics / client store defaults
// =============================================================================

export const citationsConfig = {
    maxCitations: () => envInt("MAX_CITATIONS", 20),
    maxSourceChars: () => envInt("MAX_CITATION_SOURCE_CHARS", 256),
    maxTypeChars: () => envInt("MAX_CITATION_TYPE_CHARS", 64),
    maxTitleChars: () => envInt("MAX_CITATION_TITLE_CHARS", 256),
    maxUrlChars: () => envInt("MAX_CITATION_URL_CHARS", 2048),
};

export const sessionMetadataConfig = {
    titleMaxChars: () => envInt("SESSION_TITLE_MAX_CHARS", 40),
    titleTruncateAt: () => envInt("SESSION_TITLE_TRUNCATE_AT", 37),
    wordCutThreshold: () => envInt("SESSION_TITLE_WORD_CUT_THRESHOLD", 20),
    telemetryKeywords: (): string[] =>
        envCsv("SESSION_TELEMETRY_KEYWORDS", ["telemetry", "speed", "throttle", "brake", "drs", "rpm", "gear"]),
    comparisonKeywords: (): string[] =>
        envCsv("SESSION_COMPARISON_KEYWORDS", [
            "vs",
            "versus",
            "compar",
            "faster",
            "slower",
            "better",
            "difference between",
            "who won",
            "qualifying",
            "pole",
        ]),
    strategyKeywords: (): string[] =>
        envCsv("SESSION_STRATEGY_KEYWORDS", [
            "strateg",
            "pit ?stop",
            "tyre",
            "tire",
            "compound",
            "stint",
            "undercut",
            "overcut",
        ]),
    fallbackTitle: () => envStr("SESSION_FALLBACK_TITLE", "New conversation"),
};

export const storeDefaults = {
    provider: () => envStr("STORE_DEFAULT_PROVIDER", "openrouter"),
    model: () => envStr("STORE_DEFAULT_MODEL", "nvidia/nemotron-3-ultra-550b-a55b:free"),
    temperature: () => envFloat("STORE_DEFAULT_TEMPERATURE", 0.7),
    maxTokens: () => envInt("STORE_DEFAULT_MAX_TOKENS", 8192),
    visualizationWidth: () => envInt("STORE_VISUALIZATION_WIDTH", 500),
    storageName: () => envStr("STORE_STORAGE_NAME", "f1-chat-storage"),
    storageVersion: () => envInt("STORE_STORAGE_VERSION", 4),
};

// =============================================================================
// Responder system prompt (override without a code change)
// =============================================================================

const DEFAULT_RESPONDER_SYSTEM_PROMPT = `You are an expert Formula 1 AI assistant with deep knowledge of F1 history, technical regulations, driver statistics, and race analysis.

## Your Role
- Answer questions about F1 using the data provided from official F1 sources
- Provide accurate, detailed responses based on the context
- Be conversational but precise
- Format responses nicely with markdown when appropriate

## Anti-Hallucination Rules (CRITICAL)
1. CRITICAL: You must answer ONLY from the F1 Data Context provided below. Do NOT use your training data or parametric knowledge for any factual claim.
2. If the F1 Data Context is empty, says "No data was retrieved", or does not contain information relevant to the question, respond: "I don't have data to answer this question. The data retrieval may have failed or this query may not be supported. Please try rephrasing."
3. Every factual statement (driver name, position, lap time, points) must be traceable to the data context. If you cannot find it in the context, say "Data not available."
4. Never guess driver codes, GP names, or session results. If the data doesn't contain it, say so.
5. For comparisons, highlight the key differences using the data provided.
6. Use driver abbreviations (VER, HAM, LEC) when referring to drivers \u2014 but only if those abbreviations appear in the data context.
7. Format lap times properly (e.g., 1:23.456) \u2014 using values from the data context only.

## Response Format
- Use markdown formatting for readability
- Use bullet points for lists
- Use tables for comparisons when appropriate
- Bold important information
- Keep responses focused and relevant
- When the F1 Data Context contains \`retrieve_regulations\` results, base every regulation/decision claim on the retrieved documents, preferring higher \`relevance_score\` hits`;

export function responderSystemPrompt(): string {
    return envStr("F1_RESPONDER_SYSTEM_PROMPT", DEFAULT_RESPONDER_SYSTEM_PROMPT);
}
