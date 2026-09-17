/**
 * Quota enforcement for the free-tier launch (server-only).
 * =========================================================
 * Everyone is metered — BYOK included, looser — because Vercel/D1/R2
 * costs accrue regardless of whose LLM key generates the tokens.
 *
 * Two ledgers, both must pass (dual-consume):
 *   - account (`cf_uid`, convenience identity, trivially reset) and
 *   - IP hash (abuse identity: one human ≈ one IP; survives cookie clears
 *     and multi-account farming).
 * Plus: per-IP provision velocity (kills scripted account farming),
 * per-call simulation clamps, and a global managed-spend circuit breaker.
 *
 * Failure posture: fail OPEN on infrastructure errors (never break the
 * app because D1 hiccuped), fail CLOSED on measured over-quota.
 * `QUOTAS_ENABLED=false` is the instant kill-switch.
 */

import net from "node:net";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { d1Query, d1Exec } from "./d1";

// ---------------------------------------------------------------------------
// Config (env-overridable, code defaults = launch posture)
// ---------------------------------------------------------------------------

function numEnv(name: string, def: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return def;
    const v = Number(raw);
    // Note: 0 is a valid cap (deny-all, useful for testing/lockdown).
    return Number.isFinite(v) && v >= 0 ? v : def;
}

export type Tier = "managed" | "byok";
export type QuotaKind = "chat" | "deep";

export interface TierCaps {
    queriesPerDay: number;
    deepRunsPerDay: number;
    simCallsPerDay: number;
    maxSimIterations: number;
    completionTokensPerDay: number;
}

function capsFromEnv(prefix: string, def: TierCaps): TierCaps {
    const p = (k: string, d: number) => numEnv(`QUOTA_${prefix}_${k}`, d);
    return {
        queriesPerDay: p("QUERIES", def.queriesPerDay),
        deepRunsPerDay: p("DEEP", def.deepRunsPerDay),
        simCallsPerDay: p("SIM", def.simCallsPerDay),
        maxSimIterations: p("SIM_ITER", def.maxSimIterations),
        completionTokensPerDay: p("OUT_TOKENS", def.completionTokensPerDay),
    };
}

/** Managed-key users: the traffic that costs us LLM money. */
export function freeCaps(): TierCaps {
    return capsFromEnv("FREE", {
        queriesPerDay: 20,
        deepRunsPerDay: 3,
        simCallsPerDay: 3,
        maxSimIterations: 2000,
        completionTokensPerDay: 150_000,
    });
}

/** BYOK users: own key = our cost is hosting only, so looser — still bounded. */
export function byokCaps(): TierCaps {
    return capsFromEnv("BYOK", {
        queriesPerDay: 100,
        deepRunsPerDay: 10,
        simCallsPerDay: 20,
        maxSimIterations: 5000,
        completionTokensPerDay: 1_000_000,
    });
}

/** IP-level ceilings (tier-agnostic abuse bound ≈ 2× the free account share). */
export function ipCaps(): TierCaps {
    return capsFromEnv("IP", {
        queriesPerDay: 40,
        deepRunsPerDay: 6,
        simCallsPerDay: 6,
        maxSimIterations: 5000,
        completionTokensPerDay: 300_000,
    });
}

export function quotasEnabled(): boolean {
    return process.env.QUOTAS_ENABLED !== "false";
}

/** A deep run counts as N chat queries (it burns 10-50× the tokens). */
export function deepQueryWeight(): number {
    return numEnv("QUOTA_DEEP_QUERY_WEIGHT", 5);
}

/** Global managed-spend breaker, USD/day. */
export function managedDailyCapMicros(): number {
    return Math.round(numEnv("MANAGED_DAILY_CAP_USD", 5) * 1_000_000);
}

export function maxAccountsPerIpPerDay(): number {
    return Math.round(numEnv("QUOTA_IP_MAX_ACCOUNTS", 10));
}

