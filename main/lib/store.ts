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
    /** True when `data` was truncated to fit stored-doc limits. */
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
     * Pointer to the offloaded full visualization payload in R2
     * (set when visualizationData exceeded inline limits).
     * On load the payload is fetched and merged back into
     * `visualizationData` so charts render without re-execution.
     */
    visualizationRef?: string | null
    /** True when visualizationData was truncated to fit stored-doc limits. */
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
     * Per-message usage accounting. `provider` is the AI mode
     * ("managed" | "byok"). `cost` is real when the gateway reports
     * it, else null and only token counts are populated.
     *
     * `model` is captured here (not just from settings) because it
     * records the model that actually produced this response.
     */
    usage?: {
        provider: string
        model: string
        /**
         * Legacy: planner model id for messages produced before the
         * managed/BYOK simplification (when planner and responder could
         * differ). Planner and responder always share one model now.
         * Kept so old messages still render.
         */
        plannerModel?: string
        promptTokens: number
        completionTokens: number
        reasoningTokens?: number
        cachedTokens?: number
        totalTokens: number
        /** Cost in USD. Null when the gateway doesn't report it. */
        cost: number | null
        /** Upstream inference cost (raw provider-side cost). */
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

export type AiModeSetting = "managed" | "byok";

interface Settings {
    /**
     * Which model serves this client:
     * - "managed": the app owner's model (OpenCode Go, MiMo V2.5).
     *   The user picks nothing; the server resolves everything from env.
     * - "byok": brought by the user via Settings (base URL + model id
     *   + friendly name below; the API key itself lives in an httpOnly
     *   cookie, never in localStorage).
     */
    aiMode: AiModeSetting;
    /** BYOK: OpenAI-compatible base URL (the "model url"). */
    byokBaseUrl: string;
    /** BYOK: model identifier sent to the API. */
    byokModelId: string;
    /** BYOK: friendly display name shown in the UI. */
    byokModelName: string;
    deepResearchMode: boolean
    webSearchEnabled: boolean
    visualizeEnabled: boolean
    developerMode: boolean
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
 * All fields optional except `id` so stored snapshots (which always
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
    aiMode: 'managed',
    byokBaseUrl: '',
    byokModelId: '',
    byokModelName: '',
    deepResearchMode: false,
    webSearchEnabled: false,
    visualizeEnabled: false,
    developerMode: false,
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
            // serialize later (cloud storage, debugging) stay comparable.
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
            name: 'dbrief1-storage',
            storage: createJSONStorage(() => idbStorage),
            // Persist settings, messages (which carry chartSpecs for
            // deep-research mode), the active visualization payload, the
            // graph history, and the panel UI state. We deliberately
            // exclude ephemeral per-message UI state (currentIndex,
            // localWidth during resize, etc.) and the loading flag.
            // (BYOK keys are never in settings — they live in the
            // httpOnly cookie — so nothing sensitive is persisted here.)
            partialize: (state) => ({
                settings: state.settings,
                messages: state.messages,
                visualizationData: state.visualizationData,
                graphHistory: state.graphHistory,
                isVisualizationCollapsed: state.isVisualizationCollapsed,
                visualizationWidth: state.visualizationWidth,
            }),
            // Bump the version when the persisted shape changes so old
            // clients drop stale data instead of crashing on load.
            version: 6,
            // v2 -> v3: Settings gained a `customModels: string[]` field.
            // v3 -> v4: Settings gained a `plannerModel: string` field.
            // v4 -> v5: `settings.apiKey` is no longer persisted (keys
            //   in IndexedDB are XSS-exfiltratable). Dropped on migrate.
            // v5 -> v6: two-mode simplification — Settings is now
            //   (aiMode + byokBaseUrl/byokModelId/byokModelName).
            //   provider/model/plannerModel/temperature/maxTokens/apiKey/
            //   customModels are dropped; messages keep rendering (the
            //   `usage` block is untouched).
            migrate: (persistedState) => {
                const state = (persistedState ?? {}) as Partial<{
                    settings: Partial<Settings> & Record<string, unknown>
                    messages: Message[]
                }>
                if (state.settings) {
                    const s = state.settings;
                    const aiMode = s.aiMode === "byok" ? "byok" : "managed";
                    state.settings = {
                        ...defaultSettings,
                        aiMode,
                        byokBaseUrl: typeof s.byokBaseUrl === "string" ? s.byokBaseUrl : "",
                        byokModelId: typeof s.byokModelId === "string" ? s.byokModelId : "",
                        byokModelName: typeof s.byokModelName === "string" ? s.byokModelName : "",
                        deepResearchMode: s.deepResearchMode === true,
                        webSearchEnabled: s.webSearchEnabled === true,
                        visualizeEnabled: s.visualizeEnabled === true,
                        developerMode: s.developerMode === true,
                    };
                }
                return state as { settings?: Partial<Settings>; messages?: Message[] }
            },
        }
    )
)
