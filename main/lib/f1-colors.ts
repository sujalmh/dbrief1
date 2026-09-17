/**
 * F1 Driver/Team Colors
 * =====================
 * Single source of truth for driver highlight + team colors.
 *
 * Two layers (first hit wins):
 *   1. LEARNED (live data) — `learnColorsFromPayload()` scans tool-result
 *      payloads (results/qualifying/race/driver rows carry `Abbreviation` +
 *      `TeamName` + `TeamColor` straight from FastF1) and memorizes the
 *      driver→team→color mapping, tagged with season when known. This is
 *      what keeps colors correct across seasons and mid-season swaps with
 *      zero code changes: whatever the API returns wins.
 *   2. STATIC (fallback) — the last fully-curated grid below, used only
 *      when no live data has been seen (e.g. pure regulation answers).
 *      Stale entries here are harmless: layer 1 overrides them.
 */

export const TEAM_COLORS: Record<string, string> = {
    "Red Bull Racing": "#3671C6", // Adjusted for better readability on dark/light
    "Mercedes": "#00D2BE",
    "Ferrari": "#E8002D", // Official Ferrari Red
    "McLaren": "#FF8700",
    "Aston Martin": "#229971",
    "Alpine": "#0090FF",
    "Williams": "#64C4FF",
    "RB": "#6692FF", // Visa Cash App RB
    "Haas": "#B6BABD", // Grey works better than white on white backgrounds
    "Kick Sauber": "#52E252",
    "Renault": "#FFF500",
    "Racing Point": "#F596C8",
    "AlphaTauri": "#2B4562",
    "Alfa Romeo": "#900000"
}

export const DRIVER_TO_TEAM: Record<string, string> = {
    // 2024 Grid
    "VER": "Red Bull Racing", "Max Verstappen": "Red Bull Racing",
    "PER": "Red Bull Racing", "Sergio Perez": "Red Bull Racing",
    "HAM": "Mercedes", "Lewis Hamilton": "Mercedes",
    "RUS": "Mercedes", "George Russell": "Mercedes",
    "LEC": "Ferrari", "Charles Leclerc": "Ferrari",
    "SAI": "Ferrari", "Carlos Sainz": "Ferrari",
    "NOR": "McLaren", "Lando Norris": "McLaren",
    "PIA": "McLaren", "Oscar Piastri": "McLaren",
    "ALO": "Aston Martin", "Fernando Alonso": "Aston Martin",
    "STR": "Aston Martin", "Lance Stroll": "Aston Martin",
    "GAS": "Alpine", "Pierre Gasly": "Alpine",
    "OCO": "Alpine", "Esteban Ocon": "Alpine",
    "ALB": "Williams", "Alex Albon": "Williams",
    "SAR": "Williams", "Logan Sargeant": "Williams",
    "TSU": "RB", "Yuki Tsunoda": "RB",
    "RIC": "RB", "Daniel Ricciardo": "RB",
    "MAG": "Haas", "Kevin Magnussen": "Haas",
    "HUL": "Haas", "Nico Hulkenberg": "Haas",
    "BOT": "Kick Sauber", "Valtteri Bottas": "Kick Sauber",
    "ZHO": "Kick Sauber", "Zhou Guanyu": "Kick Sauber",
    // Common Nicknames/Shortnames mapping (optional but helpful)
    "Checo": "Red Bull Racing",
    "Max": "Red Bull Racing",
    "Lewis": "Mercedes",
    "Fernando": "Aston Martin",
    "Lando": "McLaren"
}

// 1. Generate a list of all matchable tokens (Full names, codes, First names, Last names)
const MATCHABLE_TOKENS = new Set<string>();

function collectTokens(keys: Iterable<string>, into: Set<string>) {
    for (const key of keys) {
        const cleanKey = key.trim();
        if (!cleanKey) continue;
        into.add(cleanKey);
        if (cleanKey.includes(" ")) {
            for (const part of cleanKey.split(" ")) {
                if (part.length > 2) into.add(part); // Avoid 1-2 letter generic words
            }
        }
    }
}

