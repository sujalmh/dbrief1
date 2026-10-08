"use client"

import { Settings, Share2, Github, Menu } from "lucide-react"
import dynamic from "next/dynamic"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/lib/store"
import { useSession } from "@/lib/cf/session-context"
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
import { useMemo, useState } from "react"

const ShareDialog = dynamic(
    () => import("@/components/chat/share-dialog").then((m) => m.ShareDialog),
    { ssr: false }
)

const ProfileModal = dynamic(
    () => import("@/components/profile/profile-modal").then((m) => m.ProfileModal),
    { ssr: false }
)

export function Header() {
    // Slice subscriptions: `messages` changes on every streamed token, so
    // this component selects only the derived mode signal (stable across
    // token frames). Download lives inside the share dialog, so this
    // header never subscribes to the full message list.
    const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
    const lastVizPayload = useChatStore((s) => {
        for (let i = s.messages.length - 1; i >= 0; i--) {
            const viz = s.messages[i]?.visualizationData
            if (viz !== undefined && viz !== null) return viz
        }
        return null
    })
    const sessions = useChatStore((s) => s.sessions)
    const currentSessionId = useChatStore((s) => s.currentSessionId)
    const isSidebarOpen = useChatStore((s) => s.isSidebarOpen)
    const setSidebarOpen = useChatStore((s) => s.setSidebarOpen)
    const { user } = useSession()
    const [isInfoOpen, setInfoOpen] = useState(false)
    const [isShareOpen, setShareOpen] = useState(false)
    const [isProfileOpen, setProfileOpen] = useState(false)

    // Derive context from the latest message carrying visualization data
    const context = useMemo(() => {
        // visualizationData is untyped at the store boundary (tool-result
        // array in standard mode, ChartSpec[] in deep-research mode).
        // Only the tool-result shape carries success/tool for mode detection.
        const rawData: unknown = lastVizPayload
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
    }, [lastVizPayload, sessions, currentSessionId])


    return (
        <AppHeaderShell>
            {/* Left: session context. On phones the sidebar is an
                off-canvas drawer, so the navbar carries its toggle and
                logo; on desktop the sidebar owns them. */}
            <div className="flex items-center gap-2 md:gap-6 min-w-0">
                <div className="flex shrink-0 items-center gap-1.5 md:hidden">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        onClick={() => setSidebarOpen(!isSidebarOpen)}
                        aria-label={isSidebarOpen ? "Close sidebar" : "Open sidebar"}
                    >
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Toggle sidebar</span>
                    </Button>
                    <LogoBadge onBackground className="bg-transparent shadow-none" />
                </div>
                {/* Dynamic Session Badge — compact + truncated on phones */}
                <SessionBadge label={context.sessionString} />
            </div>

            {/* Center: Mode / View Selector (Dynamic) */}
            <ModePill active={context.mode} />

            {/* Right: Controls Cluster. Icon buttons are desktop-only —
                on phones everything lives in the profile modal, keeping
                the navbar to badge + avatar. */}
            <div className="hidden items-center gap-2 md:gap-3 shrink-0 md:flex">

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

                {/* Source Button — GitHub glyph, opens About / Privacy / Terms */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setInfoOpen(true)}
                            className="btn-wheel btn-wheel-blue h-9 w-9 md:h-10 md:w-10"
                        >
                            <Github className="h-5 w-5" />
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

            {/* Profile — phones only (desktop has it in the sidebar).
                Avatar opens settings/share/about/contact/logout. */}
            {user && (
                <div className="flex shrink-0 items-center md:hidden">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 rounded-full border border-white/20 p-0.5 md:h-10 md:w-10"
                                onClick={() => setProfileOpen(true)}
                            >
                                {user.google?.avatarUrl ? (
                                    // eslint-disable-next-line @next/next/no-img-element -- Google avatar from verified ID-token claim
                                    <img
                                        src={user.google.avatarUrl}
                                        alt="Profile"
                                        referrerPolicy="no-referrer"
                                        className="h-full w-full rounded-full object-cover"
                                    />
                                ) : (
                                    <span className="text-[10px] font-bold">
                                        {(user.displayName || "DRV").slice(0, 3).toUpperCase()}
                                    </span>
                                )}
                                <span className="sr-only">Profile</span>
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>Profile</p>
                        </TooltipContent>
                    </Tooltip>
                </div>
            )}

            <InfoModal open={isInfoOpen} onOpenChange={setInfoOpen} />
            <ProfileModal open={isProfileOpen} onOpenChange={setProfileOpen} />
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
