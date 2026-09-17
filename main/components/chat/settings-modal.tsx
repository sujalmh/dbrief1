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
import { getProviderMeta } from "@/lib/providers"
import { saveApiKeyAction, hasApiKeyAction } from "@/app/actions/settings"
import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
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
            hasApiKeyAction().then(setHasKey)
            setTestResult(null)
        }
    }, [isSettingsOpen])

    /**
     * Format-only validation that catches the most common mistakes
     * (too short, missing prefix, embedded whitespace) before we
     * round-trip the key to the server. The server action still
     * re-validates — this is purely a UX speed-up.
     */
    function validateApiKeyFormat(key: string): string | null {
        const trimmed = key.trim()
        if (!trimmed) return "API key is required"
        if (trimmed.length < 10) return "API key is too short"
        if (trimmed.length > 512) return "API key is too long"
        if (/\s/.test(trimmed)) return "API key cannot contain whitespace"
        // Common provider prefixes. Not exhaustive — just a hint.
        const knownPrefixes = ["sk-", "sk-", "AIza", "hf_", "gsk_"]
        const hasKnownPrefix = knownPrefixes.some((p) => trimmed.startsWith(p))
        // Only warn for empty prefix when key is long enough to look real
        if (!hasKnownPrefix && !/[a-zA-Z0-9_-]{20,}/.test(trimmed)) {
            return "API key format doesn't look right"
        }
        return null
    }

    /**
     * Verify the key against the current provider's key-test endpoint
     * from the provider registry (works for every configured provider —
     * OpenRouter, Gemini, HuggingFace, Zen, and Go). Anything other than
     * a 200 response is treated as a failure. The key is sent in an
     * Authorization header (or ?key= query param for Gemini-style
     * endpoints) — the body of the response is discarded.
     */
    async function handleTestKey() {
        if (!apiKeyInput) return
        setIsTesting(true)
        setTestResult(null)
        const formatError = validateApiKeyFormat(apiKeyInput)
        if (formatError) {
            setErrorMsg(formatError)
            setIsTesting(false)
            return
        }
        try {
            const meta = getProviderMeta(settings.provider)
            if (!meta?.keyTest) {
                setErrorMsg(`Key testing isn't supported for this provider yet — save and try a chat.`)
                setIsTesting(false)
                return
            }
            let testUrl = meta.keyTest.url
            const headers: Record<string, string> = {}
            if (meta.keyTest.auth === "bearer") {
                headers.Authorization = `Bearer ${apiKeyInput}`
            } else {
                const sep = testUrl.includes("?") ? "&" : "?"
                testUrl = `${testUrl}${sep}key=${encodeURIComponent(apiKeyInput)}`
            }
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 10_000)
            const res = await fetch(testUrl, { method: "GET", headers, signal: controller.signal })
            clearTimeout(timeoutId)
            if (res.ok) {
                setTestResult("ok")
            } else {
                setTestResult("fail")
                setErrorMsg(`Provider returned ${res.status} ${res.statusText}`)
            }
        } catch (e) {
            setTestResult("fail")
            if (e instanceof Error && e.name === "AbortError") {
                setErrorMsg("Key test timed out")
            } else {
                setErrorMsg(`Key test failed: ${e instanceof Error ? e.message : "unknown"}`)
            }
        } finally {
            setIsTesting(false)
        }
    }

    const handleSave = async () => {
        setIsSaving(true)
        setErrorMsg("")
        try {
            if (apiKeyInput) {
                // Run the same format check as the "Test Key" button so a
                // malformed key can't even be sent to the server action.
                const formatError = validateApiKeyFormat(apiKeyInput)
                if (formatError) {
                    setErrorMsg(formatError)
                    setIsSaving(false)
                    return
                }
                const result = await saveApiKeyAction(apiKeyInput)
                if (!result.success) {
                    setErrorMsg(result.error || "Failed to save key")
                    setIsSaving(false)
                    return
                }
                setHasKey(true)
            }
            // Remove the API key from local state completely so it doesn't get saved in localStorage
            if (settings.apiKey) {
                updateSettings({ apiKey: "" })
            }
            setSettingsOpen(false)
        } catch {
            setErrorMsg("An unexpected error occurred")
        }
        setIsSaving(false)
    }

    return (
        <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
            <DialogContent className="sm:max-w-[500px] max-h-[90dvh] overflow-y-auto border-none bg-background/95 backdrop-blur-xl shadow-2xl">
                <DialogHeader className="mb-4 text-center">
                    <DialogTitle className="text-xl font-bold tracking-tight">Race Configuration</DialogTitle>
                    <DialogDescription className="text-muted-foreground/80">
                        Manage your team access key and app preferences. Model
                        selection lives in the picker above the chat input.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 px-2 min-w-0 [&>*]:min-w-0">
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
                                value={apiKeyInput}
                                onChange={(e) => {
                                    setApiKeyInput(e.target.value)
                                    // Live format check as the user types
                                    if (errorMsg) setErrorMsg("")
                                }}
                                className="relative bg-background border-muted/40 focus-visible:ring-1 focus-visible:ring-[var(--f1-purple)] focus-visible:border-[var(--f1-purple)]/50 transition-all font-mono text-sm"
                                placeholder={hasKey ? "Key is set (hidden for security)" : "sk-..."}
                            />
                        </div>
                        {errorMsg && <p className="text-xs text-red-500 mt-1">{errorMsg}</p>}
                        {apiKeyInput && !errorMsg && (
                            <p className="text-[10px] text-muted-foreground/70">
                                Format looks OK. Use <span className="font-mono">Test Key</span> to verify it works against the provider before saving.
                            </p>
                        )}
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleTestKey}
                                disabled={!apiKeyInput || isTesting || isSaving}
                                className="text-xs"
                            >
                                {isTesting ? (
                                    <>
                                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                        Testing...
                                    </>
                                ) : (
                                    "Test Key"
                                )}
                            </Button>
                            {testResult && (
                                <span
                                    className={cn(
                                        "text-xs",
                                        testResult === "ok" ? "text-green-500" : "text-red-500"
                                    )}
                                >
                                    {testResult === "ok" ? "\u2713 Key works" : "\u2717 Key rejected"}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Current setup (read-only) — provider and models are
                        picked from the model picker above the chat input,
                        which also supports custom models and a dedicated
                        planner model. */}
                    <div className="flex items-center justify-between rounded-lg border border-muted/40 p-3 bg-muted/5">
                        <div className="space-y-0.5 min-w-0 flex-1">
                            <Label className="text-sm font-medium">Active Setup</Label>
                            {/* Wraps (never truncates): on a 390px phone the
                                full model id would otherwise push the dialog
                                wider than the viewport (grid blowout). */}
                            <p className="text-xs text-muted-foreground break-all leading-relaxed">
                                {getProviderMeta(settings.provider)?.menuLabel ?? settings.provider}
                                {" · "}
                                <span className="font-mono">{settings.model}</span>
                                {settings.plannerModel ? (
                                    <span className="font-mono"> (planner: {settings.plannerModel})</span>
                                ) : null}
                            </p>
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
