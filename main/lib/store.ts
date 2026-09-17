import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { get, set, del } from 'idb-keyval'

const idbStorage = {
    getItem: async (name: string): Promise<string | null> => {
        return (await get(name)) || null
    },
    setItem: async (name: string, value: string): Promise<void> => {
        await set(name, value)
    },
    removeItem: async (name: string): Promise<void> => {
        await del(name)
    },
}

export interface ResearchEvidence {
    id: string
    type: string
    source: { tool: string; taskId: string; args: Record<string, unknown> }
    race?: string
    season?: number
    driver?: string
    summary: string
    confidence: number
    /**
     * Full tool output for this evidence item. Present in live sessions;
     * persisted to the cloud store inline when small, offloaded to R2 via
     * `dataRef` when large (see lib/cf/store.ts). Needed so a
     * reopened session can re-render charts/debug without re-execution.
     */
    data?: unknown
    /** Storage path pointer when `data` was offloaded (e.g. telemetry dumps). */
    dataRef?: string | null
    /** True when `data` was truncated to fit Firestore limits. */
    dataTruncated?: boolean
}

export interface ResearchReflection {
    useful: boolean
    answeredPart: string
    stillMissing: string[]
    nextAction: 'call_tool' | 'stop'
    nextStrategy?: string
    reasoning: string
    iteration: number
}

export interface ResearchIteration {
    iteration: number
    tasks: {
        id: string
        description: string
        tool: string
        status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
        evidenceId?: string
        /** Tool args for this task (preserved from plan_iteration SSE). */
        args?: Record<string, unknown>
    }[]
    reasoning?: string
}

export interface ConfidenceScore {
    overall: number
    factors: {
        sourceCount: number
        completeness: number
        conflicts: number
        missingData: string[]
        dataQuality: number
    }
}

export interface ChartSpec {
    id: string
    type:
    | 'line'
    | 'bar'
    | 'scatter'
    | 'heatmap'
    | 'histogram'
    | 'horizontal_bar'
    | 'area'
    | 'stacked_bar'
    | 'dumbbell'
    | 'box_plot'
    | 'telemetry_multi'
    | 'kpi'
    title: string
    subtitle?: string
    dataSource: string
    xField: string
    yField: string
    groupField?: string
    purpose?: string
    question?: string
    insight?: string
    config: Record<string, unknown>
}

export interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: number
    reasoning?: string
    // For UI states
    isError?: boolean
    steps?: {
        description: string
        tool: string
        status: 'pending' | 'running' | 'success' | 'failed'
        result?: string
        /** Tool args for this step (preserved from the plan SSE event). */
        args?: Record<string, unknown>
        /** Error message when status is failed. */
        error?: string
        /** Wall time for this step in ms (when known). */
        durationMs?: number
    }[]
    /**
     * Pointer to the offloaded full visualization payload in Firebase
     * Storage (set when visualizationData exceeded inline limits).
     * On load the payload is fetched and merged back into
     * `visualizationData` so charts render without re-execution.
     */
    visualizationRef?: string | null
    /** True when visualizationData was truncated to fit Firestore limits. */
    visualizationTruncated?: boolean
    citations?: {
        source: string
        type: string
        /** Human-readable document title (falls back to `source`). */
        title?: string | null
        /** Source URL — renders as a clickable link when present. */
        url?: string | null
        /** Canonical link from the collection payload (preferred over `url`). */
        source_url?: string | null
    }[]
    visualizationData?: unknown
    /**
     * Non-fatal warning(s) emitted by the backend indicating that the
     * response was produced in a degraded mode (e.g. intent analysis
     * unavailable due to rate limit). Displayed as a small badge in the
     * message bubble so the user knows the answer may be best-effort.
     */
    degradedWarnings?: {
        stage: string
        kind: string
        message: string
    }[]
    /**
     * Per-message usage accounting (OpenRouter returns this natively per
     * the docs: prompt/completion tokens + cost in credits). When
     * `provider === 'openrouter'`, `cost` is real. For Gemini / HuggingFace
     * `cost` is null and only the token counts are populated.
     *
     * `model` is captured here (not just from settings) because the user
     * can change models mid-conversation — we want to display the model
     * that actually produced this response, not the current selection.
     */
    usage?: {
        provider: string
        model: string
        /**
         * Model id used by the planner (intent + step
         * decomposition). When planner and responder use
         * different models, the footer surfaces both so the
         * user knows which model handled which stage. The
         * aggregated token / cost fields still cover the
         * whole request — we don't try to split them per
         * stage because OpenRouter's `usage` block doesn't
         * make that easy to do accurately.
         */
        plannerModel?: string
        promptTokens: number
        completionTokens: number
        reasoningTokens?: number
        cachedTokens?: number
        totalTokens: number
        /** Cost in USD (credits). Null when the provider doesn't report it. */
        cost: number | null
        /** Upstream inference cost from OpenRouter (raw provider-side cost). */
        upstreamCost?: number | null
    }
    // Deep research mode fields
    researchType?: string
    iterations?: ResearchIteration[]
    evidence?: ResearchEvidence[]
    confidence?: ConfidenceScore
    reflections?: ResearchReflection[]
    chartSpecs?: ChartSpec[]
}

