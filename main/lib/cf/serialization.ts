/**
 * Session serialization (pure, no Firebase I/O)
 * =============================================
 * Builds / parses the full message docs persisted by session-io.ts.
 * Has no I/O or credentials so unit tests can import it freely.
 */

import { sanitizeCitations } from "@/lib/utils";
import type { Message } from "@/lib/store";

/** Minimal stored-message envelope (columns live in D1, the rest in data_json). */
export interface StoredMessageRow {
    id?: string;
    role: "user" | "assistant";
    content: string;
    timestamp: unknown;
    queryType?: "telemetry" | "COMPARISON" | "STRATEGY" | "INSIGHTS";
    citations?: Array<{ source: string; type: string; title?: string | null; url?: string | null; source_url?: string | null }> | null;
}

/** D1/R2-backed doc budget (mirrors the old Firestore 1MB cap). */
export const FIRESTORE_DOC_LIMIT = 1_000_000;
/** Inline budget with headroom for serverTimestamp + field names. */
export const INLINE_BUDGET = 800_000;
/** A single field larger than this is offloaded to Storage when possible. */
export const OVERFLOW_FIELD_THRESHOLD = 200_000;
/** Max bytes fetched from a single Storage blob. */
export const MAX_BLOB_BYTES = 10_000_000;
/** Max rows kept per list payload when truncating (matches executor). */
const MAX_ROWS_TRUNCATED = 12;
/** Max telemetry points kept when truncating without Storage. */
const MAX_TELEMETRY_POINTS_TRUNCATED = 100;
/** Max laps kept when truncating without Storage. */
const MAX_LAPS_TRUNCATED = 30;

/**
 * Full message payload stored in D1 (data_json). Extends the legacy
 * ChatMessage (role/content/citations) with every field Message carries
 * in the client store, plus ownership + resume pointers.
 */
export interface FullMessageDoc extends StoredMessageRow {
    userId: string;
    /** Client-side stable ID (mirrors the doc ID). */
    clientId?: string;
    /** Original client timestamp ms (server `timestamp` owns ordering). */
    clientTimestamp?: number;
    reasoning?: string;
    isError?: boolean;
    steps?: NonNullable<Message["steps"]>;
    visualizationData?: unknown;
    visualizationRef?: string | null;
    visualizationTruncated?: boolean;
    degradedWarnings?: NonNullable<Message["degradedWarnings"]>;
    usage?: NonNullable<Message["usage"]>;
    researchType?: string;
    iterations?: NonNullable<Message["iterations"]>;
    evidence?: Array<NonNullable<NonNullable<Message["evidence"]>[number]> & { dataRef?: string | null; dataTruncated?: boolean }>;
    confidence?: NonNullable<Message["confidence"]>;
    reflections?: NonNullable<Message["reflections"]>;
    chartSpecs?: NonNullable<Message["chartSpecs"]>;
}

/** Session-level UI state persisted to the session doc `context`. */
export interface SessionUIState {
    visualizationData?: unknown;
    visualizationRef?: string | null;
    graphHistory?: Array<{ id: string; name: string; type: "lap_times" | "telemetry" | "comparison"; data?: unknown; dataRef?: string | null; timestamp: number }>;
    activeMessageId?: string | null;
}

