"use client"

import { Brain, Globe, BarChart3, Server, KeyRound } from "lucide-react"
import { useChatStore } from "@/lib/store"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"

export function ControlPanel() {
    const { settings, updateSettings, setSettingsOpen } = useChatStore()
    const isByok = settings.aiMode === "byok"
    const ModeIcon = isByok ? KeyRound : Server
    const modeLabel = isByok
        ? settings.byokModelName.trim() || settings.byokModelId.trim() || "Custom"
        : "Managed"

    return (
        <div className="flex items-center justify-between w-full pt-2">
            <div className="flex items-center gap-1">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                                updateSettings({ deepResearchMode: !settings.deepResearchMode })
                            }
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

                {settings.deepResearchMode && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                    updateSettings({ webSearchEnabled: !settings.webSearchEnabled })
                                }
                                className="btn-wheel btn-wheel-green h-8 w-8"
                                data-active={settings.webSearchEnabled}
                            >
                                <Globe className="h-4 w-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                            <p>Web Search</p>
                        </TooltipContent>
                    </Tooltip>
                )}

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                                updateSettings({ visualizeEnabled: !settings.visualizeEnabled })
                            }
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

            <Button
                variant="ghost"
                size="sm"
                onClick={() => setSettingsOpen(true)}
                className="btn-wheel btn-wheel-orange h-8 gap-2 text-xs px-3"
                title={isByok ? "Custom model — open Model Settings" : "Managed model — open Model Settings"}
            >
                <ModeIcon className="h-3.5 w-3.5" />
                <span className="max-w-[120px] truncate hidden sm:inline-block font-bold">
                    {modeLabel}
                </span>
            </Button>
        </div>
    )
}
