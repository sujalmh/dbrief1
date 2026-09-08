"use client"

import { Flag, Settings, Sun, Moon, Info } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { useMemo } from "react"

export function Header() {
    const { setSettingsOpen, activeMessageId, messages, sessions, currentSessionId } = useChatStore()
    const { setTheme, theme } = useTheme()

    const toggleTheme = () => {
        setTheme(theme === "light" ? "dark" : "light")
    }

    // Find the active message
    const activeMessage = useMemo(() => {
        return messages.find(m => m.id === activeMessageId)
    }, [messages, activeMessageId])

    // Derive context from the active message
    const context = useMemo(() => {
        const results = activeMessage?.visualizationData
        const currentSession = sessions.find(s => s.id === currentSessionId)

        // Use session title if available, otherwise "NEW CHAT"
        const sessionString = currentSession?.title ? currentSession.title.toUpperCase() : "NEW CHAT"
        let mode = "Telemetry" // Default

        // Detect mode from the first successful tool result
        const firstResult = results?.find(r => r.success)
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
            mode = toolModes[firstResult.tool] ?? mode
        }

        // If the session has a type, use that to override the mode
        if (currentSession?.type) {
            mode = currentSession.type.charAt(0).toUpperCase() + currentSession.type.slice(1)
        }

        return { sessionString, mode }
    }, [activeMessage, sessions, currentSessionId])


    return (
        <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-carbon-header text-white shadow-md transition-all duration-500">
            <div className="w-full max-w-screen-2xl mx-auto flex h-16 items-center justify-between px-6">

                {/* Left: Identity + Session Context */}
                <div className="flex items-center gap-6">
                    {/* Logo Area - Icon Only */}
                    <div className="flex items-center gap-3 opacity-90 hover:opacity-100 transition-opacity">
                        <div className="flex items-center justify-center rounded-sm bg-[var(--f1-red)] p-1.5 shadow-[0_0_10px_rgba(225,6,0,0.4)]">
                            <Flag className="h-4 w-4 text-white fill-current" />
                        </div>
                    </div>

                    {/* Dynamic Session Badge */}
                    <div className="hidden md:flex items-center gap-3 px-4 py-1.5 rounded-full bg-black/40 border border-white/5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] transition-all duration-500">
                        <span className="text-xs font-mono font-medium text-zinc-300 tracking-wide truncate max-w-[300px]">
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
                <div className="flex items-center gap-3">

                    {/* Info Button */}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="btn-wheel btn-wheel-blue h-10 w-10"
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
                                className="btn-wheel btn-wheel-amber h-10 w-10"
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
                                className="btn-wheel h-10 w-10"
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
