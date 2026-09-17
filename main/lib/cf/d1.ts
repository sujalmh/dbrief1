/**
 * D1 query helper (server-only).
 * ==============================
 * Thin wrapper over the D1 REST query endpoint. Throws CfStoreError on
 * transport/API failures so routes can map to 503/500.
 */

import { CF_API_TOKEN, CF_D1_DATABASE_ID, cfApiBase, cfConfigured } from "./env";

export class CfStoreError extends Error {
    status: number;
    constructor(message: string, status = 500) {
        super(message);
        this.name = "CfStoreError";
        this.status = status;
    }
}

export function requireCf(): void {
    if (!cfConfigured()) {
        throw new CfStoreError(
            "Cloudflare storage is not configured. Set CF_API_TOKEN (plus CF_ACCOUNT_ID/CF_D1_DATABASE_ID/CF_R2_BUCKET) in .env.local — see env.example.",
            503
        );
    }
}

interface D1QueryResponse {
    success: boolean;
    errors: Array<{ message?: string }>;
    result?: Array<{ results?: Array<Record<string, unknown>>; success?: boolean; meta?: unknown }>;
}

/** Run a single parameterized D1 statement, returning rows. */
export async function d1Query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    requireCf();
    let res: Response;
    try {
        res = await fetch(`${cfApiBase()}/d1/database/${CF_D1_DATABASE_ID}/query`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${CF_API_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ sql, params }),
        });
    } catch (e) {
        throw new CfStoreError(`D1 request failed: ${e instanceof Error ? e.message : String(e)}`, 503);
    }
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new CfStoreError(`D1 error ${res.status}: ${text.slice(0, 300)}`, res.status >= 500 ? 503 : 500);
    }
    const data = (await res.json()) as D1QueryResponse;
    if (!data.success) {
        const msg = data.errors?.map((e) => e.message).filter(Boolean).join("; ") || "D1 query failed";
        throw new CfStoreError(msg.slice(0, 500), 500);
    }
    const first = data.result?.[0];
    return ((first?.results ?? []) as T[]);
}

/** Run a single D1 statement, discarding rows. */
export async function d1Exec(sql: string, params: unknown[] = []): Promise<void> {
    await d1Query(sql, params);
}
