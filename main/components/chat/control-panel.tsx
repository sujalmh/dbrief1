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
                {/* Deep Research Mode — sliding switch. Fixed-size track
                    (never resizes on toggle); the knob slides left/right.
                    Active adds outline to track + text; hover outlines
                    the track. */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            type="button"
                            {...deepResearchPress}
                            aria-pressed={deepOn}
                            aria-label={deepOn ? "Deep research on - turn off" : "Deep research off - turn on"}
                            className={cn(
                                "relative h-8 w-[76px] shrink-0 rounded-full border bg-black/30 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)] outline-1 transition-colors duration-200",
                                deepOn
                                    ? "border-purple-400/70 bg-purple-500/15 outline outline-purple-300/60 hover:outline-purple-200"
                                    : "border-white/10 hover:outline hover:outline-white/30"
                            )}
                        >
                            <span
                                aria-hidden
                                className={cn(
                                    "absolute left-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full transition-transform duration-200",
                                    deepOn ? "translate-x-[44px]" : "translate-x-0",
                                    "btn-wheel btn-wheel-purple"
                                )}
                            >
                                <Brain className="h-3.5 w-3.5" />
                            </span>
                            <span
                                aria-hidden
                                className={cn(
                                    "absolute top-1/2 -translate-y-1/2 text-[11px] font-bold uppercase tracking-wider transition-all duration-200",
                                    deepOn
                                        ? "left-2.5 rounded-sm text-purple-300 outline outline-1 outline-purple-300/60"
                                        : "right-2.5 text-muted-foreground/40"
                                )}
                            >
                                {deepOn ? "On" : "Off"}
                            </span>
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>{settings.deepResearchMode ? "Deep Research Mode" : "Normal Mode"}</p>
                    </TooltipContent>
                </Tooltip>
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
