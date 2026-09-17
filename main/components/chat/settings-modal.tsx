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
import { Switch } from "@/components/ui/switch"
import { validateByokConfig } from "@/lib/providers"
import { saveByokKeyAction, hasByokKeyAction, clearByokKeyAction } from "@/app/actions/settings"
import { useState, useEffect } from "react"
import { Loader2, Server, KeyRound } from "lucide-react"
import { cn } from "@/lib/utils"

export function SettingsModal() {
    const { isSettingsOpen, setSettingsOpen, settings, updateSettings, clearMessages } = useChatStore()
    const [apiKeyInput, setApiKeyInput] = useState("")
    const [isSaving, setIsSaving] = useState(false)
    const [isTesting, setIsTesting] = useState(false)
    const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null)
    const [errorMsg, setErrorMsg] = useState("")
    const [hasKey, setHasKey] = useState(false)

    useEffect(() => {
        if (isSettingsOpen) {
            hasByokKeyAction().then(setHasKey)
            setTestResult(null)
            setErrorMsg("")
        }
    }, [isSettingsOpen])

    function validateApiKeyFormat(key: string): string | null {
        const trimmed = key.trim()
        if (!trimmed) return "API key is required"
        if (trimmed.length < 10) return "API key is too short"
        if (trimmed.length > 1000) return "API key is too long"
        if (/\s/.test(trimmed)) return "API key cannot contain whitespace"
        return null
    }

    function byokFieldError(): string | null {
        if (settings.aiMode !== "byok") return null
        return validateByokConfig({
            baseUrl: settings.byokBaseUrl,
            modelId: settings.byokModelId,
            modelName: settings.byokModelName,
        })
    }

    /**
     * Verify the BYOK endpoint by hitting {baseUrl}/models with the key.
     * Uses the live input values (not the httpOnly cookie) so the user
     * can verify before saving.
     */
    async function handleTestKey() {
        setTestResult(null)
        const key = apiKeyInput.trim()
        if (settings.aiMode !== "byok") return
        const configError = validateByokConfig({
            baseUrl: settings.byokBaseUrl,
            modelId: settings.byokModelId,
            modelName: settings.byokModelName,
        })
        if (configError) {
            setErrorMsg(configError)
            return
        }
        // The key can come from the input (unsaved) or the saved cookie.
        if (!key && !hasKey) {
            setErrorMsg("Enter your API key (or save it first) to test the connection.")
            return
        }
        setIsTesting(true)
        setErrorMsg("")
        try {
            const baseUrl = settings.byokBaseUrl.trim().replace(/\/+$/, "")
            const headers: Record<string, string> = {}
            if (key) {
                const formatError = validateApiKeyFormat(key)
                if (formatError) {
                    setErrorMsg(formatError)
                    setIsTesting(false)
                    return
                }
                headers["Authorization"] = `Bearer ${key}`
            }
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10_000)
            // NOTE: without a key we still try the request — some
            // self-hosted endpoints allow unauthenticated /models. The
            // cookie key can't be read from JS, so an empty-input test
            // after saving will exercise the endpoint shape only.
            const res = await fetch(`${baseUrl}/models`, {
                method: "GET",
                headers,
                signal: controller.signal,
            })
            clearTimeout(timeoutId)
            if (res.ok) {
                setTestResult("ok")
            } else {
                setTestResult("fail")
                setErrorMsg(`Endpoint returned ${res.status} ${res.statusText}`)
            }
        } catch (e) {
            setTestResult("fail")
            if (e instanceof Error && e.name === "AbortError") {
                setErrorMsg("Connection test timed out")
            } else {
                setErrorMsg(`Connection test failed: ${e instanceof Error ? e.message : "unknown"}`)
            }
        } finally {
            setIsTesting(false)
        }
    }

    const handleSave = async () => {
        setIsSaving(true)
        setErrorMsg("")
        try {
            if (settings.aiMode === "byok") {
                const configError = byokFieldError()
                if (configError) {
                    setErrorMsg(configError)
                    setIsSaving(false)
                    return
                }
                if (apiKeyInput.trim()) {
                    const formatError = validateApiKeyFormat(apiKeyInput)
                    if (formatError) {
                        setErrorMsg(formatError)
                        setIsSaving(false)
                        return
                    }
                    const result = await saveByokKeyAction(apiKeyInput.trim())
                    if (!result.success) {
                        setErrorMsg(result.error || "Failed to save key")
                        setIsSaving(false)
                        return
                    }
                    setHasKey(true)
                    setApiKeyInput("")
                } else if (!hasKey) {
                    setErrorMsg("Enter your API key — it is stored securely and never shown again.")
                    setIsSaving(false)
                    return
                }
            } else if (apiKeyInput.trim()) {
                // Managed mode needs no key, but don't silently drop a
                // pasted key — save it in case the user switches to BYOK.
                const result = await saveByokKeyAction(apiKeyInput.trim())
                if (result.success) {
                    setHasKey(true)
                    setApiKeyInput("")
                }
            }
            setSettingsOpen(false)
        } catch {
            setErrorMsg("An unexpected error occurred")
        }
        setIsSaving(false)
    }

    const handleClearKey = async () => {
        await clearByokKeyAction()
        setHasKey(false)
        setApiKeyInput("")
        setTestResult(null)
    }

    const isByok = settings.aiMode === "byok"

    return (
        <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="sm:max-w-[500px] max-h-[90dvh] overflow-y-auto border-none bg-background/95 backdrop-blur-xl shadow-2xl">
                <DialogHeader className="mb-4 text-center">
                    <DialogTitle className="text-xl font-bold tracking-tight">AI Setup</DialogTitle>
                    <DialogDescription className="text-muted-foreground/80">
                        Pick who provides the model. Two options, nothing else.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 px-2 min-w-0 [&>*]:min-w-0">
                    {/* Mode selector — the only "model selection" left */}
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => updateSettings({ aiMode: "managed" })}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-all",
                                !isByok
                                    ? "border-[var(--f1-green)]/60 bg-[var(--f1-green)]/10"
                                    : "border-muted/40 bg-muted/5 hover:border-muted"
                            )}
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <Server className="h-4 w-4 text-[var(--f1-green)]" />
                                <span className="text-sm font-bold">Setup by me</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug">
                                Managed model (MiMo V2.5), configured by the app owner. No setup needed.
                            </p>
                        </button>
                        <button
                            type="button"
                            onClick={() => updateSettings({ aiMode: "byok" })}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-all",
                                isByok
                                    ? "border-[var(--f1-yellow)]/60 bg-[var(--f1-yellow)]/10"
                                    : "border-muted/40 bg-muted/5 hover:border-muted"
                            )}
                        >
                            <div className="flex items-center gap-2 mb-1">
                                <KeyRound className="h-4 w-4 text-[var(--f1-yellow)]" />
                                <span className="text-sm font-bold">BYOK by you</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug">
                                Bring your own key + any OpenAI-compatible endpoint.
                            </p>
                        </button>
                    </div>

                    {isByok ? (
                        <div className="space-y-4 rounded-lg border border-muted/40 p-3 bg-muted/5">
                            <div className="space-y-2">
                                <Label htmlFor="byokBaseUrl" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                                    Model URL
                                </Label>
                                <Input
                                    id="byokBaseUrl"
                                    type="url"
                                    inputMode="url"
                                    value={settings.byokBaseUrl}
                                    onChange={(e) => {
                                        updateSettings({ byokBaseUrl: e.target.value })
                                        if (errorMsg) setErrorMsg("")
                                    }}
                                    placeholder="https://api.openai.com/v1"
                                    className="font-mono text-sm"
                                />
                                <p className="text-[10px] text-muted-foreground/70">
                                    Base URL of any OpenAI-compatible API (no trailing path needed).
                                </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="byokModelId" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                                        Identifier
                                    </Label>
                                    <Input
                                        id="byokModelId"
                                        value={settings.byokModelId}
                                        onChange={(e) => {
                                            updateSettings({ byokModelId: e.target.value })
                                            if (errorMsg) setErrorMsg("")
                                        }}
                                        placeholder="gpt-4o-mini"
                                        className="font-mono text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="byokModelName" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                                        Name
                                    </Label>
                                    <Input
                                        id="byokModelName"
                                        value={settings.byokModelName}
                                        onChange={(e) => {
                                            updateSettings({ byokModelName: e.target.value })
                                            if (errorMsg) setErrorMsg("")
                                        }}
                                        placeholder="My GPT"
                                        className="text-sm"
                                    />
                                </div>
                            </div>
                            <p className="text-[10px] text-muted-foreground/70 -mt-2">
                                Identifier is sent to the API. Name is just the label shown in the app.
                            </p>

                            <div className="space-y-2">
                                <Label htmlFor="byokApiKey" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                                    API Key
                                </Label>
                                <div className="relative group">
                                    <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-r from-[var(--f1-purple)] to-[var(--f1-purple)] opacity-20 group-hover:opacity-40 transition duration-500 blur-sm"></div>
                                    <Input
                                        id="byokApiKey"
                                        type="password"
                                        value={apiKeyInput}
                                        onChange={(e) => {
                                            setApiKeyInput(e.target.value)
                                            if (errorMsg) setErrorMsg("")
                                        }}
                                        className="relative bg-background border-muted/40 focus-visible:ring-1 focus-visible:ring-[var(--f1-purple)] focus-visible:border-[var(--f1-purple)]/50 transition-all font-mono text-sm"
                                        placeholder={hasKey ? "Key is saved (hidden for security)" : "sk-..."}
                                    />
                                </div>
                                {hasKey && !apiKeyInput && (
                                    <button
                                        type="button"
                                        onClick={handleClearKey}
                                        className="text-[11px] text-muted-foreground underline hover:text-[var(--f1-red)]"
                                    >
                                        Remove saved key
                                    </button>
                                )}
                            </div>

                            {errorMsg && <p className="text-xs text-red-500 mt-1">{errorMsg}</p>}
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={handleTestKey}
                                    disabled={isTesting || isSaving}
                                    className="text-xs"
                                >
                                    {isTesting ? (
                                        <>
                                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                            Testing...
                                        </>
                                    ) : (
                                        "Test connection"
                                    )}
                                </Button>
                                {testResult && (
                                    <span
                                        className={cn(
                                            "text-xs",
                                            testResult === "ok" ? "text-green-500" : "text-red-500"
                                        )}
                                    >
                                        {testResult === "ok" ? "✓ Endpoint works" : "✗ Endpoint rejected"}
                                    </span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-muted/40 p-3 bg-muted/5">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Managed mode uses the model configured by the app owner
                                (MiMo V2.5, same model for planning and answering).
                                Nothing to enter — just confirm and chat.
                            </p>
                            {errorMsg && <p className="text-xs text-red-500 mt-2">{errorMsg}</p>}
                        </div>
                    )}

                    {/* Developer Mode */}
                    <div className="flex items-center justify-between rounded-lg border border-muted/40 p-3 bg-muted/5 mt-1">
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
                        onClick={() => {
                            clearMessages()
                            // Keep the cloud copy in sync: drop this
                            // session's messages (D1 + R2 blobs) too.
                            const sessionId = useChatStore.getState().currentSessionId
                            if (sessionId && !sessionId.startsWith("local_")) {
                                import("@/lib/cf/client").then(({ clearCloudMessages }) => {
                                    clearCloudMessages(sessionId)
                                })
                            }
                        }}
                        type="button"
                        className="text-muted-foreground hover:text-[var(--f1-red)] hover:bg-[var(--f1-red)]/10 text-xs uppercase tracking-wide"
                    >
                        Clear Telemetry
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-foreground text-background hover:bg-foreground/90 font-bold tracking-wide"
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        CONFIRM SETUP
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
