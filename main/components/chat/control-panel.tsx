"use client"

import { Brain, Globe, Database, Cpu, BarChart3, Sparkles, Zap } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useChatStore } from "@/lib/store"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { PROVIDERS, PROVIDER_MAP, getProviderMeta } from "@/lib/providers"

const PROVIDER_ICONS: Record<string, LucideIcon> = {
    gemini: Database,
    openrouter: Globe,
    huggingface: Cpu,
    zen: Sparkles,
    go: Zap,
};

export function ControlPanel() {
    const { settings, updateSettings } = useChatStore()

    // Helper to get current provider icon
    const ProviderIcon = PROVIDER_ICONS[settings.provider] || Database
    const activeProvider = getProviderMeta(settings.provider)

    // Switching provider also applies its default model so the selection
    // never goes stale; the menu stays open so the user can pick another one.
    const handleProviderChange = (v: string) => {
        updateSettings({
            provider: v,
            model: PROVIDER_MAP[v as keyof typeof PROVIDER_MAP]?.defaultModel ?? settings.model,
        });
    };

    // Keep the menu open when a provider is picked so the model can be
    // chosen in the same interaction (Radix closes the menu on select
    // unless the event is prevented).
    const keepOpenOnSelect = (e: Event) => e.preventDefault();

    return (
        <div className="flex items-center justify-between w-full pt-2">
            <div className="flex items-center gap-1">
                {/* Deep Research Mode Toggle (repurposed from Reasoning) */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                                updateSettings({
                                    deepResearchMode: !settings.deepResearchMode,
                                })
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

                {/* Web Search Toggle - Only visible in Deep Research Mode */}
                {settings.deepResearchMode && (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                    updateSettings({
                                        webSearchEnabled: !settings.webSearchEnabled,
                                    })
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

                {/* Visualization Toggle - Always visible */}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                                updateSettings({
                                    visualizeEnabled: !settings.visualizeEnabled,
                                })
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

            {/* Provider / Model Selector */}
            <DropdownMenu>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="btn-wheel btn-wheel-orange h-8 gap-2 text-xs px-3"
                            >
                                <ProviderIcon className="h-3.5 w-3.5" />
                                <span className="max-w-[80px] truncate hidden sm:inline-block font-bold">
                                    {settings.model.split("/").pop()?.split(":")[0] ||
                                        settings.model}
                                </span>
                            </Button>
                        </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        <p>Select AI Provider & Model</p>
                    </TooltipContent>
                </Tooltip>

                <DropdownMenuContent
                    align="end"
                    className="w-56 bg-background/95 backdrop-blur border border-border shadow-lg"
                >
                    <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Provider
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={settings.provider}
                        onValueChange={handleProviderChange}
                    >
                        {PROVIDERS.map((p) => (
                            <DropdownMenuRadioItem key={p.id} value={p.id} onSelect={keepOpenOnSelect}>
                                {p.menuLabel}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>

                    <DropdownMenuSeparator />

                    <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Model
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={settings.model}
                        onValueChange={(v) => updateSettings({ model: v })}
                    >
                        {activeProvider?.models.map((m) => (
                            <DropdownMenuRadioItem key={m.id} value={m.id}>
                                {m.label}
                            </DropdownMenuRadioItem>
                        ))}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}