interface Settings {
    /** Memory-only BYOK override (never persisted — see persist partialize). */
    apiKey: string
    provider: string
    model: string
    /**
     * Dedicated model used by the query planner (intent analysis,
     * step decomposition, structured-output tool calls). Kept
     * separate from `model` (the responder) so the user can pick
     * a cheap fast model for planning and a more capable model
     * for the final answer, mirroring the split used by coding
     * assistants like Cursor / Continue / Aider.
     *
     * When empty, the server falls back to the provider's
     * built-in cheap planner model so the feature is fully
     * opt-in.
     */
    plannerModel: string
    temperature: number
    maxTokens: number
    deepResearchMode: boolean
    webSearchEnabled: boolean
    visualizeEnabled: boolean
    developerMode: boolean
    /**
     * User-curated list of additional model IDs (typically from
     * OpenRouter) that should appear in the model picker alongside
     * the built-in presets. Each entry is just the model id string
     * (e.g. "anthropic/claude-3.5-sonnet"). The picker can also
     * accept a free-text "Add custom model" entry — in that case
     * the id is appended to this list.
     */
    customModels: string[]
}

export interface GraphHistoryItem {
    id: string
    name: string
    type: 'lap_times' | 'telemetry' | 'comparison'
    data: unknown
    timestamp: number
}

/**
 * A single tool result forwarded to the visualization layer.
 * (Mirrors the `visualization` SSE payload items sent by /api/chat.)
 */
export interface VisualizationResultItem {
    tool: string
    args?: Record<string, unknown>
    success: boolean
    data?: unknown
    error?: string | null
}

/**
 * Session row kept in the client store. Mirrors the cloud ChatSession
 * shape but stays decoupled so the store doesn't import server types.
 * All fields optional except `id` so Firestore snapshots (which always
 * carry an id plus a subset of fields) assign cleanly in both directions.
 */
export interface StoredSession {
    id: string
    title?: string
    type?: string
    userId?: string
    createdAt?: unknown
    lastMessageAt?: unknown
    context?: Record<string, unknown>
}

interface ChatStore {
    messages: Message[]
    isLoading: boolean
    input: string
    settings: Settings
    visualizationData: unknown
    graphHistory: GraphHistoryItem[]

    activeMessageId: string | null
    setActiveMessageId: (id: string | null) => void

    currentSessionId: string | null
    setCurrentSessionId: (id: string | null) => void
    sessions: StoredSession[]
    setSessions: (sessions: StoredSession[]) => void

    isSettingsOpen: boolean
    setSettingsOpen: (isOpen: boolean) => void
    visualizationWidth: number
    updateVisualizationWidth: (width: number) => void
    isVisualizationCollapsed: boolean

    toggleVisualizationCollapse: (collapsed?: boolean) => void
    isSidebarOpen: boolean
    setSidebarOpen: (isOpen: boolean) => void

    // Actions
    setInput: (input: string) => void
    addMessage: (message: Message) => void
    setMessages: (messages: Message[]) => void
    setLoading: (isLoading: boolean) => void
    updateSettings: (settings: Partial<Settings>) => void
    updateMessage: (id: string, content: string, isError?: boolean) => void
    updateMessageSteps: (id: string, steps: Message['steps']) => void
    updateMessageReasoning: (id: string, reasoning: string) => void
    updateMessageVisualization: (id: string, data: unknown) => void
    updateMessageCitations: (id: string, citations: { source: string; type: string }[]) => void
    /**
     * Append a non-fatal degraded-mode warning to a message. The message
     * is updated incrementally — existing warnings are preserved. Used to
     * surface situations like "intent analysis was skipped due to rate
     * limit" so the user knows the answer may be best-effort.
     */
    addMessageDegradedWarning: (id: string, warning: { stage: string; kind: string; message: string }) => void
    /**
     * Attach usage accounting to a message. Replaces any prior usage
     * payload — only the final aggregated values should be sent.
     * Used by the chat handler when it receives the backend's `usage`
     * SSE event.
     */
    setMessageUsage: (
        id: string,
        usage: NonNullable<Message['usage']>
    ) => void
    setVisualizationData: (data: unknown) => void
    addGraphToHistory: (name: string, type: GraphHistoryItem['type'], data: unknown) => void
    removeGraphFromHistory: (id: string) => void
    clearMessages: () => void
    deleteMessage: (id: string) => void

