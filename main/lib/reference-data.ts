/**
 * F1 Reference Data (dynamic, overridable)
 * ========================================
 * Driver codes, name aliases, Grand Prix names/patterns, session codes, and
 * team names used by the planner, intent analyzer, and fallback paths.
 *
 * Every dataset ships with the historical built-in default (preserving current
 * behavior) and can be overridden at runtime via:
 *   1. Environment JSON variables (no code change), e.g.
 *      F1_GP_PATTERNS_JSON='[{"match":"Monaco","name":"Monaco"}]'
 *   2. Runtime registration: registerReferenceData({ ... }) / resetReferenceData()
 *      (used by long-lived servers that fetch fresh data, and by tests).
 *
 * For fully dynamic operation, call `registerReferenceData()` at startup with
 * data discovered from the F1 API (e.g. get_events/get_driver_standings) so
 * heuristics track the live season instead of the built-in snapshot.
 */

import { envJson } from "./config";

// =============================================================================
// Built-in defaults (historical snapshot — behavior-preserving fallback)
// =============================================================================

const BUILTIN_DRIVER_CODES: string[] = [
    "VER", "HAM", "LEC", "SAI", "PER", "NOR", "PIA", "RUS", "ALO",
    "GAS", "OCO", "STR", "ALB", "HUL", "MAG", "BOT", "ZHO", "TSU",
    "RIC", "SAR", "LAW", "BEA", "ANT", "COL", "BOR", "DOO",
];

const BUILTIN_DRIVER_NAME_TO_CODE: Record<string, string> = {
    "max verstappen": "VER", "verstappen": "VER",
    "lewis hamilton": "HAM", "hamilton": "HAM",
    "charles leclerc": "LEC", "leclerc": "LEC",
    "carlos sainz": "SAI", "sainz": "SAI",
    "sergio perez": "PER", "perez": "PER", "checo": "PER",
    "lando norris": "NOR", "norris": "NOR", "lando": "NOR",
    "oscar piastri": "PIA", "piastri": "PIA",
    "george russell": "RUS", "russell": "RUS",
    "fernando alonso": "ALO", "alonso": "ALO",
    "pierre gasly": "GAS", "gasly": "GAS",
    "esteban ocon": "OCO", "ocon": "OCO",
    "lance stroll": "STR", "stroll": "STR",
    "alex albon": "ALB", "albon": "ALB", "alexander albon": "ALB",
    "nico hulkenberg": "HUL", "hulkenberg": "HUL",
    "kevin magnussen": "MAG", "magnussen": "MAG",
    "valtteri bottas": "BOT", "bottas": "BOT",
    "zhou guanyu": "ZHO", "zhou": "ZHO",
    "yuki tsunoda": "TSU", "tsunoda": "TSU",
    "daniel ricciardo": "RIC", "ricciardo": "RIC",
    "logan sargeant": "SAR", "sargeant": "SAR",
    "liam lawson": "LAW", "lawson": "LAW",
    "oliver bearman": "BEA", "bearman": "BEA",
    "andrea antonelli": "ANT", "antonelli": "ANT", "kim antonelli": "ANT",
    "franco colapinto": "COL", "colapinto": "COL",
    "jack doohan": "DOO", "doohan": "DOO",
};

const BUILTIN_GP_NAMES: string[] = [
    "Monaco", "Monza", "Spa", "Suzuka", "Abu Dhabi", "Singapore",
    "Hungary", "Spain", "Austria", "Britain", "British", "Netherlands",
    "Brazil", "Mexico", "Canada", "Bahrain", "Saudi Arabia", "Jeddah",
    "Australia", "Japan", "Qatar", "Las Vegas", "Miami", "Emilia Romagna",
    "Belgium", "Italy", "United States", "USA", "Austin",
];

export interface GpPattern {
    /** Regex source matched case-insensitively against the user message. */
    match: string;
    /** Canonical GP name used in tool args. */
    name: string;
}

const BUILTIN_GP_PATTERNS: GpPattern[] = [
    { match: "monaco", name: "Monaco" },
    { match: "silverstone|british", name: "Silverstone" },
    { match: "monza|italian", name: "Monza" },
    { match: "spa|belgium|belgian", name: "Belgium" },
    { match: "suzuka|japanese|japan", name: "Japan" },
    { match: "austin|us\\s*gp|united states", name: "United States" },
    { match: "bahrain", name: "Bahrain" },
    { match: "saudi|jeddah", name: "Saudi Arabia" },
    { match: "australia|melbourne", name: "Australia" },
    { match: "miami", name: "Miami" },
    { match: "canada|montreal", name: "Canada" },
    { match: "austria|spielberg", name: "Austria" },
    { match: "hungary|hungaroring", name: "Hungary" },
    { match: "netherlands|zandvoort", name: "Netherlands" },
    { match: "singapore", name: "Singapore" },
    { match: "mexico", name: "Mexico" },
    { match: "brazil|interlagos", name: "Brazil" },
    { match: "vegas|las vegas", name: "Las Vegas" },
    { match: "qatar", name: "Qatar" },
    { match: "abu dhabi", name: "Abu Dhabi" },
];

