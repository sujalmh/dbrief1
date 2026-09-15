import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { get, set, del } from 'idb-keyval'
import { storeDefaults } from './config'

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
    }[]
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
    usage?: {
        provider: string
        model: string
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

export type AiModeSetting = "managed" | "byok";

interface Settings {
    aiMode: AiModeSetting;
    byokBaseUrl: string;
    byokModelId: string;
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
 * Session row kept in the client store. Mirrors the Firestore ChatSession
 * shape but stays decoupled so the store doesn't import firebase types.
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
            visualizationWidth: storeDefaults.visualizationWidth(),
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
            name: storeDefaults.storageName(),
            storage: createJSONStorage(() => idbStorage),
            // Persist settings, messages (which carry chartSpecs for
            // deep-research mode), the active visualization payload, the
            // graph history, and the panel UI state. We deliberately
            // exclude ephemeral per-message UI state (currentIndex,
            // localWidth during resize, etc.) and the loading flag.
            partialize: (state) => ({
                settings: state.settings,
                messages: state.messages,
                visualizationData: state.visualizationData,
                graphHistory: state.graphHistory,
                isVisualizationCollapsed: state.isVisualizationCollapsed,
                visualizationWidth: state.visualizationWidth,
            }),
            version: 5,
            migrate: (persistedState) => {
                const state = (persistedState ?? {}) as Partial<{
                    settings: Record<string, unknown>
                    messages: Message[]
                }>
                if (state.settings) {
                    const s = state.settings as Record<string, unknown>;
                    const aiMode = s.aiMode === "byok" ? "byok" : "managed";
                    const next: Settings = {
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
                    state.settings = next as unknown as Record<string, unknown>;
                }
                return state as unknown as { settings?: Partial<Settings>; messages?: Message[] }
            },
        }
    )
)