collectTokens(Object.keys(DRIVER_TO_TEAM), MATCHABLE_TOKENS);

// 2. Create a Regex that matches longer names first (e.g. match "Max Verstappen" before "Max")
function buildDriverRegex(extraTokens: Iterable<string> = []): RegExp {
    const tokens = new Set<string>(MATCHABLE_TOKENS);
    collectTokens(extraTokens, tokens);
    const sorted = Array.from(tokens)
        .sort((a, b) => b.length - a.length)
        .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Escape regex chars
    // Global Regex: Matches any token surrounded by word boundaries
    return new RegExp(`\\b(${sorted.join("|")})\\b`, "gi");
}

// Global Regex (static grid only — see getDriverPattern for the learned-aware version)
export const DRIVER_REGEX = buildDriverRegex();

// ---------------------------------------------------------------------------
// Learned registry (live API data wins over the static grid)
// ---------------------------------------------------------------------------

interface LearnedEntry {
    team: string;
    color: string;
    /** Season the entry was observed in (undefined when unknown). */
    season?: number;
}

/** Driver code or full name (upper-cased) → learned entry. */
const learnedDrivers = new Map<string, LearnedEntry>();
/** Team name (lower-cased) → learned color. */
const learnedTeams = new Map<string, { color: string; season?: number }>();
/** Extra highlight tokens contributed by learned data (codes + surnames). */
const learnedTokens = new Set<string>();
/** Bumped on every successful learn; UI memoizes the regex on this. */
let learnedVersion = 0;

export function learnedColorsVersion(): number {
    return learnedVersion;
}

/** Rebuild the highlight pattern including learned driver codes/names. */
export function getDriverPattern(): RegExp {
    return buildDriverRegex(learnedTokens);
}

/** Normalize a FastF1-style color ("3671c6" or "#3671C6") or return null. */
function normalizeColor(value: unknown): string | null {
    if (typeof value !== "string") return null;
    let v = value.trim();
    if (!v) return null;
    if (!v.startsWith("#")) v = `#${v}`;
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : null;
}

function seasonOf(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isInteger(value) && value >= 1950 && value <= 2100) return value;
    if (typeof value === "string" && /^(19|20)\d{2}$/.test(value.trim())) return parseInt(value.trim(), 10);
    return undefined;
}

function learnRow(row: Record<string, unknown>, season?: number): boolean {
    const code = [row.Abbreviation, row.Driver, row.driver_code, row.driver]
        .find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim();
    const fullName = [row.FullName, row.full_name, row.BroadcastName]
        .find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim();
    const team = [row.TeamName, row.team, row.Team]
        .find((v): v is string => typeof v === "string" && v.trim().length > 0)?.trim();
    const color = normalizeColor(row.TeamColor ?? row.team_color);
    if ((!code && !fullName) || !team || !color) return false;

    const entry: LearnedEntry = { team, color, season };
    if (code) {
        learnedDrivers.set(code.toUpperCase(), entry);
        if (code.length === 3) learnedTokens.add(code.toUpperCase());
    }
    if (fullName) {
        learnedDrivers.set(fullName.toUpperCase(), entry);
        learnedTokens.add(fullName);
        for (const part of fullName.split(" ")) {
            if (part.length > 2) learnedTokens.add(part);
        }
    }
    const prev = learnedTeams.get(team.toLowerCase());
    // Prefer season-tagged observations; otherwise newest wins.
    if (!prev || (season !== undefined && prev.season !== season)) {
        learnedTeams.set(team.toLowerCase(), { color, season });
    }
    return true;
}