export function estimateJsonBytes(value: unknown): number {
    try {
        return JSON.stringify(value)?.length ?? 0;
    } catch {
        return Number.MAX_SAFE_INTEGER;
    }
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sliceArray<T>(arr: T[], keep: number): { items: T[]; omitted: number } {
    if (arr.length <= keep) return { items: arr, omitted: 0 };
    return { items: arr.slice(0, keep), omitted: arr.length - keep };
}

/**
 * Truncate a single visualization payload item's `data` so charts can
 * still render from the head rows when Storage offload is unavailable.
 */
export function truncateVizData(data: unknown): { data: unknown; truncated: boolean } {
    if (!isRecord(data)) {
        if (Array.isArray(data)) {
            const { items, omitted } = sliceArray(data, MAX_ROWS_TRUNCATED);
            return omitted > 0 ? { data: [...items, { __truncated_from: data.length }], truncated: true } : { data, truncated: false };
        }
        return { data, truncated: false };
    }
    const out: Record<string, unknown> = { ...data };
    let truncated = false;
    for (const [key, val] of Object.entries(out)) {
        if (!Array.isArray(val)) continue;
        if (key === "data" && val.length > MAX_TELEMETRY_POINTS_TRUNCATED) {
            const { items, omitted } = sliceArray(val, MAX_TELEMETRY_POINTS_TRUNCATED);
            out[key] = items;
            out[`${key}_truncated_from`] = val.length;
            truncated = true;
            void omitted;
        } else if (key === "laps" && val.length > MAX_LAPS_TRUNCATED) {
            const { items } = sliceArray(val, MAX_LAPS_TRUNCATED);
            out[key] = items;
            out[`${key}_truncated_from`] = val.length;
            truncated = true;
        } else if (val.length > MAX_ROWS_TRUNCATED) {
            const { items } = sliceArray(val, MAX_ROWS_TRUNCATED);
            out[key] = items;
            out[`${key}_truncated_from`] = val.length;
            truncated = true;
        }
    }
    return { data: out, truncated };
}

/** Truncate a visualization payload array item-wise. */
export function truncateVisualizationPayload(payload: unknown): { payload: unknown; truncated: boolean } {
    if (!Array.isArray(payload)) return { payload, truncated: false };
    let anyTruncated = false;
    const items = payload.map((item) => {
        if (!isRecord(item)) return item;
        const size = estimateJsonBytes(item);
        if (size <= OVERFLOW_FIELD_THRESHOLD) return item;
        const { data, truncated } = truncateVizData(item.data);
        if (truncated) anyTruncated = true;
        return { ...item, data };
    });
    return { payload: items, truncated: anyTruncated };
}

function sanitizeStep(s: NonNullable<NonNullable<Message["steps"]>[number]>): NonNullable<NonNullable<Message["steps"]>[number]> {
    return {
        description: String(s.description ?? "").slice(0, 500),
        tool: String(s.tool ?? "").slice(0, 128),
        status: s.status === "pending" || s.status === "running" || s.status === "success" || s.status === "failed" ? s.status : "success",
        ...(typeof s.result === "string" && s.result ? { result: s.result.slice(0, 4000) } : {}),
        ...(s.args && isRecord(s.args) ? { args: JSON.parse(JSON.stringify(s.args)) } : {}),
        ...(typeof s.error === "string" && s.error ? { error: s.error.slice(0, 2000) } : {}),
        ...(typeof s.durationMs === "number" && Number.isFinite(s.durationMs) ? { durationMs: Math.min(Math.max(0, Math.round(s.durationMs)), 3_600_000) } : {}),
    };
}

/**
 * Build the inline Firestore doc for a Message. Large `visualizationData`
 * / evidence `data` are left in place here — `saveFullMessage` decides
 * whether to offload them to Storage first. Pure: no I/O.
 */
export function buildFullMessageDoc(userId: string, message: Message): FullMessageDoc {
    const docBase: FullMessageDoc = {
        userId,
        clientId: message.id,
        role: message.role,
        content: String(message.content ?? "").slice(0, 200_000),
        timestamp: message.timestamp,
        clientTimestamp: message.timestamp,
    };
    if (message.reasoning) docBase.reasoning = String(message.reasoning).slice(0, 20_000);
    if (message.isError !== undefined) docBase.isError = !!message.isError;
    const citations = sanitizeCitations(message.citations);
    if (citations.length > 0) docBase.citations = citations;
    if (message.steps && message.steps.length > 0) {
        docBase.steps = message.steps.slice(0, 50).map(sanitizeStep);
    }
    if (message.visualizationData !== undefined && message.visualizationData !== null) {
        docBase.visualizationData = message.visualizationData;
    }
    if (message.visualizationRef) docBase.visualizationRef = message.visualizationRef;
    if (message.visualizationTruncated) docBase.visualizationTruncated = true;
    if (message.degradedWarnings && message.degradedWarnings.length > 0) {
        docBase.degradedWarnings = message.degradedWarnings.slice(0, 10).map((w) => ({
            stage: String(w.stage ?? "").slice(0, 128),
            kind: String(w.kind ?? "").slice(0, 128),
            message: String(w.message ?? "").slice(0, 2000),
        }));
    }
    if (message.usage) {
        const u = message.usage;
        docBase.usage = {
            provider: String(u.provider ?? "").slice(0, 64),
            model: String(u.model ?? "").slice(0, 256),
            ...(u.plannerModel ? { plannerModel: String(u.plannerModel).slice(0, 256) } : {}),
            promptTokens: Math.max(0, Math.round(u.promptTokens ?? 0)),
            completionTokens: Math.max(0, Math.round(u.completionTokens ?? 0)),
            ...(typeof u.reasoningTokens === "number" ? { reasoningTokens: Math.max(0, Math.round(u.reasoningTokens)) } : {}),
            ...(typeof u.cachedTokens === "number" ? { cachedTokens: Math.max(0, Math.round(u.cachedTokens)) } : {}),
            totalTokens: Math.max(0, Math.round(u.totalTokens ?? 0)),
            cost: typeof u.cost === "number" && Number.isFinite(u.cost) ? u.cost : null,
            ...(typeof u.upstreamCost === "number" && Number.isFinite(u.upstreamCost) ? { upstreamCost: u.upstreamCost } : {}),
        };
    }
    if (message.researchType) docBase.researchType = String(message.researchType).slice(0, 64);
    if (message.iterations && message.iterations.length > 0) {
        docBase.iterations = message.iterations.slice(0, 20).map((it) => ({
            iteration: Math.max(1, Math.round(it.iteration ?? 1)),
            tasks: (it.tasks ?? []).slice(0, 50).map((t) => ({
                id: String(t.id ?? "").slice(0, 128),
                description: String(t.description ?? "").slice(0, 500),
                tool: String(t.tool ?? "").slice(0, 128),
                status: t.status,
                ...(t.evidenceId ? { evidenceId: String(t.evidenceId).slice(0, 64) } : {}),
                ...(t.args && isRecord(t.args) ? { args: JSON.parse(JSON.stringify(t.args)) } : {}),
            })),
            ...(it.reasoning ? { reasoning: String(it.reasoning).slice(0, 4000) } : {}),
        }));
    }
    if (message.evidence && message.evidence.length > 0) {
        docBase.evidence = message.evidence.slice(0, 200).map((e) => ({
            id: String(e.id ?? "").slice(0, 64),
            type: String(e.type ?? "").slice(0, 64),
            source: {
                tool: String(e.source?.tool ?? "").slice(0, 128),
                taskId: String(e.source?.taskId ?? "").slice(0, 128),
                args: isRecord(e.source?.args) ? (JSON.parse(JSON.stringify(e.source.args)) as Record<string, unknown>) : {},
            },
            ...(e.race ? { race: String(e.race).slice(0, 128) } : {}),
            ...(typeof e.season === "number" ? { season: e.season } : {}),
            ...(e.driver ? { driver: String(e.driver).slice(0, 32) } : {}),
            summary: String(e.summary ?? "").slice(0, 2000),
            confidence: typeof e.confidence === "number" && Number.isFinite(e.confidence) ? Math.min(1, Math.max(0, e.confidence)) : 0,
            ...(e.data !== undefined ? { data: e.data } : {}),
            ...(e.dataRef ? { dataRef: e.dataRef } : {}),
            ...(e.dataTruncated ? { dataTruncated: true } : {}),
        }));
    }
    if (message.confidence) {
        const c = message.confidence;
        docBase.confidence = {
            overall: Math.min(1, Math.max(0, c.overall ?? 0)),
            factors: {
                sourceCount: Math.max(0, Math.round(c.factors?.sourceCount ?? 0)),
                completeness: Math.min(1, Math.max(0, c.factors?.completeness ?? 0)),
                conflicts: Math.max(0, Math.round(c.factors?.conflicts ?? 0)),
                missingData: Array.isArray(c.factors?.missingData) ? c.factors.missingData.slice(0, 20).map((s) => String(s).slice(0, 256)) : [],
                dataQuality: Math.min(1, Math.max(0, c.factors?.dataQuality ?? 0)),
            },
        };
    }
    if (message.reflections && message.reflections.length > 0) {
        docBase.reflections = message.reflections.slice(0, 20).map((r) => ({
            useful: !!r.useful,
            answeredPart: String(r.answeredPart ?? "").slice(0, 2000),
            stillMissing: Array.isArray(r.stillMissing) ? r.stillMissing.slice(0, 20).map((s) => String(s).slice(0, 500)) : [],
            nextAction: r.nextAction === "stop" ? "stop" : "call_tool",
            ...(r.nextStrategy ? { nextStrategy: String(r.nextStrategy).slice(0, 2000) } : {}),
            reasoning: String(r.reasoning ?? "").slice(0, 4000),
            iteration: Math.max(1, Math.round(r.iteration ?? 1)),
        }));
    }
    if (message.chartSpecs && message.chartSpecs.length > 0) {
        docBase.chartSpecs = message.chartSpecs.slice(0, 30).map((s) => ({
            ...s,
            id: String(s.id ?? "").slice(0, 128),
            title: String(s.title ?? "").slice(0, 256),
        }));
    }
    return docBase;
}

/** Convert a Firestore timestamp (or millis) to epoch ms without Firebase. */
export function timestampToMs(value: unknown): number | null {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "object" && value !== null) {
        const record = value as { toMillis?: unknown; seconds?: unknown };
        if (typeof record.toMillis === "function") {
            const ms = (record.toMillis as () => unknown)();
            return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
        }
        if (typeof record.seconds === "number") {
            return record.seconds * 1000;
        }
    }
    return null;
}

