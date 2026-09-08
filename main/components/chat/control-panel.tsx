"use client"

import { Brain, Globe, Database, Cpu, BarChart3, Sparkles, Zap } from "lucide-react"
import { useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"
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

export function ControlPanel() {
    const { settings, updateSettings } = useChatStore()

    // Helper to get current provider icon
    const ProviderIcon =
        {
            gemini: Database,
            openrouter: Globe,
            huggingface: Cpu,
            zen: Sparkles,
            go: Zap,
        }[settings.provider] || Database

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
                        onValueChange={(v) => updateSettings({ provider: v })}
                    >
                        <DropdownMenuRadioItem value="gemini">
                            Gemini
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="openrouter">
                            OpenRouter
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="huggingface">
                            HuggingFace
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="zen">
                            OpenCode Zen (free)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="go">
                            OpenCode Go
                        </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>

                    <DropdownMenuSeparator />

                    <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        Model
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                        value={settings.model}
                        onValueChange={(v) => updateSettings({ model: v })}
                    >
                        {settings.provider === "gemini" && (
                            <>
                                <DropdownMenuRadioItem value="gemini-2.0-flash">
                                    Gemini 2.0 Flash
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="gemini-2.0-flash-thinking-exp">
                                    Gemini 2.0 Thinking
                                </DropdownMenuRadioItem>
                            </>
                        )}

                        {settings.provider === "openrouter" && (
                            <>
                                <DropdownMenuRadioItem value="poolside/laguna-m.1:free">
                                    Poolside Laguna M.1 (Free)
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="nvidia/nemotron-3-ultra-550b-a55b:free">
                                    NVIDIA: Nemotron 3 Ultra (free)
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="cohere/north-mini-code:free">
                                    Cohere: North Mini Code (free)
                                </DropdownMenuRadioItem>
                            </>
                        )}

                        {settings.provider === "huggingface" && (
                            <>
                                <DropdownMenuRadioItem value="mistralai/Mistral-7B-Instruct-v0.3">
                                    Mistral 7B
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="mistralai/Mixtral-8x7B-Instruct-v0.1">
                                    Mixtral 8x7B
                                </DropdownMenuRadioItem>
                            </>
                        )}

                        {settings.provider === "zen" && (
                            <>
                                <DropdownMenuRadioItem value="nemotron-3-ultra-free">
                                    Nemotron 3 Ultra (Free)
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="nemotron-3.5-lightning-free">
                                    Nemotron 3.5 Lightning (Free)
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="mimo-v2.5-free">
                                    MiMo V2.5 (Free)
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="ling-3.0-flash-fin-free">
                                    Ling 3.0 Flash Fin (Free)
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="big-pickle">
                                    Big Pickle (Free)
                                </DropdownMenuRadioItem>
                            </>
                        )}

                        {settings.provider === "go" && (
                            <>
                                <DropdownMenuRadioItem value="kimi-k2.7-code">
                                    Kimi K2.7 Code
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="kimi-k3">
                                    Kimi K3
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="mimo-v2.5">
                                    MiMo V2.5
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="glm-5.3-flash">
                                    GLM 5.3 Flash
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="deepseek-v4-flash">
                                    DeepSeek V4 Flash
                                </DropdownMenuRadioItem>
                            </>
                        )}
                    </DropdownMenuRadioGroup>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}