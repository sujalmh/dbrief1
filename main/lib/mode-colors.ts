/**
 * Mode / classifier colors
 * ========================
 *
 * Single source of truth for the Telemetry / Comparison / Strategy /
 * Insights classifier colors. Distinct high-visibility hues inspired by
 * F1 steering-wheel buttons/LEDs so each capability reads instantly:
 *
 *   - Telemetry  → yellow #FFEA00
 *   - Comparison → blue   #0090FF
 *   - Strategy   → cyan   #00D2BE
 *   - Insights   → orange #FF8700
 *
 * Import this map wherever a mode badge, dot, pill, or session-type chip
 * is rendered (landing showcase, header ModePill, sidebar type chip) so
 * the classifier never drifts into second copies.
 */

export type ModeLabel = "Telemetry" | "Comparison" | "Strategy" | "Insights";

export const MODE_COLORS: Record<ModeLabel, string> = {
    Telemetry: "#FFEA00",
    Comparison: "#0090FF",
    Strategy: "#00D2BE",
    Insights: "#FF8700",
};

/** Hex color for a mode name (case-insensitive, falls back to red). */
export function modeColor(mode: string | undefined | null): string {
    if (!mode) return "#E10600";
    const key = (mode.charAt(0).toUpperCase() + mode.slice(1).toLowerCase()) as ModeLabel;
    return MODE_COLORS[key] ?? "#E10600";
}
