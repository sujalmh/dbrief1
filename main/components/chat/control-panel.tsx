"use client"

import * as React from "react"
import { Brain, Server, KeyRound } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { QuotaStrip } from "@/components/chat/quota-strip"

export function ControlPanel() {
    const settings = useChatStore((s) => s.settings)
    const updateSettings = useChatStore((s) => s.updateSettings)
    const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
    const isByok = settings.aiMode === "byok"
    const ModeIcon = isByok ? KeyRound : Server
    const modeLabel = isByok
        ? settings.byokModelName.trim() || settings.byokModelId.trim() || "BYOK"
        : "Managed"

    // Latching toggles engage on pointer-DOWN, not click. Click fires
    // after pointer-up, so a click-driven toggle releases :active (button
    // pops up) a frame before React commits data-active (button drops
    // back down) — the down-up-down "double click" flash. Engaging on
    // pointer-down keeps the button seated throughout the whole press.
    // Keyboard activation (Enter/Space) has no pointer phase, so onClick
    // still handles that path and ignores pointer-preceded clicks.
    const pointerToggledRef = React.useRef(false)
    const pressToggle = (toggle: () => void) => ({
        onPointerDown: (e: React.PointerEvent) => {
            if (e.isPrimary === false) return
            if (e.pointerType === "mouse" && e.button !== 0) return
            pointerToggledRef.current = true
            toggle()
        },
        onClick: (e: React.MouseEvent) => {
            if (pointerToggledRef.current) {
                pointerToggledRef.current = false
                return
            }
            // Keyboard-driven click (no preceding pointer-down).
            if (e.detail === 0) toggle()
        },
    })
    const deepResearchPress = pressToggle(() =>
        updateSettings({ deepResearchMode: !settings.deepResearchMode })
    )

    const deepOn = settings.deepResearchMode === true

    return (
        <div className="flex items-center justify-between w-full pt-2">
            <div className="flex items-center gap-1">
                {/* Deep Research Mode — combined section: toggle + status.
                    The pill is recessed (indent effect); the status reads
                    On/Off, dim while off and highlighted when on. */}
                <div className="flex h-8 items-center gap-1 rounded-full border border-white/10 bg-black/30 py-1 pl-1 pr-2.5 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                {...deepResearchPress}
                                className="btn-wheel btn-wheel-purple h-6 w-6"
                                data-active={settings.deepResearchMode}
                            >
                                <Brain className="h-3.5 w-3.5" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>{settings.deepResearchMode ? "Deep Research Mode" : "Normal Mode"}</p>
                        </TooltipContent>
                    </Tooltip>
                    <button
                        type="button"
                        {...deepResearchPress}
                        aria-pressed={deepOn}
                        aria-label={deepOn ? "Deep research on - turn off" : "Deep research off - turn on"}
                        className={cn(
                            "text-[11px] font-bold uppercase tracking-wider transition-colors",
                            deepOn ? "text-purple-300" : "text-muted-foreground/40 hover:text-muted-foreground/70"
                        )}
                    >
                        {deepOn ? "On" : "Off"}
                    </button>
                </div>
            </div>

            {/* Right side: inline usage (hover for details) + AI mode badge. */}
            <div className="flex min-w-0 items-center gap-1">
                <QuotaStrip />
                {/* AI mode badge — opens Settings. No provider/model dropdowns. */}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSettingsOpen(true)}
                    className="btn-wheel btn-wheel-orange h-8 shrink-0 gap-2 text-xs px-3"
                title={isByok ? "BYOK — open AI Setup" : "Managed — open AI Setup"}
            >
                <ModeIcon className="h-3.5 w-3.5" />
                <span className="max-w-[120px] truncate hidden sm:inline-block font-bold">
                    {modeLabel}
                </span>
            </Button>
            </div>
        </div>
    )
}
