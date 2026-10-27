/**
 * Contrast helpers for team-coloured text.
 * ========================================
 * Driver names are painted in team colours, and several of those hues
 * (Red Bull navy, McLaren orange, Ferrari red) sit below the WCAG AA
 * 4.5:1 ratio for small bold text on one of the two themes. Rather than
 * dropping the colour, we derive one variant per theme that keeps the
 * hue but is pushed toward black/white just enough to pass.
 */

export type Rgb = { r: number; g: number; b: number };

const WHITE = "#ffffff";
const BLACK = "#09090b";

function parseHex(hex: string): Rgb | null {
    const m = (hex || "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let h = m[1]!;
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: Rgb): string {
    const c = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
}

function relativeLuminance({ r, g, b }: Rgb): number {
    const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
    const ca = parseHex(a);
    const cb = parseHex(b);
    if (!ca || !cb) return 1;
    const l1 = relativeLuminance(ca);
    const l2 = relativeLuminance(cb);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}

/**
 * Return a hex colour derived from `hex` that reaches `target` contrast
 * against `background`. Mixes toward black on light backgrounds and
 * toward white on dark ones, preserving hue as far as possible.
 */
export function ensureContrast(hex: string, background: string, target = 4.6): string {
    const fg = parseHex(hex);
    const bg = parseHex(background);
    if (!fg || !bg) return hex;
    if (contrastRatio(hex, background) >= target) return hex;

    const towardsWhite = relativeLuminance(bg) < 0.5;
    const anchor = parseHex(towardsWhite ? WHITE : BLACK)!;

    for (let step = 1; step <= 20; step++) {
        const t = step / 20;
        const mixed = toHex({
            r: fg.r + (anchor.r - fg.r) * t,
            g: fg.g + (anchor.g - fg.g) * t,
            b: fg.b + (anchor.b - fg.b) * t,
        });
        if (contrastRatio(mixed, background) >= target) return mixed;
    }
    return towardsWhite ? WHITE : BLACK;
}

/** Dark- and light-theme readable variants of a team colour. */
export function themeSafeColor(hex: string): { light: string; dark: string } {
    return {
        light: ensureContrast(hex, WHITE),
        dark: ensureContrast(hex, BLACK),
    };
}
