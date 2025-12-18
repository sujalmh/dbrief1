import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
    visualizationData?: any
}

interface Settings {
    apiKey: string
    provider: string
    model: string
    temperature: number
    maxTokens: number
    reasoningEnabled: boolean
    webSearchEnabled: boolean
    visualizeEnabled: boolean
    developerMode: boolean
}

export interface GraphHistoryItem {
    id: string
    name: string
    type: 'lap_times' | 'telemetry' | 'comparison'
    data: any
    timestamp: number
}

interface ChatStore {
    messages: Message[]
    isLoading: boolean
    input: string
    settings: Settings
    visualizationData: any | null
    graphHistory: GraphHistoryItem[]

    isSettingsOpen: boolean
    setSettingsOpen: (isOpen: boolean) => void
    visualizationWidth: number
    updateVisualizationWidth: (width: number) => void
    isVisualizationCollapsed: boolean
    toggleVisualizationCollapse: (collapsed?: boolean) => void

    // Actions
    setInput: (input: string) => void
    addMessage: (message: Message) => void
    setMessages: (messages: Message[]) => void
    setLoading: (isLoading: boolean) => void
    updateSettings: (settings: Partial<Settings>) => void
    updateMessage: (id: string, content: string, isError?: boolean) => void
    updateMessageSteps: (id: string, steps: Message['steps']) => void
    updateMessageVisualization: (id: string, data: any) => void
    setVisualizationData: (data: any) => void
    addGraphToHistory: (name: string, type: GraphHistoryItem['type'], data: any) => void
    removeGraphFromHistory: (id: string) => void
    clearMessages: () => void
}

const defaultSettings: Settings = {
    apiKey: '',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    temperature: 0.7,
    maxTokens: 1000,
    reasoningEnabled: false,
    webSearchEnabled: false,
    visualizeEnabled: false,
    developerMode: false,
}

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

            setSettingsOpen: (isOpen) => set({ isSettingsOpen: isOpen }),
            updateVisualizationWidth: (width) => set({ visualizationWidth: width }),
            toggleVisualizationCollapse: (collapsed) =>
                set((state) => ({ isVisualizationCollapsed: collapsed ?? !state.isVisualizationCollapsed })),
            setInput: (input) => set({ input }),
            addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
            setMessages: (messages) => set({ messages }),
            setLoading: (isLoading) => set({ isLoading }),
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
            updateMessageVisualization: (id, data) =>
                set((state) => ({
                    messages: state.messages.map(msg =>
                        msg.id === id ? { ...msg, visualizationData: data } : msg
                    )
                })),
            setVisualizationData: (data) => set({ visualizationData: data }),
            addGraphToHistory: (name, type, data) => set((state) => ({
                graphHistory: [
                    { id: Date.now().toString(), name, type, data, timestamp: Date.now() },
                    ...state.graphHistory
                ]
            })),
            removeGraphFromHistory: (id) => set((state) => ({
                graphHistory: state.graphHistory.filter(item => item.id !== id)
            })),
            clearMessages: () => set({ messages: [], visualizationData: null, graphHistory: [] }),
        }),
        {
            name: 'f1-chat-storage',
            partialize: (state) => ({ settings: state.settings, messages: state.messages }),
        }
    )
)
