"use client"

import { Settings, Share2, Info, PanelLeft } from "lucide-react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/lib/store"
import { InfoModal } from "@/components/layout/info-modal"
import {
    AppHeaderShell,
    ModePill,
    SessionBadge,
} from "@/components/layout/header-shell"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { useMemo, useState } from "react"

const ShareDialog = dynamic(
    () => import("@/components/chat/share-dialog").then((m) => m.ShareDialog),
    { ssr: false }
)

export function Header() {
    // Slice subscriptions: `messages` changes on every streamed token, so
    // this component selects only the active message's visualization ref
    // (stable across token frames). Download lives inside the share
    // dialog, so this header never subscribes to the message list.
    const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
    const activeVisualizationData = useChatStore((s) =>
        s.activeMessageId
            ? (s.messages.find((m) => m.id === s.activeMessageId)?.visualizationData ?? null)
            : null
    )
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
            {/* Left: mobile drawer opener + session context. Desktop
                collapse lives inside the sidebar header, and the logo
                lives in the sidebar, so the app header shows no toggle
                or logo on md+. */}
            <div className="flex items-center gap-2 md:gap-6 min-w-0">
                {/* Mobile only: opens the session drawer. Hidden on
                    desktop where the sidebar rail owns its toggle. */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className="btn-wheel h-9 w-9 shrink-0 md:hidden"
                    title={isSidebarOpen ? "Close sessions" : "Open sessions"}
                >
                    <PanelLeft className="h-5 w-5" />
                    <span className="sr-only">Toggle sidebar</span>
                </Button>

                {/* Dynamic Session Badge — compact + truncated on phones */}
                <SessionBadge label={context.sessionString} />
            </div>

            {/* Center: Mode / View Selector (Dynamic) */}
            <ModePill active={context.mode} />

            {/* Right: Controls Cluster */}
            <div className="flex items-center gap-2 md:gap-3 shrink-0">

                {/* Share Session — read-only public link + download */}
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
