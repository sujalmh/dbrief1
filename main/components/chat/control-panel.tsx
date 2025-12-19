"use client"

import { Brain, Globe, Database, Cpu, ChevronUp, BarChart3 } from "lucide-react"
import { useChatStore } from "@/lib/store"
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
import { cn } from "@/lib/utils"

export function ControlPanel() {
    const { settings, updateSettings } = useChatStore()

    // Helper to get current provider icon
    const ProviderIcon = {
        gemini: Database, // Could use specific icons if available
        openrouter: Globe,
        huggingface: Cpu,
    }[settings.provider] || Database

    return (
        <div className="flex items-center justify-between w-full pt-2">
            <div className="flex items-center gap-1">
                {/* Reasoning Toggle - Icon Only */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => updateSettings({ reasoningEnabled: !settings.reasoningEnabled })}
                    className="btn-wheel btn-wheel-purple h-8 w-8"
                    data-active={settings.reasoningEnabled}
                    title="Toggle Reasoning"
                >
                    <Brain className="h-4 w-4" />
                </Button>

                {/* Web Search Toggle - Icon Only */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => updateSettings({ webSearchEnabled: !settings.webSearchEnabled })}
                    className="btn-wheel btn-wheel-green h-8 w-8"
                    data-active={settings.webSearchEnabled}
                    title="Toggle Web Search"
                >
                    <Globe className="h-4 w-4" />
                </Button>

                {/* Visualize Toggle - Icon Only */}
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => updateSettings({ visualizeEnabled: !settings.visualizeEnabled })}
                    className="btn-wheel btn-wheel-yellow h-8 w-8"
                    data-active={settings.visualizeEnabled}
                    title="Toggle Visualization"
                >
                    <BarChart3 className="h-4 w-4" />
                </Button>
            </div>

            {/* Provider/Model Selector - Compact Trigger */}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="btn-wheel btn-wheel-orange h-8 gap-2 text-xs px-3"
                    >
                        <ProviderIcon className="h-3.5 w-3.5" />
                        <span className="max-w-[80px] truncate hidden sm:inline-block font-bold">
                            {settings.model.split('/').pop()?.split(':')[0] || settings.model}
                        </span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-background/95 backdrop-blur border border-border shadow-lg">
                    <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Provider</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={settings.provider} onValueChange={(v) => updateSettings({ provider: v })}>
                        <DropdownMenuRadioItem value="gemini">Gemini</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="openrouter">OpenRouter</DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="huggingface">HuggingFace</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>

                    <DropdownMenuSeparator />

                    <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Model</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={settings.model} onValueChange={(v) => updateSettings({ model: v })}>
                        {settings.provider === 'gemini' && (
                            <>
                                <DropdownMenuRadioItem value="gemini-2.0-flash">Gemini 2.0 Flash</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="gemini-2.0-flash-thinking-exp">Gemini 2.0 Thinking</DropdownMenuRadioItem>
                            </>
                        )}
                        {settings.provider === 'openrouter' && (
                            <>
                                <DropdownMenuRadioItem value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash (Free)</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="google/gemini-2.0-flash-thinking-exp:free">Gemini 2.0 Thinking (Free)</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="mistralai/devstral-2512:free">Devstral (Free)</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="qwen/qwen3-coder:free">Qwen 3 Coder (Free)</DropdownMenuRadioItem>
                            </>
                        )}
                        {settings.provider === 'huggingface' && (
                            <>
                                <DropdownMenuRadioItem value="mistralai/Mistral-7B-Instruct-v0.3">Mistral 7B</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="mistralai/Mixtral-8x7B-Instruct-v0.1">Mixtral 8x7B</DropdownMenuRadioItem>
                            </>
                        )}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