    // Deep research mode actions
    updateMessageResearchType: (id: string, researchType: string) => void
    addResearchIteration: (id: string, iteration: ResearchIteration) => void
    updateResearchTaskStatus: (id: string, iteration: number, taskId: string, status: string, evidenceId?: string) => void
    addResearchEvidence: (id: string, evidence: ResearchEvidence) => void
    addResearchReflection: (id: string, reflection: ResearchReflection) => void
    setResearchConfidence: (id: string, confidence: ConfidenceScore) => void
    setResearchChartSpecs: (id: string, specs: ChartSpec[]) => void

    // Global Error State
    error: string | null
    setError: (error: string | null) => void

    // Monotonic message counter — independent of the system clock so
    // message ordering and IDs stay stable even if Date.now() jumps
    // backwards (NTP sync, timezone change, VM clock drift).
    messageCounter: number
    nextMessageId: () => string
}

const defaultSettings: Settings = {
    apiKey: '',
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    plannerModel: '',
    temperature: 0.7,
    // Note: the API route (getResponderModel) overrides this to 8192.
    // This value is kept for the settings UI but is not used by the API.
    maxTokens: 8192,
    deepResearchMode: false,
    webSearchEnabled: false,
    visualizeEnabled: false,
    developerMode: false,
    customModels: [],
}

// Monotonic counter for graphHistory IDs. Lives outside the store
// factory so it survives both `clearMessages` and zustand's persist
// rehydration (Date.now() can collide when two graphs are added in
// the same millisecond).
let graphCounter = 0;

