/**
 * Source Citation Utilities Tests
 * ================================
 * Covers the structured-output source pick and the matching helpers that
 * ensure only really-retrieved documents become UI sources.
 */

import { describe, it, expect, vi } from "vitest";
import {
    citationLink,
    citationsFromDocs,
    extractEvidenceIds,
    extractRegulationDocs,
    matchCitations,
    pickUsedSources,
    toCitation,
} from "@/lib/utils/sources";

const DOCS = [
    {
        source: "2025_sporting_regs.pdf",
        title: "Sporting Regulations",
        url: "https://www.fia.com/2025_sporting_regs.pdf",
        source_url: "https://www.fia.com/2025_sporting_regs.pdf",
        doc_type: "regulation",
        content: "points rules...",
    },
    {
        source: "decision_austria_2023.pdf",
        title: "Stewards Decision",
        url: null,
        source_url: null,
        doc_type: "decision",
        content: "penalty...",
    },
];

describe("pickUsedSources", () => {
    const candidates = DOCS;

    const structuredModel = (used: unknown) => ({
        withStructuredOutput: vi.fn().mockReturnValue({
            invoke: vi.fn().mockResolvedValue({ used_sources: used }),
        }),
    });

    it("returns matched citations for the structured pick", async () => {
        const model = structuredModel([
            "decision_austria_2023.pdf",
            "2025_sporting_regs.pdf",
        ]);
        const result = await pickUsedSources(
            model as never,
            "Who was penalized in Austria 2023?",
            "The stewards penalized the driver per the decision document.",
            candidates
        );

        expect(result.map((c) => c.source)).toEqual([
            "decision_austria_2023.pdf",
            "2025_sporting_regs.pdf",
        ]);
        expect(result[1].source_url).toBe(
            "https://www.fia.com/2025_sporting_regs.pdf"
        );
    });

    it("drops picked names that were never retrieved", async () => {
        const model = structuredModel(["ghost.pdf", "2025_sporting_regs.pdf"]);
        const result = await pickUsedSources(
            model as never,
            "q?",
            "answer",
            candidates
        );

        expect(result.map((c) => c.source)).toEqual(["2025_sporting_regs.pdf"]);
    });

    it("returns [] when the model picks nothing", async () => {
        const model = structuredModel([]);
        const result = await pickUsedSources(model as never, "q?", "answer", candidates);

        expect(result).toEqual([]);
    });

    it("returns [] without calling the model when there are no candidates", async () => {
        const invoke = vi.fn();
        const model = {
            withStructuredOutput: vi.fn().mockReturnValue({ invoke }),
        };
        const result = await pickUsedSources(model as never, "q?", "answer", []);

        expect(result).toEqual([]);
        expect(model.withStructuredOutput).not.toHaveBeenCalled();
    });

    it("returns [] when the structured call fails", async () => {
        const model = {
            withStructuredOutput: vi.fn().mockReturnValue({
                invoke: vi.fn().mockRejectedValue(new Error("LLM down")),
            }),
        };
        const result = await pickUsedSources(
            model as never,
            "q?",
            "answer",
            candidates
        );

        expect(result).toEqual([]);
    });
});

describe("matchCitations", () => {
    it("matches picked names to retrieved docs in LLM order", () => {
        const result = matchCitations(
            ["decision_austria_2023.pdf", "2025_sporting_regs.pdf"],
            DOCS
        );
        expect(result.map((c) => c.source)).toEqual([
            "decision_austria_2023.pdf",
            "2025_sporting_regs.pdf",
        ]);
        expect(result[0].type).toBe("decision");
        expect(result[0].source_url).toBeNull();
        expect(result[0].url).toBeNull();
        expect(result[1].source_url).toBe("https://www.fia.com/2025_sporting_regs.pdf");
    });

    it("drops hallucinated filenames that were never retrieved", () => {
        const result = matchCitations(["made_up.pdf", "2025_sporting_regs.pdf"], DOCS);
        expect(result.map((c) => c.source)).toEqual(["2025_sporting_regs.pdf"]);
    });

    it("dedupes repeated names", () => {
        const result = matchCitations(
            ["2025_sporting_regs.pdf", "2025_sporting_regs.pdf"],
            DOCS
        );
        expect(result.length).toBe(1);
    });
});

describe("citationLink", () => {
    it("prefers source_url over url", () => {
        expect(
            citationLink({ source_url: "https://cdn/a.pdf", url: "https://old/b.pdf" })
        ).toBe("https://cdn/a.pdf");
    });

    it("falls back to url", () => {
        expect(citationLink({ source_url: null, url: "https://old/b.pdf" })).toBe(
            "https://old/b.pdf"
        );
    });

    it("returns null when neither exists", () => {
        expect(citationLink({ source_url: null, url: null })).toBeNull();
    });
});

describe("toCitation", () => {
    it("carries title, url, and source_url", () => {
        expect(toCitation(DOCS[0])).toEqual({
            source: "2025_sporting_regs.pdf",
            title: "Sporting Regulations",
            url: "https://www.fia.com/2025_sporting_regs.pdf",
            source_url: "https://www.fia.com/2025_sporting_regs.pdf",
            type: "regulation",
        });
    });

    it("falls back to doc_type/type/regulation for the kind", () => {
        expect(toCitation({ source: "a.pdf" }).type).toBe("regulation");
        expect(toCitation({ source: "a.pdf", type: "decision" }).type).toBe("decision");
    });
});

describe("extractRegulationDocs", () => {
    it("parses object and stringified tool output", () => {
        const payload = { retrieved_documents: DOCS, used_subqueries: ["q"] };
        expect(extractRegulationDocs(payload).length).toBe(2);
        expect(extractRegulationDocs(JSON.stringify(payload)).length).toBe(2);
    });

    it("returns [] for non-RAG payloads", () => {
        expect(extractRegulationDocs({ results: [] })).toEqual([]);
        expect(extractRegulationDocs("not json")).toEqual([]);
        expect(extractRegulationDocs(null)).toEqual([]);
    });
});

describe("citationsFromDocs", () => {
    it("dedupes by filename", () => {
        const result = citationsFromDocs([...DOCS, DOCS[0]]);
        expect(result.length).toBe(2);
    });
});

describe("extractEvidenceIds", () => {
    it("extracts [E#] refs in order, deduplicated", () => {
        expect(extractEvidenceIds("See [E3] and [E1], also [E3] again.")).toEqual([
            "E3",
            "E1",
        ]);
    });

    it("returns [] when no refs exist", () => {
        expect(extractEvidenceIds("No citations here.")).toEqual([]);
    });
});
