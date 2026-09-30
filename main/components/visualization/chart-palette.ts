/**
 * F1 Color Tokens
 * ===============
 *
 * Chart-facing palette. Driver/team colors live in `lib/f1-colors.ts`
 * (single source of truth, learned from live API data) and are
 * re-exported here so chart components keep one import.
 *
 * Palette:
 *   - `F1_PALETTE` is the curated high-contrast comparison palette.
 *     It leads with steering-wheel hues (yellow, blue, cyan, orange)
 *     so telemetry / comparison line series read like an F1 wheel;
 *     team colors live in `lib/f1-colors.ts`, imported directly.
 *   - `DRIVER_COLOR` is the convenience "color for a driver code" helper
 *   - `CHART_TOKENS` is the bag of color tokens used by chart wrappers
 *   - `TELEMETRY_CHANNEL_COLORS` pins each telemetry channel to a fixed
 *     steering-wheel hue so speed/throttle/brake/gear keep one identity
 *     across every chart.
 */

import { getDriverColor } from "@/lib/f1-colors";

/** Steering-wheel hues — one per classifier mode / primary series. */
export const STEERING_COLORS = {
    yellow: "#FFEA00",
    blue: "#0090FF",
    cyan: "#00D2BE",
    orange: "#FF8700",
} as const;

export const F1_PALETTE = [
    STEERING_COLORS.yellow, // Yellow — steering wheel
    STEERING_COLORS.blue, // Blue — steering wheel
    STEERING_COLORS.cyan, // Cyan/teal — steering wheel
    STEERING_COLORS.orange, // Orange — steering wheel
    "#F2059F", // Pink (high contrast)
    "#52E252", // Lime
    "#A855F7", // Purple
    "#E10600", // Red
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
 * Fixed telemetry-channel → steering-wheel color map. Channel names are
 * matched case-insensitively so planner/aggregator variants ("Speed",
 * "speed", "nGear", "DRS") all resolve to one stable hue.
 */
export const TELEMETRY_CHANNEL_COLORS: Record<string, string> = {
    speed: STEERING_COLORS.yellow,
    throttle: STEERING_COLORS.cyan,
    brake: STEERING_COLORS.orange,
    gear: STEERING_COLORS.blue,
    ngear: STEERING_COLORS.blue,
    rpm: "#F2059F",
    drs: "#A855F7",
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

/**
 * Color for a line/area series key. Telemetry channels pin to their fixed
 * steering-wheel hue; driver codes/names resolve to team colors; anything
 * else cycles the steering-wheel-led palette so multi-driver comparisons
 * stay distinguishable.
 */
export function colorForSeries(series: string | undefined, fallbackIndex = 0): string {
    if (!series) return F1_PALETTE[fallbackIndex % F1_PALETTE.length];
    const channel = TELEMETRY_CHANNEL_COLORS[series.trim().toLowerCase()];
    if (channel) return channel;
    const learned = getDriverColor(series);
    if (learned !== "#FFFFFF") return learned;
    return F1_PALETTE[fallbackIndex % F1_PALETTE.length];
}
