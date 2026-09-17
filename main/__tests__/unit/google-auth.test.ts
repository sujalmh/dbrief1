/**
 * Tests for direct Google OAuth helpers.
 * ======================================
 * ID-token verification is tested with a locally generated RSA keypair
 * (no network): sign a Google-shaped JWT, verify it, then assert every
 * rejection path (bad signature, wrong aud/iss, expiry, nonce, kid,
 * unverified email).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateKeyPairSync, createSign, createPublicKey } from "node:crypto";
import {
    buildAuthUrl,
    parseOAuthStateCookie,
    statesEqual,
    verifyIdToken,
} from "@/lib/auth/google";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

function b64url(obj: unknown): string {
    return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function makeKeypair() {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    return { privateKey, jwk: { ...jwk, kid: "test-kid", kty: "RSA" } };
}

function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, privateKey: ReturnType<typeof makeKeypair>["privateKey"]): string {
    const h = b64url(header);
    const p = b64url(payload);
    const sig = createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey);
    return `${h}.${p}.${sig.toString("base64url")}`;
}

function googlePayload(over: Record<string, unknown> = {}): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return {
        iss: "https://accounts.google.com",
        aud: CLIENT_ID,
        sub: "109999999999999999999",
        email: "driver@example.com",
        email_verified: true,
        name: "Test Driver",
        picture: "https://example.com/a.jpg",
        iat: now - 10,
        exp: now + 3600,
        ...over,
    };
}

describe("buildAuthUrl / state helpers", () => {
    it("builds a correct authorization URL", () => {
        const url = buildAuthUrl({ redirectUri: "https://app.example/api/auth/callback", state: "s", nonce: "n" });
        expect(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?")).toBe(true);
        const q = new URL(url).searchParams;
        expect(q.get("response_type")).toBe("code");
        expect(q.get("scope")).toContain("openid");
        expect(q.get("scope")).toContain("email");
        expect(q.get("state")).toBe("s");
        expect(q.get("nonce")).toBe("n");
        expect(q.get("redirect_uri")).toBe("https://app.example/api/auth/callback");
    });

    it("parses and compares state cookies strictly", () => {
        const s = "a".repeat(64);
        const n = "b".repeat(64);
        expect(parseOAuthStateCookie(`${s}.${n}`)).toEqual({ state: s, nonce: n });
        expect(parseOAuthStateCookie(undefined)).toBeNull();
        expect(parseOAuthStateCookie("short")).toBeNull();
        expect(parseOAuthStateCookie("notahex!".repeat(8) + "." + n)).toBeNull();
        expect(statesEqual(s, s)).toBe(true);
        expect(statesEqual(s, "c".repeat(64))).toBe(false);
        expect(statesEqual(s, "short")).toBe(false);
    });
});

describe("verifyIdToken", () => {
    const kp = makeKeypair();
    const fetchCerts = async () => ({ keys: [kp.jwk] });
    const baseOpts = { clientId: CLIENT_ID, fetchCerts };

    it("accepts a well-formed Google token", async () => {
        const t = signJwt({ alg: "RS256", kid: "test-kid", typ: "JWT" }, googlePayload(), kp.privateKey);
        const p = await verifyIdToken(t, baseOpts);
        expect(p.sub).toBe("109999999999999999999");
        expect(p.email).toBe("driver@example.com");
        expect(p.avatarUrl).toBe("https://example.com/a.jpg");
    });

    it("accepts the alternate issuer form", async () => {
        const t = signJwt({ alg: "RS256", kid: "test-kid" }, googlePayload({ iss: "accounts.google.com" }), kp.privateKey);
        await expect(verifyIdToken(t, baseOpts)).resolves.toBeTruthy();
    });

    it("rejects tampered payloads", async () => {
        const t = signJwt({ alg: "RS256", kid: "test-kid" }, googlePayload(), kp.privateKey);
        const [h, , s] = t.split(".");
        const evil = Buffer.from(JSON.stringify(googlePayload({ email: "attacker@example.com" }))).toString("base64url");
        await expect(verifyIdToken(`${h}.${evil}.${s}`, baseOpts)).rejects.toThrow(/signature/i);
    });

    it("rejects wrong audience, issuer, expiry, nonce, kid", async () => {
        const mk = (payload: Record<string, unknown>, kid = "test-kid") =>
            signJwt({ alg: "RS256", kid }, payload, kp.privateKey);
        await expect(verifyIdToken(mk(googlePayload({ aud: "other.apps.googleusercontent.com" })), baseOpts)).rejects.toThrow(/issued to this app/i);
        await expect(verifyIdToken(mk(googlePayload({ iss: "https://evil.example" })), baseOpts)).rejects.toThrow(/issuer/i);
        await expect(verifyIdToken(mk(googlePayload({ exp: Math.floor(Date.now() / 1000) - 3600 })), baseOpts)).rejects.toThrow(/expired/i);
        await expect(verifyIdToken(mk(googlePayload({ nonce: "abc" })), { ...baseOpts, nonce: "different" })).rejects.toThrow(/nonce/i);
        await expect(verifyIdToken(mk(googlePayload(), "unknown-kid"), baseOpts)).rejects.toThrow(/signing key/i);
    });

    it("rejects unverified emails and non-RS256 algorithms", async () => {
        const t = signJwt({ alg: "RS256", kid: "test-kid" }, googlePayload({ email_verified: false }), kp.privateKey);
        await expect(verifyIdToken(t, baseOpts)).rejects.toThrow(/not verified/i);
        const none = `${b64url({ alg: "none" })}.${b64url(googlePayload())}.`;
        await expect(verifyIdToken(none, baseOpts)).rejects.toThrow(/algorithm/i);
    });

    it("createPublicKey accepts our exported JWK (sanity of test harness)", () => {
        expect(() => createPublicKey({ key: kp.jwk, format: "jwk" })).not.toThrow();
    });
});

describe("linkGoogleAccount (mocked D1)", () => {
    beforeEach(() => {
        vi.unstubAllEnvs();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    async function freshStore() {
        vi.resetModules();
        vi.stubEnv("CF_API_TOKEN", "test-token");
        vi.stubEnv("CF_ACCOUNT_ID", "a");
        vi.stubEnv("CF_D1_DATABASE_ID", "d");
        vi.stubEnv("CF_R2_BUCKET", "b");
        return import("@/lib/cf/store");
    }

    function mockD1(statements: string[]) {
        return vi.fn(async (_url: string, init?: { body?: string }) => {
            const sql = (JSON.parse((init?.body as string) || "{}") as { sql?: string }).sql || "";
            statements.push(sql);
            if (sql.includes("SELECT id FROM users WHERE google_sub")) {
                return { ok: true, json: async () => ({ success: true, errors: [], result: [{ results: [] }] }) };
            }
            if (sql.includes("SELECT google_sub FROM users WHERE id")) {
                // Anonymous previous row: migratable.
                return { ok: true, json: async () => ({ success: true, errors: [], result: [{ results: [{ google_sub: null }] }] }) };
            }
            return { ok: true, json: async () => ({ success: true, errors: [], result: [{ results: [] }] }) };
        });
    }

    it("creates a deterministic uid and migrates anonymous history", async () => {
        const store = await freshStore();
        const statements: string[] = [];
        vi.stubGlobal("fetch", mockD1(statements));
        const uid = await store.linkGoogleAccount("u_anon123", { sub: "10999", email: "d@example.com", name: "D" });
        expect(uid).toBe("g_10999");
        const joined = statements.join("\n");
        expect(joined).toMatch(/INSERT INTO users/);
        expect(joined).toMatch(/UPDATE sessions SET user_id/);
        expect(joined).toMatch(/UPDATE messages SET user_id/);
        expect(joined).toMatch(/DELETE FROM users WHERE id/);
    });

    it("re-login to the same uid performs no migration", async () => {
        const store = await freshStore();
        const statements: string[] = [];
        vi.stubGlobal("fetch", mockD1(statements));
        const uid = await store.linkGoogleAccount("g_10999", { sub: "10999", email: "d@example.com" });
        expect(uid).toBe("g_10999");
        expect(statements.join("\n")).not.toMatch(/UPDATE sessions/);
    });
});