export function maxSessionsPerIpPerDay(): number {
    return Math.round(numEnv("QUOTA_IP_MAX_SESSIONS", 30));
}

function adminUids(): Set<string> {
    return new Set(
        (process.env.ADMIN_UIDS || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
    );
}

export function isAdmin(uid: string): boolean {
    return adminUids().has(uid);
}

/** UTC day bucket `YYYY-MM-DD`. */
export function todayDay(now = Date.now()): string {
    return new Date(now).toISOString().slice(0, 10);
}

/** Epoch ms of next UTC midnight (for `resetsAt` hints). */
export function nextMidnightMs(now = Date.now()): number {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

// ---------------------------------------------------------------------------
// Client IP: trust, normalize, hash (never store raw IPs)
// ---------------------------------------------------------------------------
// Vercel overwrites X-Forwarded-For at the edge and does not forward
// external values (anti-spoofing), so the first entry IS the client IP on
// Vercel direct. If a proxy is ever placed in front, switch to
// CF-Connecting-IP — never trust client-supplied leftmost entries blindly.

/** Normalize to a stable key: full IPv4, or IPv6 /64 prefix. Null if invalid. */
export function normalizeIp(raw: string): string | null {
    let s = raw.trim();
    // Strip [brackets] and trailing :port the way proxies sometimes add them.
    const bracket = s.match(/^\[(.+)\](?::\d+)?$/);
    if (bracket) s = bracket[1]!;
    if (net.isIP(s) === 4) return s;
    if (net.isIP(s) !== 6) {
        // Maybe bare IPv4 with port ("1.2.3.4:5678").
        const m = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
        if (m && net.isIP(m[1]!) === 4) return m[1]!;
        return null;
    }
    // IPv6: privacy extensions rotate the low 64 bits per connection, so
    // key on the /64 (first 4 hextets). Handles :: compression + zone ids.
    const pct = s.indexOf("%");
    const addr = (pct >= 0 ? s.slice(0, pct) : s).toLowerCase();
    // IPv4-mapped ::ffff:a.b.c.d → treat as that IPv4.
    const mapped = addr.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped && net.isIP(mapped[1]!) === 4) return mapped[1]!;
    const halves = addr.split("::");
    if (halves.length > 2) return null;
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const ok = (g: string) => /^[0-9a-f]{1,4}$/.test(g);
    if (!head.every(ok) || !tail.every(ok)) return null;
    if (halves.length === 1 && head.length !== 8) return null;
    const zeros = 8 - head.length - tail.length;
    if (zeros < 0 || (halves.length === 2 && zeros === 0)) return null;
    const groups = [...head, ...Array<string>(zeros).fill("0"), ...tail].map(
        (g) => g.replace(/^0+/, "") || "0"
    );
    const prefix = groups.slice(0, 4);
    // Canonical all-zero /64 (loopback etc.).
    if (prefix.every((g) => g === "0")) return "::/64";
    return `${prefix.join(":")}::/64`;
}

let saltWarned = false;

function ipSalt(): string {
    const s = process.env.IP_HASH_SALT;
    if (s && s.length >= 16) return s;
    // Fall back to the Cloudflare token (secret + stable). Dev-only path
    // when neither is set — quota hashes just won't survive restarts.
    if (process.env.CF_API_TOKEN) return `cf:${process.env.CF_API_TOKEN}`;
    if (!saltWarned) {
        saltWarned = true;
        console.warn("[quota] IP_HASH_SALT not set — IP hashes are unstable. Set it in Vercel env.");
    }
    return "dev-insecure-salt";
}

/** Salted SHA-256 of the normalized IP. Deterministic per salt era. */
export function hashIp(normalized: string): string {
    return createHash("sha256").update(`${ipSalt()}\n${normalized}`).digest("hex");
}

/** Trusted client IP key from request headers, or null (dev/unknown). */
export function extractIpKey(req: NextRequest): string | null {
    const candidates = [
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
        req.headers.get("x-real-ip")?.trim(),
    ];
    for (const c of candidates) {
        if (!c) continue;
        const n = normalizeIp(c.slice(0, 128));
        if (n) return n;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Pricing (per 1M tokens, USD) — OpenRouter's reported `cost` wins when present
// ---------------------------------------------------------------------------

interface ModelPrice {
    inPerM: number;
    outPerM: number;
}

const BUILTIN_PRICES: Array<[string, ModelPrice]> = [
    ["nemotron", { inPerM: 0, outPerM: 0 }],
    [":free", { inPerM: 0, outPerM: 0 }],
    // Managed fleet runs on the flat-rate Go subscription (MiMo V2.5),
    // so marginal token cost is zero; token COUNTS are still ledgered
    // (they're the signal future paid tiers will price on).
    ["mimo", { inPerM: 0, outPerM: 0 }],
    ["gemini-2.0-flash", { inPerM: 0.1, outPerM: 0.4 }],
    ["gemini-2.5-flash", { inPerM: 0.3, outPerM: 2.5 }],
    ["gemini-1.5-flash", { inPerM: 0.075, outPerM: 0.3 }],
    ["claude-3-5-sonnet", { inPerM: 3, outPerM: 15 }],
    ["claude-3-7-sonnet", { inPerM: 3, outPerM: 15 }],
    ["claude-sonnet-4", { inPerM: 3, outPerM: 15 }],
    ["claude-opus", { inPerM: 15, outPerM: 75 }],
    ["gpt-4o-mini", { inPerM: 0.15, outPerM: 0.6 }],
    ["gpt-4o", { inPerM: 2.5, outPerM: 10 }],
    ["gpt-4.1", { inPerM: 2, outPerM: 8 }],
    ["o4-mini", { inPerM: 1.1, outPerM: 4.4 }],
    ["deepseek", { inPerM: 0.27, outPerM: 1.1 }],
];

const DEFAULT_PRICE: ModelPrice = { inPerM: 1.0, outPerM: 4.0 };

function customPrices(): Array<[string, ModelPrice]> {
    try {
        const raw = JSON.parse(process.env.MODEL_PRICES_JSON || "{}") as Record<string, [number, number]>;
        return Object.entries(raw)
            .filter(([, v]) => Array.isArray(v) && v.every((n) => typeof n === "number"))
            .map(([k, v]) => [k.toLowerCase(), { inPerM: v[0]!, outPerM: v[1]! }] as [string, ModelPrice]);
    } catch {
        return [];
    }
}

export function priceForModel(modelId: string | undefined): ModelPrice {
    const m = (modelId || "").toLowerCase();
    for (const [substr, price] of customPrices()) {
        if (substr && m.includes(substr)) return price;
    }
    for (const [substr, price] of BUILTIN_PRICES) {
        if (m.includes(substr)) return price;
    }
    return DEFAULT_PRICE;
}

/** USD micros. Reported provider cost wins; otherwise price-table estimate. */
export function estimateCostMicros(args: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    reportedCost?: number | null;
}): number {
    const { promptTokens = 0, completionTokens = 0, reportedCost = null } = args;
    if (typeof reportedCost === "number" && Number.isFinite(reportedCost) && reportedCost >= 0) {
        return Math.round(reportedCost * 1_000_000);
    }
    const p = priceForModel(args.model);
    // price is $/1M tokens, micros = tokens × $/1M (the two 1e6 cancel).
    return Math.round(promptTokens * p.inPerM + completionTokens * p.outPerM);
}

// ---------------------------------------------------------------------------
// Pre-flight check (dual ledger: account AND IP)
// ---------------------------------------------------------------------------

export interface QuotaCheckInput {
    uid: string;
    ipHash: string | null;
    tier: Tier;
    kind: QuotaKind;
}

export interface QuotaCheck {
    allowed: boolean;
    code?: "account_quota" | "account_deep_quota" | "shared_network_quota" | "shared_network_deep_quota" | "global_budget";
    message?: string;
    resetsAt?: number;
}

interface DailyRow {
    queries?: number;
    deep_runs?: number;
    sim_calls?: number;
    sim_iterations?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    est_cost_micros?: number;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function byokHint(tier: Tier): string {
    return tier === "managed"
        ? " Add your own API key in Settings for a much higher limit — or come back tomorrow."
        : " Come back tomorrow.";
}

export async function checkQuota(input: QuotaCheckInput): Promise<QuotaCheck> {
    const { uid, ipHash, tier, kind } = input;
    try {
        if (!quotasEnabled()) return { allowed: true };
        if (isAdmin(uid)) return { allowed: true };
        const day = todayDay();
        const acct = tier === "byok" ? byokCaps() : freeCaps();
        const ipc = ipCaps();
        const weight = kind === "deep" ? deepQueryWeight() : 1;
        const resetsAt = nextMidnightMs();

        const ureq = d1Query<DailyRow>(`SELECT queries, deep_runs, completion_tokens, est_cost_micros FROM quota_daily WHERE user_id = ? AND day = ?`, [uid, day]);
        const ireq = ipHash
            ? d1Query<DailyRow>(`SELECT queries, deep_runs, completion_tokens, est_cost_micros FROM quota_ip_daily WHERE ip_hash = ? AND day = ?`, [ipHash, day])
            : Promise.resolve([] as DailyRow[]);
        const greq = tier === "managed"
            ? d1Query<{ est_cost_micros?: number }>(`SELECT est_cost_micros FROM global_spend_daily WHERE day = ?`, [day])
            : Promise.resolve([] as { est_cost_micros?: number }[]);
        const [urow, irow, grow] = await Promise.all([ureq, ireq, greq]);
        const u = urow[0] ?? {};
        const ip = irow[0] ?? {};

        // 1. Global managed-spend breaker (free tier only; BYOK never trips it).
        if (tier === "managed" && num(grow[0]?.est_cost_micros) >= managedDailyCapMicros()) {
            return {
                allowed: false,
                code: "global_budget",
                message: "Free service is paused for today due to high demand. Add your own API key in Settings to keep going.",
                resetsAt,
            };
        }
        // 2. Account ledger.
        if (kind === "deep" && num(u.deep_runs) + 1 > acct.deepRunsPerDay) {
            return {
                allowed: false,
                code: "account_deep_quota",
                message: `Today's free deep-research share (${acct.deepRunsPerDay} runs) is used up.${byokHint(tier)}`,
                resetsAt,
            };
        }
        if (num(u.queries) + weight > acct.queriesPerDay) {
            return {
                allowed: false,
                code: "account_quota",
                message: `You've used today's free share (${acct.queriesPerDay} queries).${byokHint(tier)}`,
                resetsAt,
            };
        }
        // 3. IP ledger (2× headroom for households/CGNAT; tier-agnostic by design).
        if (!ipHash) return { allowed: true };
        if (kind === "deep" && num(ip.deep_runs) + 1 > ipc.deepRunsPerDay) {
            return {
                allowed: false,
                code: "shared_network_deep_quota",
                message: `This network has used its free deep-research share today (${ipc.deepRunsPerDay} runs across all accounts here). Try again tomorrow.`,
                resetsAt,
            };
        }
        if (num(ip.queries) + weight > ipc.queriesPerDay) {
            return {
                allowed: false,
                code: "shared_network_quota",
                message: `This network has used its free share today (${ipc.queriesPerDay} queries across all accounts here). Try again tomorrow.`,
                resetsAt,
            };
        }
        return { allowed: true };
    } catch (e) {
        // Fail open: a D1 hiccup must never break the app.
        console.warn("[quota] pre-flight failed open:", e instanceof Error ? e.message : e);
        return { allowed: true };
    }
}

// ---------------------------------------------------------------------------
// Post-stream accounting (dual increment; best-effort, never throws)
// ---------------------------------------------------------------------------

export interface UsageRecord {
    uid: string;
    ipHash: string | null;
    tier: Tier;
    queries?: number;
    deepRuns?: number;
    simCalls?: number;
    simIterations?: number;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    reportedCost?: number | null;
}

export async function recordUsage(rec: UsageRecord): Promise<void> {
    try {
        if (!quotasEnabled()) return;
        if (isAdmin(rec.uid)) return; // admins don't consume quota
        const day = todayDay();
        const q = Math.max(0, Math.round(rec.queries ?? 0));
        const d = Math.max(0, Math.round(rec.deepRuns ?? 0));
        const s = Math.max(0, Math.round(rec.simCalls ?? 0));
        const si = Math.max(0, Math.round(rec.simIterations ?? 0));
        const pt = Math.max(0, Math.round(rec.promptTokens ?? 0));
        const ct = Math.max(0, Math.round(rec.completionTokens ?? 0));
        const micros = estimateCostMicros({
            model: rec.model,
            promptTokens: pt,
            completionTokens: ct,
            reportedCost: rec.reportedCost,
        });
        const jobs: Promise<unknown>[] = [
            d1Exec(
                `INSERT INTO quota_daily (user_id, day, tier, queries, deep_runs, sim_calls, sim_iterations, prompt_tokens, completion_tokens, est_cost_micros)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, day) DO UPDATE SET
                   tier = excluded.tier,
                   queries = queries + excluded.queries,
                   deep_runs = deep_runs + excluded.deep_runs,
                   sim_calls = sim_calls + excluded.sim_calls,
                   sim_iterations = sim_iterations + excluded.sim_iterations,
                   prompt_tokens = prompt_tokens + excluded.prompt_tokens,
                   completion_tokens = completion_tokens + excluded.completion_tokens,
                   est_cost_micros = est_cost_micros + excluded.est_cost_micros`,
                [rec.uid, day, rec.tier, q, d, s, si, pt, ct, micros]
            ),
        ];
        if (rec.ipHash) {
            jobs.push(
                d1Exec(
                    `INSERT INTO quota_ip_daily (ip_hash, day, queries, deep_runs, sim_calls, completion_tokens, est_cost_micros)
                     VALUES (?, ?, ?, ?, ?, ?, ?)
                     ON CONFLICT(ip_hash, day) DO UPDATE SET
                       queries = queries + excluded.queries,
                       deep_runs = deep_runs + excluded.deep_runs,
                       sim_calls = sim_calls + excluded.sim_calls,
                       completion_tokens = completion_tokens + excluded.completion_tokens,
                       est_cost_micros = est_cost_micros + excluded.est_cost_micros`,
                    [rec.ipHash, day, q, d, s, ct, micros]
                )
            );
        }
        // Global ledger tracks managed-key spend only (BYOK costs us hosting,
        // which the per-account/IP query caps already bound).
        if (rec.tier === "managed" && (micros > 0 || q > 0)) {
            jobs.push(
                d1Exec(
                    `INSERT INTO global_spend_daily (day, est_cost_micros, queries)
                     VALUES (?, ?, ?)
                     ON CONFLICT(day) DO UPDATE SET
                       est_cost_micros = est_cost_micros + excluded.est_cost_micros,
                       queries = queries + excluded.queries`,
                    [day, micros, q]
                )
            );
        }
        // Lazy retention: quotas are short-lived abuse rails, not history.
        const cutoff = new Date(Date.now() - 8 * 86400_000).toISOString().slice(0, 10);
        jobs.push(
            d1Exec(`DELETE FROM quota_daily WHERE day < ?`, [cutoff]).catch(() => undefined),
            d1Exec(`DELETE FROM quota_ip_daily WHERE day < ?`, [cutoff]).catch(() => undefined),
            d1Exec(`DELETE FROM global_spend_daily WHERE day < ?`, [cutoff]).catch(() => undefined)
        );
        await Promise.all(jobs);
    } catch (e) {
        console.warn("[quota] record failed (best-effort):", e instanceof Error ? e.message : e);
    }
}

// ---------------------------------------------------------------------------
// Quota state readout (for the subtle usage indicator in the sidebar)
// ---------------------------------------------------------------------------

export interface QuotaSlice {
    queriesUsed: number;
    queriesCap: number;
    deepUsed: number;
    deepCap: number;
    simUsed: number;
    simCap: number;
    outTokensUsed: number;
    outTokensCap: number;
}

export interface QuotaState {
    tier: Tier;
    resetsAt: number;
    /** True when the global managed-spend breaker is currently tripping. */
    managedPaused: boolean;
    account: QuotaSlice;
    /** Shared-network (IP) ledger — the binding constraint on shared networks. */
    network: QuotaSlice;
}

/** Today's usage vs caps for one identity. Throws on infra failure (503). */
export async function getQuotaState(uid: string, ipHash: string | null, tier: Tier): Promise<QuotaState> {
    const day = todayDay();
    const acct = tier === "byok" ? byokCaps() : freeCaps();
    const ipc = ipCaps();
    const [urow, irow, grow] = await Promise.all([
        d1Query<DailyRow>(`SELECT queries, deep_runs, sim_calls, completion_tokens FROM quota_daily WHERE user_id = ? AND day = ?`, [uid, day]),
        ipHash
            ? d1Query<DailyRow>(`SELECT queries, deep_runs, sim_calls, completion_tokens FROM quota_ip_daily WHERE ip_hash = ? AND day = ?`, [ipHash, day])
            : Promise.resolve([] as DailyRow[]),
        tier === "managed"
            ? d1Query<{ est_cost_micros?: number }>(`SELECT est_cost_micros FROM global_spend_daily WHERE day = ?`, [day])
            : Promise.resolve([] as { est_cost_micros?: number }[]),
    ]);
    const u = urow[0] ?? {};
    const ip = irow[0] ?? {};
    const slice = (r: DailyRow, c: TierCaps): QuotaSlice => ({
        queriesUsed: num(r.queries),
        queriesCap: c.queriesPerDay,
        deepUsed: num(r.deep_runs),
        deepCap: c.deepRunsPerDay,
        simUsed: num(r.sim_calls),
        simCap: c.simCallsPerDay,
        outTokensUsed: num(r.completion_tokens),
        outTokensCap: c.completionTokensPerDay,
    });
    return {
        tier,
        resetsAt: nextMidnightMs(),
        managedPaused: tier === "managed" && num(grow[0]?.est_cost_micros) >= managedDailyCapMicros(),
        account: slice(u, acct),
        network: slice(ip, ipc),
    };
}

// ---------------------------------------------------------------------------
// Provision velocity (anti-farming: cap new accounts per IP per day)
// ---------------------------------------------------------------------------

export async function checkProvisionVelocity(ipHash: string | null): Promise<{ allowed: boolean; message?: string; resetsAt?: number }> {
    try {
        if (!quotasEnabled() || !ipHash) return { allowed: true };
        const day = todayDay();
        const rows = await d1Query<{ n?: number }>(
            `SELECT COUNT(*) AS n FROM users WHERE ip_hash = ? AND created_day = ?`,
            [ipHash, day]
        );
        if (num(rows[0]?.n) >= maxAccountsPerIpPerDay()) {
            return {
                allowed: false,
                message: "Too many new accounts from this network today. Try again tomorrow.",
                resetsAt: nextMidnightMs(),
            };
        }
        return { allowed: true };
    } catch (e) {
        console.warn("[quota] provision check failed open:", e instanceof Error ? e.message : e);
        return { allowed: true };
    }
}
