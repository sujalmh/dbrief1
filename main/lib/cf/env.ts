/**
 * Cloudflare storage configuration (server-only).
 * ==============================================
 * The app persists sessions/messages to D1 (`f1-sessions`) and large
 * payloads (visualization dumps, evidence data, UI state) to R2 (`f1-ai`)
 * via the Cloudflare REST APIs. All values are server-only env vars —
 * never expose CF_API_TOKEN to the browser.
 */

export const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || "7fb30c62368164d849d8ca1a5d28ed19";
export const CF_API_TOKEN = process.env.CF_API_TOKEN || "";
export const CF_D1_DATABASE_ID = process.env.CF_D1_DATABASE_ID || "c5acda92-8b2c-4daf-a004-e4f7cc1f0179";
export const CF_R2_BUCKET = process.env.CF_R2_BUCKET || "f1-ai";

/** True when the server can reach D1 + R2 (all vars present). */
export function cfConfigured(): boolean {
    return CF_ACCOUNT_ID.length > 0 && CF_API_TOKEN.length > 0 && CF_D1_DATABASE_ID.length > 0 && CF_R2_BUCKET.length > 0;
}

export function cfApiBase(): string {
    return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}`;
}