const BUILTIN_SESSION_MAP: Record<string, string> = {
    "fp1": "FP1", "fp2": "FP2", "fp3": "FP3",
    "qualifying": "Q", "quali": "Q",
    "sprint qualifying": "SQ", "sprint shootout": "SS",
    "sprint": "S", "race": "R",
};

const BUILTIN_SESSION_CODES: string[] = ["FP1", "FP2", "FP3", "Q", "SQ", "SS", "S", "R"];

const BUILTIN_TEAMS: string[] = [
    "Red Bull", "Mercedes", "Ferrari", "McLaren", "Aston Martin",
    "Alpine", "Williams", "RB", "Haas", "Kick Sauber",
];

// =============================================================================
// Runtime overrides (env JSON + programmatic registration)
// =============================================================================

export interface ReferenceDataOverrides {
    driverCodes?: string[];
    driverNameToCode?: Record<string, string>;
    gpNames?: string[];
    gpPatterns?: GpPattern[];
    sessionMap?: Record<string, string>;
    sessionCodes?: string[];
    teams?: string[];
}

let runtimeOverrides: ReferenceDataOverrides = {};

/**
 * Register reference data discovered at runtime (e.g. from the F1 API at
 * startup). Merges over built-ins and env JSON overrides. Pass a partial
 * object — only the provided datasets are replaced.
 */
export function registerReferenceData(overrides: ReferenceDataOverrides): void {
    runtimeOverrides = { ...runtimeOverrides, ...overrides };
}

/** Clear runtime registrations (used by tests). */
export function resetReferenceData(): void {
    runtimeOverrides = {};
}

function mergedList<T>(runtime: T[] | undefined, envName: string, builtin: T[]): T[] {
    if (runtime !== undefined) return runtime;
    const fromEnv = envJson<T[] | undefined>(envName, undefined);
    if (fromEnv !== undefined) return fromEnv;
    return builtin;
}

function mergedMap(runtime: Record<string, string> | undefined, envName: string, builtin: Record<string, string>): Record<string, string> {
    const fromEnv = envJson<Record<string, string> | undefined>(envName, undefined);
    return { ...builtin, ...(fromEnv ?? {}), ...(runtime ?? {}) };
}

// =============================================================================
// Accessors (consumers must use these — never the built-ins directly)
// =============================================================================

export function getDriverCodes(): string[] {
    return mergedList(runtimeOverrides.driverCodes, "F1_DRIVERS_JSON", BUILTIN_DRIVER_CODES);
}

export function getDriverNameToCode(): Record<string, string> {
    return mergedMap(runtimeOverrides.driverNameToCode, "F1_DRIVER_ALIASES_JSON", BUILTIN_DRIVER_NAME_TO_CODE);
}

export function getGpNames(): string[] {
    return mergedList(runtimeOverrides.gpNames, "F1_GP_NAMES_JSON", BUILTIN_GP_NAMES);
}

export function getGpPatterns(): GpPattern[] {
    return mergedList(runtimeOverrides.gpPatterns, "F1_GP_PATTERNS_JSON", BUILTIN_GP_PATTERNS);
}

export function getSessionMap(): Record<string, string> {
    return mergedMap(runtimeOverrides.sessionMap, "F1_SESSION_MAP_JSON", BUILTIN_SESSION_MAP);
}

export function getSessionCodes(): string[] {
    return mergedList(runtimeOverrides.sessionCodes, "F1_SESSIONS_JSON", BUILTIN_SESSION_CODES);
}

export function getTeams(): string[] {
    return mergedList(runtimeOverrides.teams, "F1_TEAMS_JSON", BUILTIN_TEAMS);
}

/** Detect a GP name in free text using the configured patterns. */
export function detectGpName(message: string): string | null {
    for (const { match, name } of getGpPatterns()) {
        try {
            if (new RegExp(match, "i").test(message)) return name;
        } catch {
            if (message.toLowerCase().includes(match.toLowerCase())) return name;
        }
    }
    return null;
}

/** One-line driver-code reference for prompts (generated, not hardcoded). */
export function driverCodesPromptList(): string {
    return getDriverCodes().join(", ");
}
