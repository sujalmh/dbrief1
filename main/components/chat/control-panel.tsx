"use client"

import * as React from "react"
import { Brain, BarChart3, Server, KeyRound } from "lucide-react"
import { useChatStore } from "@/lib/store"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"

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
    const visualizePress = pressToggle(() =>
        updateSettings({ visualizeEnabled: !settings.visualizeEnabled })
    )

    return (
        <div className="flex items-center justify-between w-full pt-2">
            <div className="flex items-center gap-1">
                {/* Deep Research Mode Toggle */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            {...deepResearchPress}
                            className="btn-wheel btn-wheel-purple h-8 w-8"
                            data-active={settings.deepResearchMode}
                        >
                            <Brain className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>{settings.deepResearchMode ? "Deep Research Mode" : "Normal Mode"}</p>
                    </TooltipContent>
                </Tooltip>

                {/* Visualization Toggle - Always visible */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            {...visualizePress}
                            className="btn-wheel btn-wheel-yellow h-8 w-8"
                            data-active={settings.visualizeEnabled}
                        >
                            <BarChart3 className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>Visualization</p>
                    </TooltipContent>
                </Tooltip>
            </div>

            {/* AI mode badge — opens Settings. No provider/model dropdowns. */}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => setSettingsOpen(true)}
                className="btn-wheel btn-wheel-orange h-8 gap-2 text-xs px-3"
                title={isByok ? "BYOK — open AI Setup" : "Managed — open AI Setup"}
            >
                <ModeIcon className="h-3.5 w-3.5" />
                <span className="max-w-[120px] truncate hidden sm:inline-block font-bold">
                    {modeLabel}
                </span>
            </Button>
        </div>
    )
}
