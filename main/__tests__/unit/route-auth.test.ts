/**
 * Tests for the server-side sign-in gate.
 * =======================================
 * Cookie possession alone must NOT grant API access — only identities
 * with a Google link (users.google_sub) pass. D1 is faked by stubbing
 * global fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type RouteUtil = typeof import("@/lib/cf/route-util");

async function freshRouteUtil(env?: Record<string, string | undefined>) {
    vi.resetModules();
    vi.stubEnv("CF_API_TOKEN", "test-token");
    vi.stubEnv("CF_ACCOUNT_ID", "a");
    vi.stubEnv("CF_D1_DATABASE_ID", "d");
    vi.stubEnv("CF_R2_BUCKET", "b");
    for (const [k, v] of Object.entries(env ?? {})) {
        if (v === undefined) delete process.env[k];
        else vi.stubEnv(k, v);
    }
    return import("@/lib/cf/route-util");
}

function mockD1(rows: Array<Record<string, unknown>> | "throw") {
    return vi.fn(async (_url: string) => {
        void _url;
        if (rows === "throw") throw new Error("d1 down");
        return { ok: true, json: async () => ({ success: true, errors: [], result: [{ results: rows }] }) };
    });
}

describe("requireLinkedIdentity", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it("allows Google-linked identities", async () => {
        const r: RouteUtil = await freshRouteUtil();
        vi.stubGlobal("fetch", mockD1([{ google_sub: "10999" }]));
        expect(await r.requireLinkedIdentity("u_linked")).toBeNull();
    });

    it("denies anonymous callers and unlinked accounts with 401 + code", async () => {
        const r: RouteUtil = await freshRouteUtil();
        vi.stubGlobal("fetch", mockD1([{ google_sub: null }]));
        const anon = await r.requireLinkedIdentity(null);
        expect(anon?.status).toBe(401);
        expect(((await anon?.json()) as { code?: string }).code).toBe("auth_required");
        const unlinked = await r.requireLinkedIdentity("u_anon");
        expect(unlinked?.status).toBe(401);
        const missing = await (async () => {
            vi.stubGlobal("fetch", mockD1([]));
            return r.requireLinkedIdentity("u_gone");
        })();
        expect(missing?.status).toBe(401);
    });

    it("fails closed on D1 errors, open when storage is unconfigured (dev)", async () => {
        const r: RouteUtil = await freshRouteUtil();
        vi.stubGlobal("fetch", mockD1("throw"));
        const closed = await r.requireLinkedIdentity("u_linked");
        expect(closed?.status).toBe(401);
        expect(closed).not.toBeNull();

        // Local dev without CF credentials: the store layer throws 503,
        // and the gate stays open so dev doesn't need cloud access.
        const dev: RouteUtil = await freshRouteUtil({ CF_API_TOKEN: undefined });
        const open = await dev.requireLinkedIdentity("anyone");
        expect(open).toBeNull();
    });
});
