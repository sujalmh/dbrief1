/**
 * Tests for IP normalization/hashing, pricing, and dual-ledger quota logic.
 * D1 is faked by stubbing global fetch (d1Query posts to the D1 REST
 * endpoint); env is stubbed before a fresh dynamic import per test group
 * because connection constants are module-level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type QuotasMod = typeof import("@/lib/cf/quotas");

interface MockRow {
    [k: string]: unknown;
}

function mockD1(routes: Record<string, MockRow[]>, opts?: { throwAll?: boolean }) {
    return vi.fn(async (url: string, init?: { body?: string }) => {
        if (opts?.throwAll) throw new Error("d1 down");
        const body = JSON.parse((init?.body as string) || "{}") as { sql?: string };
        const sql = body.sql || "";
        void url;
        for (const [substr, rows] of Object.entries(routes)) {
            if (sql.includes(substr)) {
                return {
                    ok: true,
                    json: async () => ({ success: true, errors: [], result: [{ results: rows }] }),
                };
            }
        }
        return {
            ok: true,
            json: async () => ({ success: true, errors: [], result: [{ results: [] }] }),
        };
    });
}

async function freshQuotas(): Promise<QuotasMod> {
    vi.resetModules();
    vi.stubEnv("CF_API_TOKEN", "test-token");
    vi.stubEnv("CF_ACCOUNT_ID", "a");
    vi.stubEnv("CF_D1_DATABASE_ID", "d");
    vi.stubEnv("CF_R2_BUCKET", "b");
    vi.stubEnv("IP_HASH_SALT", "test-salt-0123456789");
    return import("@/lib/cf/quotas");
}

describe("normalizeIp", () => {
    it("accepts IPv4, normalizes IPv6 to /64, rejects garbage", async () => {
        const q = await freshQuotas();
        expect(q.normalizeIp("1.2.3.4")).toBe("1.2.3.4");
        expect(q.normalizeIp("1.2.3.4:5678")).toBe("1.2.3.4");
        expect(q.normalizeIp("[::1]")).toBe("::/64");
        expect(q.normalizeIp("2001:db8:abcd:12::1")).toBe("2001:db8:abcd:12::/64");
        expect(q.normalizeIp("2001:db8:abcd:12::2")).toBe("2001:db8:abcd:12::/64");
        expect(q.normalizeIp("2001:0db8:0000:0012:0000:0000:0000:0001")).toBe("2001:db8:0:12::/64");
        expect(q.normalizeIp("::ffff:9.9.9.9")).toBe("9.9.9.9");
        expect(q.normalizeIp("999.1.1.1")).toBeNull();
        expect(q.normalizeIp("not-an-ip")).toBeNull();
        expect(q.normalizeIp("")).toBeNull();
        expect(q.normalizeIp("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    });
});

describe("hashIp", () => {
    it("is deterministic per salt and differs across salts", async () => {
        const q = await freshQuotas();
        const a = q.hashIp("1.2.3.4");
        const b = q.hashIp("1.2.3.4");
        expect(a).toBe(b);
        expect(a).toMatch(/^[0-9a-f]{64}$/);
        vi.stubEnv("IP_HASH_SALT", "other-salt-0123456789");
        const q2 = await import("@/lib/cf/quotas");
        expect(q2.hashIp("1.2.3.4")).not.toBe(a);
    });
});

describe("pricing", () => {
    it("prefers reported provider cost, else estimates from the table", async () => {
        const q = await freshQuotas();
        expect(q.estimateCostMicros({ model: "x", promptTokens: 1000, completionTokens: 500, reportedCost: 0.00123 })).toBe(1230);
        expect(q.estimateCostMicros({ model: "nvidia/nemotron-3-ultra:free", promptTokens: 100000, completionTokens: 50000 })).toBe(0);
        // gemini-2.0-flash: 1000 * 0.10 + 500 * 0.40 per 1M = 300 micros
        expect(q.estimateCostMicros({ model: "gemini-2.0-flash", promptTokens: 1000, completionTokens: 500 })).toBe(300);
        // unknown model falls back to the conservative default table
        expect(q.estimateCostMicros({ model: "mystery-9000", promptTokens: 1_000_000, completionTokens: 0 })).toBe(1_000_000);
    });
});

describe("checkQuota", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("allows everything when quotas are disabled", async () => {
        const q = await freshQuotas();
        vi.stubEnv("QUOTAS_ENABLED", "false");
        const fetchSpy = mockD1({});
        vi.stubGlobal("fetch", fetchSpy);
        const r = await q.checkQuota({ uid: "u1", ipHash: "h", tier: "managed", kind: "deep" });
        expect(r.allowed).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("allows a fresh user and denies an exhausted account (2x IP stays independent)", async () => {
        const q = await freshQuotas();
        // Fresh: all ledgers empty.
        vi.stubGlobal("fetch", mockD1({}));
        expect((await q.checkQuota({ uid: "u1", ipHash: "h1", tier: "managed", kind: "chat" })).allowed).toBe(true);

        // Account at cap (30/30 free), IP clean -> account_quota.
        vi.stubGlobal(
            "fetch",
            mockD1({ "FROM quota_daily": [{ queries: 20, deep_runs: 0 }] })
        );
        const denied = await q.checkQuota({ uid: "u1", ipHash: "h1", tier: "managed", kind: "chat" });
        expect(denied.allowed).toBe(false);
        expect(denied.code).toBe("account_quota");
        expect(denied.message).toMatch(/own API key/);

        // Account clean, IP at cap (40/40) -> shared_network_quota even with fresh cookies.
        vi.stubGlobal("fetch", mockD1({ "FROM quota_ip_daily": [{ queries: 40, deep_runs: 0 }] }));
        const ipDenied = await q.checkQuota({ uid: "brand-new-uid", ipHash: "h1", tier: "managed", kind: "chat" });
        expect(ipDenied.allowed).toBe(false);
        expect(ipDenied.code).toBe("shared_network_quota");
    });

    it("enforces deep-run caps on both ledgers", async () => {
        const q = await freshQuotas();
        vi.stubGlobal("fetch", mockD1({ "FROM quota_daily": [{ queries: 0, deep_runs: 3 }] }));
        const r = await q.checkQuota({ uid: "u1", ipHash: "h1", tier: "managed", kind: "deep" });
        expect(r.allowed).toBe(false);
        expect(r.code).toBe("account_deep_quota");
    });

    it("trips the global managed-spend breaker, but never for BYOK", async () => {
        const q = await freshQuotas();
        vi.stubEnv("MANAGED_DAILY_CAP_USD", "5");
        vi.stubGlobal("fetch", mockD1({ "FROM global_spend_daily": [{ est_cost_micros: 6_000_000 }] }));
        const managed = await q.checkQuota({ uid: "u1", ipHash: "h1", tier: "managed", kind: "chat" });
        expect(managed.allowed).toBe(false);
        expect(managed.code).toBe("global_budget");
        const byok = await q.checkQuota({ uid: "u2", ipHash: "h2", tier: "byok", kind: "chat" });
        expect(byok.allowed).toBe(true);
    });

    it("fails open when D1 is down, and skips admins", async () => {
        const q = await freshQuotas();
        vi.stubGlobal("fetch", mockD1({}, { throwAll: true }));
        expect((await q.checkQuota({ uid: "u1", ipHash: "h", tier: "managed", kind: "deep" })).allowed).toBe(true);
        vi.stubEnv("ADMIN_UIDS", "admin-1");
        const fetchSpy = mockD1({});
        vi.stubGlobal("fetch", fetchSpy);
        expect((await q.checkQuota({ uid: "admin-1", ipHash: "h", tier: "managed", kind: "deep" })).allowed).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe("recordUsage + provision velocity", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("dual-increments account + IP + global ledgers for managed users", async () => {
        const q = await freshQuotas();
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string, init?: { body?: string }) => {
                calls.push(JSON.parse((init?.body as string) || "{}").sql || "");
                return { ok: true, json: async () => ({ success: true, errors: [], result: [{ results: [] }] }) };
            })
        );
        await q.recordUsage({
            uid: "u1",
            ipHash: "h1",
            tier: "managed",
            queries: 5,
            deepRuns: 1,
            simCalls: 2,
            simIterations: 1500,
            model: "gemini-2.0-flash",
            promptTokens: 1000,
            completionTokens: 500,
            reportedCost: null,
        });
        const joined = calls.join("\n");
        expect(joined).toMatch(/INTO quota_daily/);
        expect(joined).toMatch(/INTO quota_ip_daily/);
        expect(joined).toMatch(/INTO global_spend_daily/);
        expect(joined).toMatch(/DELETE FROM quota_daily/);
    });

    it("skips the global ledger for BYOK and all writes for admins", async () => {
        const q = await freshQuotas();
        const calls: string[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn(async (_url: string, init?: { body?: string }) => {
                calls.push(JSON.parse((init?.body as string) || "{}").sql || "");
                return { ok: true, json: async () => ({ success: true, errors: [], result: [{ results: [] }] }) };
            })
        );
        await q.recordUsage({ uid: "u2", ipHash: "h2", tier: "byok", queries: 1 });
        expect(calls.join("\n")).not.toMatch(/INTO global_spend_daily/);
        vi.stubEnv("ADMIN_UIDS", "admin-1");
        calls.length = 0;
        await q.recordUsage({ uid: "admin-1", ipHash: "h2", tier: "managed", queries: 1 });
        expect(calls.filter((s) => s.includes("INTO quota"))).toHaveLength(0);
    });

    it("caps fresh provisions per IP per day", async () => {
        const q = await freshQuotas();
        vi.stubGlobal("fetch", mockD1({ "FROM users": [{ n: 10 }] }));
        const denied = await q.checkProvisionVelocity("h1");
        expect(denied.allowed).toBe(false);
        expect(denied.message).toMatch(/Too many new accounts/);
        vi.stubGlobal("fetch", mockD1({ "FROM users": [{ n: 3 }] }));
        expect((await q.checkProvisionVelocity("h1")).allowed).toBe(true);
        expect((await q.checkProvisionVelocity(null)).allowed).toBe(true);
    });
});

describe("getQuotaState", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("returns used-vs-cap slices for account and network ledgers", async () => {
        const q = await freshQuotas();
        vi.stubGlobal(
            "fetch",
            mockD1({
                "FROM quota_daily": [{ queries: 7, deep_runs: 1, sim_calls: 2, completion_tokens: 1500 }],
                "FROM quota_ip_daily": [{ queries: 20, deep_runs: 1, sim_calls: 4, completion_tokens: 9000 }],
                "FROM global_spend_daily": [{ est_cost_micros: 1000 }],
            })
        );
        const s = await q.getQuotaState("u1", "h1", "managed");
        expect(s.tier).toBe("managed");
        expect(s.managedPaused).toBe(false);
        expect(s.resetsAt).toBeGreaterThan(Date.now());
        expect(s.account).toMatchObject({ queriesUsed: 7, queriesCap: 20, deepUsed: 1, deepCap: 3, simUsed: 2, simCap: 3, outTokensUsed: 1500, outTokensCap: 150_000 });
        expect(s.network).toMatchObject({ queriesUsed: 20, queriesCap: 40, deepCap: 6, simCap: 6, outTokensCap: 300_000 });
    });

    it("uses BYOK caps for the byok tier and flags a tripped global breaker", async () => {
        const q = await freshQuotas();
        vi.stubEnv("MANAGED_DAILY_CAP_USD", "5");
        vi.stubGlobal("fetch", mockD1({}));
        const byok = await q.getQuotaState("u2", "h2", "byok");
        expect(byok.account.queriesCap).toBe(100);
        expect(byok.managedPaused).toBe(false);
        vi.stubGlobal("fetch", mockD1({ "FROM global_spend_daily": [{ est_cost_micros: 9_000_000 }] }));
        const paused = await q.getQuotaState("u1", "h1", "managed");
        expect(paused.managedPaused).toBe(true);
    });

    it("returns zeros on empty ledgers", async () => {
        const q = await freshQuotas();
        vi.stubGlobal("fetch", mockD1({}));
        const s = await q.getQuotaState("u9", null, "managed");
        expect(s.account.queriesUsed).toBe(0);
        expect(s.network.queriesUsed).toBe(0);
        expect(s.network.queriesCap).toBe(40);
    });
});
