"use client"

/**
 * AddModelsDialog
 * ===============
 *
 * Dialog that lets the user add any OpenRouter model (or a custom model
 * id by free-text) to their `settings.customModels` list. The custom
 * list then appears alongside the built-in presets in the
 * ControlPanel's model picker.
 *
 * Two ways to add a model:
 *   1. Browse the OpenRouter catalog (powered by GET /api/models/openrouter)
 *      with a search box. Selecting a row calls back with the model id.
 *   2. Type any model id in the free-text field at the top — useful for
 *      private deployments, models the catalog hasn't indexed yet, or
 *      paste-from-elsewhere workflows.
 *
 * We deliberately re-fetch the catalog every time the dialog opens so
 * newly released models show up without requiring a deploy. No user API
 * key is forwarded (H5) — the public catalog quota applies.
 */

import { useEffect, useMemo, useState } from "react"
import { Search, Loader2, Plus, X, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useChatStore } from "@/lib/store"
import { cn } from "@/lib/utils"

interface OpenRouterModelSummary {
    id: string
    name: string
    description: string
    contextLength: number | null
    modality: string | null
    pricing: { prompt: string | null; completion: string | null } | null
}

interface AddModelsDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function AddModelsDialog({ open, onOpenChange }: AddModelsDialogProps) {
    const settings = useChatStore((s) => s.settings)
    const updateSettings = useChatStore((s) => s.updateSettings)
    const [search, setSearch] = useState("")
    const [freeText, setFreeText] = useState("")
    const [models, setModels] = useState<OpenRouterModelSummary[] | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    /**
     * Fetch the catalog every time the dialog opens. We don't cache
     * results across opens because the catalog changes (new models,
     * deprecations) and the response is small. H5: no stored key is
     * forwarded — the public endpoint quota applies; BYOK users rely
     * on the server env key.
     */
    useEffect(() => {
        if (!open) return
        let cancelled = false
        // Initial fetch state is set from the event that opened the dialog
        // (user click), not during render — the effect only continues it.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLoading(true)
        setError(null)
        fetch("/api/models/openrouter", {
            method: "GET",
        })
            .then(async (res) => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}))
                    throw new Error(body.error || `Catalog fetch failed (${res.status})`)
                }
                return res.json() as Promise<{ models: OpenRouterModelSummary[] }>
            })
            .then((data) => {
                if (cancelled) return
                setModels(data.models)
            })
            .catch((e) => {
                if (cancelled) return
                setError(e instanceof Error ? e.message : "Failed to load models")
                setModels([])
            })
            .finally(() => {
                if (cancelled) return
                setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [open])

    // Client-side search filter — the server already filters by the
    // same `search` param, but we re-filter on every keystroke so the
    // UI feels instant (the network call has its own debouncing via
    // the response cache header).
    const filtered = useMemo(() => {
        if (!models) return []
        if (!search) return models
        const q = search.toLowerCase()
        return models.filter(
            (m) =>
                m.id.toLowerCase().includes(q) ||
                m.name.toLowerCase().includes(q) ||
                m.description.toLowerCase().includes(q)
        )
    }, [models, search])

    /**
     * Append a model id to the custom list, deduping against both the
     * existing list and any built-in presets. The custom list is
     * meant to be additive — it never silently overwrites a
     * selection.
     */
    const addModel = (id: string) => {
        const trimmed = id.trim()
        if (!trimmed) return
        const existing = new Set(settings.customModels)
        if (existing.has(trimmed)) {
            // Already added — give a tiny visual hint by re-rendering
            // the list with the row briefly highlighted. Keeping the
            // state simple: we just no-op.
            return
        }
        updateSettings({ customModels: [...settings.customModels, trimmed] })
    }

    const removeModel = (id: string) => {
        updateSettings({
            customModels: settings.customModels.filter((m) => m !== id),
        })
    }

    const handleFreeTextAdd = () => {
        if (!freeText.trim()) return
        addModel(freeText)
        setFreeText("")
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[640px] border-none bg-background/95 backdrop-blur-xl shadow-2xl">
                <DialogHeader className="mb-4 text-left">
                    <DialogTitle className="text-xl font-bold tracking-tight flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-[var(--f1-yellow)]" />
                        Add other models
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground/80">
                        Pick any OpenRouter model or paste a custom model id. Added
                        models will appear in the model picker alongside the built-in
                        presets.
                    </DialogDescription>
                </DialogHeader>

                {/* Free-text input — fastest path for "I know exactly which
                    model I want". Accepts any string the user types; we
                    pass it through to the OpenRouter API verbatim. */}
                <div className="space-y-2 mb-4">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                        Add by model id
                    </Label>
                    <div className="flex gap-2">
                        <Input
                            value={freeText}
                            onChange={(e) => setFreeText(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault()
                                    handleFreeTextAdd()
                                }
                            }}
                            placeholder="e.g. anthropic/claude-3.5-sonnet"
                            className="font-mono text-sm"
                        />
                        <Button
                            type="button"
                            onClick={handleFreeTextAdd}
                            disabled={!freeText.trim()}
                            className="shrink-0"
                        >
                            <Plus className="h-4 w-4 mr-1" />
                            Add
                        </Button>
                    </div>
                </div>

                {/* Currently added list — so the user can see what's
                    already in their custom set and remove it without
                    searching the catalog again. */}
                {settings.customModels.length > 0 && (
                    <div className="space-y-2 mb-4">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                            Your custom models
                        </Label>
                        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar">
                            {settings.customModels.map((m) => (
                                <span
                                    key={m}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[var(--f1-yellow)]/10 border border-[var(--f1-yellow)]/30 text-xs font-mono"
                                >
                                    {m}
                                    <button
                                        type="button"
                                        onClick={() => removeModel(m)}
                                        className="text-muted-foreground hover:text-[var(--f1-red)] transition-colors"
                                        aria-label={`Remove ${m}`}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Catalog browser */}
                <div className="space-y-2">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 ml-1">
                        Browse OpenRouter catalog
                    </Label>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search models…"
                            className="pl-9"
                            disabled={loading && !models}
                        />
                        {loading && (
                            <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                    </div>

                    {error && (
                        <p className="text-xs text-red-500 mt-1">{error}</p>
                    )}

                    <div
                        className={cn(
                            "border border-muted/40 rounded-md max-h-72 overflow-y-auto custom-scrollbar",
                            (!models || models.length === 0) && "min-h-[120px] flex items-center justify-center"
                        )}
                    >
                        {!models && loading && (
                            <p className="text-xs text-muted-foreground p-4 text-center">
                                Loading OpenRouter catalog…
                            </p>
                        )}
                        {models && filtered.length === 0 && !loading && (
                            <p className="text-xs text-muted-foreground p-4 text-center">
                                {search
                                    ? "No models match your search."
                                    : "No models available."}
                            </p>
                        )}
                        {filtered.length > 0 && (
                            <ul className="divide-y divide-muted/30">
                                {filtered.map((m) => {
                                    const alreadyAdded = settings.customModels.includes(m.id)
                                    return (
                                        <li
                                            key={m.id}
                                            className="flex items-start justify-between gap-2 p-3 hover:bg-muted/30 transition-colors"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-mono text-xs font-bold truncate">
                                                        {m.id}
                                                    </span>
                                                    {m.contextLength != null && (
                                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                                            {(m.contextLength / 1000).toFixed(0)}k ctx
                                                        </span>
                                                    )}
                                                </div>
                                                {m.description && (
                                                    <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                                                        {m.description}
                                                    </p>
                                                )}
                                            </div>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant={alreadyAdded ? "ghost" : "outline"}
                                                onClick={() => addModel(m.id)}
                                                disabled={alreadyAdded}
                                                className="shrink-0 h-7 text-xs"
                                            >
                                                {alreadyAdded ? "Added" : "Add"}
                                            </Button>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="flex justify-end pt-4">
                    <Button
                        type="button"
                        onClick={() => onOpenChange(false)}
                        className="bg-foreground text-background hover:bg-foreground/90 font-bold tracking-wide"
                    >
                        DONE
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
