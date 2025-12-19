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

Object.keys(DRIVER_TO_TEAM).forEach(key => {
    const cleanKey = key.trim();
    MATCHABLE_TOKENS.add(cleanKey); // Add "Max Verstappen"

    // Split names to add "Max" and "Verstappen" individually
    if (cleanKey.includes(" ")) {
        const parts = cleanKey.split(" ");
        parts.forEach(part => {
            if (part.length > 2) MATCHABLE_TOKENS.add(part); // Avoid 1-2 letter generic words
        });
    }
});

// 2. Create a Regex that matches longer names first (e.g. match "Max Verstappen" before "Max")
const SORTED_TOKENS = Array.from(MATCHABLE_TOKENS)
    .sort((a, b) => b.length - a.length)
    .map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Escape regex chars

// Global Regex: Matches any token surrounded by word boundaries
export const DRIVER_REGEX = new RegExp(`\\b(${SORTED_TOKENS.join("|")})\\b`, "gi");

export function getDriverColor(input: string): string {
    if (!input) return "#FFFFFF";
    const normalized = input.trim().toLowerCase();

    // Try direct lookup
    const directKey = Object.keys(DRIVER_TO_TEAM).find(k => k.toLowerCase() === normalized);
    if (directKey) return TEAM_COLORS[DRIVER_TO_TEAM[directKey]];

    // Try finding a key that contains this part (e.g. Input: "Verstappen" -> Key: "Max Verstappen")
    const partialKey = Object.keys(DRIVER_TO_TEAM).find(key => {
        const parts = key.toLowerCase().split(" ");
        return parts.includes(normalized);
    });

    if (partialKey) return TEAM_COLORS[DRIVER_TO_TEAM[partialKey]];

    return "#FFFFFF";
}