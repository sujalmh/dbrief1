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
import { validateByokConfig } from "@/lib/providers"
import { saveByokKeyAction, hasByokKeyAction, clearByokKeyAction } from "@/app/actions/settings"
import { useState, useEffect } from "react"
import { useTheme } from "next-themes"
import { Loader2, Server, KeyRound, Sun, Moon, Monitor } from "lucide-react"
import { cn } from "@/lib/utils"

export function SettingsModal() {
    const isSettingsOpen = useChatStore((s) => s.isSettingsOpen)
    const setSettingsOpen = useChatStore((s) => s.setSettingsOpen)
    const settings = useChatStore((s) => s.settings)
    const updateSettings = useChatStore((s) => s.updateSettings)
    const clearMessages = useChatStore((s) => s.clearMessages)
    const [apiKeyInput, setApiKeyInput] = useState("")
    const [isSaving, setIsSaving] = useState(false)
    const [isTesting, setIsTesting] = useState(false)
    const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null)
    const [errorMsg, setErrorMsg] = useState("")
    const [hasKey, setHasKey] = useState(false)
    const { theme, setTheme } = useTheme()
    const activeTheme = theme ?? "system"

    // Draft state: the modal edits a local copy and only writes back to
    // the store on CONFIRM. Closing via X / overlay / Escape discards the
    // draft, so peeking at BYOK never flips the app's live aiMode.
    const [draftAiMode, setDraftAiMode] = useState(settings.aiMode)
    const [draftBaseUrl, setDraftBaseUrl] = useState(settings.byokBaseUrl)
    const [draftModelId, setDraftModelId] = useState(settings.byokModelId)
    const [draftModelName, setDraftModelName] = useState(settings.byokModelName)

    useEffect(() => {
        if (isSettingsOpen) {
            hasByokKeyAction().then(setHasKey)
            setTestResult(null)
            setErrorMsg("")
            setApiKeyInput("")
            // Snapshot the live settings into the draft on every open.
            setDraftAiMode(settings.aiMode)
            setDraftBaseUrl(settings.byokBaseUrl)
            setDraftModelId(settings.byokModelId)
            setDraftModelName(settings.byokModelName)
        }
        // Snapshot intentially runs on open only — draft edits must not
        // be overwritten by store changes while the modal is open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        if (draftAiMode !== "byok") return null
        return validateByokConfig({
            baseUrl: draftBaseUrl,
            modelId: draftModelId,
            modelName: draftModelName,
        })
    }

    /**
     * Verify the BYOK endpoint by hitting {baseUrl}/models with the key.
     * Uses the live draft values (not the httpOnly cookie) so the user
     * can verify before saving.
     */
    async function handleTestKey() {
        setTestResult(null)
        const key = apiKeyInput.trim()
        if (draftAiMode !== "byok") return
        const configError = validateByokConfig({
            baseUrl: draftBaseUrl,
            modelId: draftModelId,
            modelName: draftModelName,
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
            const baseUrl = draftBaseUrl.trim().replace(/\/+$/, "")
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
            if (draftAiMode === "byok") {
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
            // Single commit point: draft → live store. Nothing above
            // touched the store, so cancelling earlier changed nothing.
            updateSettings({
                aiMode: draftAiMode,
                byokBaseUrl: draftBaseUrl,
                byokModelId: draftModelId,
                byokModelName: draftModelName,
            })
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

    const isByok = draftAiMode === "byok"

    return (
        <Dialog open={isSettingsOpen} onOpenChange={setSettingsOpen}>
            {/* Gradient outline + frosted glass body, matching the composer. */}
            <DialogContent className="sm:max-w-[520px] max-h-[90dvh] overflow-y-auto border-none bg-gradient-to-br from-white/25 via-white/10 to-transparent p-px shadow-[0_8px_32px_rgba(0,0,0,0.5)] gap-0">
                <div className="rounded-[calc(0.5rem-1px)] bg-background/85 backdrop-blur-2xl p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                <DialogHeader className="mb-4 text-center">
                    <div className="mx-auto mb-2 h-1 w-12 rounded-full bg-gradient-to-r from-[var(--f1-red)] to-[var(--f1-red)]/40" />
                    <DialogTitle className="text-xl font-black uppercase italic tracking-widest">AI Setup</DialogTitle>
                    <DialogDescription className="text-muted-foreground/80">
                        Pick who provides the model. Two options, nothing else.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-5 px-2 min-w-0 [&>*]:min-w-0">
                    {/* Mode selector — physical cards, latched when active */}
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setDraftAiMode("managed")}
                            data-active={!isByok}
                            className={cn(
                                "btn-physical p-3 text-left",
                                !isByok && "ring-1 ring-[var(--f1-green)]/60"
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
                            onClick={() => setDraftAiMode("byok")}
                            data-active={isByok}
                            className={cn(
                                "btn-physical p-3 text-left",
                                isByok && "ring-1 ring-[var(--f1-yellow)]/60"
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

                    {/* Appearance — theme lives here now (removed from navbar) */}
                    <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                            Appearance
                        </Label>
                        <div className="grid grid-cols-3 gap-2">
                            {(
                                [
                                    { value: "light", label: "Light", Icon: Sun },
                                    { value: "dark", label: "Dark", Icon: Moon },
                                    { value: "system", label: "System", Icon: Monitor },
                                ] as const
                            ).map(({ value, label, Icon }) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => setTheme(value)}
                                    data-active={activeTheme === value}
                                    className="btn-physical flex items-center justify-center gap-1.5 px-2 py-2 text-xs"
                                >
                                    <Icon className="h-3.5 w-3.5" />
                                    <span>{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {isByok ? (
                        <div className="space-y-4 rounded-xl border border-white/10 p-3 bg-white/5 backdrop-blur">
                            <div className="space-y-2">
                                <Label htmlFor="byokBaseUrl" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                                    Model URL
                                </Label>
                                <Input
                                    id="byokBaseUrl"
                                    type="url"
                                    inputMode="url"
                                    value={draftBaseUrl}
                                    onChange={(e) => {
                                        setDraftBaseUrl(e.target.value)
                                        if (errorMsg) setErrorMsg("")
                                    }}
                                    placeholder="https://api.openai.com/v1"
                                    className="font-mono text-sm bg-background/60 border-white/10 focus-visible:border-[var(--f1-green)]/50 focus-visible:ring-1 focus-visible:ring-[var(--f1-green)]/40"
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
                                        value={draftModelId}
                                        onChange={(e) => {
                                            setDraftModelId(e.target.value)
                                            if (errorMsg) setErrorMsg("")
                                        }}
                                        placeholder="gpt-4o-mini"
                                        className="font-mono text-sm bg-background/60 border-white/10 focus-visible:border-[var(--f1-green)]/50 focus-visible:ring-1 focus-visible:ring-[var(--f1-green)]/40"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="byokModelName" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                                        Name
                                    </Label>
                                    <Input
                                        id="byokModelName"
                                        value={draftModelName}
                                        onChange={(e) => {
                                            setDraftModelName(e.target.value)
                                            if (errorMsg) setErrorMsg("")
                                        }}
                                        placeholder="My GPT"
                                        className="text-sm bg-background/60 border-white/10 focus-visible:border-[var(--f1-green)]/50 focus-visible:ring-1 focus-visible:ring-[var(--f1-green)]/40"
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
                                <Input
                                    id="byokApiKey"
                                    type="password"
                                    value={apiKeyInput}
                                    onChange={(e) => {
                                        setApiKeyInput(e.target.value)
                                        if (errorMsg) setErrorMsg("")
                                    }}
                                    className="bg-background/60 border-white/10 focus-visible:border-[var(--f1-green)]/50 focus-visible:ring-1 focus-visible:ring-[var(--f1-green)]/40 font-mono text-sm"
                                    placeholder={hasKey ? "Key is saved (hidden for security)" : "sk-..."}
                                />
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
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleTestKey}
                                    disabled={isTesting || isSaving}
                                    className="btn-wheel h-8 px-3 text-xs"
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
                        <div className="rounded-xl border border-white/10 p-3 bg-white/5 backdrop-blur">
                            <p className="text-xs text-muted-foreground leading-relaxed">
                                Managed mode uses the model configured by the app owner
                                (MiMo V2.5, same model for planning and answering).
                                Nothing to enter — just confirm and chat.
                            </p>
                            {errorMsg && <p className="text-xs text-red-500 mt-2">{errorMsg}</p>}
                        </div>
                    )}

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
                        className="btn-wheel h-9 px-4 text-muted-foreground hover:text-[var(--f1-red)] text-xs uppercase tracking-wide"
                    >
                        Clear Telemetry
                    </Button>
                    <Button
                        type="button"
                        onClick={handleSave}
                        disabled={isSaving}
                        className="btn-wheel btn-wheel-green h-9 px-5 font-bold tracking-wide"
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        CONFIRM SETUP
                    </Button>
                </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
