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

// In-process limiter for the catalog proxy (10/min per caller). Same
// multi-instance caveat as the chat limiter — swap for a shared store if
// abuse is observed.
const CATALOG_WINDOW_MS = 60_000;
const CATALOG_MAX = 10;
const catalogBuckets = new Map<string, number[]>();

function catalogKey(req: NextRequest): string {
    const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = (fwd && /^[A-Za-z0-9.:]{3,64}$/.test(fwd) ? fwd : null)
        || req.headers.get("x-real-ip")?.trim()
        || "anon";
    return `catalog:${ip}`;
}

function catalogAllowed(req: NextRequest): number | null {
    const now = Date.now();
    const cutoff = now - CATALOG_WINDOW_MS;
    const key = catalogKey(req);
    const bucket = (catalogBuckets.get(key) || []).filter((t) => t > cutoff);
    if (bucket.length >= CATALOG_MAX) {
        return Math.max(0, CATALOG_WINDOW_MS - (now - bucket[0]!));
    }
    bucket.push(now);
    catalogBuckets.set(key, bucket);
    return null;
}

export async function GET(request: NextRequest) {
    const waitMs = catalogAllowed(request);
    if (waitMs !== null) {
        return NextResponse.json(
            { error: "Rate limit exceeded. Please slow down." },
            { status: 429, headers: { "Retry-After": Math.ceil(waitMs / 1000).toString(), "Cache-Control": "no-store" } }
        );
    }
    const rawKey = request.headers.get("x-openrouter-key")?.trim() || "";
    // Validate key shape to block header-injection / log-pollution attempts.
    const apiKey = /^[A-Za-z0-9._~-]{8,512}$/.test(rawKey) ? rawKey : "";
    const search = request.nextUrl.searchParams.get("search")?.toLowerCase().trim().slice(0, 128) || ""

    const headers: Record<string, string> = {
        // Identify ourselves to OpenRouter per their attribution policy.
        // The site URL / app name are best-effort from env.
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://f1.local",
        "X-Title": process.env.NEXT_PUBLIC_APP_NAME || "F1 AI Chatbot",
    }
    if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`
    }

    try {
        const upstream = await fetch("https://openrouter.ai/api/v1/models", {
            method: "GET",
            headers,
            // Re-fetch on every request so newly released models show up.
            // The endpoint is fast and small (<1MB JSON).
            cache: "no-store",
        })

        if (!upstream.ok) {
            return NextResponse.json(
                { error: `OpenRouter catalog returned ${upstream.status}` },
                { status: upstream.status, headers: { "Cache-Control": "no-store" } }
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
                // box feel snappy.
                "Cache-Control": "private, max-age=60",
            },
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch models"
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
