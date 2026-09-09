/**
 * OpenRouter Model Catalog
 * ========================
 * GET /api/models/openrouter
 *
 * Returns a normalized, search-friendly list of OpenRouter models. The
 * frontend uses this to power the "Add other models" dialog so the
 * user can pick any OpenRouter model instead of being limited to the
 * built-in presets.
 *
 * Query params:
 *   - search: optional substring filter (matches id, name, description)
 *
 * Authentication: the user's OpenRouter API key is required to access
 * the upstream catalog with a higher rate limit. We forward it from
 * the `x-openrouter-key` header (sent from the client at request
 * time — never persisted to a URL/log). If absent we still call the
 * public endpoint which returns the same models at a lower quota.
 *
 * Response shape (trimmed to what the UI needs):
 *   { models: [{ id, name, description, contextLength, pricing }] }
 */

import { NextRequest, NextResponse } from "next/server"
import { envInt, envStr } from "@/lib/config"

interface OpenRouterModel {
    id: string
    name?: string
    description?: string
    context_length?: number
    pricing?: {
        prompt?: string
        completion?: string
    }
    top_provider?: {
        max_completion_tokens?: number
    }
    architecture?: {
        modality?: string
    }
}

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(request: NextRequest) {
    const apiKey = request.headers.get("x-openrouter-key")?.trim() || ""
    const search = request.nextUrl.searchParams.get("search")?.toLowerCase().trim() || ""

    const headers: Record<string, string> = {
        // Identify ourselves to OpenRouter per their attribution policy.
        // The site URL / app name are best-effort from env.
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || envStr("OPENROUTER_REFERER_FALLBACK", "https://f1.local"),
        "X-Title": process.env.NEXT_PUBLIC_APP_NAME || envStr("OPENROUTER_APP_NAME_FALLBACK", "F1 AI Chatbot"),
    }
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`
    }

    try {
        const upstream = await fetch(envStr("OPENROUTER_CATALOG_URL", "https://openrouter.ai/api/v1/models"), {
            method: "GET",
            headers,
            // Re-fetch on every request so newly released models show up.
            // The endpoint is fast and small (<1MB JSON).
            cache: "no-store",
        })

        if (!upstream.ok) {
            return NextResponse.json(
                { error: `OpenRouter catalog returned ${upstream.status}` },
                { status: upstream.status }
            )
        }

        const json = (await upstream.json()) as { data?: OpenRouterModel[] }
        const all = json.data ?? []

        const models = all
            .map((m) => ({
                id: m.id,
                name: m.name || m.id,
                description: m.description || "",
                contextLength: m.context_length ?? m.top_provider?.max_completion_tokens ?? null,
                pricing: m.pricing
                    ? {
                          // OpenRouter pricing is in USD per token as a
                          // decimal string ("0.000002"). We keep it as
                          // a string so the client can format it however
                          // it wants without floating-point drift.
                          prompt: m.pricing.prompt ?? null,
                          completion: m.pricing.completion ?? null,
                      }
                    : null,
                modality: m.architecture?.modality ?? null,
            }))
            .filter((m) => {
                if (!search) return true
                return (
                    m.id.toLowerCase().includes(search) ||
                    m.name.toLowerCase().includes(search) ||
                    m.description.toLowerCase().includes(search)
                )
            })
            // Stable, predictable ordering: alphabetical by id.
            .sort((a, b) => a.id.localeCompare(b.id))

        return NextResponse.json({ models }, {
            headers: {
                // The catalog is cheap to refetch but we still cache it
                // briefly on the client to make typing in the search
                // box feel snappy. Duration is config-driven.
                "Cache-Control": `private, max-age=${envInt("OPENROUTER_CATALOG_CACHE_SECONDS", 60)}`,
            },
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch models"
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
