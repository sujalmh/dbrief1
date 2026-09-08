"use client"

import { useChatStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { PROVIDERS, getProviderMeta } from "@/lib/providers"

export function SettingsModal() {
    const { isSettingsOpen, setSettingsOpen, settings, updateSettings, clearMessages } = useChatStore()
    const activeProvider = getProviderMeta(settings.provider)

    return (
        <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="sm:max-w-[500px] border-none bg-background/95 backdrop-blur-xl shadow-2xl">
                <DialogHeader className="mb-4 text-center">
                    <DialogTitle className="text-xl font-bold tracking-tight">Race Configuration</DialogTitle>
                    <DialogDescription className="text-muted-foreground/80">
                        Fine-tune your telemetry and pit crew parameters.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 px-2">
                    {/* API Key Section */}
                    <div className="space-y-2">
                        <Label htmlFor="apiKey" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                            Team Access Key
                        </Label>
                        <div className="relative group">
                            <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-[var(--f1-purple)] to-[var(--f1-purple)] opacity-20 group-hover:opacity-40 transition duration-500 blur-sm"></div>
                                <Input
                                    id="apiKey"
                                    type="password"
                                    value={settings.apiKey}
                                    onChange={(e) => updateSettings({ apiKey: e.target.value })}
                                    className="relative bg-background border-muted/40 focus-visible:ring-1 focus-visible:ring-[var(--f1-purple)] focus-visible:border-[var(--f1-purple)]/50 transition-all font-mono text-sm"
                                    placeholder="Paste provider key, or set it via env var"
                                />
                        </div>
                    </div>

                    {/* Model Configuration Grid */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">Provider</Label>
                            <Select
                                value={settings.provider}
                                onValueChange={(value) => updateSettings({ provider: value })}
                            >
                                <SelectTrigger className="border-muted/40 focus:ring-1 focus:ring-[var(--f1-green)] focus:border-[var(--f1-green)]/50 transition-all">
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    {PROVIDERS.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>{p.menuLabel}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">Model Engine</Label>
                            <Select
                                value={settings.model}
                                onValueChange={(value) => updateSettings({ model: value })}
                            >
                                <SelectTrigger className="border-muted/40 focus:ring-1 focus:ring-[var(--f1-green)] focus:border-[var(--f1-green)]/50 transition-all">
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {activeProvider?.models.map((m) => (
                                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Sliders Section */}
                    <div className="space-y-6 pt-2">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Temperature</Label>
                                <span className="text-xs font-mono text-[var(--f1-yellow)] bg-[var(--f1-yellow)]/10 px-2 py-0.5 rounded border border-[var(--f1-yellow)]/20">
                                    {settings.temperature}
                                </span>
                            </div>
                            <Slider
                                defaultValue={[settings.temperature]}
                                max={1}
                                step={0.1}
                                className="[&_.bg-primary]:bg-[var(--f1-yellow)] [&_.border-primary]:border-[var(--f1-yellow)] [&_.bg-secondary]:bg-muted/30"
                                onValueChange={(vals) => updateSettings({ temperature: vals[0] })}
                            />
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">Max Tokens</Label>
                                <span className="text-xs font-mono text-[var(--f1-yellow)] bg-[var(--f1-yellow)]/10 px-2 py-0.5 rounded border border-[var(--f1-yellow)]/20">
                                    {settings.maxTokens}
                                </span>
                            </div>
                            <Slider
                                defaultValue={[settings.maxTokens]}
                                max={4000}
                                step={100}
                                className="[&_.bg-primary]:bg-[var(--f1-yellow)] [&_.border-primary]:border-[var(--f1-yellow)] [&_.bg-secondary]:bg-muted/30"
                                onValueChange={(vals) => updateSettings({ maxTokens: vals[0] })}
                            />
                        </div>
                    </div>

                    {/* Developer Mode */}
                    <div className="flex items-center justify-between rounded-lg border border-muted/40 p-3 bg-muted/5 mt-2">
                        <div className="space-y-0.5">
                            <Label className="text-sm font-medium">Developer Mode</Label>
                            <p className="text-xs text-muted-foreground">Show detailed debug information</p>
                        </div>
                        <Switch
                            checked={settings.developerMode}
                            onCheckedChange={(checked) => updateSettings({ developerMode: checked })}
                            className="data-[state=checked]:bg-[var(--f1-red)]"
                        />
                    </div>
                </div>

                <DialogFooter className="sm:justify-between items-center mt-4">
                    <Button
                        variant="ghost"
                        onClick={clearMessages}
                        type="button"
                        className="text-muted-foreground hover:text-[var(--f1-red)] hover:bg-[var(--f1-red)]/10 text-xs uppercase tracking-wide"
                    >
                        Clear Telemetry
                    </Button>
                    <Button
                        type="submit"
                        onClick={() => setSettingsOpen(false)}
                        className="bg-foreground text-background hover:bg-foreground/90 font-bold tracking-wide"
                    >
                        CONFIRM SETUP
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
