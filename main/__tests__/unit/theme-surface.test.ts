/**
 * Theme surface contract
 * ======================
 * Guards the steering-wheel palette split: light mode is an aluminium
 * surface with its own ink, not dark-mode chrome reused. These are source
 * checks (the suite runs without a browser) for the tokens and the few
 * shared components every surface renders through.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

function readSource(rel: string): string {
    return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("steering-wheel theme", () => {
    const css = readSource("app/globals.css");

    it("defines switchgear hues and per-theme wheel surfaces", () => {
        for (const token of [
            "--f1-cyan:",
            "--f1-blue:",
            "--f1-orange:",
            "--header-bg:",
            "--header-fg:",
            "--wheel-face:",
            "--wheel-well:",
            "--wheel-line:",
            "--wheel-text:",
        ]) {
            expect(css, token).toContain(token);
        }
        // Both themes must set their own header surface, not inherit one.
        expect(css.match(/--header-bg:/g)?.length).toBe(2);
        expect(css.match(/--wheel-well:/g)?.length).toBe(2);
    });

    it("keeps the LED strip and hardware surface classes", () => {
        expect(css).toMatch(/\.wheel-led-strip\s*\{/);
        expect(css).toMatch(/\.wheel-well\s*\{/);
        expect(css).toMatch(/\.wheel-panel\s*\{/);
        expect(css).toMatch(/\.dark \.bg-carbon-header\s*\{/);
        expect(css).toMatch(/html\.light \.btn-physical\s*\{/);
    });

    it("header controls are coloured switchgear, not neutral chrome", () => {
        const header = readSource("components/layout/header.tsx");
        expect(header).toMatch(/btn-wheel-purple/);
        expect(header).toMatch(/btn-wheel-blue/);
        expect(header).toMatch(/btn-wheel-orange/);
        expect(header).toMatch(/btn-wheel h-9 w-9/);
    });

    it("shared header chrome uses theme tokens instead of dark-only colours", () => {
        const shell = readSource("components/layout/header-shell.tsx");
        expect(shell).toMatch(/wheel-led-strip/);
        expect(shell).toMatch(/var\(--header-fg\)/);
        expect(shell).toMatch(/var\(--wheel-text-dim\)/);
        expect(shell).toMatch(/wheel-well/);
        expect(shell).not.toMatch(/bg-black\/40/);
        expect(shell).not.toMatch(/text-zinc-300/);
    });

    it("public share view follows the active theme", () => {
        const share = readSource("components/share/share-view.tsx");
        expect(share).toMatch(/var\(--header-fg\)/);
        expect(share).toMatch(/var\(--header-dim\)/);
        expect(share).not.toMatch(/text-zinc-300/);
        expect(share).not.toMatch(/bg-black\/40/);
    });

    it("modal inset panels and inputs use theme borders", () => {
        for (const rel of [
            "components/chat/settings-modal.tsx",
            "components/chat/share-dialog.tsx",
            "components/profile/profile-modal.tsx",
        ]) {
            const source = readSource(rel);
            expect(source, rel).toMatch(/wheel-panel/);
            expect(source, rel).not.toMatch(/dark:bg-black\/30/);
        }
        const settings = readSource("components/chat/settings-modal.tsx");
        expect(settings).not.toMatch(/border-white\/10/);
    });
});
