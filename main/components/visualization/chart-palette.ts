/**
 * F1 Color Tokens
 * ===============
 *
 * Single source of truth for every F1-themed color used in charts. Mirrors
 * `lib/f1-colors.ts` (driver/team colors) but is re-exported here as a
 * generic palette so chart components don't have to import team metadata.
 *
 * Palette:
 *   - `F1_PALETTE` is the curated high-contrast comparison palette
 *   - `TEAM_COLORS` is the team color lookup
 *   - `DRIVER_COLOR` is the convenience "color for a driver code" helper
 *   - `CHART_TOKENS` is the bag of color tokens used by chart wrappers
 */

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

export const TEAM_COLORS: Record<string, string> = {
    "Red Bull Racing": "#3671C6",
    Mercedes: "#00D2BE",
    Ferrari: "#E8002D",
    McLaren: "#FF8700",
    "Aston Martin": "#229971",
    Alpine: "#0090FF",
    Williams: "#64C4FF",
    RB: "#6692FF",
    Haas: "#B6BABD",
    "Kick Sauber": "#52E252",
    Renault: "#FFF500",
    "Racing Point": "#F596C8",
    AlphaTauri: "#2B4562",
    "Alfa Romeo": "#900000",
};

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
 * falling back to the F1 palette. Case-insensitive.
 */
export function colorForDriver(input: string | undefined, fallbackIndex = 0): string {
    if (!input) return F1_PALETTE[fallbackIndex % F1_PALETTE.length];
    // Driver -> team lookup is intentionally duplicated here (small file)
    // so chart code doesn't depend on the broader driver registry.
    const lookup: Record<string, string> = {
        VER: "Red Bull Racing", PER: "Red Bull Racing",
        HAM: "Mercedes", RUS: "Mercedes",
        LEC: "Ferrari", SAI: "Ferrari",
        NOR: "McLaren", PIA: "McLaren",
        ALO: "Aston Martin", STR: "Aston Martin",
        GAS: "Alpine", OCO: "Alpine",
        ALB: "Williams", SAR: "Williams",
        TSU: "RB", RIC: "RB",
        MAG: "Haas", HUL: "Haas",
        BOT: "Kick Sauber", ZHO: "Kick Sauber",
    };
    const upper = input.toUpperCase();
    const team = lookup[upper];
    if (team && TEAM_COLORS[team]) return TEAM_COLORS[team];
    return F1_PALETTE[fallbackIndex % F1_PALETTE.length];
}
