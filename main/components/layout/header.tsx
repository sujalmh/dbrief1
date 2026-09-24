"use client"

import { Flag, Settings, Sun, Moon, Info, Download, FileText, FileJson, Menu } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useMemo } from "react"
import { exportConversation } from "@/lib/utils/export-conversation"

export function Header() {
    // Slice subscriptions: `messages` changes on every streamed token, so
    // this component selects only the active message's visualization ref
    // (stable across token frames) plus a message count for the export
    // button. Export handlers read the full array via getState() on click.
    const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
    const activeMessageId = useChatStore((s) => s.activeMessageId)
    const activeVisualizationData = useChatStore((s) =>
        s.activeMessageId
            ? (s.messages.find((m) => m.id === s.activeMessageId)?.visualizationData ?? null)
            : null
    )
    const hasMessages = useChatStore((s) => s.messages.length > 0)
    const sessions = useChatStore((s) => s.sessions)
    const currentSessionId = useChatStore((s) => s.currentSessionId)
    const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
    const isSidebarOpen = useChatStore((s) => s.isSidebarOpen)
    const { setTheme, theme } = useTheme()

    const toggleTheme = () => {
        setTheme(theme === "light" ? "dark" : "light")
    }

    // Derive context from the active message
    const context = useMemo(() => {
        // visualizationData is untyped at the store boundary (tool-result
        // array in standard mode, ChartSpec[] in deep-research mode).
        // Only the tool-result shape carries success/tool for mode detection.
        const rawData: unknown = activeVisualizationData
        const results = Array.isArray(rawData) ? rawData : []
        const currentSession = sessions.find(s => s.id === currentSessionId)

        // Use session title if available, otherwise "NEW CHAT"
        const sessionTitle: string = typeof currentSession?.title === "string" ? currentSession.title : "NEW CHAT"
        const sessionString = sessionTitle.toUpperCase()
        let mode = "Telemetry" // Default

        // Detect mode from the first successful tool result
        const firstResult = results.find((r): r is { success?: unknown; tool?: unknown } =>
            typeof r === "object" && r !== null && (r as { success?: unknown }).success === true
        )
        if (firstResult) {
            const toolModes: Record<string, string> = {
                get_telemetry: "Telemetry",
                get_laps: "Telemetry",
                get_fastest_lap: "Telemetry",
                get_car_data: "Telemetry",
                get_qualifying: "Comparison",
                get_race: "Comparison",
                get_tyres: "Strategy",
                get_stints: "Strategy",
                get_weather: "Insights",
                get_race_control: "Insights",
                get_track_status: "Insights",
                retrieve_regulations: "Insights",
            }
            const tool = typeof firstResult.tool === "string" ? firstResult.tool : ""
            mode = toolModes[tool] ?? mode
        }

        // If the session has a type, use that to override the mode
        const sessionType: string | undefined = typeof currentSession?.type === "string" ? currentSession.type : undefined
        if (sessionType) {
            mode = sessionType.charAt(0).toUpperCase() + sessionType.slice(1)
        }

        return { sessionString, mode }
    }, [activeVisualizationData, sessions, currentSessionId])


    return (
        <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-carbon-header text-white shadow-md transition-all duration-500">
            <div className="w-full max-w-screen-2xl mx-auto flex h-14 md:h-16 items-center justify-between px-3 md:px-6 gap-2">

                {/* Left: Identity + Session Context */}
                <div className="flex items-center gap-2 md:gap-6 min-w-0">
                    {/* Mobile hamburger — opens the session drawer */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSidebarOpen(!isSidebarOpen)}
                        className="btn-wheel h-9 w-9 shrink-0 md:hidden"
                        title="Open sessions"
                    >
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Open sessions</span>
                    </Button>
                    {/* Logo Area - Icon Only */}
                    <div className="flex items-center gap-3 opacity-90 hover:opacity-100 transition-opacity shrink-0">
                        <div className="flex items-center justify-center rounded-sm bg-[var(--f1-red)] p-1.5 shadow-[0_0_10px_rgba(225,6,0,0.4)]">
                            <Flag className="h-4 w-4 text-white fill-current" />
                        </div>
                    </div>

                    {/* Dynamic Session Badge — compact + truncated on phones */}
                    <div className="flex items-center gap-3 px-3 md:px-4 py-1.5 rounded-full bg-black/40 border border-white/5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] transition-all duration-500 min-w-0">
                        <span className="text-xs font-mono font-medium text-zinc-300 tracking-wide truncate max-w-[110px] sm:max-w-[200px] md:max-w-[300px]">
                            {context.sessionString}
                        </span>
                    </div>
                </div>

                {/* Center: Mode / View Selector (Dynamic) */}
                <div className="hidden lg:flex items-center bg-black/30 rounded-full p-1 border border-white/5 shadow-inner">
                    {['Telemetry', 'Comparison', 'Strategy', 'Insights'].map((m) => (
                        <button
                            key={m}
                            className={cn(
                                "px-4 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all duration-500",
                                context.mode === m
                                    ? "bg-[var(--f1-red)]/20 text-[var(--f1-red)] shadow-[0_0_10px_rgba(225,6,0,0.2)]"
                                    : "text-zinc-500 hover:text-zinc-300"
                            )}
                        >
                            {m}
                        </button>
                    ))}
                </div>

                {/* Right: Controls Cluster */}
                <div className="flex items-center gap-2 md:gap-3 shrink-0">

                    {/* Export Conversation Dropdown */}
                    <DropdownMenu>
                        {/* NOTE: A Radix Tooltip wrapping a DropdownMenuTrigger
                            silently breaks the dropdown click in some browsers
                            because the two components compete for pointer
                            events. The button's own `title` and the visible
                            icon give enough affordance. */}
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="btn-wheel btn-wheel-green h-9 w-9 md:h-10 md:w-10"
                                disabled={!hasMessages}
                                title="Export Conversation"
                            >
                                <Download className="h-5 w-5" />
                                <span className="sr-only">Export Conversation</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>Download as</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                onClick={() => {
                                    const st = useChatStore.getState()
                                    exportConversation(st.messages, "markdown", {
                                        title: st.sessions.find((s) => s.id === st.currentSessionId)?.title,
                                    })
                                }}
                                className="cursor-pointer"
                            >
                                <FileText className="mr-2 h-4 w-4" />
                                <span>Markdown (.md)</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => {
                                    const st = useChatStore.getState()
                                    exportConversation(st.messages, "json", {
                                        title: st.sessions.find((s) => s.id === st.currentSessionId)?.title,
                                    })
                                }}
                                className="cursor-pointer"
                            >
                                <FileJson className="mr-2 h-4 w-4" />
                                <span>JSON (.json)</span>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {/* Info Button — desktop only (no room on phones) */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="btn-wheel btn-wheel-blue h-9 w-9 md:h-10 md:w-10 hidden sm:inline-flex"
                            >
                                <Info className="h-5 w-5" />
                                <span className="sr-only">Information</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>Information</p>
                        </TooltipContent>
                    </Tooltip>

                    {/* Rotary Theme Toggle */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={toggleTheme}
                                className="btn-wheel btn-wheel-amber h-9 w-9 md:h-10 md:w-10"
                            >
                                <Sun className="h-5 w-5 rotate-0 scale-100  dark:-rotate-90 dark:scale-0" />
                                <Moon className="absolute h-5 w-5 rotate-90 scale-0  dark:rotate-0 dark:scale-100" />
                                <span className="sr-only">Toggle theme</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>Toggle Theme</p>
                        </TooltipContent>
                    </Tooltip>

                    {/* Settings Button */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="btn-wheel h-9 w-9 md:h-10 md:w-10"
                                onClick={() => setSettingsOpen(true)}
                            >
                                <Settings className="h-5 w-5" />
                                <span className="sr-only">Settings</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>Settings</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </header>
    )
}
