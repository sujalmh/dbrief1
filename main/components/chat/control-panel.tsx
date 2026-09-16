"use client"

import { useState } from "react"
import { Brain, Globe, Database, Cpu, BarChart3, Sparkles, Zap, Plus } from "lucide-react"
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
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { PROVIDERS, PROVIDER_MAP, getProviderMeta } from "@/lib/providers"
import { AddModelsDialog } from "@/components/chat/add-models-dialog"

const PROVIDER_ICONS: Record<string, LucideIcon> = {
    gemini: Database,
    openrouter: Globe,
    huggingface: Cpu,
    zen: Sparkles,
    go: Zap,
};

// =============================================================================
// ModelList
// =============================================================================
//
// Shared radio group for the responder / planner model pickers. Renders the
// built-in presets from the centralized provider catalog (lib/providers.ts),
// then the user's "Custom" list (if any). Kept as a sub-component so the
// planner and responder sections stay in sync.
//
interface ModelListProps {
    provider: string
    customModels: string[]
    value: string
    onSelect: (modelId: string) => void
    /**
     * When provided, prepend a non-default radio entry (e.g.
     * "Use default" for the planner) that the user can pick
     * to clear their selection. We represent "no selection" as
     * the empty string in the store.
     */
    prependDefault?: {
        label: string
        value: string
    }
}

function ModelList({ provider, customModels, value, onSelect, prependDefault }: ModelListProps) {
    const builtins = getProviderMeta(provider)?.models ?? []
    return (
        <DropdownMenuRadioGroup value={value} onValueChange={onSelect}>
            {prependDefault && (
                <DropdownMenuRadioItem value={prependDefault.value}>
                    <span className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                        {prependDefault.label}
                    </span>
                </DropdownMenuRadioItem>
            )}

            {builtins.map((m) => (
                <DropdownMenuRadioItem key={m.id} value={m.id}>
                    {m.label}
                </DropdownMenuRadioItem>
            ))}

            {customModels.length > 0 && (
                <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] text-muted-foreground/70 uppercase">
                        Custom
                    </DropdownMenuLabel>
                    {customModels.map((m) => (
                        <DropdownMenuRadioItem key={m} value={m}>
                            <span className="font-mono text-xs">{m}</span>
                        </DropdownMenuRadioItem>
                    ))}
                </>
            )}
        </DropdownMenuRadioGroup>
    )
}

export function ControlPanel() {
    const { settings, updateSettings } = useChatStore()
    // The "Add other models" dialog opens from a special non-radio
    // item at the bottom of the model list. Keeping its open state
    // local to the panel means the dropdown can close itself while
    // the dialog is still open.
    const [isAddModelsOpen, setIsAddModelsOpen] = useState(false)

    // Helper to get current provider icon
    const ProviderIcon = PROVIDER_ICONS[settings.provider] || Database

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
                {/* NOTE: Do NOT wrap a DropdownMenuTrigger in a Radix
                    Tooltip. The two components compete for focus/pointer
                    events and the dropdown silently stops opening in some
                    browsers. We rely on the visible button label and the
                    DropdownMenuLabel inside the menu for affordance. */}
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="btn-wheel btn-wheel-orange h-8 gap-2 text-xs px-3"
                        title="Select AI Provider & Model"
                    >
                        <ProviderIcon className="h-3.5 w-3.5" />
                        <span className="max-w-[80px] truncate hidden sm:inline-block font-bold">
                            {settings.model.split("/").pop()?.split(":")[0] ||
                                settings.model}
                        </span>
                    </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent
                    align="end"
                    className="w-64 bg-background/95 backdrop-blur border border-border shadow-lg"
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

                    {/* Responder (answer) model — the "main" model the user
                        picked. The server uses this to generate the final
                        response. */}
                    <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Model (Answer)
                    </DropdownMenuLabel>
                    <ModelList
                        provider={settings.provider}
                        customModels={settings.customModels}
                        value={settings.model}
                        onSelect={(v) => updateSettings({ model: v })}
                    />

                    <DropdownMenuSeparator />

                    {/* Planner model. Defaults to the provider's
                        built-in cheap planner when empty (the
                        "Use default" entry). When set, this
                        model handles intent analysis + step
                        decomposition. */}
                    <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Model (Planner)
                    </DropdownMenuLabel>
                    <ModelList
                        provider={settings.provider}
                        customModels={settings.customModels}
                        value={settings.plannerModel}
                        onSelect={(v) => updateSettings({ plannerModel: v })}
                        prependDefault={{
                            label: "Use default (built-in cheap)",
                            value: "",
                        }}
                    />

                    <DropdownMenuSeparator />
                    {/* Non-radio action: open the "Add other models"
                        dialog. Clicking this closes the dropdown so
                        the dialog can take over focus. */}
                    <DropdownMenuItem
                        onSelect={(e) => {
                            e.preventDefault()
                            setIsAddModelsOpen(true)
                        }}
                        className="text-xs gap-1.5"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add other models…
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <AddModelsDialog open={isAddModelsOpen} onOpenChange={setIsAddModelsOpen} />
        </div>
    )
}