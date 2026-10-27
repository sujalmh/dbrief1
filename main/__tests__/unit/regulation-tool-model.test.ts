/**
 * Regulation tool model wiring
 * ============================
 * The regulation tool must pass an optional planner model through to
 * ragRetrieve so the existing sub-query expansion path is used, while the
 * unbound tool stays backward compatible.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ragRetrieve } from "@/lib/agents/regulationRetriever";
import {
    createRegulationRetrieveTool,
    getRegulationTools,
    regulationRetrieveTool,
} from "@/lib/tools/regulation";

const EMBEDDING = Array(1024).fill(0.1);
const SUB_QUERIES = [
    "safety car restart procedure",
    "race suspension points allocation",
    "minimum race distance full points",
];

interface RecordedCall {
    url: string;
    body: Record<string, unknown>;
}

let calls: RecordedCall[];

const qdrantPoint = (content: string) => ({
    id: 1,
    score: 0.92,
    payload: {
        season: "2025",
        doc_type: "regulation",
        section: "Sporting",
        filename: "2025_sporting_regulations.pdf",
        short_title: "2025 Sporting Regulations",
        source_url: "https://www.fia.com/2025_sporting_regulations.pdf",
        published_on: "2024-10-17",
        chunk_index: 3,
        text: content,
    },
});

function jsonResponse(payload: unknown): Response {
    return {
        ok: true,
        json: async () => payload,
    } as unknown as Response;
}

function createSubQueryModel(subQueries: string[]) {
    const model = {
        invoke: vi.fn().mockResolvedValue({
            content: JSON.stringify(subQueries),
        }),
    };
    return {
        model: model as unknown as BaseChatModel,
        invoke: model.invoke,
    };
}

beforeEach(() => {
    calls = [];
    process.env.EMBEDDINGS_API_KEY = "test-key";
    process.env.QDRANT_URL = "https://test.qdrant.io";
    process.env.QDRANT_API_KEY = "test-qdrant-key";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = init?.body ? JSON.parse(String(init.body)) : {};

        if (url.includes("/v1/embeddings")) {
            calls.push({ url, body });
            return jsonResponse({ data: [{ embedding: EMBEDDING }] });
        }
        if (url.includes("/collections/fia_documents/points/search")) {
            calls.push({ url, body });
            return jsonResponse({
                result: [qdrantPoint("Safety Car restart procedures are defined in Article 55.")],
            });
        }
        if (url.includes("/v1/rerank")) {
            calls.push({ url, body });
            return jsonResponse({
                object: "list",
                data: [{ index: 0, relevance_score: 0.97 }],
                model: "rerank-3",
            });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EMBEDDINGS_API_KEY;
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
});

const searchCalls = () => calls.filter((c) => c.url.includes("/points/search"));
const embeddingCalls = () => calls.filter((c) => c.url.includes("/v1/embeddings"));

describe("getRegulationTools model wiring", () => {
    it("keeps the unbound singleton and searches with the original query", async () => {
        const tools = getRegulationTools();

        expect(tools.retrieve_regulations).toBe(regulationRetrieveTool);

        const raw = await tools.retrieve_regulations.invoke({
            query: "safety car restart rules",
            season: 2025,
            section: "Sporting",
            doc_type: "regulation",
        });
        const result = JSON.parse(String(raw));

        expect(result.used_subqueries).toEqual(["safety car restart rules"]);
        expect(result.retrieved_documents).toHaveLength(1);
        expect(embeddingCalls()).toHaveLength(1);
        expect(searchCalls()).toHaveLength(1);
    });

    it("passes the model to ragRetrieve and expands sub-queries", async () => {
        const { model, invoke } = createSubQueryModel(SUB_QUERIES);
        const tools = getRegulationTools(model);

        expect(tools.retrieve_regulations).not.toBe(regulationRetrieveTool);

        const raw = await tools.retrieve_regulations.invoke({
            query: "What happens to points if a race is suspended?",
            season: 2025,
            section: "Sporting",
            doc_type: "regulation",
        });
        const result = JSON.parse(String(raw));

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result.used_subqueries).toEqual(SUB_QUERIES);
        expect(result.retrieved_documents).toHaveLength(1);
        expect(result.retrieved_documents[0].source_url).toBe(
            "https://www.fia.com/2025_sporting_regulations.pdf"
        );
        expect(embeddingCalls()).toHaveLength(SUB_QUERIES.length);
        expect(searchCalls()).toHaveLength(SUB_QUERIES.length);
    });

    it("does not leak a model into later unbound tool sets", async () => {
        const { model } = createSubQueryModel(SUB_QUERIES);
        const bound = getRegulationTools(model);
        expect(bound.retrieve_regulations).not.toBe(regulationRetrieveTool);

        const unbound = getRegulationTools();
        expect(unbound.retrieve_regulations).toBe(regulationRetrieveTool);

        await unbound.retrieve_regulations.invoke({
            query: "safety car restart rules",
            season: 2025,
            section: "Sporting",
            doc_type: "regulation",
        });

        expect(embeddingCalls()).toHaveLength(1);
    });

    it("falls back to the original query when the model returns bad JSON", async () => {
        const model = {
            invoke: vi.fn().mockResolvedValue({ content: "not json" }),
        } as unknown as BaseChatModel;
        const tools = getRegulationTools(model);

        const raw = await tools.retrieve_regulations.invoke({
            query: "unsafe release penalty",
            season: 2025,
            section: "Sporting",
            doc_type: "regulation",
        });
        const result = JSON.parse(String(raw));

        expect(result.used_subqueries).toEqual(["unsafe release penalty"]);
        expect(embeddingCalls()).toHaveLength(1);
    });

    it("keeps createRegulationRetrieveTool usable without a model", async () => {
        const tool = createRegulationRetrieveTool();
        expect(tool.name).toBe("retrieve_regulations");

        const raw = await tool.invoke({
            query: "safety car restart rules",
            season: 2025,
            section: "Sporting",
            doc_type: "regulation",
        });
        const result = JSON.parse(String(raw));

        expect(result.used_subqueries).toEqual(["safety car restart rules"]);
    });
});

describe("ragRetrieve sub-query generation", () => {
    it("uses every generated sub-query for embedding and search", async () => {
        const { model, invoke } = createSubQueryModel(SUB_QUERIES);

        const result = await ragRetrieve(
            {
                query: "What happens to points if a race is suspended?",
                season: 2025,
                section: "Sporting",
                doc_type: "regulation",
            },
            model
        );

        expect(invoke).toHaveBeenCalledTimes(1);
        expect(result.used_subqueries).toEqual(SUB_QUERIES);
        expect(embeddingCalls().map((c) => c.body.input)).toEqual(SUB_QUERIES);
        expect(searchCalls()).toHaveLength(SUB_QUERIES.length);
    });

    it("uses only the original query when no model is supplied", async () => {
        const result = await ragRetrieve({
            query: "safety car restart rules",
            season: 2025,
            section: "Sporting",
            doc_type: "regulation",
        });

        expect(result.used_subqueries).toEqual(["safety car restart rules"]);
        expect(embeddingCalls()).toHaveLength(1);
    });
});