/**
 * Map a Firestore doc back to a client Message. Resolves nothing —
 * Storage refs are hydrated by `loadFullSessionMessages`.
 */
export function docToMessage(id: string, data: Record<string, unknown>): Message {
    const citations = sanitizeCitations(data.citations);
    const msg: Message = {
        id: (typeof data.clientId === "string" && data.clientId) || id,
        role: data.role === "assistant" ? "assistant" : "user",
        content: typeof data.content === "string" ? data.content : "",
        timestamp: timestampToMs(data.timestamp) ?? (typeof data.clientTimestamp === "number" ? data.clientTimestamp : Date.now()),
    };
    if (typeof data.reasoning === "string" && data.reasoning) msg.reasoning = data.reasoning;
    if (data.isError === true) msg.isError = true;
    if (Array.isArray(data.steps)) msg.steps = data.steps as Message["steps"];
    if (data.visualizationData !== undefined) msg.visualizationData = data.visualizationData;
    if (typeof data.visualizationRef === "string") msg.visualizationRef = data.visualizationRef;
    if (data.visualizationTruncated === true) msg.visualizationTruncated = true;
    if (citations.length > 0) msg.citations = citations;
    if (Array.isArray(data.degradedWarnings)) msg.degradedWarnings = data.degradedWarnings as Message["degradedWarnings"];
    if (typeof data.usage === "object" && data.usage !== null && !Array.isArray(data.usage)) msg.usage = data.usage as Message["usage"];
    if (typeof data.researchType === "string") msg.researchType = data.researchType;
    if (Array.isArray(data.iterations)) msg.iterations = data.iterations as Message["iterations"];
    if (Array.isArray(data.evidence)) msg.evidence = data.evidence as Message["evidence"];
    if (typeof data.confidence === "object" && data.confidence !== null && !Array.isArray(data.confidence)) {
        msg.confidence = data.confidence as unknown as Message["confidence"];
    }
    if (Array.isArray(data.reflections)) msg.reflections = data.reflections as Message["reflections"];
    if (Array.isArray(data.chartSpecs)) msg.chartSpecs = data.chartSpecs as Message["chartSpecs"];
    return msg;
}