/**
 * Scan an arbitrary tool-result payload for driver/team/color rows and
 * memorize them. Handles the `visualization` SSE envelope
 * (`[{tool, args, success, data}]`, season read from `args.year`) as well
 * as bare result arrays. Bounded (depth + item caps) so pathological
 * payloads can't hang rendering. Returns the number of entries learned.
 */
export function learnColorsFromPayload(payload: unknown, defaultSeason?: number): number {
    let learned = 0;
    let visited = 0;
    const walk = (value: unknown, depth: number, season?: number): void => {
        if (value === null || typeof value !== "object" || depth > 5 || visited > 5000) return;
        if (Array.isArray(value)) {
            const items = value.slice(0, 500);
            visited += items.length;
            for (const item of items) walk(item, depth + 1, season);
            return;
        }
        visited++;
        const rec = value as Record<string, unknown>;
        // Visualization envelope items carry their own season in args.
        const itemSeason = seasonOf((rec.args as Record<string, unknown> | undefined)?.year)
            ?? seasonOf(rec.year ?? rec.season)
            ?? season
            ?? defaultSeason;
        if (learnRow(rec, itemSeason)) learned++;
        for (const key of ["data", "results", "drivers", "teams", "laps"]) {
            if (rec[key] !== undefined) walk(rec[key], depth + 1, itemSeason);
        }
    };
    walk(payload, 0, defaultSeason);
    if (learned > 0) learnedVersion++;
    return learned;
}

/** First season year found in a tool-result envelope (args.year), if any. */
export function seasonFromPayload(payload: unknown): number | undefined {
    if (!Array.isArray(payload)) return undefined;
    for (const item of payload.slice(0, 20)) {
        if (typeof item !== "object" || item === null) continue;
        const args = (item as Record<string, unknown>).args as Record<string, unknown> | undefined;
        const s = seasonOf(args?.year);
        if (s !== undefined) return s;
    }
    return undefined;
}

/** Color for a team name: learned live color first, static map fallback. */
export function resolveTeamColor(team: string | undefined | null): string | null {
    if (!team) return null;
    const learned = learnedTeams.get(team.toLowerCase());
    if (learned) return learned.color;
    return TEAM_COLORS[team] ?? null;
}

export function getDriverColor(input: string, season?: number): string {
    if (!input) return "#FFFFFF";
    const normalized = input.trim().toLowerCase();

    // 1. Learned (live API data). Prefer a season match, else any entry.
    const directLearned = learnedDrivers.get(normalized.toUpperCase());
    const partialLearned = directLearned ? undefined : Array.from(learnedDrivers.keys()).find(k => {
        const parts = k.toLowerCase().split(" ");
        return parts.includes(normalized);
    });
    const learnedKey = directLearned ? normalized.toUpperCase() : partialLearned;
    if (learnedKey) {
        const entry = learnedDrivers.get(learnedKey)!;
        if (season === undefined || entry.season === undefined || entry.season === season) {
            return entry.color;
        }
        // Season mismatch: fall through to static rather than show the
        // wrong year's color... unless nothing else knows this driver.
        const staticKnown = Object.keys(DRIVER_TO_TEAM).some(k => k.toLowerCase() === normalized);
        if (!staticKnown) return entry.color;
    }

    // 2. Static grid fallback.
    const directKey = Object.keys(DRIVER_TO_TEAM).find(k => k.toLowerCase() === normalized);
    if (directKey) {
        const team = DRIVER_TO_TEAM[directKey];
        return resolveTeamColor(team) ?? "#FFFFFF";
    }

    // Try finding a key that contains this part (e.g. Input: "Verstappen" -> Key: "Max Verstappen")
    const partialKey = Object.keys(DRIVER_TO_TEAM).find(key => {
        const parts = key.toLowerCase().split(" ");
        return parts.includes(normalized);
    });

    if (partialKey) {
        const team = DRIVER_TO_TEAM[partialKey];
        return resolveTeamColor(team) ?? "#FFFFFF";
    }

    return "#FFFFFF";
}