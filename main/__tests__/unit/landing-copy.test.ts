/**
 * Landing copy: no staccato sentences
 * =====================================
 * House rule: landing pages use flowing sentences, never choppy
 * fragments ("Russell, clearly.", "Mostly the final sector.").
 * This test reads the landing sources as text (no component imports)
 * and fails on short sentences or known-removed fragments.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Double-quoted TS string values for a given key (handles \" escapes). */
function extractValues(source: string, key: string): string[] {
    const re = new RegExp(`${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "g");
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        out.push((m[1] ?? "").replace(/\\"/g, '"'));
    }
    return out;
}

function sentences(text: string): string[] {
    return text
        .replace(/\*\*/g, "")
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

const showcase = readSource("components/landing/landing-showcase.tsx");
const hero = readSource("components/landing/landing-hero.tsx");

describe("landing copy has no staccato sentences", () => {
    it("demo answers are flowing sentences (no 1-3 word fragments)", () => {
        const answers = extractValues(showcase, "answer");
        expect(answers.length).toBeGreaterThan(0);
        for (const answer of answers) {
            for (const sentence of sentences(answer)) {
                const words = sentence.split(/\s+/).filter(Boolean);
                expect(
                    words.length,
                    `staccato fragment in demo answer: "${sentence}"`
                ).toBeGreaterThan(3);
            }
        }
    });

    it("demo questions are complete questions", () => {
        const questions = extractValues(showcase, "question");
        expect(questions.length).toBeGreaterThan(0);
        for (const question of questions) {
            const words = question.split(/\s+/).filter(Boolean);
            expect(words.length, `fragment question: "${question}"`).toBeGreaterThan(3);
        }
    });

    it("chart captions read as full clauses", () => {
        const captions = extractValues(showcase, "caption");
        expect(captions.length).toBeGreaterThan(0);
        for (const caption of captions) {
            const words = caption.split(/\s+/).filter(Boolean);
            expect(words.length, `fragment caption: "${caption}"`).toBeGreaterThan(3);
        }
    });

    it("hero subline is a complete flowing sentence", () => {
        const match = hero.match(/<motion\.p[\s\S]*?>([\s\S]*?)<\/motion\.p>/);
        expect(match).not.toBeNull();
        const subline = (match?.[1] ?? "").replace(/\s+/g, " ").trim();
        const parts = sentences(subline);
        expect(parts.length).toBe(1);
        expect(parts[0]?.split(/\s+/).length).toBeGreaterThan(3);
    });

    it("removed staccato fragments never come back", () => {
        const copy = `${showcase}\n${hero}`;
        for (const fragment of [
            "Russell, clearly",
            "Mostly the final sector",
            "Two-stop:",
            "asked in chat, answered",
            "overtake ~lap",
        ]) {
            expect(copy, `banned fragment resurfaced: "${fragment}"`).not.toContain(fragment);
        }
    });
});

describe("repo docs have no staccato sentences", () => {
    // README.md / CONTRIBUTING.md live at the repo root (one level up).
    const docs = ["../README.md", "../CONTRIBUTING.md"].map((rel) =>
        readFileSync(join(process.cwd(), rel), "utf8")
    );

    it("uses flowing sentences (no 1-3 word fragments)", () => {
        for (const [i, doc] of docs.entries()) {
            // Only prose counts: skip fenced code, images, and headings.
            // Track fences on raw lines (filtering ``` first would blind
            // the toggle and leak code lines into the check).
            const inProse: string[] = [];
            let fenced = false;
            for (const line of doc.split("\n")) {
                const trimmed = line.trim();
                if (trimmed.startsWith("```")) {
                    fenced = !fenced;
                    continue;
                }
                if (fenced || trimmed.startsWith("!")) continue;
                inProse.push(line);
            }
            for (const sentence of sentences(inProse.join("\n"))) {
                // Headings, list markers, and table rows are labels, not sentences.
                const cleaned = sentence
                    .replace(/^#{1,6}\s+/, "")
                    .replace(/^[-*]\s+/, "")
                    .replace(/^\d+[.)]\s+/, "")
                    .replace(/\s*\d+[.)]\s*$/, "")
                    .trim();
                if (!cleaned || cleaned.startsWith("|")) continue;
                // Fragments without sentence punctuation are headings or
                // labels, not sentences (e.g. a lone "## Workflow").
                if (!/[.!?:]/.test(cleaned)) continue;
                const words = cleaned.split(/\s+/).filter(Boolean);
                expect(words.length, `doc ${i}: "${cleaned}"`).toBeGreaterThan(3);
            }
        }
    });

    it("mentions the screenshots it embeds", () => {
        const readme = docs[0] ?? "";
        for (const shot of ["assets/readme-landing.jpg", "assets/readme-chat.jpg", "assets/readme-mobile.jpg"]) {
            expect(readme).toContain(shot);
            expect(existsSync(join(process.cwd(), "..", shot))).toBe(true);
        }
    });
});
