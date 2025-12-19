"use client"

import { Flag, Settings, Sun, Moon, Info } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { useMemo } from "react"

export function Header() {
    const { setSettingsOpen, activeMessageId, messages } = useChatStore()
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
        const data = activeMessage?.visualizationData

        let sessionString = "2023 SEASON OVERVIEW" // Default
        let mode = "Telemetry" // Default

        if (data) {
            // Heuristic: specific session info in data or derive from title
            if (data.session_info) {
                // Example format: "Q3 - Saudi Arabia 2024"
                sessionString = data.session_info.toUpperCase()
            } else if (data.title) {
                // Allow title to map to session string if no specific session info
                sessionString = data.title.toUpperCase()
            }

            // Heuristic for mode
            const title = (data.title || "").toLowerCase()
            if (title.includes("strategy") || title.includes("pit")) mode = "Strategy"
            else if (title.includes("compare") || title.includes("gap") || title.includes("vs")) mode = "Comparison"
            else if (title.includes("weather") || title.includes("track")) mode = "Insights"
            else mode = "Telemetry"
        }

        return { sessionString, mode }
    }, [activeMessage])


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
                    <Button
                        variant="ghost"
                        size="icon"
                        className="btn-wheel btn-wheel-blue h-10 w-10"
                        title="Information"
                    >
                        <Info className="h-5 w-5" />
                    </Button>

                    {/* Rotary Theme Toggle */}
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

                    {/* Settings Button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="btn-wheel h-10 w-10"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Settings className="h-5 w-5" />
                        <span className="sr-only">Settings</span>
                    </Button>
                </div>
            </div>
        </header>
    )
}
