/**
 * F1 Color Tokens
 * ===============
 *
 * Chart-facing palette. Driver/team colors live in `lib/f1-colors.ts`
 * (single source of truth, learned from live API data) and are
 * re-exported here so chart components keep one import.
 *
 * Palette:
 *   - `F1_PALETTE` is the curated high-contrast comparison palette
 *     (team colors live in `lib/f1-colors.ts`, imported directly)
 *   - `DRIVER_COLOR` is the convenience "color for a driver code" helper
 *   - `CHART_TOKENS` is the bag of color tokens used by chart wrappers
 */

import { getDriverColor } from "@/lib/f1-colors";

export const F1_PALETTE = [
    "#F2059F", // Pink (high contrast)
    "#00D2BE", // Cyan/Teal
    "#FFEA00", // Yellow
    "#52E252", // Lime
    "#FF8700", // Orange
    "#A855F7", // Purple
    "#E10600", // Red
    "#0600EF", // Blue
    "#B6BABD", // Grey
    "#006F62", // Dark Green
];

export const CHART_TOKENS = {
    grid: "var(--border)",
    axis: "var(--muted-foreground)",
    foreground: "var(--foreground)",
    background: "var(--background)",
    highlight: "#E10600",
    positive: "#00D26A",
    negative: "#E10600",
    compound: {
        SOFT: "#E10600",
        MEDIUM: "#FFD700",
        HARD: "#FFFFFF",
        INTERMEDIATE: "#52E252",
        WET: "#0600EF",
    },
};

/**
 * Returns the color associated with a driver code (3-letter) or full name,
 * falling back to the F1 palette. Case-insensitive. Learned live colors
 * (see lib/f1-colors.ts) win; unknown drivers cycle the palette so chart
 * series stay distinguishable.
 */
export function colorForDriver(input: string | undefined, fallbackIndex = 0): string {
    if (!input) return F1_PALETTE[fallbackIndex % F1_PALETTE.length];
    const learned = getDriverColor(input);
    if (learned !== "#FFFFFF") return learned;
    return F1_PALETTE[fallbackIndex % F1_PALETTE.length];
}
