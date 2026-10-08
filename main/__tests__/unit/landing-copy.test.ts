/**
 * Landing copy: no staccato sentences
 * =====================================
 * House rule: landing pages use flowing sentences, never choppy
 * fragments ("Russell, clearly.", "Mostly the final sector.").
 * This test reads the landing sources as text (no component imports)
 * and fails on short sentences or known-removed fragments.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
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
