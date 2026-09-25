/**
 * R2 object helper (server-only).
 * ===============================
 * Large session payloads (visualization dumps, evidence data, UI state)
 * live as JSON objects in the `f1-ai` bucket via the R2 REST object API.
 * Keys look like `sessions/{sid}/messages/{mid}/visualization.json`.
 */

import { CF_API_TOKEN, CF_R2_BUCKET, cfApiBase } from "./env";
import { requireCf, CfStoreError } from "./d1";

function objectUrl(key: string): string {
    return `${cfApiBase()}/r2/buckets/${CF_R2_BUCKET}/objects/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function authHeaders(): Record<string, string> {
    requireCf();
    return { Authorization: `Bearer ${CF_API_TOKEN}` };
}

/** Upload a JSON value to R2 (overwrites). */
export async function r2PutJson(key: string, value: unknown): Promise<void> {
    const res = await fetch(objectUrl(key), {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(value),
    }).catch((e) => {
        throw new CfStoreError(`R2 upload failed: ${e instanceof Error ? e.message : String(e)}`, 503);
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new CfStoreError(`R2 upload error ${res.status}: ${text.slice(0, 300)}`, 503);
    }
}

/** Download a JSON value from R2, or null when absent/corrupt. */
export async function r2GetJson<T = unknown>(key: string): Promise<T | null> {
    const res = await fetch(objectUrl(key), { method: "GET", headers: authHeaders() }).catch(() => null);
    if (!res || !res.ok) return null;
    try {
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

/** Delete one R2 object (missing keys are fine). */
export async function r2Delete(key: string): Promise<void> {
    const res = await fetch(objectUrl(key), { method: "DELETE", headers: authHeaders() }).catch(() => null);
    void res;
}
