import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { citationsConfig } from "./config"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Allow-list for outbound links rendered from retrieval payloads.
 * Qdrant document URLs are ingestion-controlled, but defense-in-depth:
 * only http(s) links ever become clickable anchors (blocks `javascript:`,
 * `data:`, and other exotic schemes even if a payload is ever poisoned).
 */
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
}

/** Resolve the clickable link for a source citation, or null for text-only. */
export function citationHref(citation: {
  url?: string | null
  source_url?: string | null
}): string | null {
  if (isSafeHttpUrl(citation.source_url)) return citation.source_url
  if (isSafeHttpUrl(citation.url)) return citation.url
  return null
}

export interface SanitizedCitation {
  source: string
  type: string
  title?: string | null
  url?: string | null
  source_url?: string | null
}

/**
 * Coerce unknown input (SSE payload, Firestore doc) into safe citations.
 * Drops malformed entries, caps count/lengths to bound Firestore doc size,
 * and only keeps http(s) links. Never throws. Caps are config-driven
 * (see lib/config.ts citationsConfig).
 */
export function sanitizeCitations(value: unknown): SanitizedCitation[] {
  if (!Array.isArray(value)) return []
  const maxCitations = citationsConfig.maxCitations()
  const maxSourceChars = citationsConfig.maxSourceChars()
  const maxTypeChars = citationsConfig.maxTypeChars()
  const maxTitleChars = citationsConfig.maxTitleChars()
  const maxUrlChars = citationsConfig.maxUrlChars()
  const out: SanitizedCitation[] = []
  for (const item of value) {
    if (out.length >= maxCitations) break
    if (typeof item !== "object" || item === null) continue
    const rec = item as Record<string, unknown>
    if (typeof rec.source !== "string" || rec.source.length === 0) continue
    const citation: SanitizedCitation = {
      source: rec.source.slice(0, maxSourceChars),
      type:
        typeof rec.type === "string" && rec.type.length > 0
          ? rec.type.slice(0, maxTypeChars)
          : "regulation",
    }
    if (typeof rec.title === "string" && rec.title.length > 0) {
      citation.title = rec.title.slice(0, maxTitleChars)
    }
    if (isSafeHttpUrl(rec.source_url)) {
      citation.source_url = rec.source_url.slice(0, maxUrlChars)
    }
    if (isSafeHttpUrl(rec.url)) {
      citation.url = rec.url.slice(0, maxUrlChars)
    }
    out.push(citation)
  }
  return out
}
