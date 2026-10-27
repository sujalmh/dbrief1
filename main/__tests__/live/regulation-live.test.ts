/**
 * Live regulation retrieval check
 * ===============================
 * Opt-in only. Run with:
 *   RUN_LIVE_RAG=1 npx vitest run __tests__/live/regulation-live.test.ts
 *
 * Requires QDRANT_URL, QDRANT_API_KEY, EMBEDDINGS_API_KEY, and a managed
 * API key. It performs one real retrieval through the model-bound tool so
 * the planner-model sub-query path is exercised end to end.
 */

import { config } from "dotenv";
import { describe, expect, it } from "vitest";

const RUN_LIVE = process.env.RUN_LIVE_RAG === "1";
if (RUN_LIVE) {
    config({ path: ".env.local", quiet: true });
}

const HAS_RAG_CONFIG = Boolean(
    process.env.QDRANT_URL &&
    process.env.QDRANT_API_KEY &&
    process.env.EMBEDDINGS_API_KEY
);
const MANAGED_MODEL = process.env.MANAGED_LLM_MODEL || "deepseek-v4.1-flash";
const ALLOWED_MODEL =
    MANAGED_MODEL === "deepseek-v4.1-flash" || MANAGED_MODEL === "mimo-v2.6-flash";
const LIVE = RUN_LIVE && HAS_RAG_CONFIG;

describe.skipIf(!LIVE)("live regulation retrieval", () => {
    it(
        "retrieves Sporting regulation chunks with model-expanded sub-queries",
        async () => {
            expect(ALLOWED_MODEL).toBe(true);

            const { getRegulationTools } = await import("@/lib/tools/regulation");
            const { getPlannerModel } = await import("@/lib/llm");

            const model = await getPlannerModel(
                "managed",
                undefined,
                `p1-rag-live-${Date.now()}`
            );
            const tools = getRegulationTools(model);
            const raw = await tools.retrieve_regulations.invoke({
                query: "What are the safety car restart procedures?",
                season: 2025,
                section: "Sporting",
                doc_type: "regulation",
            });
            const result = JSON.parse(String(raw)) as {
                error?: boolean;
                message?: string;
                retrieved_documents?: Array<{ content?: string; source_url?: string | null }>;
                used_subqueries?: string[];
            };

            expect(result.error).not.toBe(true);
            expect(result.used_subqueries?.length ?? 0).toBeGreaterThan(1);
            expect(result.retrieved_documents?.length ?? 0).toBeGreaterThan(0);

            const joined = (result.retrieved_documents ?? [])
                .map((doc) => doc.content ?? "")
                .join("\n")
                .toLowerCase();
            expect(joined).toContain("safety car");

            console.log(
                `[live-rag] model=${MANAGED_MODEL} subqueries=${result.used_subqueries?.length} docs=${result.retrieved_documents?.length}`
            );
            console.log(
                `[live-rag] sources=${(result.retrieved_documents ?? [])
                    .map((doc) => doc.source_url ?? "no-url")
                    .join(", ")}`
            );
        },
        120_000
    );
});
