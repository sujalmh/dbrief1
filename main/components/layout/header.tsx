"use client"

import { Settings, Share2, Info, Download, FileText, FileJson, PanelLeft } from "lucide-react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/lib/store"
import { InfoModal } from "@/components/layout/info-modal"
import {
    AppHeaderShell,
    LogoBadge,
    ModePill,
    SessionBadge,
} from "@/components/layout/header-shell"
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
import { useMemo, useState } from "react"
import { exportConversation } from "@/lib/utils/export-conversation"

const ShareDialog = dynamic(
    () => import("@/components/chat/share-dialog").then((m) => m.ShareDialog),
    { ssr: false }
)

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
    const [isInfoOpen, setInfoOpen] = useState(false)
    const [isShareOpen, setShareOpen] = useState(false)

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
        <AppHeaderShell>
            {/* Left: Identity + Session Context */}
            <div className="flex items-center gap-2 md:gap-6 min-w-0">
                {/* Single sidebar toggle — the only collapse control.
                    Visible on all breakpoints: on mobile it opens the
                    session drawer, on desktop it collapses the rail. */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className="btn-wheel h-9 w-9 shrink-0"
                    title={isSidebarOpen ? "Collapse sidebar" : "Open sessions"}
                >
                    <PanelLeft className="h-5 w-5" />
                    <span className="sr-only">Toggle sidebar</span>
                </Button>
                {/* Logo Area - Falcon logo */}
                <div className="flex items-center gap-3 opacity-90 hover:opacity-100 transition-opacity shrink-0">
                    <LogoBadge />
                </div>

                {/* Dynamic Session Badge — compact + truncated on phones */}
                <SessionBadge label={context.sessionString} />
            </div>

            {/* Center: Mode / View Selector (Dynamic) */}
            <ModePill active={context.mode} />

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

                {/* Share Session — read-only public link */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setShareOpen(true)}
                            disabled={!currentSessionId}
                            className="btn-wheel btn-wheel-purple h-9 w-9 md:h-10 md:w-10"
                            title="Share session"
                        >
                            <Share2 className="h-5 w-5" />
                            <span className="sr-only">Share session</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>Share session</p>
                    </TooltipContent>
                </Tooltip>

                {/* Info Button — opens About / Privacy / Terms */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setInfoOpen(true)}
                            className="btn-wheel btn-wheel-blue h-9 w-9 md:h-10 md:w-10"
                        >
                            <Info className="h-5 w-5" />
                            <span className="sr-only">Information</span>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>Information</p>
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

            <InfoModal open={isInfoOpen} onOpenChange={setInfoOpen} />
            {isShareOpen && currentSessionId && (
                <ShareDialog
                    open={isShareOpen}
                    onOpenChange={setShareOpen}
                    sessionId={currentSessionId}
                    sessionTitle={
                        sessions.find((s) => s.id === currentSessionId)?.title
                    }
                />
            )}
        </AppHeaderShell>
    )
}