export const useChatStore = create<ChatStore>()(
    persist(
        (set) => ({
            messages: [],
            isLoading: false,
            input: '',
            settings: defaultSettings,
            isSettingsOpen: false,
            visualizationData: null,
            visualizationWidth: 500,
            isVisualizationCollapsed: false,
            graphHistory: [],
            activeMessageId: null,
            error: null,
            currentSessionId: null,
            sessions: [],
            // Monotonic counter starts above Date.now() so any timestamps we
            // serialize later (Firestore, debugging) stay comparable.
            messageCounter: Date.now(),

            setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
            updateVisualizationWidth: (width) => set({ visualizationWidth: width }),
            toggleVisualizationCollapse: (collapsed) =>
                set((state) => ({ isVisualizationCollapsed: collapsed ?? !state.isVisualizationCollapsed })),
            isSidebarOpen: true,
            setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
            setActiveMessageId: (id) => set({ activeMessageId: id }),
            setCurrentSessionId: (id) => set({ currentSessionId: id }),
            setSessions: (sessions) => set({ sessions }),
            setInput: (input) => set({ input }),
            // nextMessageId bumps the monotonic counter; we never use
            // Date.now() here so two messages created in the same tick
            // still get distinct, comparable IDs.
            nextMessageId: () => {
                let nextId: string | undefined
                set((state) => {
                    const n = state.messageCounter + 1
                    nextId = `m_${n}`
                    return { messageCounter: n }
                })
                // set() is synchronous in zustand, so nextId is always
                // assigned by the time we read it. Fall back to a fresh
                // timestamp in the (impossible) edge case it isn't.
                return nextId ?? `m_${Date.now()}`
            },
            addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
            setMessages: (messages) => set({ messages }),
            setLoading: (isLoading) => set({ isLoading }),
            setError: (error) => set({ error }),
            updateSettings: (newSettings) =>
                set((state) => ({ settings: { ...state.settings, ...newSettings } })),
            updateMessage: (id, content, isError) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, content, isError } : msg
                    )
                })),
            updateMessageSteps: (id, steps) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, steps } : msg
                    )
                })),
            updateMessageReasoning: (id, reasoning) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, reasoning } : msg
                    )
                })),
            updateMessageVisualization: (id, data) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, visualizationData: data } : msg
                    )
                })),
            updateMessageCitations: (id, citations) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, citations } : msg
                    )
                })),
            addMessageDegradedWarning: (id, warning) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id
                            ? {
                                  ...msg,
                                  degradedWarnings: [
                                      ...(msg.degradedWarnings ?? []),
                                      warning,
                                  ],
                              }
                            : msg
                    )
                })),
            setMessageUsage: (id, usage) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id
                            ? { ...msg, usage }
                            : msg
                    )
                })),
            setVisualizationData: (data) => set({ visualizationData: data }),
            addGraphToHistory: (name, type, data) => set((state) => ({
                graphHistory: [
                    // Use a monotonically increasing counter instead of
                    // Date.now() so two graphs added in the same
                    // millisecond don't collide on the same ID.
                    { id: `g_${++graphCounter}`, name, type, data, timestamp: Date.now() },
                    ...state.graphHistory
                ]
            })),
            removeGraphFromHistory: (id) => set((state) => ({
                graphHistory: state.graphHistory.filter(item => item.id !== id)
            })),
            clearMessages: () => set({ messages: [], visualizationData: null, graphHistory: [], activeMessageId: null }),
            deleteMessage: (id) => set((state) => ({
                messages: state.messages.filter(msg => msg.id !== id)
            })),

            // Deep research mode actions
            updateMessageResearchType: (id, researchType) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, researchType } : msg
                    )
                })),
            addResearchIteration: (id, iteration) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id
                            ? { ...msg, iterations: [...(msg.iterations || []), iteration] }
                            : msg
                    )
                })),
            updateResearchTaskStatus: (id, iterationNum, taskId, status, evidenceId) =>
                set((state) => ({
                    messages: state.messages.map(msg => {
                        if (msg.id !== id || !msg.iterations) return msg
                        return {
                            ...msg,
                            iterations: msg.iterations.map(iter => {
                                if (iter.iteration !== iterationNum) return iter
                                return {
                                    ...iter,
                                    tasks: iter.tasks.map(task =>
                                        task.id === taskId ? { ...task, status: status as ResearchIteration['tasks'][number]['status'], evidenceId } : task
                                    )
                                }
                            })
                        }
                    })
                })),
            addResearchEvidence: (id, evidence) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id
                            ? { ...msg, evidence: [...(msg.evidence || []), evidence] }
                            : msg
                    )
                })),
            addResearchReflection: (id, reflection) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id
                            ? { ...msg, reflections: [...(msg.reflections || []), reflection] }
                            : msg
                    )
                })),
            setResearchConfidence: (id, confidence) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, confidence } : msg
                    )
                })),
            setResearchChartSpecs: (id, specs) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, chartSpecs: specs } : msg
                    )
                })),
        }),
        {
            name: 'f1-chat-storage',
            storage: createJSONStorage(() => idbStorage),
            // Persist settings, messages (which carry chartSpecs for
            // deep-research mode), the active visualization payload, the
            // graph history, and the panel UI state. We deliberately
            // exclude ephemeral per-message UI state (currentIndex,
            // localWidth during resize, etc.) and the loading flag.
            // SECURITY: `settings.apiKey` is NEVER persisted (memory-only).
            // Persisted IndexedDB is readable by any XSS payload; the key
            // lives in the httpOnly `api_key` cookie + server env instead.
            partialize: (state) => {
                const { apiKey: _dropped, ...safeSettings } = state.settings;
                void _dropped;
                return {
                    settings: safeSettings,
                    messages: state.messages,
                    visualizationData: state.visualizationData,
                    graphHistory: state.graphHistory,
                    isVisualizationCollapsed: state.isVisualizationCollapsed,
                    visualizationWidth: state.visualizationWidth,
                };
            },
            // Bump the version when the persisted shape changes so old
            // clients drop stale data instead of crashing on load.
            version: 5,
            // v2 -> v3: Settings gained a `customModels: string[]` field.
            // v3 -> v4: Settings gained a `plannerModel: string` field
            //   (the dedicated planner model, separate from `model`).
            // v4 -> v5: `settings.apiKey` is no longer persisted (H5: keys
            //   in IndexedDB are XSS-exfiltratable). Dropped on migrate.
            // We backfill both on the fly so existing users keep their
            // messages (with the new optional `usage.plannerModel`
            // field left as undefined, which the UI handles by hiding
            // the planner row in the footer).
            migrate: (persistedState) => {
                const state = (persistedState ?? {}) as Partial<{
                    settings: Partial<Settings>
                    messages: Message[]
                }>
                if (state.settings) {
                    if (!Array.isArray(state.settings.customModels)) {
                        state.settings = { ...state.settings, customModels: [] }
                    }
                    if (typeof (state.settings as Partial<Settings>).plannerModel !== "string") {
                        state.settings = { ...state.settings, plannerModel: "" }
                    }
                    // H5: purge any key persisted by older versions.
                    if ("apiKey" in state.settings) {
                        const { apiKey: _old, ...rest } = state.settings as Partial<Settings> & { apiKey?: unknown };
                        void _old;
                        state.settings = { ...rest, apiKey: "" };
                    }
                }
                return state as { settings?: Partial<Settings>; messages?: Message[] }
            },
        }
    )
)
